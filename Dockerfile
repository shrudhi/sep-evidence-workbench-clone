FROM node:22-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATABASE_PATH=/app/data/workbench.db \
    SOURCE_DIR=/app/sources \
    ARTIFACT_DIR=/app/data \
    FRONTEND_DIR=/app/frontend/dist \
    HF_HOME=/app/model-cache
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY backend ./backend
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install .

COPY sources ./sources
COPY --from=frontend-build /build/frontend/dist ./frontend/dist
RUN mkdir -p /app/seed /app/data \
    && DATABASE_PATH=/app/seed/workbench.db python -m backend.app.ingest

COPY docker-entrypoint.sh ./
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
