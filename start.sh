#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install -r requirements.txt
if [ ! -f .env ]; then
  cp .env.example .env
fi

echo "拼个实习已启动：http://127.0.0.1:8000"
exec .venv/bin/python -m uvicorn server.main:app --host 0.0.0.0 --port 8000
