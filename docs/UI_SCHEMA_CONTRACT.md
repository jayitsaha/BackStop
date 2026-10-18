# Backstop Dynamic Dashboard — UI-Schema Contract (v1)

> **This file is the single source of truth** shared by the page-generation engine
> (`agents/pagegen.py`, which *emits* a UI-schema) and the frontend renderer
> (`web/src/components/DynamicDashboard.jsx`, which *renders* it). Neither side may
> invent widget types or props the other doesn't implement. If you need a new widget,
> add it **here first**, then on both sides.

Backstop is **a secure agentic marketplace** — a store of identity-verified, crash-tested,
insured AI agents that do *anything* (fraud defense, concert-ticket buying, web bot detection,
travel booking, bill-pay, …). When a developer publishes an agent, Backstop **generates that
agent's "My account" dashboard at runtime** from the agent's description + capabilities. The
dashboard is described by a single JSON document — the **UI-schema** — that this contract defines.

---

## 1. Top-level shape

```jsonc
{
  "schema_version": "1.0",
  "agent_id": "ticketpro-ab12cd",          // the marketplace agent id
  "use_case_type": "ticket-buyer",         // machine slug (see §4)
  "title": "TicketPro — your concert concierge",
  "subtitle": "Finds, watches and buys tickets at your price — and never gets scalped.",
  "accent": "info",                        // one of: brand | info | safe | warn | bad (theme color)
  "icon": "ticket",                         // see icon vocabulary §5
  "greeting": "Hi! I'm TicketPro. Tell me an artist and your budget and I'll hunt for seats.",
  "primary_action": {                       // optional; the hero CTA
    "id": "run-inbox",
    "label": "Scan my inbox",
    "widget": "message_analyzer"            // id of the section this CTA scrolls-to/opens, or an action
  },
  "sections": [ /* ordered list of Section objects, see §2 */ ],
  "chat_context": "You are the in-dashboard assistant for TicketPro, a concert-ticket buying agent. It can search listings, set price alerts, and purchase within the user's budget mandate. Capabilities: [...]. Help the user understand and operate this dashboard. You can suggest they click specific widgets by name."
}
```

Rules:
- `sections` is an **ordered** array; the renderer lays them out top-to-bottom respecting `span`.
- Every section has a unique `id`, a `type` from the **fixed vocabulary** (§3), a `title`, an optional
  `span` (`"full"` default, or `"half"` to pair two side-by-side on wide screens), and a `props` object
  whose shape is defined per-type in §3.
- Unknown `type` → the renderer shows a small "unsupported widget" placeholder (never crashes).
- `accent` maps to the existing Tailwind tokens (`brand` gold, `info` blue, `safe` green, `warn` amber,
  `bad` red). Widgets tint their chrome with the dashboard accent unless a widget overrides it.

---

## 2. Section object

```jsonc
{
  "id": "price-alerts",
  "type": "item_list",
  "title": "Price alerts",
  "span": "half",                 // "full" | "half"
  "subtitle": "Seats you're watching",   // optional
  "props": { /* type-specific, see §3 */ }
}
```

---

## 3. Widget vocabulary (the ONLY allowed `type` values)

Each widget is a real, implemented React component. The builder agent may only emit these.

### 3.1 `agent_runner` — **the universal widget. Works for every agent.**
A freeform box where the user instructs the live agent; it runs the purchased agent's LLM
tool-use loop server-side and streams back the tool-call log + final report. Because *every*
marketplace agent is an LLM-with-tools, this always works regardless of domain.
```jsonc
"props": {
  "input_label": "What should TicketPro do?",
  "placeholder": "Find 2 tickets to Coldplay in Atlanta under $180 each",
  "examples": ["Watch for Taylor Swift resale under $300", "Buy the cheapest 2 together"],
  "cta": "Run TicketPro"
}
```
Backend: `POST /customers/me/agent-task` `{ task, inputs? }` → `{ run: {log, messages_to_user, report, result, new_payment_ids} }`.

### 3.2 `message_analyzer` — paste/upload a message or document; the agent classifies & extracts.
Fraud agents use `mode:"fraud"` (scam/caution/safe verdict). Others use `mode:"generic"`
(the agent summarizes/classifies per its own purpose).
```jsonc
"props": {
  "placeholder": "Paste the email, bill, listing or message…",
  "accept": ["text", "image"],       // which inputs to show
  "mode": "fraud",                    // "fraud" | "generic"
  "verdict_labels": { "safe": "Looks legit", "caution": "Double-check", "scam": "Likely a scam" }
}
```
Backend: `POST /analyze` `{ text?, image?, agent? }`.

### 3.3 `voice_guard` — browser-mic / audio-upload live scam analysis. (fraud/safety agents)
`"props": { "mode": "vishing" }`. Backend: `POST /voice/analyze`.

### 3.4 `live_call_guard` — LiveKit live-call guardian (fraud/safety agents).
`"props": {}`. Backend: `POST /livekit/token`, `GET /calls`.

### 3.5 `gmail_connect` — connect Gmail and triage the inbox through this agent.
`"props": { "query": "in:inbox newer_than:1y", "actions": ["hold","reply","handoff","report"] }`.

### 3.6 `stat_cards` — a row of KPI tiles.
```jsonc
"props": {
  "items": [
    { "label": "Covered limit", "source": "certificate.per_incident_limit_usd", "format": "usd" },
    { "label": "Premium you pay", "value": 0, "format": "usd" },         // literal value OR source
    { "label": "Actions taken",  "source": "runs.length", "format": "int" }
  ]
}
```
`source` is a dot-path into the **customer state** (see §6) or one of the derived metrics the
renderer knows (`runs.length`, `payments.length`, `claims.length`, `frozen.length`). `format`:
`usd | int | pct | text | oneIn`.

### 3.7 `item_list` — a table/list over a data source.
```jsonc
"props": {
  "source": "payments",               // §6 data sources
  "columns": [
    { "key": "payee", "label": "To", "format": "text" },
    { "key": "amount", "label": "Amount", "format": "usd" },
    { "key": "status", "label": "Status", "format": "status" }
  ],
  "empty": "No activity yet.",
  "limit": 20
}
```

### 3.8 `timeline` — reverse-chronological activity feed (agent runs / events).
`"props": { "source": "runs", "empty": "Nothing yet — run the agent." }`.
Renders each run's tool-call steps + messages (reuses the existing run-result timeline).

### 3.9 `form_action` — a structured form that dispatches a task to the agent.
Like `agent_runner` but with typed fields instead of freeform text. The renderer assembles the
field values into a task string / inputs object and calls the same `agent-task` endpoint.
```jsonc
"props": {
  "fields": [
    { "key": "artist", "label": "Artist / event", "type": "text", "placeholder": "Coldplay" },
    { "key": "city",   "label": "City",            "type": "text" },
    { "key": "budget", "label": "Max $/ticket",    "type": "number" },
    { "key": "qty",    "label": "How many",        "type": "number" }
  ],
  "submit": { "label": "Find tickets", "task_template": "Find {qty} tickets to {artist} in {city} under ${budget} each." }
}
```

### 3.10 `claims_panel` — file & view insurance claims for payments this agent made.
`"props": {}`. Backend: `POST /customers/me/claims`, and links to the Litigation flow.

### 3.11 `markdown` — static explainer / usage guide / "how to use me".
`"props": { "content": "## How TicketPro works\n1. Tell me…" }`.

### 3.12 `chart` — a simple recharts line/bar over a numeric series.
```jsonc
"props": { "kind": "line", "source": "runs", "x": "ts", "y": "premium_accrued_usd", "label": "Premium accrued" }
```

### 3.13 `capabilities` — pretty grid of the agent's capabilities (from the agent record).
`"props": { "source": "agent.capabilities" }` — renders `[{name, description}]`.

### 3.14 `mandate_editor` — view/adjust the spend/behaviour mandate (finance-ish agents).
`"props": {}`. Backend: existing mandate + hold/unhold endpoints.

---

## 4. `use_case_type` slugs (drive sensible defaults; not exhaustive)

`fraud-detector` · `bill-pay` · `ticket-buyer` · `shopping` · `travel-booker` ·
`bot-detector` · `web-monitor` · `research` · `scheduler` · `support-agent` ·
`trading` · `generic` (fallback).

The planner picks the closest slug; `generic` always falls back to `agent_runner` + `markdown`
+ `timeline` + `stat_cards` so *any* agent has a working dashboard.

---

## 5. Icon vocabulary (renderer maps these to inline SVGs; unknown → shield)
`shield · ticket · bot · plane · cart · chart · search · calendar · phone · mail · bank · sparkle`

---

## 6. Data sources available to widgets (dot-paths into customer state)

The renderer fetches customer state (`GET /customers/me`) and exposes these to `source`:

- `payments` → `customer.bank.payments` (array of `{id, payee, amount, account_last4, status, ts, memo}`)
- `runs` → `customer.runs` (array of `{ts, agent, log[], messages_to_user[], report, new_payment_ids[], premium_accrued_usd}`)
- `claims` → `customer.claims`
- `frozen` → `customer.frozen`
- `inbox` → `customer.inbox`
- `certificate` → `customer.certificate` (`{certificate_id, per_incident_limit_usd}`)
- `agent` → the active marketplace agent record (`{name, category, use_case_type, description, capabilities[], usage[]}`)
- derived: `runs.length`, `payments.length`, `claims.length`, `frozen.length`, `premium_collected_usd`

`format` helpers the renderer implements: `usd`, `int`, `pct`, `oneIn`, `text`, `status`, `date`.

---

## 7. Where the schema lives

- Generated at publish time and stored on the agent record at `agents/{id}.ui_schema`
  (and mirrored under Firebase `ui_schemas/{agent_id}` for quick fetch).
- Fetchable via `GET /agents/{id}/ui` → `{ ui_schema }` (regenerates on demand if missing).
- Regeneratable via `POST /agents/{id}/ui/regenerate` (owner only).
- The validator agent guarantees: valid JSON, ≥3 sections, every `type` in the vocabulary, exactly
  one `agent_runner` **or** `form_action` present (so the agent can always be operated), a `markdown`
  usage section present, and `chat_context` non-empty. If invalid, it repairs or the builder re-runs
  on the escalation model.

---

## 8. Minimal guarantees for the renderer

- Must render **every** widget type in §3, tolerate missing/extra props, and never crash on bad data
  (wrap each section in an error boundary; unknown types → placeholder).
- Must theme off `accent`, reuse existing `.card`, `.btn-primary`, `.chip`, `.eyebrow`, `.label`, `.inp`
  classes and the `marks.jsx` icons.
- The dashboard page (`CustomerApp`) is **chatbot-first**: it opens as an Asha-style chat (re-skinned
  ink+gold). The chat can (a) answer questions using `chat_context`, and (b) switch the active agent /
  open specific widgets. Selecting a purchased agent swaps in that agent's rendered UI-schema beneath
  the chat, which stays docked.
