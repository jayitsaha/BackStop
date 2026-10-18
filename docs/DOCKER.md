# Running Backstop with Docker

The whole stack runs reproducibly via Docker Compose. No application code is
changed to containerize — the frontend is served by nginx (which proxies `/api`
to the backend), and the backend runs uvicorn exactly as in development.

## Prerequisites

- Docker with Compose v2 (`docker compose ...`).
- A `.env` file in the project root (same directory as `docker-compose.yml`).

## 1. Create your `.env`

Copy the template and fill in the real values:

```bash
cp .env.example .env
# then edit .env
```

Required / used keys (see `.env.example` for the full list):

- `NVIDIA_API_KEYS` (comma-separated), optional `NVIDIA_BASE_URL`, `NVIDIA_MODEL`
- `FIREBASE_API_KEY`, `FIREBASE_DB_URL`, `FIREBASE_DB_SECRET`
- `DEEPGRAM_API_KEY`
- `LIVEKIT_*` (URL / API key / secret) — needed for voice + guardian

> The `.env` is **never** baked into the images. It is read at runtime via
> `env_file:` in `docker-compose.yml`, and `.dockerignore` keeps it out of the
> build context entirely. The images contain no secrets.

## 2. Build and run

```bash
docker compose up --build
```

This builds and starts two services:

| Service | Image            | URL                     | Notes                                   |
|---------|------------------|-------------------------|-----------------------------------------|
| `web`   | nginx + Vite dist | http://localhost:8080  | SPA; proxies `/api/*` → `api:8000`      |
| `api`   | python:3.11-slim  | http://localhost:8000  | FastAPI (uvicorn); `GET /health` probe  |

Open **http://localhost:8080**. The frontend calls `/api/...`, which nginx
forwards to the backend (stripping the `/api` prefix, matching the Vite dev
proxy). You can also hit the API directly at http://localhost:8000.

The `web` service waits for the `api` healthcheck (`GET /health`) to pass
before it starts.

## 3. Optional: the live-call guardian worker

The guardian is a separate LiveKit voice worker (`scripts/call_guardian.py`).
It is behind the `guardian` compose profile and is **off by default**:

```bash
docker compose --profile guardian up --build
```

> The guardian image installs `scripts/call_guardian.requirements.txt`, which
> includes `livekit-plugins-silero` → **torch** (large; first build is slow and
> the image is big). If you don't need local VAD, you can omit silero/torch.
> The guardian needs the `LIVEKIT_*`, `DEEPGRAM_API_KEY` and `NVIDIA_*` values
> from `.env` (loaded automatically via `env_file`).

## Common commands

```bash
docker compose up --build -d        # run detached
docker compose logs -f api          # tail backend logs
docker compose logs -f web          # tail nginx logs
docker compose ps                   # status + health
docker compose down                 # stop and remove containers
docker compose build api            # rebuild just the backend
```

## How it maps to the non-Docker setup

- Backend: `uvicorn api.main:app --port 8000` → the `api` service (bound to
  `0.0.0.0:8000` inside the container, published on host `8000`).
- Frontend: `npm run build` → `web/dist`, served by nginx in the `web` service.
  In dev you'd run `npm run dev` on 5173 with Vite's `/api` proxy; in Docker,
  nginx plays that proxy role (`nginx.conf`).
- Backend Python deps come from `requirements.txt` (fastapi, uvicorn[standard],
  pydantic, openai, pyyaml, PyJWT, python-dotenv). `firebase.py` uses `urllib`,
  so `requests` is not required.
