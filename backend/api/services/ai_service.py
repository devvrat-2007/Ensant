"""
ai_service.py — Model Orchestration Layer
==========================================

A thin, provider-aware routing layer that maps high-level *task types* to
concrete model IDs and dispatches the request to the correct backend
(Google GenAI, Groq, or DeepSeek).

Why this exists
---------------
The codebase previously hard-coded a single ``GENERATIVE_MODEL`` string at
every call site. That made a "use the right model for the job" strategy
impossible without touching dozens of lines. This service centralizes:

  1. The task → model mapping (``MODEL_REGISTRY``).
  2. The model → provider mapping (``_MODEL_PROVIDERS``).
  3. The actual API dispatch + uniform error handling (``AIOrchestrator``).

Design notes
------------
* **Multi-provider.** The registry intentionally spans three providers:
    - Google  : vision, reasoning, long_doc, summarize  (google.genai SDK)
    - Groq    : chat, guard                             (OpenAI-compatible REST)
    - DeepSeek: code                                    (OpenAI-compatible REST)
  Only Google is configured in this project's .env today. Groq/DeepSeek
  routes are fully implemented but will raise a clear, logged
  ``AIProviderNotConfigured`` error until the relevant API key is added.

* **Graceful degradation.** A failed model call never bubbles a raw
  provider exception to the view. It is logged and re-raised as a typed
  ``AIServiceError`` the caller can catch and turn into a friendly response.

* **Provider status.**
    - Live now: vision, reasoning, summarize (Google) + chat, guard (Groq).
    - ``code`` (qwen/qwen3-coder-next) and ``long_doc`` (minimax/minimax-m1)
      route through OpenRouter and require ``OPENROUTER_API_KEY``. Until that
      key is set they raise ``AIProviderNotConfigured`` (graceful, logged).
  Model IDs were confirmed against the OpenRouter catalog; the live request
  has not yet been exercised (no key available at implementation time).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import requests as http_requests

# Google GenAI SDK (already a project dependency, used in views.py / tasks.py).
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Registry
# ─────────────────────────────────────────────────────────────────────────────

# Task type → model ID. This is the single source of truth for "which model
# does what". Change a value here to re-route a whole class of requests.
MODEL_REGISTRY: dict[str, str] = {
    "vision":    "gemini-2.5-flash",       # multimodal image analysis
    "reasoning": "gemma-4-26b-a4b-it",     # general enterprise reasoning (default)
    "chat":      "meta-llama/llama-4-scout-17b-16e-instruct",  # fast chat (Groq) — verified live
    "code":      "qwen/qwen3-coder-next",  # code generation / refactoring (OpenRouter)
    "long_doc":  "minimax/minimax-m1",     # very large context windows (OpenRouter)
    "summarize": "gemini-2.5-flash-lite",  # low-cost, low-latency summaries
    "guard":     "meta-llama/llama-prompt-guard-2-86m",  # safety / moderation (Groq) — verified available
}

# The task used when an unknown task_type is requested. Must be a key above.
DEFAULT_TASK = "reasoning"

# ── Embedding model ──────────────────────────────────────────────────────────
# Single source of truth for the RAG embedding model. BOTH ingestion
# (api/tasks.py) and retrieval (api/views.py) MUST import this exact value —
# query vectors are only comparable to indexed vectors when produced by the
# same model. Outputs 3072-dimensional vectors (matches the Pinecone index).
#
# ⚠️ Changing this value invalidates every vector already stored in Pinecone.
# After changing it you must re-embed all documents (vectors from a different
# model are not comparable, even at the same dimension).
EMBEDDING_MODEL = "gemini-embedding-2"
EMBEDDING_DIMENSIONS = 3072

# Model ID → provider. Drives which dispatch path AIOrchestrator takes.
_MODEL_PROVIDERS: dict[str, str] = {
    "gemini-2.5-flash":      "google",
    "gemma-4-26b-a4b-it":    "google",
    "gemini-2.5-flash-lite": "google",
    "meta-llama/llama-4-scout-17b-16e-instruct": "groq",
    "meta-llama/llama-prompt-guard-2-86m":       "groq",
    "qwen/qwen3-coder-next": "openrouter",
    "minimax/minimax-m1":    "openrouter",
}

# OpenAI-compatible REST endpoints for the non-Google providers.
_GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"
_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions"
_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"


# ─────────────────────────────────────────────────────────────────────────────
# Exceptions
# ─────────────────────────────────────────────────────────────────────────────

class AIServiceError(Exception):
    """Base error for any failure inside the orchestration layer."""


class AIProviderNotConfigured(AIServiceError):
    """Raised when a route resolves to a provider whose API key is missing."""


class UnknownModelError(AIServiceError):
    """Raised when a model ID has no registered provider."""


# ─────────────────────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────────────────────

def get_model_for_task(task_type: str) -> str:
    """Return the model ID registered for *task_type*.

    Falls back to ``MODEL_REGISTRY[DEFAULT_TASK]`` for any unknown or empty
    task type, logging a warning so misrouted calls are visible.
    """
    if task_type in MODEL_REGISTRY:
        return MODEL_REGISTRY[task_type]

    fallback = MODEL_REGISTRY[DEFAULT_TASK]
    logger.warning(
        "Unknown task_type %r; falling back to default task %r (model %s).",
        task_type, DEFAULT_TASK, fallback,
    )
    return fallback


def _provider_for_model(model_id: str) -> str:
    """Return the provider key ('google' | 'groq' | 'deepseek') for a model."""
    try:
        return _MODEL_PROVIDERS[model_id]
    except KeyError as exc:
        raise UnknownModelError(
            f"No provider registered for model '{model_id}'. "
            f"Add it to _MODEL_PROVIDERS."
        ) from exc


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────────────────────

class AIOrchestrator:
    """Routes a task to the correct model + provider and runs the request.

    Usage
    -----
        orchestrator = AIOrchestrator()
        text = orchestrator.generate(
            task_type="reasoning",
            payload={"prompt": "Summarize Q3 risks."},
        )

    The orchestrator is stateless apart from its lazily-created provider
    clients, so a single module-level instance (``orchestrator`` below) can be
    shared across requests.
    """

    def __init__(self) -> None:
        self._google_client: Optional[genai.Client] = None

    # ── Provider clients (lazy) ──────────────────────────────────────────────

    @staticmethod
    def _google_api_key() -> Optional[str]:
        return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

    def _get_google_client(self) -> genai.Client:
        """Create the Google GenAI client on first use and cache it."""
        if self._google_client is None:
            api_key = self._google_api_key()
            if not api_key:
                raise AIProviderNotConfigured(
                    "Google provider selected but GEMINI_API_KEY / "
                    "GOOGLE_API_KEY is not set."
                )
            self._google_client = genai.Client(api_key=api_key)
        return self._google_client

    # ── Public API ───────────────────────────────────────────────────────────

    def generate(
        self,
        task_type: str,
        payload: dict[str, Any],
    ) -> str:
        """Run a generation request for *task_type* and return the text output.

        Parameters
        ----------
        task_type:
            One of the keys in ``MODEL_REGISTRY`` (e.g. "vision", "reasoning").
            Unknown values fall back to ``DEFAULT_TASK``.
        payload:
            Request data. Recognized keys:
              - "prompt"             (str)  : the user/content prompt. Required.
              - "system_instruction" (str)  : optional system prompt.
              - "temperature"        (float): optional sampling temperature.
              - "image_bytes"        (bytes): optional inline image for vision.
              - "image_mime_type"    (str)  : MIME type for image_bytes.

        Returns
        -------
        str : the model's text response.

        Raises
        ------
        AIServiceError (or a subclass) on any unrecoverable failure.
        """
        model_id = get_model_for_task(task_type)
        provider = _provider_for_model(model_id)

        logger.info(
            "AIOrchestrator dispatch: task=%s → model=%s (provider=%s)",
            task_type, model_id, provider,
        )

        try:
            if provider == "google":
                return self._generate_google(model_id, payload)
            if provider == "groq":
                return self._generate_openai_compatible(
                    base_url=_GROQ_BASE_URL,
                    api_key_env="GROQ_API_KEY",
                    provider_name="Groq",
                    model_id=model_id,
                    payload=payload,
                )
            if provider == "deepseek":
                return self._generate_openai_compatible(
                    base_url=_DEEPSEEK_BASE_URL,
                    api_key_env="DEEPSEEK_API_KEY",
                    provider_name="DeepSeek",
                    model_id=model_id,
                    payload=payload,
                )
            if provider == "openrouter":
                return self._generate_openai_compatible(
                    base_url=_OPENROUTER_BASE_URL,
                    api_key_env="OPENROUTER_API_KEY",
                    provider_name="OpenRouter",
                    model_id=model_id,
                    payload=payload,
                )
            raise UnknownModelError(f"Unhandled provider '{provider}'.")

        except AIServiceError:
            # Already typed + (where relevant) logged — let it propagate.
            raise
        except Exception as exc:
            # Wrap any provider-specific exception in our uniform type so
            # callers only ever need to catch AIServiceError.
            logger.exception(
                "AIOrchestrator: model call failed (task=%s, model=%s).",
                task_type, model_id,
            )
            raise AIServiceError(
                f"Model call failed for task '{task_type}' "
                f"(model '{model_id}'): {exc}"
            ) from exc

    # ── Provider dispatchers ──────────────────────────────────────────────────

    def _generate_google(self, model_id: str, payload: dict[str, Any]) -> str:
        """Dispatch to the Google GenAI SDK."""
        client = self._get_google_client()
        prompt = payload.get("prompt", "")

        # Build the `contents` list. For vision tasks an inline image part is
        # prepended ahead of the text prompt.
        contents: list[Any] = []
        image_bytes = payload.get("image_bytes")
        image_mime = payload.get("image_mime_type")
        if image_bytes and image_mime:
            contents.append(
                types.Part.from_bytes(data=image_bytes, mime_type=image_mime)
            )
        contents.append(prompt)

        # Assemble the generation config only from provided keys.
        config_kwargs: dict[str, Any] = {}
        if payload.get("system_instruction"):
            config_kwargs["system_instruction"] = payload["system_instruction"]
        if payload.get("temperature") is not None:
            config_kwargs["temperature"] = payload["temperature"]

        config = types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

        response = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=config,
        )
        return (response.text or "").strip()

    def _generate_openai_compatible(
        self,
        base_url: str,
        api_key_env: str,
        provider_name: str,
        model_id: str,
        payload: dict[str, Any],
    ) -> str:
        """Dispatch to any OpenAI-compatible chat-completions endpoint.

        Used for Groq (chat, guard) and DeepSeek (code). These providers share
        the OpenAI request/response schema, so a single implementation covers
        both — only the base URL and API key env var differ.
        """
        api_key = os.environ.get(api_key_env)
        if not api_key:
            raise AIProviderNotConfigured(
                f"{provider_name} provider selected (model '{model_id}') but "
                f"{api_key_env} is not set in the environment."
            )

        messages: list[dict[str, str]] = []
        if payload.get("system_instruction"):
            messages.append({"role": "system", "content": payload["system_instruction"]})
        messages.append({"role": "user", "content": payload.get("prompt", "")})

        body: dict[str, Any] = {"model": model_id, "messages": messages}
        if payload.get("temperature") is not None:
            body["temperature"] = payload["temperature"]

        response = http_requests.post(
            base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()

        # OpenAI-compatible shape: choices[0].message.content
        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, AttributeError) as exc:
            raise AIServiceError(
                f"{provider_name} returned an unexpected response shape: {data}"
            ) from exc


# A shared, module-level instance. Import this directly:
#     from api.services.ai_service import orchestrator
orchestrator = AIOrchestrator()
