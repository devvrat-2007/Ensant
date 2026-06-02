import uuid
from django.db import models
from django.contrib.auth.models import User


class ChatSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_sessions', null=True, blank=True)
    title = models.CharField(max_length=255, default="New Chat")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"Session: {self.title} ({self.id})"


class AuditLog(models.Model):
    session = models.ForeignKey(
        'ChatSession', on_delete=models.CASCADE,
        related_name='messages', null=True, blank=True
    )
    user_prompt = models.TextField()
    ai_response = models.TextField()
    latency_ms = models.IntegerField()
    is_vector_hit = models.BooleanField(default=False)
    # Marks system/agentic entries (CRM sync, doc upload, exec summary, etc.)
    # so they are excluded from conversation history replay in the sidebar.
    is_agentic = models.BooleanField(default=False)
    metadata = models.JSONField(default=dict, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # ── RLHF Feedback Fields ──────────────────────────────────────────────────
    # Binary signal: True = thumbs-up, False = thumbs-down, None = no feedback.
    feedback_positive = models.BooleanField(null=True, blank=True, default=None)

    # Granular 1-5 rating. Stored separately so both signals can coexist and
    # be used independently during dataset export.
    feedback_rating = models.PositiveSmallIntegerField(
        null=True, blank=True, default=None,
        help_text="1 (very poor) – 5 (excellent). Null means no rating given."
    )

    # Free-text correction or comment left by the reviewer.
    feedback_comment = models.TextField(blank=True, default="")

    # Snapshot of the document chunks that were injected into the prompt.
    # Stored as a list of strings: [{"source": "...", "content": "..."}]
    context_chunks = models.JSONField(
        default=list, blank=True,
        help_text="Ordered list of RAG chunks used to generate this response."
    )

    # ISO-8601 timestamp of when feedback was last submitted (not auto-set so
    # it stays null until a human actually rates the response).
    feedback_at = models.DateTimeField(null=True, blank=True, default=None)
    # ─────────────────────────────────────────────────────────────────────────

    def save(self, *args, **kwargs):
        # Prevent 500 DataError by truncating text fields before saving
        max_length = 20000
        if self.user_prompt and len(self.user_prompt) > max_length:
            self.user_prompt = self.user_prompt[:max_length] + " ... [TRUNCATED]"
        if self.ai_response and len(self.ai_response) > max_length:
            self.ai_response = self.ai_response[:max_length] + " ... [TRUNCATED]"
        if self.feedback_comment and len(self.feedback_comment) > max_length:
            self.feedback_comment = self.feedback_comment[:max_length] + " ... [TRUNCATED]"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"AuditLog {self.id} at {self.created_at}"
