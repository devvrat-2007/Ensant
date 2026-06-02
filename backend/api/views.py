import os
import json
import time
import tempfile
import hashlib
import math
import requests as http_requests
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.core.cache import cache
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.permissions import IsAdminUser, AllowAny, IsAuthenticated
from rest_framework.parsers import MultiPartParser, JSONParser, FormParser
from django.db.models import Avg

# LangChain for Vector/RAG operations
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_community.tools import DuckDuckGoSearchRun
from sentence_transformers import CrossEncoder

# Native Google SDK for Text Generation
from google import genai
from google.genai import types, errors

# Optional: For real CPU tracking
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

from django.utils import timezone
from .models import AuditLog, ChatSession
from .tasks import process_and_embed_document
from .services.ai_service import EMBEDDING_MODEL

reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))

# Generative model used for every text-generation task. Centralized so a
# "model shift" is a single-line change. Must be a Gemini model: the pipeline
# relies on system_instruction and response_mime_type (JSON mode), neither of
# which Gemma models support on the Gemini API. NOTE: this is NOT the embedding
# model (gemini-embedding-001) — that is a separate model class.
GENERATIVE_MODEL = "gemini-3.5-flash"
FALLBACK_MODEL = "gemini-3.1-flash-lite"

# Vision-capable model. Gemma is text-only on the public API; Gemini 2.5 Flash
# supports inline image bytes. Used ONLY for the Vision-First path so the
# 20 req/day free-tier quota is not consumed by text tasks.
VISION_MODEL = "gemini-3.5-flash"

# MIME types that trigger the Vision-First path instead of RAG.
_IMAGE_MIME_PREFIXES = ("image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif")


def safe_generate(client_instance, model_name, contents, config=None):
    """
    Fortified content wrapper. Intercepts broad upstream exceptions and 
    silently reroutes to the Flash-Lite tier before bubbling errors.
    """
    try:
        return client_instance.models.generate_content(model=model_name, contents=contents, config=config)
    except Exception as e:
        error_str = str(e).lower()
        if any(msg in error_str for msg in ["429", "503", "unavailable", "exhausted", "quota"]):
            print(f"⚠️ Primary model overloaded ({model_name}). Cascading to {FALLBACK_MODEL}...")
            try:
                return client_instance.models.generate_content(model=FALLBACK_MODEL, contents=contents, config=config)
            except Exception as fallback_err:
                raise fallback_err
        raise e

def safe_generate_stream(client_instance, model_name, contents, config=None):
    """
    Streams content safely. Initial handshakes are protected; downstream 
    mid-stream drops are safely handled via chunk generator loops.
    """
    try:
        return client_instance.models.generate_content_stream(model=model_name, contents=contents, config=config)
    except Exception as e:
        error_str = str(e).lower()
        if any(msg in error_str for msg in ["429", "503", "unavailable", "exhausted", "quota"]):
            print(f"⚠️ Stream connection overloaded. Cascading to fallback model {FALLBACK_MODEL}...")
            try:
                return client_instance.models.generate_content_stream(model=FALLBACK_MODEL, contents=contents, config=config)
            except Exception as fallback_err:
                raise fallback_err
        raise e

def refine_query(raw_query):
    try:
        refine_prompt = (
            f"You are a search query optimizer. Strip all conversational metadata, greetings, filler words, "
            f"and explicit references to files, images, diagrams, or uploads from the following user input. "
            f"Output ONLY the core technical keywords, entities, and semantic intent required for a vector database search.\n\n"
            f"User Input: {raw_query}\n\n"
            f"Optimized Search Query:"
        )
        response = safe_generate(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
            contents=refine_prompt
        )
        return response.text.strip()
    except Exception:
        return raw_query

class ChatView(APIView):
    # Accept both JSON (standard chat) and multipart/form-data (inline image
    # uploads for the Vision-First path).
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @staticmethod
    def _is_image_mime(file) -> bool:
        """Return True if *file*'s content_type is a supported image MIME type.

        Checked against ``_IMAGE_MIME_PREFIXES`` using ``startswith`` so that
        subtypes with parameters (e.g. ``image/jpeg; charset=...``) still match.
        """
        mime = getattr(file, "content_type", "") or ""
        return any(mime.startswith(prefix) for prefix in _IMAGE_MIME_PREFIXES)

    def post(self, request):
        start_time = time.time()  # Start the latency timer
        
        if request.data.get('clear_history'):
            return JsonResponse({'status': 'cleared'})

        message = request.data.get('message', '')
        allow_web_search = request.data.get('allow_web_search', False)
        is_direct_task = request.data.get('is_direct_task', False)
        task_type = request.data.get('task_type', '')
        session_id = request.data.get('session_id', None)

        # Initialize so the outer `except` can safely reference it even if an
        # error is raised before a session is resolved/created.
        session = None

        # Validate the payload BEFORE touching the database so an empty message
        # never creates a ghost "New Chat" session.
        if not message:
            return Response({"error": "The 'message' field is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Session-scoped history
        if session_id:
            try:
                session = ChatSession.objects.get(id=session_id, user=request.user)
            except ChatSession.DoesNotExist:
                return Response({"error": "Session not found."}, status=status.HTTP_404_NOT_FOUND)
        else:
            title = ' '.join(message.split()[:4]) or "New Chat"
            session = ChatSession.objects.create(title=title, user=request.user)

        last_logs = AuditLog.objects.filter(session=session, is_agentic=False).order_by('-created_at')[:10]
        chat_history = [{'user': log.user_prompt, 'model': log.ai_response} for log in reversed(last_logs)]
            
        casual_tokens = {'hello', 'hi', 'hey', 'greetings', 'yo', 'sup', 'help'}
        clean_query = message.lower().strip().strip('?!.')
        
        try:
            # ── 0. VISION-FIRST PATH ─────────────────────────────────────────
            # If the request carries an inline image, handle it before any other
            # routing (greetings, router, direct-task, Pinecone checks). Image
            # analysis needs neither the RAG pipeline nor a Pinecone key, so it
            # must not be gated behind them. Falls through to the normal flow
            # only if vision inference fails or returns empty text.
            inline_image = request.FILES.get("image")
            if inline_image and self._is_image_mime(inline_image):
                try:
                    image_bytes = inline_image.read()
                    vision_part = types.Part.from_bytes(
                        data=image_bytes,
                        mime_type=inline_image.content_type,
                    )
                    vision_system = (
                        "You are an expert vision analyst. Analyze the provided image in detail. "
                        "Focus on text, diagrams, and overall context. Do not search for vector "
                        "chunks; rely entirely on your visual reasoning capabilities."
                    )
                    vision_response = safe_generate(
                    client_instance=client,
                    model_name=VISION_MODEL,
                        contents=[vision_part, message],
                        config=types.GenerateContentConfig(
                            system_instruction=vision_system,
                            temperature=0.2,
                        ),
                    )
                    vision_text = (vision_response.text or "").strip()
                    if vision_text:
                        latency_ms = int((time.time() - start_time) * 1000)
                        AuditLog.objects.create(
                            session=session,
                            user_prompt=message,
                            ai_response=vision_text,
                            latency_ms=latency_ms,
                            is_vector_hit=False,
                            metadata={"vision_model": VISION_MODEL, "image_file": inline_image.name},
                        )
                        return Response(
                            {
                                "role": "assistant",
                                "content": vision_text,
                                "session_id": str(session.id),
                                "extras": {
                                    "fallback_triggered": False,
                                    "chunks_used": 0,
                                    "sources": [f"Vision Analysis ({inline_image.name})"],
                                    "vision_path": True,
                                },
                            },
                            status=status.HTTP_200_OK,
                        )
                except Exception as vision_err:
                    # Vision inference failed — return a clean JSON error
                    # immediately rather than falling through to the SSE
                    # pipeline (which would cause a JSON parse error on the
                    # frontend expecting a JSON response for this path).
                    print(f"Warning: Vision inference failed ({vision_err}).")
                    latency_ms = int((time.time() - start_time) * 1000)
                    AuditLog.objects.create(
                        session=session,
                        user_prompt=message,
                        ai_response=f"[Vision Error] {vision_err}",
                        latency_ms=latency_ms,
                        is_vector_hit=False,
                        metadata={"vision_model": VISION_MODEL, "error": str(vision_err)},
                    )
                    return Response(
                        {
                            "role": "assistant",
                            "content": (
                                "⚠️ **Image Analysis Failed.** "
                                "I couldn't process this image right now. "
                                "Please try again or describe what you need in text."
                            ),
                            "session_id": str(session.id),
                            "extras": {
                                "fallback_triggered": True,
                                "chunks_used": 0,
                                "sources": [],
                                "vision_path": True,
                            },
                        },
                        status=status.HTTP_200_OK,
                    )

                # Vision returned empty text — same clean JSON error.
                if inline_image and self._is_image_mime(inline_image):
                    latency_ms = int((time.time() - start_time) * 1000)
                    AuditLog.objects.create(
                        session=session,
                        user_prompt=message,
                        ai_response="[Vision returned empty response]",
                        latency_ms=latency_ms,
                        is_vector_hit=False,
                        metadata={"vision_model": VISION_MODEL, "error": "empty_response"},
                    )
                    return Response(
                        {
                            "role": "assistant",
                            "content": (
                                "⚠️ **Image Analysis Returned No Content.** "
                                "The model couldn't extract information from this image. "
                                "Try a clearer image or describe what you need."
                            ),
                            "session_id": str(session.id),
                            "extras": {
                                "fallback_triggered": True,
                                "chunks_used": 0,
                                "sources": [],
                                "vision_path": True,
                            },
                        },
                        status=status.HTTP_200_OK,
                    )
            # ── END VISION-FIRST PATH ────────────────────────────────────────

            # 1. SHORT-CIRCUIT FOR GREETINGS
            if clean_query in casual_tokens or len(clean_query) < 4:
                response_stream = safe_generate_stream(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
                    contents=f"The user said '{message}'. Respond warmly as an expert Enterprise Sales Assistant and ask how you can help them analyze their technical workflows or documents today."
                )
                
                def basic_sse_generator(stream):
                    full_text = ""
                    try:
                        for chunk in stream:
                            if chunk.text:
                                full_text += chunk.text
                                safe_payload = json.dumps({"text": chunk.text})
                                yield f"data: {safe_payload}\n\n"
                    except Exception as e:
                        error_msg = str(e).lower()
                        if "429" in error_msg or "exhausted" in error_msg:
                            full_text += "\n[System Traffic Alert]"
                            yield 'data: {"text": "⚠️ **System Traffic Alert:** The enterprise AI network is currently processing a high volume of requests. Please wait 30 seconds and try your message again."}\n\n'
                        else:
                            full_text += "\n[System Error]"
                            yield f'data: {{"text": "⚠️ **System Error:** An unexpected error occurred: {str(e)}"}}\n\n'
                    finally:
                        latency_ms = int((time.time() - start_time) * 1000)
                        AuditLog.objects.create(session=session, user_prompt=message, ai_response=full_text, latency_ms=latency_ms, is_vector_hit=False)

                streaming_response = StreamingHttpResponse(basic_sse_generator(response_stream), content_type='text/event-stream')
                streaming_response['Cache-Control'] = 'no-cache'
                streaming_response['X-Accel-Buffering'] = 'no'
                streaming_response['X-Session-Id'] = str(session.id)
                return streaming_response

            google_api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            pinecone_index_name = os.environ.get("PINECONE_INDEX_NAME", "flowzint-hackathon")
            
            if not google_api_key:
                 return Response({"error": "Missing GEMINI_API_KEY in environment."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # 2. THE ROUTER
            if not is_direct_task and not allow_web_search:
                try:
                    router_prompt = (
                        "Analyze the following user message to an enterprise assistant. Determine if they are asking a factual question, or if they are giving an explicit instruction to format, draft, or structure data.\n\n"
                        "Respond with exactly one word: 'TASK' if it is an explicit formatting/generation request, or 'INFO' if it is a standard question.\n\n"
                        f"User Message: {message}"
                    )
                    response = safe_generate(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
                        contents=router_prompt,
                        config=types.GenerateContentConfig(temperature=0)
                    )
                    intent = response.text.strip().upper()
                    # Exact match only — "TASK" in intent would incorrectly
                    # match negations like "NO TASK" or verbose model replies.
                    if intent == "TASK":
                        is_direct_task = True
                except Exception as router_err:
                    # The router API call failed (quota, network, etc.).
                    # Do NOT silently fall through to the RAG pipeline — that
                    # would return "I couldn't find this in your documents" for
                    # a message that has nothing to do with documents.
                    # Instead, stream a General Assistant response directly so
                    # the user always gets a useful answer.
                    print(f"Warning: Router API call failed ({router_err}). Activating General Assistant fallback.")

                    # Force routing to the fallback model to prevent immediate duplicate execution failures
                    general_stream = safe_generate_stream(
                        client_instance=client,
                        model_name=FALLBACK_MODEL,
                        contents=message,
                        config=types.GenerateContentConfig(
                            system_instruction=(
                                "You are a helpful General Assistant for FlowZint. "
                                "The enterprise routing system is temporarily unavailable, so answer the user's question "
                                "as helpfully and accurately as possible using your general knowledge."
                            )
                        )
                    )

                    def general_fallback_generator(stream):
                        full_text = ""
                        try:
                            for chunk in stream:
                                if chunk.text:
                                    full_text += chunk.text
                                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                        except Exception as e:
                            err = str(e).lower()
                            if "429" in err or "exhausted" in err:
                                yield 'data: {"text": "⚠️ **System Traffic Alert:** High request volume. Please wait 30 seconds and try again."}\n\n'
                            else:
                                yield f"data: {json.dumps({'text': f'⚠️ An error occurred: {str(e)}'})}\n\n"
                        finally:
                            latency_ms = int((time.time() - start_time) * 1000)
                            AuditLog.objects.create(
                                session=session,
                                user_prompt=message,
                                ai_response=full_text,
                                latency_ms=latency_ms,
                                is_vector_hit=False
                            )

                    fallback_response = StreamingHttpResponse(
                        general_fallback_generator(general_stream),
                        content_type='text/event-stream'
                    )
                    fallback_response['Cache-Control'] = 'no-cache'
                    fallback_response['X-Accel-Buffering'] = 'no'
                    fallback_response['X-Session-Id'] = str(session.id)
                    return fallback_response

            # 3. DIRECT TASK EXECUTION
            if is_direct_task:
                system_instruction = "You are an expert Enterprise Sales Assistant. Help the user format, structure, or draft the requested asset professionally."
                if task_type == 'executive_summary':
                    system_instruction = "You are an Enterprise Sales Director. Condense the provided chat context into exactly 3 bullet points: 1. Executive Summary (The 'Why'), 2. Key Risks (The 'Watchouts'), and 3. Next Steps (The 'Action')."
                elif "email" in message.lower() or "mail" in message.lower():
                    system_instruction = "You are an expert Enterprise Sales Assistant. Your task is to draft a professional internal briefing email based on the context provided."
                elif "battlecard" in message.lower() or "swot" in message.lower():
                    system_instruction = "You are an expert sales strategist. Convert the provided data into a structured markdown table matrix with columns: Competitor, Core Strengths, Weaknesses, and How to Win."

                response = safe_generate(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
                    contents=message,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.3
                    )
                )
                
                # Safe Extraction: Prevents crash if safety filters block the return text block
                try:
                    generated_content = response.text
                except (ValueError, AttributeError):
                    generated_content = "⚠️ **Generation Filtered:** The request context was flagged or returned empty content. Please refine your selection."
                
                latency_ms = int((time.time() - start_time) * 1000)
                
                # Enterprise Clean Logging: Truncate strings to prevent database validation errors
                clean_task_name = task_type.replace('_', ' ').title() if task_type else "Generation Task"
                action_name = f"Agentic Action: {clean_task_name} Compiled"
                
                AuditLog.objects.create(
                    session=session, 
                    user_prompt=action_name, 
                    ai_response=generated_content, 
                    latency_ms=latency_ms, 
                    is_vector_hit=False, 
                    is_agentic=True
                )
                
                return Response({
                    "role": "assistant",
                    "content": generated_content,
                    "session_id": str(session.id),
                    "extras": {"fallback_triggered": False, "chunks_used": 0, "sources": ["Direct AI Generation Pipeline"]}
                }, status=status.HTTP_200_OK)

            if not os.environ.get("PINECONE_API_KEY"): 
                return Response({"error": "PINECONE_API_KEY missing."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # 4. PINECONE RAG SEARCH
            refined_message = refine_query(message)

            # ── CACHE CHECK ──────────────────────────────────────────────────
            # Hash the refined query so semantically identical questions share
            # the same cache key regardless of minor surface-level differences.
            cache_key = "chat:" + hashlib.md5(refined_message.encode("utf-8")).hexdigest()
            cached_response = cache.get(cache_key)
            if cached_response is not None:
                # Return the stored response immediately, skipping all RAG and
                # LLM work.  We still write an AuditLog entry so the admin
                # dashboard reflects the request, but mark it as a cache hit.
                latency_ms = int((time.time() - start_time) * 1000)
                AuditLog.objects.create(
                    session=session,
                    user_prompt=message,
                    ai_response=cached_response["content"],
                    latency_ms=latency_ms,
                    is_vector_hit=True,
                    metadata={**cached_response.get("extras", {}), "cache_hit": True},
                )
                return Response({
                    **cached_response,
                    "session_id": str(session.id),
                    "extras": {**cached_response.get("extras", {}), "cache_hit": True},
                }, status=status.HTTP_200_OK)
            # ── END CACHE CHECK ──────────────────────────────────────────────

            embeddings = GoogleGenerativeAIEmbeddings(model=EMBEDDING_MODEL, google_api_key=google_api_key)
            vectorstore = PineconeVectorStore(index_name=pinecone_index_name, embedding=embeddings)
            docs_with_scores = vectorstore.similarity_search_with_score(message, k=15)
            valid_chunks, sources = [], []
            top_score = 0
            
            if docs_with_scores:
                retrieved_docs = [doc for doc, _ in docs_with_scores]
                pairs = [[message, doc.page_content] for doc in retrieved_docs]
                scores = reranker.predict(pairs)
                
                doc_score_pairs = list(zip(retrieved_docs, scores))
                doc_score_pairs.sort(key=lambda x: x[1], reverse=True)
                
                if doc_score_pairs:
                    raw_score = doc_score_pairs[0][1]
                    top_score = int((1 / (1 + math.exp(-raw_score))) * 100)
                
                for doc, score in doc_score_pairs[:3]:
                    valid_chunks.append(doc.page_content)
                    if doc.metadata.get('source', 'Unknown Source') not in sources:
                        sources.append(doc.metadata.get('source', 'Unknown Source'))

            # 5. NO-CHUNK HANDLING: GENERAL KNOWLEDGE FALLBACK → WEB SEARCH
            if not valid_chunks:
                # ── 5a. GENERAL KNOWLEDGE STREAM ────────────────────────────
                # The vector search returned nothing useful. Rather than dead-
                # ending with a canned "I couldn't find details" message, stream
                # a general-knowledge answer so the user always gets value.
                # The web-search consent prompt is only shown when the user has
                # *explicitly* opted in via allow_web_search=True.
                if not allow_web_search:
                    general_knowledge_stream = safe_generate_stream(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
                        contents=message,
                        config=types.GenerateContentConfig(
                            system_instruction=(
                                "The user is asking a question that is not covered in the internal "
                                "documents. Answer using your own general knowledge, but maintain a "
                                "professional enterprise tone. If the answer could benefit from "
                                "internal document context, briefly note that no matching documents "
                                "were found and suggest the user upload relevant files."
                            ),
                            safety_settings=[
                                types.SafetySetting(
                                    category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                                ),
                                types.SafetySetting(
                                    category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                                ),
                            ],
                        ),
                    )

                    def general_knowledge_sse(stream, t_start):
                        """SSE generator for the general-knowledge fallback path.

                        Emits a metadata event first (empty sources, score 0) so
                        the frontend SSE parser receives the same event sequence
                        it expects from the normal RAG path.
                        """
                        meta_payload = json.dumps({"sources": [], "score": 0})
                        yield f"event: metadata\ndata: {meta_payload}\n\n"

                        full_text = ""
                        try:
                            for chunk in stream:
                                if chunk.text:
                                    full_text += chunk.text
                                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                        except Exception as e:
                            err = str(e).lower()
                            if "429" in err or "exhausted" in err:
                                full_text += "\n[System Traffic Alert]"
                                yield 'data: {"text": "⚠️ **System Traffic Alert:** High request volume. Please wait 30 seconds and try again."}\n\n'
                            else:
                                full_text += "\n[System Error]"
                                yield f"data: {json.dumps({'text': f'⚠️ An error occurred: {str(e)}'})}\n\n"
                        finally:
                            latency = int((time.time() - t_start) * 1000)
                            log_entry = AuditLog.objects.create(
                                session=session,
                                user_prompt=message,
                                ai_response=full_text,
                                latency_ms=latency,
                                is_vector_hit=False,
                                metadata={"fallback": "general_knowledge", "sources": [], "score": 0},
                            )
                            yield f"event: log_id\ndata: {json.dumps({'log_id': log_entry.id})}\n\n"

                    gk_response = StreamingHttpResponse(
                        general_knowledge_sse(general_knowledge_stream, start_time),
                        content_type="text/event-stream",
                    )
                    gk_response["Cache-Control"] = "no-cache"
                    gk_response["X-Accel-Buffering"] = "no"
                    gk_response["X-Session-Id"] = str(session.id)
                    return gk_response

                # ── 5b. WEB SEARCH (user explicitly opted in) ────────────────
                try:
                    search = DuckDuckGoSearchRun()
                    web_results = search.run(message)
                except Exception as e:
                    web_results = "System Error: The live web search is currently rate-limited. Please inform the user that live data is temporarily unavailable and answer based on your internal knowledge."
                
                web_system_instruction = f"You are an expert enterprise research assistant. Synthesize the live web data below into a clear summary. State clearly that this is sourced from live web data.\n\nLIVE WEB DATA:\n{web_results}"
                web_response = safe_generate(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
                    contents=message,
                    config=types.GenerateContentConfig(system_instruction=web_system_instruction)
                )
                ai_response = web_response.text
                
                latency_ms = int((time.time() - start_time) * 1000)
                AuditLog.objects.create(session=session, user_prompt=message, ai_response=ai_response, latency_ms=latency_ms, is_vector_hit=False)
                
                return Response({
                    "role": "assistant",
                    "content": f"🌐 **Live Web Search Executed**\n\nHere is what I found on the live web:\n\n{ai_response}",
                    "session_id": str(session.id),
                    "extras": {"fallback_triggered": True, "chunks_used": 0, "sources": ["Live Web Search (DuckDuckGo)"]}
                }, status=status.HTTP_200_OK)

            # 6. DOCUMENT CONTEXT RESPONSE
            context_text = "\n\n".join(valid_chunks)
            history_text = "\n".join([f"User: {turn.get('user', '')}\nAssistant: {turn.get('model', '')}" for turn in chat_history])
            
            if history_text:
                context_text = f"Previous Conversation Context:\n{history_text}\n\nDocument Context:\n{context_text}"
            else:
                context_text = f"Document Context:\n{context_text}"
                
            system_prompt = "You are a strict, factual assistant for FlowZint Cloud Solutions. Answer using ONLY the provided context.\n\nContext: {context}"
            final_compiled_prompt = system_prompt.format(context=context_text) + f"\n\nUser Question: {message}"
            
            response_stream = safe_generate_stream(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
                contents=final_compiled_prompt,
                config=types.GenerateContentConfig(
                    safety_settings=[
                        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                        types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold=types.HarmBlockThreshold.BLOCK_NONE)
                    ]
                )
            )

            def sse_generator(stream, query, sources_list, max_score, t_start, chunks):
                # Use a dedicated SSE event type instead of embedding a [META]
                # prefix inside the data field. This keeps the data payload as
                # clean JSON and is robust against proxies/CDNs.
                meta_payload = json.dumps({"sources": sources_list, "score": max_score})
                yield f"event: metadata\ndata: {meta_payload}\n\n"
                
                full_response_text = ""
                try:
                    for chunk in stream:
                        if chunk.text:
                            full_response_text += chunk.text
                            safe_payload = json.dumps({"text": chunk.text})
                            yield f"data: {safe_payload}\n\n"
                except Exception as e:
                    error_msg = str(e).lower()
                    if "429" in error_msg or "exhausted" in error_msg:
                        full_response_text += "\n[System Traffic Alert]"
                        yield 'data: {"text": "\\n\\n⚠️ **System Traffic Alert:** The enterprise AI network is currently processing a high volume of requests. Please wait 30 seconds and try your message again."}\n\n'
                    else:
                        full_response_text += "\n[System Error]"
                        yield f'data: {{"text": "\\n\\n⚠️ **System Error:** An unexpected error occurred: {str(e)}"}}\n\n'
                finally:
                    latency = int((time.time() - t_start) * 1000)
                    log_entry = AuditLog.objects.create(
                        session=session,
                        user_prompt=query,
                        ai_response=full_response_text,
                        latency_ms=latency,
                        is_vector_hit=True,
                        metadata={"sources": sources_list, "score": max_score},
                        context_chunks=chunks,
                    )
                    # Emit the DB primary key so the frontend can attach
                    # RLHF feedback to the exact log entry.
                    yield f"event: log_id\ndata: {json.dumps({'log_id': log_entry.id})}\n\n"

                    # ── CACHE STORE ──────────────────────────────────────────
                    # Only cache clean, complete responses — skip error stubs.
                    if full_response_text and not full_response_text.endswith(("[System Traffic Alert]", "[System Error]")):
                        response_data = {
                            "role": "assistant",
                            "content": full_response_text,
                            "extras": {
                                "fallback_triggered": False,
                                "chunks_used": len(chunks),
                                "sources": sources_list,
                                "score": max_score,
                                "cache_hit": False,
                            },
                        }
                        cache.set(cache_key, response_data, timeout=3600)
                    # ── END CACHE STORE ──────────────────────────────────────

            streaming_response = StreamingHttpResponse(
                sse_generator(response_stream, message, sources, top_score, start_time, valid_chunks), 
                content_type='text/event-stream'
            )
            streaming_response['Cache-Control'] = 'no-cache'
            streaming_response['X-Accel-Buffering'] = 'no'
            streaming_response['X-Session-Id'] = str(session.id)
            return streaming_response

        except Exception as e:
            import traceback
            print("================= CRASH REPORT =================", flush=True)
            traceback.print_exc()
            print("=================================================", flush=True)
            error_msg = str(e).lower()
            # `session` may be None if the error occurred before it was resolved.
            session_id_header = str(session.id) if session is not None else "unknown"

            if "429" in error_msg or "exhausted" in error_msg or "503" in error_msg or "unavailable" in error_msg:
                if is_direct_task:
                    return Response({
                        "role": "assistant",
                        "content": "⚠️ **System Traffic Alert:** The enterprise AI network is currently experiencing high demand or rate limits. Please wait 30 seconds and try your message again.",
                        "extras": {"fallback_triggered": True, "chunks_used": 0, "sources": []}
                    }, status=status.HTTP_429_TOO_MANY_REQUESTS)
                else:
                    def mock_429_generator():
                        yield 'data: {"text": "⚠️ **System Traffic Alert:** The enterprise AI network is currently experiencing high demand or rate limits. Please wait 30 seconds and try your message again."}\n\n'

                    streaming_response = StreamingHttpResponse(mock_429_generator(), content_type='text/event-stream')
                    streaming_response['Cache-Control'] = 'no-cache'
                    streaming_response['X-Accel-Buffering'] = 'no'
                    streaming_response['X-Session-Id'] = session_id_header
                    return streaming_response

            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@parser_classes([MultiPartParser])
def upload_document(request):
    if 'file' not in request.FILES: return JsonResponse({"error": "No file uploaded"}, status=400)
    uploaded_file = request.FILES['file']
    file_name = uploaded_file.name
    mime_type = uploaded_file.content_type
    
    session_id = request.POST.get('session_id')
    session_obj = None
    if session_id:
        try:
            session_obj = ChatSession.objects.get(id=session_id, user=request.user)
        except ChatSession.DoesNotExist:
            pass

    try:
        shared_dir = "/app/shared_tmp"
        os.makedirs(shared_dir, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=shared_dir, delete=False, suffix=os.path.splitext(file_name)[1]) as temp_file:
            for chunk in uploaded_file.chunks():
                temp_file.write(chunk)
            temp_file_path = temp_file.name
        
        task = process_and_embed_document.delay(temp_file_path, file_name, mime_type)
        AuditLog.objects.create(session=session_obj, user_prompt="System: Document Uploaded", ai_response=file_name, latency_ms=0, is_vector_hit=False, is_agentic=True)
        return JsonResponse({
            "status": "processing",
            "task_id": task.id,
            "message": "File upload accepted and is processing in the background."
        }, status=202)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@api_view(['GET'])
def get_task_status(request, task_id):
    """Poll the status of a background document-embedding task so the UI can
    surface real failures instead of silently showing "processing" forever."""
    from celery.result import AsyncResult
    from core.celery import app as celery_app

    result = AsyncResult(task_id, app=celery_app)
    payload = {"task_id": task_id, "state": result.state}

    if result.successful():
        payload["result"] = result.result
    elif result.failed():
        # result.result is the exception instance when the task failed.
        payload["error"] = str(result.result)

    return JsonResponse(payload, status=200)


@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    """Lightweight liveness/readiness probe for load balancers and monitors.

    Returns 200 when the core dependencies (database, cache) are reachable,
    503 otherwise. Also reports which optional integrations are configured.
    This endpoint performs no AI calls, so it is cheap to poll frequently.
    """
    from django.db import connection

    checks = {}
    healthy = True

    # ── Database ─────────────────────────────────────────────────────────────
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"
        healthy = False

    # ── Cache (used by the chat response cache) ──────────────────────────────
    try:
        cache.set("healthcheck", "1", timeout=5)
        checks["cache"] = "ok" if cache.get("healthcheck") == "1" else "degraded"
    except Exception as exc:
        checks["cache"] = f"error: {exc}"
        # Cache failure is non-fatal — the app falls back to live generation.

    # ── Configured integrations (presence only, no network calls) ────────────
    checks["integrations"] = {
        "google_ai": bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")),
        "pinecone": bool(os.environ.get("PINECONE_API_KEY")),
        "groq": bool(os.environ.get("GROQ_API_KEY")),
        "openrouter": bool(os.environ.get("OPENROUTER_API_KEY")),
        "slack": bool(os.environ.get("SLACK_WEBHOOK_URL")),
    }

    status_code = status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return JsonResponse(
        {"status": "healthy" if healthy else "unhealthy", "checks": checks},
        status=status_code,
    )


SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")

@csrf_exempt
@require_POST
def push_to_slack(request):
    if not SLACK_WEBHOOK_URL:
        return JsonResponse({"error": "Slack integration is not configured."}, status=503)
    try:
        body = json.loads(request.body)
        text_content = body.get('text', '')
        if not text_content:
            return JsonResponse({"error": "The 'text' field is required."}, status=400)

        response = http_requests.post(SLACK_WEBHOOK_URL, json={"text": text_content}, timeout=10)
        response.raise_for_status()
        return JsonResponse({"message": "Successfully pushed to Slack."}, status=200)
    except http_requests.exceptions.RequestException:
        # Do not echo the exception (it can contain the internal webhook URL).
        return JsonResponse({"error": "Webhook delivery failed."}, status=502)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    except Exception:
        return JsonResponse({"error": "An unexpected error occurred."}, status=500)

@api_view(['GET'])
@permission_classes([IsAdminUser])
def get_admin_data(request):
    try:
        active_requests = AuditLog.objects.count()
        
        # Calculate Real Average Latency
        avg_latency_res = AuditLog.objects.aggregate(Avg('latency_ms'))
        avg_latency = avg_latency_res.get('latency_ms__avg')
        avg_latency_ms = int(avg_latency) if avg_latency else 0
            
        # Calculate Real Vector Match Rate
        if active_requests > 0:
            vector_hits = AuditLog.objects.filter(is_vector_hit=True).count()
            hit_rate_pct = round((vector_hits / active_requests) * 100, 1)
        else:
            hit_rate_pct = 0.0

        # Calculate Real CPU Load
        if HAS_PSUTIL:
            cpu_load = psutil.cpu_percent(interval=0.1)
        else:
            cpu_load = 14.5 # Fallback if psutil isn't installed
            
        pinecone_status = "operational" if os.environ.get("PINECONE_API_KEY") else "degraded"
        gemini_status = "operational" if (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")) else "degraded"

        stats = [
            {"label": "Active Requests", "value": str(active_requests), "trend": "Live", "icon_name": "activity"},
            {"label": "Avg Latency", "value": f"{avg_latency_ms}ms", "trend": "Real-time", "icon_name": "clock"},
            {"label": "Vector Hits", "value": f"{hit_rate_pct}%", "trend": "RAG Accuracy", "icon_name": "database"},
            {"label": "System Load", "value": f"{cpu_load}%", "trend": "CPU Usage", "icon_name": "server"}
        ]
        
        health = [
            {"name": "API Gateway", "status": "operational", "uptime": "99.99%"},
            {"name": "Vector DB (Pinecone)", "status": pinecone_status, "uptime": "Live"},
            {"name": "Gemini API", "status": gemini_status, "uptime": "Live"}
        ]
        
        logs = []
        recent_logs = AuditLog.objects.order_by('-created_at')[:50]
        for log in recent_logs:
            event_hash = hashlib.md5(f"{log.id}{log.user_prompt}".encode()).hexdigest()[:8]
            user_text = log.user_prompt
            model_text = log.ai_response
            timestamp = log.created_at.strftime("%H:%M:%S")
            
            logs.append({
                "id": event_hash,
                "time": timestamp,
                "user": user_text[:20] + "..." if len(user_text) > 20 else user_text,
                "action": model_text[:40] + "..." if len(model_text) > 40 else model_text,
                "status": "200 OK"
            })
            
        return JsonResponse({
            "stats": stats,
            "health": health,
            "logs": logs
        }, status=200)

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

@api_view(['POST'])
def sync_to_crm(request):
    try:
        chat_history = request.data.get('chat_history', [])
        if not chat_history:
            return Response({"error": "No chat history provided for sync."}, status=status.HTTP_400_BAD_REQUEST)

        # Resolve the session so the audit log is properly linked.
        session_obj = None
        session_id = request.data.get('session_id')
        if session_id:
            try:
                session_obj = ChatSession.objects.get(id=session_id, user=request.user)
            except ChatSession.DoesNotExist:
                pass
        
        # Prepare context for the prompt
        context_text = "\n".join([f"Role: {msg.get('role', 'unknown')}\nMessage: {msg.get('content', '')}" for msg in chat_history])
        
        system_instruction = (
            "You are an AI data extractor for an enterprise CRM system. "
            "Analyze the provided chat history and extract the following structured data into a valid JSON object:\n"
            '1. "lead_name" (or "company_name" if inferred, else "Unknown Lead")\n'
            '2. "key_pain_points" (list of strings)\n'
            '3. "action_items" (list of strings for next steps)\n'
            "Respond ONLY with the JSON object, no markdown blocks or extra text."
        )
        
        response = safe_generate(
                    client_instance=client,
                    model_name=GENERATIVE_MODEL,
            contents=context_text,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,
                response_mime_type="application/json"
            )
        )
        
        # Strip markdown code fences if the model wraps its output despite
        # response_mime_type="application/json" being set. Some models may still
        # return ```json ... ``` blocks in certain configurations.
        raw_response = response.text.strip()
        if raw_response.startswith("```"):
            # Remove opening fence (```json or ```)
            raw_response = raw_response.split("\n", 1)[-1]
            # Remove closing fence
            if raw_response.endswith("```"):
                raw_response = raw_response[: raw_response.rfind("```")]
        extracted_data = json.loads(raw_response.strip())
        # Simulate network delay to external CRM (HubSpot/Salesforce)
        time.sleep(1.5)
        
        mock_crm_id = f"CRM-{hashlib.md5(str(time.time()).encode()).hexdigest()[:8].upper()}"
        
        AuditLog.objects.create(
            session=session_obj,
            user_prompt="Agentic Action: CRM Sync Triggered", 
            ai_response=f"Synced to {mock_crm_id} with data: {json.dumps(extracted_data)}", 
            latency_ms=1500, 
            is_vector_hit=False,
            is_agentic=True
        )
        
        return Response({
            "status": "success",
            "crm_id": mock_crm_id,
            "data": extracted_data,
            "message": f"Successfully synchronized with CRM. Record ID: {mock_crm_id}"
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        return Response({"error": f"Failed to sync to CRM: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SessionListView(APIView):
    def get(self, request):
        sessions = ChatSession.objects.filter(user=request.user)[:50]
        data = [
            {
                "id": str(s.id),
                "title": s.title,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat(),
            }
            for s in sessions
        ]
        return Response(data, status=status.HTTP_200_OK)


class SessionDetailView(APIView):
    def get(self, request, session_id):
        try:
            session = ChatSession.objects.get(id=session_id, user=request.user)
        except ChatSession.DoesNotExist:
            return Response({"error": "Session not found."}, status=status.HTTP_404_NOT_FOUND)
        
        # Exclude agentic/system entries (CRM sync, doc upload, exec summary)
        # so they don't pollute the replayed conversation history in the sidebar.
        messages = AuditLog.objects.filter(session=session, is_agentic=False).order_by('created_at')
        data = {
            "id": str(session.id),
            "title": session.title,
            "messages": [
                {
                    "user_prompt": msg.user_prompt,
                    "ai_response": msg.ai_response,
                    "created_at": msg.created_at.isoformat(),
                    "metadata": msg.metadata
                }
                for msg in messages
            ]
        }
        return Response(data, status=status.HTTP_200_OK)


@api_view(['POST'])
def submit_feedback(request, log_id):
    """
    RLHF feedback endpoint. Accepts a thumbs signal, a 1-5 rating, and an
    optional free-text comment for a specific AuditLog entry.

    Expected JSON body:
        {
            "positive":  true | false,          // required
            "rating":    1-5,                   // optional
            "comment":   "string"               // optional
        }
    """
    try:
        log = AuditLog.objects.get(id=log_id)
    except AuditLog.DoesNotExist:
        return Response({"error": "Log entry not found."}, status=status.HTTP_404_NOT_FOUND)

    positive = request.data.get('positive')
    if positive is None:
        return Response(
            {"error": "The 'positive' field (true/false) is required."},
            status=status.HTTP_400_BAD_REQUEST
        )

    rating = request.data.get('rating')
    if rating is not None:
        try:
            rating = int(rating)
            if not (1 <= rating <= 5):
                raise ValueError
        except (ValueError, TypeError):
            return Response(
                {"error": "The 'rating' field must be an integer between 1 and 5."},
                status=status.HTTP_400_BAD_REQUEST
            )

    log.feedback_positive = bool(positive)
    log.feedback_rating = rating
    log.feedback_comment = request.data.get('comment', '')
    log.feedback_at = timezone.now()
    log.save(update_fields=['feedback_positive', 'feedback_rating', 'feedback_comment', 'feedback_at'])

    return Response({"status": "feedback recorded", "log_id": log_id}, status=status.HTTP_200_OK)

from django.contrib.auth.models import User

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def setup_admin(request):
    """Temporary endpoint to bypass Render Shell paywall and create an admin."""
    if not User.objects.filter(username='admin').exists():
        User.objects.create_superuser('admin', 'admin@example.com', 'admin123!')
        return Response({"status": "Superuser 'admin' created with password 'admin123!'"}, status=status.HTTP_201_CREATED)
    return Response({"status": "Superuser 'admin' already exists!"}, status=status.HTTP_200_OK)
