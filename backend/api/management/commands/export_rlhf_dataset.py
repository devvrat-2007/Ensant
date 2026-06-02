"""
Management command: export_rlhf_dataset
========================================
Aggregates rated AuditLog entries into a JSONL file formatted for
supervised fine-tuning (SFT) or reward-model training.

Each line is a self-contained JSON object:
{
    "id":             <int>          – AuditLog primary key
    "session_id":     <str|null>     – parent session UUID
    "prompt":         <str>          – the user's original question
    "response":       <str>          – the AI's full response
    "rating":         <int|null>     – 1-5 explicit rating (null if not given)
    "positive":       <bool|null>    – thumbs signal (null if not given)
    "comment":        <str>          – free-text reviewer note (may be empty)
    "context_chunks": [<str>, ...]   – RAG passages injected into the prompt
    "sources":        [<str>, ...]   – source document names from metadata
    "vector_score":   <int|null>     – CrossEncoder confidence score (0-99)
    "latency_ms":     <int>          – end-to-end response latency
    "is_vector_hit":  <bool>         – whether RAG retrieved relevant chunks
    "created_at":     <str>          – ISO-8601 timestamp of the interaction
    "feedback_at":    <str|null>     – ISO-8601 timestamp of the rating
}

Usage
-----
# Export only rated entries (default):
    python manage.py export_rlhf_dataset

# Export all entries including unrated ones:
    python manage.py export_rlhf_dataset --include-unrated

# Filter by minimum rating:
    python manage.py export_rlhf_dataset --min-rating 4

# Custom output path:
    python manage.py export_rlhf_dataset --output /tmp/flowzint_rlhf.jsonl

# Limit to the N most recent entries:
    python manage.py export_rlhf_dataset --limit 500
"""

import json
import os

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from api.models import AuditLog


class Command(BaseCommand):
    help = "Export rated AuditLog entries as a JSONL fine-tuning dataset."

    def add_arguments(self, parser):
        parser.add_argument(
            '--output',
            type=str,
            default='rlhf_dataset.jsonl',
            help='Output file path (default: rlhf_dataset.jsonl in the current directory).',
        )
        parser.add_argument(
            '--include-unrated',
            action='store_true',
            default=False,
            help='Include entries that have not yet received human feedback.',
        )
        parser.add_argument(
            '--min-rating',
            type=int,
            default=None,
            help='Only export entries with feedback_rating >= this value (1-5).',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Cap the number of exported entries (most recent first).',
        )
        parser.add_argument(
            '--positive-only',
            action='store_true',
            default=False,
            help='Only export entries where feedback_positive=True (thumbs-up).',
        )

    def handle(self, *args, **options):
        output_path = options['output']
        include_unrated = options['include_unrated']
        min_rating = options['min_rating']
        limit = options['limit']
        positive_only = options['positive_only']

        # ── Build queryset ────────────────────────────────────────────────────
        qs = AuditLog.objects.filter(
            is_agentic=False,   # exclude CRM sync / doc upload system entries
        ).order_by('-created_at')

        if not include_unrated:
            # At least one feedback signal must be present.
            qs = qs.filter(
                Q(feedback_positive__isnull=False) | Q(feedback_rating__isnull=False)
            )

        if min_rating is not None:
            if not (1 <= min_rating <= 5):
                raise CommandError("--min-rating must be between 1 and 5.")
            qs = qs.filter(feedback_rating__gte=min_rating)

        if positive_only:
            qs = qs.filter(feedback_positive=True)

        if limit:
            qs = qs[:limit]

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.WARNING(
                "No matching entries found. "
                "Use --include-unrated to export all logs."
            ))
            return

        self.stdout.write(f"Exporting {total} entries → {output_path}")

        # ── Write JSONL ───────────────────────────────────────────────────────
        written = 0
        skipped = 0

        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                for log in qs.iterator(chunk_size=200):
                    # Skip entries with empty prompt or response — they are
                    # not useful training examples.
                    if not log.user_prompt.strip() or not log.ai_response.strip():
                        skipped += 1
                        continue

                    meta = log.metadata or {}
                    sources = meta.get('sources', [])
                    vector_score = meta.get('score', None)

                    record = {
                        "id": log.id,
                        "session_id": str(log.session_id) if log.session_id else None,
                        "prompt": log.user_prompt,
                        "response": log.ai_response,
                        "rating": log.feedback_rating,
                        "positive": log.feedback_positive,
                        "comment": log.feedback_comment or "",
                        "context_chunks": log.context_chunks or [],
                        "sources": sources,
                        "vector_score": vector_score,
                        "latency_ms": log.latency_ms,
                        "is_vector_hit": log.is_vector_hit,
                        "created_at": log.created_at.isoformat(),
                        "feedback_at": log.feedback_at.isoformat() if log.feedback_at else None,
                    }

                    f.write(json.dumps(record, ensure_ascii=False) + '\n')
                    written += 1

        except OSError as exc:
            raise CommandError(f"Could not write to {output_path}: {exc}") from exc

        # ── Summary ───────────────────────────────────────────────────────────
        self.stdout.write(self.style.SUCCESS(
            f"\n✅  Export complete.\n"
            f"   Written : {written}\n"
            f"   Skipped : {skipped} (empty prompt/response)\n"
            f"   Output  : {os.path.abspath(output_path)}\n"
        ))

        # Print a quick quality breakdown if ratings are present.
        rated = [r for r in qs if r.feedback_rating is not None]
        if rated:
            avg = sum(r.feedback_rating for r in rated) / len(rated)
            thumbs_up = sum(1 for r in qs if r.feedback_positive is True)
            thumbs_down = sum(1 for r in qs if r.feedback_positive is False)
            self.stdout.write(
                f"   Avg rating    : {avg:.2f} / 5.0\n"
                f"   Thumbs-up     : {thumbs_up}\n"
                f"   Thumbs-down   : {thumbs_down}\n"
            )
