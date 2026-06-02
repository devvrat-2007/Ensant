"""
Test suite for the FlowZint API.

These tests avoid external network calls (Google/Groq/Pinecone) so they run
fast and deterministically in CI. AI/vector calls are mocked where a view
path would otherwise hit a provider.
"""
import json
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from api.models import AuditLog, ChatSession
from api.services.ai_service import (
    get_model_for_task,
    MODEL_REGISTRY,
    DEFAULT_TASK,
    _provider_for_model,
    AIProviderNotConfigured,
)


# ─────────────────────────────────────────────────────────────────────────────
# Model layer
# ─────────────────────────────────────────────────────────────────────────────

class ModelTests(TestCase):
    def test_chatsession_defaults(self):
        s = ChatSession.objects.create()
        self.assertEqual(s.title, "New Chat")
        self.assertIsNotNone(s.id)

    def test_auditlog_links_to_session(self):
        s = ChatSession.objects.create(title="Demo")
        log = AuditLog.objects.create(
            session=s, user_prompt="hi", ai_response="hello", latency_ms=10
        )
        self.assertEqual(log.session, s)
        self.assertFalse(log.is_vector_hit)
        self.assertFalse(log.is_agentic)
        self.assertIsNone(log.feedback_positive)

    def test_auditlog_nullable_session(self):
        log = AuditLog.objects.create(
            user_prompt="x", ai_response="y", latency_ms=1
        )
        self.assertIsNone(log.session)


# ─────────────────────────────────────────────────────────────────────────────
# Orchestration router
# ─────────────────────────────────────────────────────────────────────────────

class OrchestratorRouterTests(TestCase):
    def test_known_task_returns_registered_model(self):
        for task, model in MODEL_REGISTRY.items():
            self.assertEqual(get_model_for_task(task), model)

    def test_unknown_task_falls_back_to_default(self):
        self.assertEqual(
            get_model_for_task("does-not-exist"),
            MODEL_REGISTRY[DEFAULT_TASK],
        )

    def test_every_registry_model_has_a_provider(self):
        for model in MODEL_REGISTRY.values():
            # Should not raise UnknownModelError.
            provider = _provider_for_model(model)
            self.assertIn(provider, {"google", "groq", "deepseek", "openrouter"})

    def test_unconfigured_provider_raises_clean_error(self):
        """A route to a provider with no key raises AIProviderNotConfigured."""
        from api.services.ai_service import AIOrchestrator
        orch = AIOrchestrator()
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("OPENROUTER_API_KEY", None)
            with self.assertRaises(AIProviderNotConfigured):
                orch.generate("code", {"prompt": "ping"})


# ─────────────────────────────────────────────────────────────────────────────
# Health endpoint
# ─────────────────────────────────────────────────────────────────────────────

class HealthCheckTests(TestCase):
    def test_health_returns_200_and_db_ok(self):
        resp = self.client.get("/api/health/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["checks"]["database"], "ok")
        self.assertIn("integrations", data["checks"])


# ─────────────────────────────────────────────────────────────────────────────
# Session endpoints
# ─────────────────────────────────────────────────────────────────────────────

class SessionEndpointTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_session_list_empty(self):
        resp = self.client.get("/api/sessions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_session_detail_404_for_missing(self):
        # A random valid UUID that does not exist.
        resp = self.client.get(
            "/api/sessions/00000000-0000-0000-0000-000000000000/"
        )
        self.assertEqual(resp.status_code, 404)

    def test_session_detail_excludes_agentic_entries(self):
        s = ChatSession.objects.create(title="T", user=self.user)
        AuditLog.objects.create(session=s, user_prompt="real q", ai_response="a", latency_ms=1, is_agentic=False)
        AuditLog.objects.create(session=s, user_prompt="System: Document Uploaded", ai_response="f.pdf", latency_ms=0, is_agentic=True)
        resp = self.client.get(f"/api/sessions/{s.id}/")
        self.assertEqual(resp.status_code, 200)
        msgs = resp.json()["messages"]
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]["user_prompt"], "real q")


# ─────────────────────────────────────────────────────────────────────────────
# Chat endpoint validation (no AI calls)
# ─────────────────────────────────────────────────────────────────────────────

class ChatValidationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_empty_message_rejected(self):
        resp = self.client.post(
            "/api/chat/", data=json.dumps({"message": ""}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_empty_message_creates_no_session(self):
        self.client.post(
            "/api/chat/", data=json.dumps({"message": ""}),
            content_type="application/json",
        )
        self.assertEqual(ChatSession.objects.count(), 0)

    def test_clear_history_shortcircuits(self):
        resp = self.client.post(
            "/api/chat/", data=json.dumps({"clear_history": True}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json().get("status"), "cleared")


# ─────────────────────────────────────────────────────────────────────────────
# Feedback endpoint
# ─────────────────────────────────────────────────────────────────────────────

class FeedbackTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.log = AuditLog.objects.create(
            user_prompt="q", ai_response="a", latency_ms=5
        )

    def test_feedback_requires_positive_field(self):
        resp = self.client.post(
            f"/api/feedback/{self.log.id}/",
            data=json.dumps({"rating": 5}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_feedback_records_signal(self):
        resp = self.client.post(
            f"/api/feedback/{self.log.id}/",
            data=json.dumps({"positive": True, "rating": 4, "comment": "good"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.log.refresh_from_db()
        self.assertTrue(self.log.feedback_positive)
        self.assertEqual(self.log.feedback_rating, 4)
        self.assertEqual(self.log.feedback_comment, "good")
        self.assertIsNotNone(self.log.feedback_at)

    def test_feedback_rejects_out_of_range_rating(self):
        resp = self.client.post(
            f"/api/feedback/{self.log.id}/",
            data=json.dumps({"positive": True, "rating": 9}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_feedback_404_for_missing_log(self):
        resp = self.client.post(
            "/api/feedback/999999/",
            data=json.dumps({"positive": True}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 404)
