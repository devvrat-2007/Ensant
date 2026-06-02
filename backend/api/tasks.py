import os
from celery import shared_task
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from google import genai
from google.genai import types

from .services.ai_service import EMBEDDING_MODEL

# Generative model for image-to-text extraction. Centralized to match views.py.
# Must be a Gemini model (Gemma does not support the multimodal/vision inputs
# used here). The embedding model below, gemini-embedding-001, is a separate
# model class.
# Model for image-to-text extraction during document ingestion.
# Must be a vision-capable Gemini model — Gemma is text-only on the public API.
GENERATIVE_MODEL = "gemini-2.5-flash"

def extract_text_from_image(file_bytes, mime_type, client):
    response = client.models.generate_content(
        model=GENERATIVE_MODEL,
        contents=[
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "Analyze this image (technical diagram, flowchart, or document screenshot) exhaustively. Convert all visible data, text labels, architectural components, relationships, and structural details into a highly detailed markdown document for semantic index retrieval."
        ]
    )
    return response.text

@shared_task(bind=True, max_retries=3, default_retry_delay=5)
def process_and_embed_document(self, file_path, file_name, mime_type):
    try:
        if mime_type in ['image/png', 'image/jpeg', 'image/jpg']:
            with open(file_path, 'rb') as f:
                file_bytes = f.read()
            
            # Lazy load the client only inside the thread
            client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
            text_content = extract_text_from_image(file_bytes, mime_type, client)
            docs = [Document(page_content=text_content, metadata={"source": file_name})]
        else:
            loader = PyPDFLoader(file_path) if file_name.endswith('.pdf') else TextLoader(file_path)
            docs = loader.load()
            for doc in docs: 
                doc.metadata['source'] = file_name
        
        # We can clean up the file now
        try:
            os.remove(file_path)
        except OSError:
            pass

        splits = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200).split_documents(docs)

        embeddings = GoogleGenerativeAIEmbeddings(
            model=EMBEDDING_MODEL,
            google_api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        )
        vectorstore = PineconeVectorStore(index_name=os.environ.get("PINECONE_INDEX_NAME", "flowzint-hackathon"), embedding=embeddings)

        # Single attempt — Celery's retry mechanism below is the ONLY retry
        # path. Avoids the previous double-retry loop (3 x 3 = up to 9 calls)
        # that needlessly burned API quota on 429s.
        vectorstore.add_documents(splits)

        return {"status": "success", "chunks_processed": len(splits), "file_name": file_name}
    except Exception as e:
        error_msg = str(e)
        # Best-effort cleanup of the temp file on any failure path.
        try:
            os.remove(file_path)
        except OSError:
            pass

        if "503" in error_msg or "429" in error_msg or "exhausted" in error_msg.lower():
            # Exponential backoff: 1s, 2s, 4s. When retries are exhausted,
            # self.retry raises MaxRetriesExceededError, which we convert to a
            # hard failure below so the task ends in FAILURE (not a silent
            # "success"-shaped error dict the frontend can't detect).
            try:
                countdown = 2 ** self.request.retries
                raise self.retry(exc=e, countdown=countdown)
            except self.MaxRetriesExceededError:
                raise RuntimeError(
                    f"Embedding failed for '{file_name}' after {self.max_retries} retries "
                    f"due to rate limiting: {error_msg}"
                )
        # Non-retryable error: re-raise so Celery records a real FAILURE state
        # with a traceback the /api/task/<id>/ endpoint can report.
        raise
