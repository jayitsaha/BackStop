#!/usr/bin/env bash
# One command to run the whole demo: backend API on :8000 and the web app on :5173.
#
#   ./run.sh                # sets up venv + node deps if needed, regenerates demo data, starts both
#   ./run.sh backend        # just the FastAPI API
#   ./run.sh web            # just the Vite dev server
#
# Then open http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")"

PY=.venv/bin/python
PIP=.venv/bin/pip

setup_backend() {
  if [ ! -d .venv ]; then
    echo "→ creating python venv"
    python3 -m venv .venv
    $PIP install --quiet --upgrade pip
    $PIP install --quiet -r requirements.txt
  fi
  if [ ! -f demo/results.json ]; then
    echo "→ generating demo data (3 agents × 20 tests × 3 runs)"
    $PY -m scripts.run_demo >/dev/null
  fi
}

start_backend() {
  setup_backend
  echo "→ API   http://localhost:8000"
  exec .venv/bin/uvicorn api.main:app --port 8000 --reload
}

start_web() {
  if [ ! -d web/node_modules ]; then
    echo "→ installing web dependencies"
    (cd web && npm install)
  fi
  echo "→ web   http://localhost:5173"
  exec bash -c "cd web && npm run dev"
}

case "${1:-all}" in
  backend) start_backend ;;
  web) start_web ;;
  all)
    setup_backend
    echo "→ API   http://localhost:8000"
    .venv/bin/uvicorn api.main:app --port 8000 --reload >/tmp/backstop_api.log 2>&1 &
    API_PID=$!
    trap 'kill $API_PID 2>/dev/null' EXIT
    if [ ! -d web/node_modules ]; then
      echo "→ installing web dependencies (first run)"
      (cd web && npm install)
    fi
    echo "→ web   http://localhost:5173   (open this)"
    cd web && npm run dev
    ;;
  *) echo "usage: ./run.sh [all|backend|web]"; exit 1 ;;
esac
