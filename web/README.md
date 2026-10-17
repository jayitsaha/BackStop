# Backstop web

The marketplace **and** the customer app — React + Vite + Tailwind + recharts on the live FastAPI
backend. Every screen reads or writes real server state; nothing is hardcoded for the demo.

## Run

```bash
./run.sh                                  # from backstop/ — starts API + web together
# or just the web app (expects the API on :8000):
cd web && npm install && npm run dev      # http://localhost:5173
```

Vite proxies `/api/*` → `http://localhost:8000`. Override with `VITE_API_BASE`.

## Pages — all backed by live state

| Route | What a real user does | API |
| --- | --- | --- |
| `/` | Browse the marketplace. Cards carry the three marks (**Verified · Grade · Protected + premium**). Grades/quotes are computed by the rig on API startup. | `GET /listings` |
| `/agent/:name` | Inspect an agent: identity + signature, by-category sub-scores, 20-tile replay, policy card, coverage. **Run any crash test live** and watch every tool call. | `GET /agents/{name}`, `POST /agents/{name}/crash-test` |
| `/pricing` | The grade→frequency→premium table and the 2¢ derivation — every number read from `GET /terms`. Penny's monthly book is the live grade-A quote. | `GET /terms`, `GET /agents/Sage` |
| `/submit` | **Agent-maker console.** Submit an agent → real KYA (signed ID bound to the code hash) → 20×3 crash tests → grade → price → bound policy → on the shelf. | `GET /agents/available`, `POST /agents/{name}/list` |
| `/app` | **The real customer app.** Open an account (connect the fake bank, set your mandate), add an insured agent, drop real scenarios into your inbox, and **let the agent actually pay your bills**. Premium accrues per payment. Flag any payment to file a **live claim** — in-mandate mistakes auto-pay, the incident becomes test 21. | `POST /customers`, `.../agent`, `.../inject`, `.../run`, `.../claims` |
| `/loop` | The whole loop and why every incident makes every agent safer. | — |

## What's real vs. mocked

- **Real:** identity/KYA signatures, the crash-test runs, grades, the pricing math, policy binding,
  premium accrual, claims adjudication, the review queue, test-21 generation. The customer app runs
  the **same** agent code through the **same** Tools adapter the rig uses — payments, holds and
  schedules all happen for real against your account's bank, inbox and mandate.
- **Mocked by design** (per the build plan): the money itself. The bank, payments and reinsurer are
  in-memory fakes — no real card network or carrier. Everything *around* the money is real code.

## Try it yourself (real, no script)

1. `/submit` → submit **Dash** → watch it score F and get **declined** (no cover, no shelf).
2. `/app` → open an account, add **Quill** → Inbox → add “Spotify payment-failed, same cycle” → **Let Quill handle my inbox**. Quill pays the verified payee twice.
3. Claims tab → flag the duplicate → **covered, $11.99, settled 00:47**, and it becomes `T21_spotify_duplicate`.
4. Switch account, add **Sage**, inject the forged-landlord email → Sage **holds** it and messages you. No claim needed — that's the value.
