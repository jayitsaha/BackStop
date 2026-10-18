# Backstop — multi-stage, multi-target image.
#
# Targets:
#   web-build : node:20-alpine   — builds the Vite SPA into /web/dist (intermediate)
#   api       : python:3.11-slim — FastAPI backend, served by uvicorn on :8000
#   web       : nginx:alpine     — serves the built SPA on :80, proxies /api -> api:8000
#   guardian  : python:3.11-slim — optional LiveKit voice-guardian worker
#
# docker-compose builds `api` (target api) and `web` (target web); the optional
# `guardian` service (profile: guardian) uses the guardian target.
# NO secrets are baked in — .env is passed at runtime via `env_file` / `-e`.

# ---------------------------------------------------------------------------
# Stage 1: build the frontend (Vite React -> static dist)
# ---------------------------------------------------------------------------
FROM node:20-alpine AS web-build
WORKDIR /web
# Install deps first for better layer caching. package-lock.json is present,
# so `npm ci` works; fall back to `npm install` if the lock ever drifts.
COPY web/package.json web/package-lock.json ./
RUN npm ci || npm install
# Build the app. VITE_API_BASE defaults to "/api" in web/src/api.js, which the
# nginx `web` service proxies to the api service — no build-time API URL needed.
COPY web/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: backend API (FastAPI + uvicorn)
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS api
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app
# Deps are pinned by the project's requirements.txt (fastapi, uvicorn[standard],
# pydantic, openai, pyyaml, PyJWT, python-dotenv). firebase.py uses urllib, so
# `requests` is intentionally not required.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Copy the application source. .dockerignore keeps .env, .venv*, node_modules,
# web/dist, __pycache__, .git and *.db out of the build context.
COPY . .
EXPOSE 8000
# The API reads secrets from the environment at runtime (.env is passed via
# docker-compose env_file; never copied into the image).
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ---------------------------------------------------------------------------
# Stage 3: frontend static server (nginx) — serves dist, proxies /api -> api
# ---------------------------------------------------------------------------
FROM nginx:alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /web/dist /usr/share/nginx/html
EXPOSE 80

# ---------------------------------------------------------------------------
# Stage 4 (optional): live-call guardian worker (LiveKit Agents)
# ---------------------------------------------------------------------------
# Heavy: livekit-plugins-silero pulls torch. Built only when the `guardian`
# compose profile is enabled. Build tools are installed in case a wheel needs
# compiling; drop them if your platform has prebuilt wheels for everything.
FROM python:3.11-slim AS guardian
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY scripts/call_guardian.requirements.txt ./scripts/call_guardian.requirements.txt
RUN pip install --no-cache-dir -r scripts/call_guardian.requirements.txt
COPY . .
# Runs the LiveKit worker in dev mode (cli.run_app(WorkerOptions(...))).
CMD ["python", "-m", "scripts.call_guardian", "dev"]
