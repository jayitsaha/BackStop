# Deploying Backstop to Vercel (free, all-in-one)

Both the **React/Vite frontend** and the **FastAPI backend** run on a single free Vercel
(Hobby) project. The frontend is served as static files; the backend runs as one Python
serverless function. The browser talks to the API same-origin at `/api/*`, which Vercel
routes to the function.

```
Browser ──> https://<your-app>.vercel.app
              ├── /            → static frontend (web/dist)
              └── /api/*        → vercel_app.py  (FastAPI, api.main:app)
                                   ├── state  → Firebase Realtime DB (external)
                                   ├── LLMs   → NVIDIA NIM (OpenAI-compatible)
                                   └── chain  → EVM testnet RPC (optional)
```

## What changed to make it serverless-safe

Vercel serverless functions are **stateless**, **capped at 60s**, and **can't keep background
threads alive** after a response returns. The code now adapts automatically when the `VERCEL`
environment variable is present (Vercel sets it):

- **`vercel_app.py`** — ASGI entrypoint. Strips the `/api` prefix so the existing root-level
  routes match, and forwards lifespan events through to the real app.
- **`vercel.json`** — builds the Python function + the static web app, and routes `/api/*` to
  the function with everything else falling back to the SPA's `index.html`.
- **Maker upload job** (`/maker/agents` → `/maker/jobs/{id}`) and **tailored crash-test job**
  (`/agents/{id}/crash-test/tailored` → `/crash-jobs/{id}`): job state is now persisted to
  Firebase (`maker_jobs/`, `crash_jobs/`) and the work runs **inline** on serverless instead of
  in a dropped background thread. On a long-lived server (local `./run.sh`) the original
  threaded, live-progress behaviour is preserved.
- **Seeding** (reference agents + insurance-ledger rebind) is now idempotent and also runs from
  an HTTP middleware, so it's correct even if the platform skips startup/lifespan events, and
  each cold instance rebinds its ledger on first request.
- **On-chain waits** capped at 45s (were 90–180s) to stay under the function limit; they already
  degrade gracefully on timeout.
- Added `Pillow` to `requirements.txt` (multimodal Inbox Guard image uploads) and gave
  `BACKSTOP_LLM_MODEL` / the KYA signing secret safe fallbacks.

### Known best-effort limits on free Vercel (per the agreed scope)

- A **full 20-test maker crash run** or a large **tailored crash run** makes many live LLM calls
  and can exceed the 60s cap. Keep `runs=1` and smaller `n` (≤6) for reliable completion. If a
  job hits the ceiling its Firebase record stays at `running`. Everything else — scam analysis,
  concierge chat, voice guard, red-team, single/custom crash test, dynamic dashboards, claims,
  on-chain anchoring — fits comfortably.
- The live **phone-call screening worker** (LiveKit SIP, `scripts/call_guardian.py`) is a
  separate long-lived process and is not part of the serverless deploy. Token minting
  (`/livekit/token`) and browser live-mic voice guard still work.

## Environment variables (set in Vercel → Project → Settings → Environment Variables)

Set these for **Production** (and Preview if you want PR deploys to work). Values come from your
existing local `.env`.

### Required — core + all AI features
| Var | Notes |
|---|---|
| `NVIDIA_API_KEYS` | one or more NIM keys, comma-separated |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_MODEL` | e.g. `openai/gpt-oss-20b` |
| `BACKSTOP_CHECKER_MODEL` | verifier model |
| `BACKSTOP_ESCALATION_MODEL` | stronger escalation model |
| `BACKSTOP_VISION_MODEL` | multimodal model for image uploads |
| `FIREBASE_API_KEY` | Firebase web API key (auth) |
| `FIREBASE_DB_URL` | `https://<project>-default-rtdb.firebaseio.com` |
| `FIREBASE_DB_SECRET` | Realtime DB secret (storage) |
| `BACKSTOP_KYA_SECRET` | signing salt for agent IDs (any random string) |

### Optional — degrade gracefully if unset
| Var | Enables |
|---|---|
| `DEEPGRAM_API_KEY` | transcribing uploaded voicemails (live-mic needs no key) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | live-call screening tokens |
| `CHAIN_NAME`, `CHAIN_ID`, `CHAIN_RPC_URL`, `CHAIN_EXPLORER`, `CHAIN_ADDRESS`, `CHAIN_PRIVATE_KEY` | EVM testnet anchoring + MetaMask payouts (use a THROWAWAY testnet key) |

### Frontend build-time vars
| Var | Notes |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | optional; enables the live Gmail connector. Leave blank to hide it. |
| `VITE_API_BASE` | **leave UNSET** — the app then calls `/api` same-origin, which is what we want on Vercel. |

> Vercel does not read your `.env` file (it's gitignored and excluded). You must add the vars in
> the dashboard (or `vercel env add`).

## Deploy

The repo root (where `vercel.json` lives) is the Vercel project root.

### Option A — Git integration (recommended, auto-deploys on push)
1. Push this branch (already done by the agent) and/or merge it.
2. In the Vercel dashboard: **Add New → Project → Import** `jayitsaha/BackStop`.
3. **Root Directory**: leave as the repo root (it contains `vercel.json`).
4. Framework preset: **Other** (vercel.json drives the build; don't override build/output).
5. Add the environment variables above.
6. **Deploy.** Vercel builds the web app + the Python function and gives you a `*.vercel.app` URL.

### Option B — Vercel CLI from this directory
```bash
npm i -g vercel
cd idea/backstop            # the git repo root, where vercel.json is
vercel login
vercel link                 # create/link the project
# add env vars (repeat for each, or paste in the dashboard):
vercel env add NVIDIA_API_KEYS production
# ... all the required vars above ...
vercel --prod               # build + deploy
```

## After deploy — smoke test
```bash
curl https://<your-app>.vercel.app/api/health
# {"ok":true,"llm":true,"firebase":true}

curl https://<your-app>.vercel.app/api/listings   # should list Sage/Quill/Dash + any maker agents
```
Then open `https://<your-app>.vercel.app` — sign up, add an agent, run the dashboards.

### If LLM endpoints time out
Vercel → Project → Settings → **Functions** → set **Max Duration** to **60s** (Hobby max).
`vercel.json` requests this, but confirm it's applied.
