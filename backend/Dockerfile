# ── FlowZint backend image ───────────────────────────────────────────────────
# Single image used for both the web (gunicorn) and Celery worker services;
# the command is overridden per-service in docker-compose.yml.

FROM python:3.13.3-slim

# Avoid .pyc files and force unbuffered stdout/stderr (so container logs are
# streamed immediately to `docker logs`).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps:
#   build-essential + libpq-dev → build/runtime for psycopg (PostgreSQL)
# Cleaned up in the same layer to keep the image small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer caching). Includes the production
# extras (gunicorn + psycopg) that are commented-out in requirements.txt.
#
# torch is installed FIRST from the CPU-only wheel index. sentence-transformers
# depends on torch; without this it pulls the default CUDA build (~5GB of NVIDIA
# libraries) which is useless for CPU inference and massively bloats the image.
COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install -r requirements.txt \
    && pip install "gunicorn>=23.0" "psycopg[binary]>=3.2"

# Copy the application code.
COPY . .

# Create a non-root user and run as it (security best practice).
RUN useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Default command (web). Overridden by the worker service in compose.
# collectstatic is run at start so STATIC_ROOT is populated; || true keeps the
# container booting even if static is a no-op in a given config.
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn core.wsgi:application --bind 0.0.0.0:8000 --workers 4 --timeout 120"]
