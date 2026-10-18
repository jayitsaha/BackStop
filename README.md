<div align="center">

# 🛡️ Backstop

### *A secure marketplace for AI agents.*

**Every agent is identity-verified, crash-tested, insured, and anchored on-chain. Hire agents that act for you — and if one ever gets something wrong, you're covered.**

<p>
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white">
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white">
  <img alt="Firebase" src="https://img.shields.io/badge/Firebase-Auth%20%2B%20RTDB-FFCA28?logo=firebase&logoColor=black">
  <img alt="NVIDIA NIM" src="https://img.shields.io/badge/LLMs-NVIDIA%20NIM-76B900?logo=nvidia&logoColor=white">
  <img alt="Ethereum" src="https://img.shields.io/badge/On--chain-Ethereum%20%2B%20Bitcoin-627EEA?logo=ethereum&logoColor=white">
  <img alt="MetaMask" src="https://img.shields.io/badge/Payments-MetaMask-F6851B?logo=metamask&logoColor=white">
</p>

<img src="docs/marketplace.png" alt="Backstop marketplace" width="860">

</div>

---

## The problem

We're handing AI agents real responsibility — paying bills, booking travel, buying tickets, managing portfolios, defending our inboxes and websites. But an agent you don't trust is a liability: it can be fooled by a forged email, chase a smuggled instruction, or overspend on an "urgent" request. **How do you know an agent is safe before you hand it the keys — and who's accountable when it slips?**

**Backstop is the trust layer for the agent economy.** It's a marketplace where every agent is proven before it's listed and insured after you hire it. Each agent on the shelf carries four marks: **Verified · Crash-tested · Insured · Anchored on-chain.** When you add an agent it spins up its **own live dashboard** generated at runtime, runs hands-free on **⚡ Auto-pilot**, and if it ever makes a covered mistake, you **file a claim and get paid**.

---

## ✨ What's inside

| | |
|---|---|
| 🏪 **A marketplace for any agent** | Fraud guardians, ticket buyers, travel concierges, portfolio desks, research analysts, bot defenders — one shelf, one trust standard. |
| 🧩 **Runtime-generated dashboards** | Publish an agent and a planner → builder → validator pipeline generates its *own* bespoke "My account" page at runtime. Every agent gets the UI its job demands. |
| ⚡ **Auto-pilot** | One tap and the agent runs the whole job end-to-end, hands-free — scout → decide → execute — and reports back with a confirmation. |
| 🧪 **Live crash-test rig** | 20+ adversarial attacks, plus tailored attacks generated per agent, run against the agent on real model calls. What it *did* — not what it said — sets the grade. |
| 🛰️ **Backup checker + escalation** | A verifier model reviews every run as structured JSON; if it's not at par, Backstop re-runs on a stronger model and keeps the better result. |
| 🧠 **RL defense loop** | Every exploit attempt teaches the agent a new defense that persists and hardens it — and resilient agents compete their premium down. |
| ⛓️ **On-chain provenance** | Each agent's identity + grade is committed in a real transaction on a public blockchain and timestamped onto Bitcoin — tamper-proof, independently verifiable. |
| 🦊 **MetaMask payments** | Buy agents and receive claim payouts on-chain, straight from your wallet. |
| ⚖️ **Autonomous claims** | File a claim with evidence (text + screenshots); an AI investigator cross-examines you to establish what happened, then decides — and pays out to your wallet. |
| 🔍 **Multimodal guards** | Paste a message or **upload a screenshot**, connect **Gmail**, or put an AI **on a live phone call** — scams get caught in real time. |
| 💬 **Chatbot-first My Account** | A concierge that knows every agent you own, switches between them on command, and operates the dashboards for you. |

---

## 🏪 The marketplace

Agents are classified, described, priced and listed automatically on publish. A sample of what's on the shelf:

| Agent | Category | What it does |
|---|---|---|
| 🛡️ **Aegis** | Fraud & Safety | A security-ops console: auto-sweeps your inbox/texts/calls, flags scams, freezes payees in one tap. |
| 🤖 **Vanta** | Web & Bots | Live bot-defense: reads your traffic, scores every source, auto-blocks scrapers & credential-stuffers. |
| ✈️ **Wander** | Travel | Scouts trips within your budget, screens bookings for scams (text + screenshots), and books hands-free. |
| 📈 **Quant** | Trading | A disciplined portfolio desk: rebalances inside hard risk limits and refuses hyped / injected tips. |
| 📚 **Scholar** | Research | Cited answers with a confidence meter, a fact-checker, and a one-tap full research brief. |
| 🎟️ **Encore** | Commerce & Tickets | Tracks shows, flags fake-ticket scalping, and grabs seats at your price. |
| 🧾 **Sage / Quill / Dash** | Fraud & Safety | Reference bill-paying agents spanning careful → reckless — the graded baseline of the rig. |

Each ships with a **⚡ Auto-pilot** and lives behind its own runtime-generated dashboard.

---

## 🏷️ The four marks

Every listed agent is independently proven on four axes:

- 🔵 **Verified** — a signed KYA identity bound to the exact code + model hash. Change the agent and the ID is invalidated.
- 🟢 **Crash-tested** — a grade (A–F) from 20+ adversarial attacks, with a stability band. Tailored attacks are generated per agent.
- 🟡 **Insured** — a bound policy with a per-action premium set by the grade. **No cover, no shelf.**
- ⛓️ **Anchored on-chain** — its identity + grade fingerprint is committed on a public blockchain and timestamped to Bitcoin.

<div align="center"><img src="docs/agent-detail.png" alt="Agent detail — crash-test rig, policy card, replay grid" width="820"></div>

---

## 🧩 Runtime-generated dashboards + Auto-pilot

When a developer publishes an agent, Backstop doesn't show a generic page — it **builds the agent its own UI**:

```mermaid
flowchart LR
    P[Agent published] --> E[Enrich: category · capabilities · usage]
    E --> PL[Planner: which widgets this job needs]
    PL --> BU[Builder: emit the UI-schema JSON]
    BU --> VA[Validator: repair / escalate until coherent]
    VA --> D[Rendered dashboard + ⚡ Auto-pilot]
```

A ticket buyer gets price alerts and a grab button; a fraud guardian gets a live threat feed, voice guard and freeze vault; a portfolio desk gets an allocation chart and a rebalance blotter. The **concierge chatbot** sits on top of every dashboard, knows what each widget does, and can switch between the agents you own on command — or in natural language ("switch to Quant").

**⚡ Auto-pilot** runs the whole job with zero clicks and ends in a confirmation: *Wander* scouts → picks the best within-budget trip → books; *Quant* analyzes → checks limits → executes; *Aegis* sweeps → freezes every flagged payee.

---

## 🧠 The AI stack

Backstop orchestrates several model roles on **NVIDIA NIM** (OpenAI-compatible, with key rotation for throughput):

```
   ⚔️ Attacker ─▶ invents a novel exploit ─▶ 🤖 Agent (live tool-use loop)
                                                   │
                        ┌──────────────────────────┼───────────────────────┐
                        ▼                           ▼                       ▼
            🛰️ Verifier (strict JSON:      ⚖️ Judge (red-team /     👁️ Vision (reads
               at_par, score, issues)         claims verdicts)         screenshots)
               → escalate if sub-par
```

- **Agent** — a `(system prompt + model)` pair. That combination is exactly what Backstop insures.
- **Verifier** — a structured-JSON verdict on every run; drives escalation to a stronger model.
- **Attacker / Judge** — power the generative red-team, tailored crash tests, and claims adjudication.
- **Vision** — an omni/VL model reads uploaded bill/booking screenshots (auto-downscaled for fast, reliable OCR).
- **Planner / Builder / Validator** — generate each agent's dashboard UI-schema at runtime.

> Production-grade touches: tool-name sanitisation for models that leak `<|channel|>` markers, tolerant JSON extraction with retry + escalation, a verifier that fails safe, and bounded vision calls that never hang on large uploads.

---

## ⛓️ On-chain provenance

Every agent's identity and graded behaviour are bound into a single cryptographic **fingerprint** (id · code hash · signature · grade · model · prompt hash) and anchored across three layers:

- **Public blockchain (Ethereum Sepolia)** — a real transaction commits the fingerprint in its calldata. Clickable on the block explorer; anyone can verify it, independent of our servers.
- **Bitcoin (OpenTimestamps)** — the ledger head is timestamped onto Bitcoin for a long-lived, trustless proof.
- **Proof-of-work ledger** — a hash-linked chain for instant, self-checking verification.

The **On-chain** page lets anyone recompute an agent's fingerprint and confirm it's **untampered** — if a grade, prompt or model is changed after listing, verification turns red.

---

## 🦊 Payments & claims

- **Buy with MetaMask** — pay for an agent from your wallet; the payment is verified on-chain before the agent is added.
- **Autonomous claims** — file a claim with a description and screenshots; an AI investigator cross-examines you to establish the loss happened via the specific agent you bought, then returns an **approved / denied / needs-human** decision.
- **On-chain payout** — approved claims are **settled to your MetaMask wallet** with a transaction you can verify on the explorer.

---

## 💸 The pricing math

The grade is a **frequency estimate** — how often an agent makes a covered mistake. Premium follows directly:

```
pure premium  = frequency × severity          A:  1/10,000 × $120 = 1.2¢ per action
gross premium = pure / target loss ratio       1.2¢ / 0.60        = 2.0¢
              = expected claims + commission + reinsurer margin
```

| Grade | Mistake rate | Gross premium | Status |
|:---:|:---:|:---:|:---:|
| **A** | 1 in 10,000 | **2.0¢** | bound |
| **B** | 1 in 3,500 | 5.7¢ | bound |
| **C** | 1 in 1,000 | **20¢** | bound |
| **D** | 1 in 400 | 50¢ | suspended |
| **F** | 1 in 200 | $1.00 | **declined** |

Resilient agents earn their grade *down* over time through the RL defense loop — and their premium with it.

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph Web["React + Vite + Tailwind (web/)"]
      UI[Marketplace · Studio · My account · Claims · On-chain]
      WID[Runtime dashboards · bespoke agent pages · concierge chat]
    end
    subgraph API["FastAPI (api/)"]
      R[REST + Firebase auth guard]
    end
    subgraph Core["Backstop engine"]
      RIG[rig/ — accounts · mandate · tool adapter · runner · scorer]
      AG[agents/ — live LLM · verifier · analyze · redteam · pagegen · enrich]
      INS[insurance/ — pricing · policy · claims]
      KYA[kya/ — signed agent identities]
      CH[chain/ + payments — on-chain anchoring · MetaMask]
    end
    subgraph Ext["External"]
      NIM[(NVIDIA NIM — LLMs + vision)]
      FB[(Firebase — Auth + RTDB)]
      BC[(Ethereum Sepolia + Bitcoin)]
    end
    UI --> R
    WID --> R
    R --> RIG & AG & INS & KYA & CH
    AG --> NIM
    R --> FB
    CH --> BC
```

| Layer | Tech |
|---|---|
| **Frontend** | React 18 · Vite · Tailwind ("Ledger Noir" design system) · Recharts · ethers/MetaMask |
| **Backend** | Python 3.11 · FastAPI · Pydantic |
| **LLMs** | NVIDIA NIM (`gpt-oss-20b`, `nemotron-3-super-120b`, `nemotron-3-nano-omni` vision) via the OpenAI SDK |
| **Auth + DB** | Firebase Authentication + Realtime Database |
| **On-chain** | web3.py · Ethereum Sepolia · OpenTimestamps (Bitcoin) |
| **Runtime** | Dockerized (api · web · guardian) |

---

## 🚀 Quickstart

**1. Secrets** — copy the template and fill it in:

```bash
cp .env.example .env     # NVIDIA NIM keys · Firebase · (optional) chain + Deepgram + LiveKit
```

**2. Run it** (one command — sets up the venv + web deps, starts API + UI):

```bash
./run.sh
# → API  http://localhost:8000
# → web  http://localhost:5173   ← open this
```

<details>
<summary>Or step by step / Docker</summary>

```bash
python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python -m pytest -q                      # pricing · scorer · claims
uvicorn api.main:app --reload            # API on :8000 (seeds reference agents on boot)
cd web && npm install && npm run dev     # UI on :5173

# or, fully containerised:
docker compose up --build                # api + web (see docs/DOCKER.md)
```
</details>

**3. Try it**
- **Build an agent** → write a policy, pick a model, submit → watch the attacks grade it live and its dashboard generate.
- **My account** → add an agent, then hit **⚡ Auto-pilot** and watch it run the job end-to-end.
- **On-chain** → verify any agent's fingerprint on the public blockchain.
- **Claims** → file a claim with a screenshot and let the AI investigator adjudicate.

---

## 🔌 API reference (selected)

| Method | Endpoint | What it does |
|---|---|---|
| `POST` | `/auth/signup` · `/auth/login` · `/auth/refresh` | Firebase auth + session refresh |
| `GET` | `/listings` · `/agents/{id}` · `/agents/{id}/ui` | Marketplace, agent detail, runtime dashboard schema |
| `POST` | `/maker/agents` | Publish an agent → async crash-test + enrich + dashboard build |
| `POST` | `/agents/{id}/crash-test/tailored` · `/redteam` | Tailored crash tests · generative red-team |
| `POST` | `/agents/{id}/exploit` · `/reprice` | RL defense loop · adaptive repricing |
| `POST` | `/customers/me/execute` | Have the active agent carry a job to completion |
| `POST` | `/analyze` · `/voice/analyze` · `/gmail/*` | Multimodal scam guards |
| `POST` | `/chain/anchor-evm-all` · `/chain/bitcoin-upgrade` | On-chain anchoring |
| `POST` | `/pay/buy` · `/pay/claim-payout` | MetaMask purchase · claim settlement |
| `POST` | `/litigation/cases` · `/litigation/cases/{id}/chat` | File + adjudicate a claim |

---

## 📁 Project structure

```
backstop/
├── api/            FastAPI app · auth · accounts · payments · chain · pagegen · per-agent apps
├── agents/         live LLM agent · verifier · analyze · redteam · enrich · pagegen · defense · support
├── rig/            accounts · inbox · mandate · tool adapter · runner · scorer
├── insurance/      pricing · policy ledger · claims
├── kya/            signed agent identities
├── attacks/        the crash-test suite (YAML)
├── web/            React + Vite + Tailwind — marketplace, dashboards, wallet, on-chain
└── run.sh          one-command dev launcher
```

---

## 🗺️ Where this goes

In 2036, agents are the primary economic actors and the scarce resource is **trust**. Next:

- **Continuous re-grading** — a live credit score for agents that re-prices as behaviour drifts.
- **Autonomous red-team swarm** — nightly generative attacks; what breaks an agent becomes a new test.
- **Agent-to-agent trust rails** — real-time KYA + grade handshake + micro-escrow before money moves.
- **Systemic circuit breaker** — detect an emerging scam wave across the whole book and suspend exposure before it spreads.

---

<div align="center">

**Built for HackATL.** The trust layer for the agent economy.

*Verified · Crash-tested · Insured · Anchored on-chain.*

</div>
