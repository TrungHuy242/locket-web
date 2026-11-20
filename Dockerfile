# Multi-stage Dockerfile for Hugging Face Spaces (Docker SDK, port 7860, UID 1000)
# Also works on any Docker host (Render, Railway, VPS) via PORT env override.

# ---- Stage 1: build the React + Vite PWA bundle -----------------------------
FROM node:20-slim AS frontend-builder

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime (non-root UID 1000 for Hugging Face Spaces) ----
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PORT=7860 \
    LOCKET_COOKIE_SECURE=1 \
    LOCKET_DATA_DIR=/home/user/data

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 user \
    && mkdir -p /home/user/app /home/user/data \
    && chown -R user:user /home/user

WORKDIR /home/user/app

COPY --chown=user:user backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    "huggingface_hub>=0.25" \
    "cryptography>=42"

COPY --chown=user:user backend/__init__.py ./backend/__init__.py
COPY --chown=user:user backend/app ./backend/app
COPY --chown=user:user vendor ./vendor
COPY --chown=user:user --from=frontend-builder /build/frontend/dist ./frontend/dist

USER user
EXPOSE 7860

CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers --forwarded-allow-ips='*'"]
