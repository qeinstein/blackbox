#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
  echo "BLACKBOX needs Python 3.10 or newer to run the local analysis service." >&2
  exit 1
fi
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "BLACKBOX needs Python 3.10 or newer to run the local analysis service." >&2
  exit 1
fi

if [ ! -x .venv/bin/uvicorn ]; then
  echo "Setting up the BLACKBOX analysis service (first run only)…"
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Add your Meta Model API key as MODEL_API_KEY=... and save; the API reloads automatically."
fi

.venv/bin/uvicorn server.api:app --host 127.0.0.1 --port 8000 --reload --reload-include .env &
API_PID=$!
npm run frontend:dev -- --host 127.0.0.1 &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait -n "$API_PID" "$WEB_PID"
