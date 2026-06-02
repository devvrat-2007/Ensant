# FlowZint Backend

Django + DRF API powering the FlowZint Enterprise Sales Assistant: RAG over
Pinecone, multi-provider model orchestration, async document ingestion via
Celery, and an RLHF feedback pipeline.

## Stack

- **Django 6 / DRF** — HTTP API
- **Pinecone** — vector store (3072-dim, `gemini-embedding-2`)
- **Celery + Redis** — async document embedding
- **Model orchestration** (`api/services/ai_service.py`) — routes tasks to
  Google (Gemini/Gemma), Groq, and OpenRouter models

## Setup

```bash
# 1. Create & activate a virtualenv
python -m venv venv
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
#    then edit .env and fill in your real API keys

# 4. Apply migrations
python manage.py migrate

# 5. Run the dev server
python manage.py runserver
```

Redis must be running for document uploads (Celery broker):

```bash
redis-server                       # in one terminal
celery -A core worker -l info      # in another terminal
```

## Environment variables

See `.env.example` for the full list. Required to boot: `DJANGO_SECRET_KEY`.
Required for AI features: `GEMINI_API_KEY`, `PINECONE_API_KEY`. Optional
provider keys: `GROQ_API_KEY`, `OPENROUTER_API_KEY`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/health/` | Liveness/readiness probe (DB + cache) |
| POST | `/api/chat/` | Chat (JSON text or multipart image) |
| POST | `/api/upload/` | Async document ingestion |
| GET  | `/api/task/<id>/` | Poll ingestion task status |
| GET  | `/api/sessions/` | List chat sessions |
| GET  | `/api/sessions/<uuid>/` | Session message history |
| POST | `/api/feedback/<log_id>/` | Submit RLHF feedback |
| POST | `/api/crm/sync/` | Extract + sync chat to mock CRM |
| POST | `/api/slack/` | Push text to Slack webhook |
| GET  | `/api/admin/` | Dashboard metrics |

## Tests

```bash
python manage.py test api
```

The suite mocks external providers, so it runs offline and deterministically.

## Production deployment

Local dev (SQLite + `runserver` + `DEBUG=True`) works with no extra setup. For
production, the app switches behavior purely through environment variables —
no code changes needed:

```bash
# 1. Install production extras (see commented block in requirements.txt)
pip install "gunicorn>=23.0" "psycopg[binary]>=3.2"

# 2. Set production env vars
export DEBUG=False
export DJANGO_SECRET_KEY="<a real 50+ char random key>"
export ALLOWED_HOSTS="api.yourdomain.com"
export CORS_ALLOWED_ORIGINS="https://app.yourdomain.com"
export DATABASE_URL="postgres://user:pass@host:5432/flowzint"
export SECURE_HSTS_SECONDS=31536000   # once HTTPS is confirmed working

# 3. Migrate + collect static
python manage.py migrate
python manage.py collectstatic --noinput

# 4. Serve with gunicorn (behind nginx/ALB terminating TLS)
gunicorn core.wsgi:application --bind 0.0.0.0:8000 --workers 4
```

When `DEBUG=False`, the app automatically enables: HTTPS redirect, secure
cookies, HSTS, content-type nosniff, and a strict CORS allowlist. Verify with:

```bash
python manage.py check --deploy
```

Setting `DATABASE_URL` switches from SQLite to the given database (Postgres,
MySQL, or a SQLite path). Leaving it unset keeps the local SQLite file.

## Management commands

```bash
# Re-embed all Pinecone vectors with the current EMBEDDING_MODEL (dry-run first)
python manage.py reindex_embeddings            # preview
python manage.py reindex_embeddings --apply    # execute

# Export rated AuditLog entries as a JSONL fine-tuning dataset
python manage.py export_rlhf_dataset
```
