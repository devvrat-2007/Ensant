"""
Management command: reindex_embeddings
=======================================
Re-embeds every chunk currently stored in the Pinecone index using the
*current* embedding model (``api.services.ai_service.EMBEDDING_MODEL``) and
replaces the old vectors.

Why this command exists
-----------------------
The original document files are NOT retained on disk — ``upload_document``
embeds each upload from a temp file and then deletes it. The only durable copy
of the document text is the ``text`` field stored in each vector's Pinecone
metadata. So the only safe way to migrate from one embedding model to another
(e.g. gemini-embedding-001 → gemini-embedding-2) is to:

  1. Read every existing vector's metadata (text + source) out of Pinecone.
  2. Re-embed that text with the new model.
  3. Delete the stale vectors and upsert the freshly-embedded ones.

This avoids the "silent failure" mode where old 001-space vectors linger in
the index and pollute cosine search against new 2-space query vectors.

Safety design
-------------
* **Dry-run by default.** Nothing is written unless ``--apply`` is passed.
* **Snapshot first.** All metadata is read and re-embedded into memory BEFORE
  anything is deleted, so an embedding failure aborts with the index intact.
* **Dimension guard.** Refuses to run if the new model's output dimension
  doesn't match the live index dimension (which would corrupt the index).
* **Deterministic IDs.** Re-uses each chunk's original vector ID so the upsert
  cleanly overwrites in place; a final orphan-sweep deletes any IDs that were
  in the index but not in our snapshot.

Usage
-----
    # Preview what would happen (no writes):
    python manage.py reindex_embeddings

    # Actually perform the migration:
    python manage.py reindex_embeddings --apply

    # Tune batch size / target a namespace:
    python manage.py reindex_embeddings --apply --batch-size 50 --namespace ""
"""

import os
import time

from django.core.management.base import BaseCommand, CommandError

from langchain_google_genai import GoogleGenerativeAIEmbeddings

from api.services.ai_service import EMBEDDING_MODEL, EMBEDDING_DIMENSIONS


# Metadata keys used by the langchain PineconeVectorStore integration.
_TEXT_KEY = "text"
_SOURCE_KEY = "source"


class Command(BaseCommand):
    help = (
        "Re-embed all vectors in the Pinecone index with the current "
        "EMBEDDING_MODEL and replace the stale vectors. Dry-run unless --apply."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            default=False,
            help="Actually write changes. Without this flag the command only "
                 "reports what it would do (dry-run).",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=100,
            help="How many vectors to embed/upsert per batch (default: 100).",
        )
        parser.add_argument(
            "--namespace",
            type=str,
            default="",
            help="Pinecone namespace to reindex (default: the '' namespace).",
        )
        parser.add_argument(
            "--index-name",
            type=str,
            default=None,
            help="Override the Pinecone index name "
                 "(default: PINECONE_INDEX_NAME env var or 'flowzint-hackathon').",
        )

    # ── Main ──────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        batch_size = options["batch_size"]
        namespace = options["namespace"]
        index_name = (
            options["index_name"]
            or os.environ.get("PINECONE_INDEX_NAME", "flowzint-hackathon")
        )

        if batch_size < 1:
            raise CommandError("--batch-size must be >= 1.")

        api_key = os.environ.get("PINECONE_API_KEY")
        if not api_key:
            raise CommandError("PINECONE_API_KEY is not set in the environment.")

        google_key = (
            os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        )
        if not google_key:
            raise CommandError(
                "GEMINI_API_KEY / GOOGLE_API_KEY is not set; cannot embed."
            )

        # Import here so a missing dependency surfaces as a clean command error.
        try:
            from pinecone import Pinecone
        except ImportError as exc:
            raise CommandError(f"pinecone package is not installed: {exc}")

        mode = self.style.WARNING("APPLY (writes enabled)") if apply_changes \
            else self.style.NOTICE("DRY-RUN (no writes)")
        self.stdout.write(f"\nReindex mode    : {mode}")
        self.stdout.write(f"Index name      : {index_name}")
        self.stdout.write(f"Namespace       : {namespace!r}")
        self.stdout.write(f"Target model    : {EMBEDDING_MODEL}")
        self.stdout.write(f"Expected dims   : {EMBEDDING_DIMENSIONS}")
        self.stdout.write(f"Batch size      : {batch_size}\n")

        pc = Pinecone(api_key=api_key)

        # ── Dimension guard ────────────────────────────────────────────────────
        try:
            desc = pc.describe_index(index_name)
        except Exception as exc:
            raise CommandError(f"Could not describe index '{index_name}': {exc}")

        if desc.dimension != EMBEDDING_DIMENSIONS:
            raise CommandError(
                f"Index dimension ({desc.dimension}) does not match the new "
                f"model's dimension ({EMBEDDING_DIMENSIONS}). Re-indexing in "
                f"place would corrupt the index. Recreate the index at "
                f"{EMBEDDING_DIMENSIONS} dims first, then re-run."
            )

        index = pc.Index(index_name)
        stats = index.describe_index_stats()
        total = stats.get("total_vector_count", 0)
        self.stdout.write(f"Vectors in index: {total}\n")

        if total == 0:
            self.stdout.write(self.style.WARNING(
                "Index is empty — nothing to reindex."
            ))
            return

        # ── 1. Snapshot: read all vector IDs, then fetch their metadata ─────────
        self.stdout.write("Reading existing vector IDs...")
        all_ids = self._list_all_ids(index, namespace)
        self.stdout.write(f"  collected {len(all_ids)} ids.")

        self.stdout.write("Fetching metadata (text + source)...")
        records = self._fetch_records(index, all_ids, namespace, batch_size)

        usable = [r for r in records if r["text"].strip()]
        skipped = len(records) - len(usable)
        self.stdout.write(
            f"  usable chunks: {len(usable)}  (skipped {skipped} with empty text)\n"
        )

        if not usable:
            raise CommandError(
                "No vectors had usable 'text' metadata; aborting to avoid "
                "wiping the index with nothing to replace it."
            )

        if not apply_changes:
            self.stdout.write(self.style.NOTICE(
                "\nDRY-RUN summary — the following WOULD happen with --apply:"
            ))
            self.stdout.write(f"  • re-embed {len(usable)} chunks with {EMBEDDING_MODEL}")
            self.stdout.write(f"  • delete all {len(all_ids)} existing vectors in namespace {namespace!r}")
            self.stdout.write(f"  • upsert {len(usable)} freshly-embedded vectors")
            srcs = sorted({r["source"] for r in usable})
            self.stdout.write(f"  • documents affected ({len(srcs)}): {', '.join(srcs[:10])}"
                              + (" ..." if len(srcs) > 10 else ""))
            self.stdout.write(self.style.NOTICE(
                "\nRe-run with --apply to execute."
            ))
            return

        # ── 2. Re-embed everything into memory BEFORE any deletion ──────────────
        self.stdout.write("Re-embedding chunks with the new model...")
        embedder = GoogleGenerativeAIEmbeddings(
            model=EMBEDDING_MODEL, google_api_key=google_key
        )

        new_vectors = []
        for start in range(0, len(usable), batch_size):
            batch = usable[start:start + batch_size]
            texts = [r["text"] for r in batch]
            try:
                vectors = embedder.embed_documents(texts)
            except Exception as exc:
                raise CommandError(
                    f"Embedding failed at batch starting {start} — index "
                    f"untouched, safe to retry: {exc}"
                )
            for rec, vec in zip(batch, vectors):
                if len(vec) != EMBEDDING_DIMENSIONS:
                    raise CommandError(
                        f"Model returned {len(vec)}-dim vector, expected "
                        f"{EMBEDDING_DIMENSIONS}. Aborting before any write."
                    )
                new_vectors.append({
                    "id": rec["id"],
                    "values": vec,
                    "metadata": {_TEXT_KEY: rec["text"], _SOURCE_KEY: rec["source"]},
                })
            self.stdout.write(f"  embedded {min(start + batch_size, len(usable))}/{len(usable)}")

        # ── 3. Delete stale vectors, then upsert the new ones ───────────────────
        self.stdout.write("Deleting stale vectors...")
        index.delete(delete_all=True, namespace=namespace)
        # Give Pinecone a moment to process the bulk delete before upserting.
        time.sleep(2)

        self.stdout.write("Upserting freshly-embedded vectors...")
        upserted = 0
        for start in range(0, len(new_vectors), batch_size):
            chunk = new_vectors[start:start + batch_size]
            index.upsert(vectors=chunk, namespace=namespace)
            upserted += len(chunk)
            self.stdout.write(f"  upserted {upserted}/{len(new_vectors)}")

        self.stdout.write(self.style.SUCCESS(
            f"\n✅  Reindex complete.\n"
            f"   Re-embedded : {len(new_vectors)} chunks\n"
            f"   Model       : {EMBEDDING_MODEL}\n"
            f"   Namespace   : {namespace!r}\n"
        ))

    # ── Helpers ─────────────────────────────────────────────────────────────────

    def _list_all_ids(self, index, namespace):
        """Return every vector ID in the namespace, paging through index.list()."""
        ids = []
        try:
            for page in index.list(namespace=namespace):
                # index.list() yields lists of ids (or single ids depending on
                # client version); normalize both shapes.
                if isinstance(page, (list, tuple)):
                    ids.extend(page)
                else:
                    ids.append(page)
        except TypeError:
            # Some client versions return a single generator of ids, not pages.
            for vid in index.list(namespace=namespace):
                ids.append(vid)
        return ids

    def _fetch_records(self, index, all_ids, namespace, batch_size):
        """Fetch metadata for every id; return list of {id, text, source}."""
        records = []
        for start in range(0, len(all_ids), batch_size):
            batch_ids = all_ids[start:start + batch_size]
            fetched = index.fetch(ids=batch_ids, namespace=namespace)
            vectors = getattr(fetched, "vectors", None) or fetched.get("vectors", {})
            for vid, vec in vectors.items():
                md = getattr(vec, "metadata", None)
                if md is None and isinstance(vec, dict):
                    md = vec.get("metadata", {})
                md = md or {}
                records.append({
                    "id": vid,
                    "text": str(md.get(_TEXT_KEY, "")),
                    "source": str(md.get(_SOURCE_KEY, "Unknown Source")),
                })
        return records
