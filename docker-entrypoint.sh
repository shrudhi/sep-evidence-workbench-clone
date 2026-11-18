#!/bin/sh
set -eu

mkdir -p "${ARTIFACT_DIR:-/app/data}"
if [ ! -f "${DATABASE_PATH:-/app/data/workbench.db}" ]; then
  cp /app/seed/workbench.db "${DATABASE_PATH:-/app/data/workbench.db}"
fi

exec uvicorn backend.app.api:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
