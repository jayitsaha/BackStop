"""LLM page-generation pipeline — PLANNER -> BUILDER -> VALIDATOR.

When a developer publishes an agent, Backstop generates that agent's "My account" dashboard at
runtime as a JSON UI-schema (see docs/UI_SCHEMA_CONTRACT.md). This module is the *autonomous*
upgrade over the deterministic generator in `api/pagegen.py`: it reasons about which widgets THIS
specific agent needs instead of keying off a static use_case_type table.

The pipeline is three LLM stages, all strict JSON:

  1. PLANNER  — given the agent record, decides which dashboard sections this agent needs, choosing
                ONLY from the fixed widget vocabulary (§3 of the contract). A ticket-buyer gets no
                voice/live-call guards; a fraud-detector does. Returns an ordered list of
                {id, type, title, span, rationale}.
  2. BUILDER  — given the plan + record, emits the FULL UI-schema JSON per the contract (top-level
                keys + per-type section props + §6 data sources).
  3. VALIDATOR — checks the §7 guarantees (valid shape; >=3 sections; every type in the vocabulary;
                at least one of agent_runner OR form_action; a markdown usage section; non-empty
                chat_context; accent/icon in vocab). Invalid schemas are REPAIRED programmatically
                where cheap; if still invalid the BUILDER is re-run once on the escalation model.

Contract: this module NEVER raises on bad LLM output — it *raises RuntimeError* only to signal that
`api/pagegen.py` should fall back to its deterministic builder (i.e. when no LLM keys are present or
the pipeline cannot produce a valid schema even after repair + escalation). It never imports
`api.pagegen` (circular import) and re-implements a tiny local validator instead.
"""
from __future__ import annotations

from typing import Optional

from .nim import ESCALATION_MODEL, ask_json, llm_available

# ---------------------------------------------------------------------------
# Vocabularies (mirrors of the contract; kept local so we never import api.*)
# ---------------------------------------------------------------------------
WIDGET_TYPES = {
    "agent_runner", "message_analyzer", "voice_guard", "live_call_guard", "gmail_connect",
    "stat_cards", "item_list", "timeline", "form_action", "claims_panel", "markdown",
    "chart", "capabilities", "mandate_editor",
}
# Fraud/safety-only widgets: must NOT appear for non-safety agents (e.g. a ticket-buyer).
SAFETY_ONLY = {"voice_guard", "live_call_guard"}
SAFETY_TYPES = {"fraud-detector", "bill-pay", "support-agent"}

ICONS = {"shield", "ticket", "bot", "plane", "cart", "chart", "search",
         "calendar", "phone", "mail", "bank", "sparkle"}
ACCENTS = {"brand", "info", "safe", "warn", "bad"}
SPANS = {"full", "half"}
DATA_SOURCES = {"payments", "runs", "claims", "frozen", "inbox", "certificate",
                "agent", "agent.capabilities"}

MAX_SECTIONS = 9

# ---------------------------------------------------------------------------
# Stage 1 — PLANNER
# ---------------------------------------------------------------------------
_PLANNER_SYS = """You are the dashboard PLANNER for Backstop, a secure marketplace of identity-verified,
insured AI agents that can do ANYTHING (buy concert tickets, detect web bots, book travel, defend
against payment fraud, research, trade, schedule, pay bills, etc.).

Each purchased agent gets a "My account" dashboard assembled from a FIXED vocabulary of widgets.
Your job: pick the ordered set of sections that fit THIS agent's actual purpose — nothing generic,
nothing irrelevant.

Allowed widget `type` values (choose ONLY from these):
- agent_runner    : freeform box to give the agent any task (works for EVERY agent).
- form_action     : a typed form that dispatches a structured task (good when inputs are well-defined).
- message_analyzer: paste/upload a message/doc; the agent classifies or summarizes it.
- voice_guard     : live audio scam analysis. FRAUD/SAFETY AGENTS ONLY.
- live_call_guard : live-call guardian. FRAUD/SAFETY AGENTS ONLY.
- gmail_connect   : connect Gmail and triage the inbox (agents that act on email/bills/fraud).
- stat_cards      : a row of KPI tiles.
- item_list       : a table over a data source (payments/runs/claims/...).
- timeline        : reverse-chronological activity feed of agent runs.
- claims_panel    : file & view insurance claims (agents that spend money / take risky actions).
- mandate_editor  : view/adjust the spend mandate (finance / payment agents).
- chart           : a simple line/bar chart over a numeric series.
- capabilities    : grid of the agent's capabilities.
- markdown        : static explainer / "how to use me" guide.

HARD RULES:
- Pick voice_guard / live_call_guard ONLY for fraud, scam, safety or call-screening agents. A
  ticket-buyer, shopper, travel-booker, researcher, scheduler or trader must NEVER get them.
- Include at least one of agent_runner OR form_action (so the agent can always be operated).
- Include exactly one markdown "how to use" section.
- Include a timeline and a stat_cards section so the user can see activity.
- Prefer form_action over agent_runner when the agent's inputs are concrete and few.
- 4 to 8 sections total, ordered the way they should appear top-to-bottom.

Return ONLY a JSON object:
{
  "sections": [
    { "id": "short-slug", "type": "<one of the vocab>", "title": "Human title",
      "span": "full" | "half", "rationale": "one short phrase why this agent needs it" }
  ]
}
No prose outside the JSON."""


def _planner(rec: dict) -> list[dict]:
    uct = rec.get("use_case_type") or "generic"
    caps = ", ".join(c.get("name", "") for c in (rec.get("capabilities") or []) if isinstance(c, dict))
    user = (
        f"Agent name: {rec.get('name')}\n"
        f"use_case_type: {uct}\n"
        f"category: {rec.get('category')}\n"
        f"description: {rec.get('description') or rec.get('tagline') or ''}\n"
        f"capabilities: {caps}\n"
        f"usage steps: {rec.get('usage') or []}\n"
        f"inputs: {rec.get('inputs') or []}\n"
        f"outputs: {rec.get('outputs') or []}\n"
        f"example_tasks: {rec.get('example_tasks') or []}\n\n"
        "Plan this agent's dashboard sections."
    )
    data = ask_json(_PLANNER_SYS, user, temperature=0.2, max_tokens=1200)
    secs = data.get("sections") if isinstance(data, dict) else None
    if not isinstance(secs, list) or not secs:
        raise RuntimeError("planner produced no sections")
    # Clamp the plan to the vocab + drop safety widgets for non-safety agents.
    is_safety = uct in SAFETY_TYPES or _looks_safety(rec)
    clean: list[dict] = []
    seen_ids = set()
    for i, s in enumerate(secs):
        if not isinstance(s, dict):
            continue
        t = s.get("type")
        if t not in WIDGET_TYPES:
            continue
        if t in SAFETY_ONLY and not is_safety:
            continue
        sid = str(s.get("id") or f"sec-{i}").strip() or f"sec-{i}"
        while sid in seen_ids:
            sid += "x"
        seen_ids.add(sid)
        span = s.get("span") if s.get("span") in SPANS else "full"
        clean.append({
            "id": sid,
            "type": t,
            "title": str(s.get("title") or t.replace("_", " ").title()),
            "span": span,
            "rationale": str(s.get("rationale") or ""),
        })
        if len(clean) >= MAX_SECTIONS:
            break
    if not clean:
        raise RuntimeError("planner sections all invalid")
    return clean


def _looks_safety(rec: dict) -> bool:
    text = " ".join(str(x) for x in [
        rec.get("name"), rec.get("use_case_type"), rec.get("category"),
        rec.get("description"), rec.get("tagline"),
    ] if x).lower()
    return any(k in text for k in ("fraud", "scam", "phish", "vish", "safety", "guardian", "call screen"))


# ---------------------------------------------------------------------------
# Stage 2 — BUILDER
# ---------------------------------------------------------------------------
_BUILDER_SYS = """You are the dashboard BUILDER for Backstop. You are given an agent record and an
approved PLAN (an ordered list of sections with type + title + span). Emit the COMPLETE UI-schema
JSON that the Backstop renderer consumes. Follow the contract EXACTLY.

Top-level keys (all required):
  schema_version  : "1.0"
  agent_id        : (will be overwritten by the server — you may echo it)
  use_case_type   : the agent's slug
  title           : the agent's name / short title
  subtitle        : one honest sentence about what it does
  accent          : one of brand | info | safe | warn | bad
  icon            : one of shield | ticket | bot | plane | cart | chart | search | calendar | phone | mail | bank | sparkle
  greeting        : a friendly 1-2 sentence greeting from the agent to the user
  primary_action  : { "id": "...", "label": "...", "widget": "<id of a section in sections[]>" }
  sections        : the ordered list below, with per-type props filled in (see shapes)
  chat_context    : a non-empty paragraph briefing the in-dashboard assistant on this agent & how to
                    operate the dashboard (mention capabilities and which widgets to click).

Keep each section's id/type/title/span EXACTLY as given in the plan. Fill `props` per type:
- agent_runner  : { input_label, placeholder, examples:[...], cta }
- form_action   : { fields:[{key,label,type:"text"|"number",placeholder?}], submit:{label, task_template:"... {key} ..."} }
- message_analyzer: { placeholder, accept:["text"|"image"], mode:"fraud"|"generic", verdict_labels?:{safe,caution,scam} }
- voice_guard   : { mode:"vishing" }
- live_call_guard: {}
- gmail_connect : { query:"in:inbox newer_than:1y", actions:["hold","reply","handoff","report"] }
- stat_cards    : { items:[{label, source|value, format:"usd"|"int"|"pct"|"text"|"oneIn"}] }
- item_list     : { source, columns:[{key,label,format}], empty, limit }
- timeline      : { source:"runs", empty }
- claims_panel  : {}
- mandate_editor: {}
- chart         : { kind:"line"|"bar", source, x, y, label }
- capabilities  : { source:"agent.capabilities" }
- markdown      : { content:"## markdown string..." }

Data `source` values must be dot-paths into customer state: payments, runs, claims, frozen, inbox,
certificate, agent, agent.capabilities, or derived (runs.length, payments.length, claims.length,
frozen.length, premium_collected_usd). Do NOT invent sources.

The markdown section's content MUST be a real "how to use" guide built from the agent's usage steps.
Return ONLY the JSON object — no prose, no markdown fences."""


def _builder(rec: dict, plan: list[dict], *, model: Optional[str] = None) -> dict:
    uct = rec.get("use_case_type") or "generic"
    caps = ", ".join(c.get("name", "") for c in (rec.get("capabilities") or []) if isinstance(c, dict))
    user = (
        f"AGENT RECORD\n"
        f"name: {rec.get('name')}\n"
        f"use_case_type: {uct}\n"
        f"category: {rec.get('category')}\n"
        f"description: {rec.get('description') or rec.get('tagline') or ''}\n"
        f"tagline: {rec.get('tagline') or ''}\n"
        f"capabilities: {caps}\n"
        f"usage steps: {rec.get('usage') or []}\n"
        f"inputs: {rec.get('inputs') or []}\n"
        f"outputs: {rec.get('outputs') or []}\n"
        f"example_tasks: {rec.get('example_tasks') or []}\n"
        f"icon hint: {rec.get('icon') or 'sparkle'}\n"
        f"accent hint: {rec.get('accent') or 'brand'}\n\n"
        f"APPROVED PLAN (keep id/type/title/span exactly):\n{plan}\n\n"
        "Emit the full UI-schema JSON now."
    )
    data = ask_json(
        _BUILDER_SYS, user,
        model=model, temperature=0.2, max_tokens=2500,
    )
    if not isinstance(data, dict):
        raise RuntimeError("builder did not return an object")
    return data


# ---------------------------------------------------------------------------
# Stage 3 — VALIDATOR + programmatic REPAIR
# ---------------------------------------------------------------------------
def _validate(schema: dict) -> list[str]:
    """Return a list of guarantee violations ([] == valid)."""
    errs: list[str] = []
    if not isinstance(schema, dict):
        return ["not an object"]
    secs = schema.get("sections")
    if not isinstance(secs, list) or len(secs) < 3:
        errs.append("fewer than 3 sections")
        secs = secs if isinstance(secs, list) else []
    types = []
    for s in secs:
        if not isinstance(s, dict):
            errs.append("non-object section")
            continue
        t = s.get("type")
        if t not in WIDGET_TYPES:
            errs.append(f"bad type: {t}")
        else:
            types.append(t)
        if not s.get("id"):
            errs.append("section missing id")
        if not s.get("title"):
            errs.append("section missing title")
    if not ({"agent_runner", "form_action"} & set(types)):
        errs.append("no agent_runner or form_action")
    if "markdown" not in types:
        errs.append("no markdown usage section")
    if not str(schema.get("chat_context") or "").strip():
        errs.append("empty chat_context")
    if schema.get("accent") not in ACCENTS:
        errs.append("bad accent")
    if schema.get("icon") not in ICONS:
        errs.append("bad icon")
    return errs


def _repair(schema: dict, rec: dict, plan: list[dict]) -> dict:
    """Cheap, programmatic fixes for common guarantee violations. Mutates & returns `schema`."""
    name = rec.get("name", "your agent")
    uct = rec.get("use_case_type") or "generic"
    is_safety = uct in SAFETY_TYPES or _looks_safety(rec)

    # Normalize sections: drop junk, clamp types, drop safety-only for non-safety agents.
    secs = schema.get("sections")
    if not isinstance(secs, list):
        secs = []
    clean: list[dict] = []
    seen = set()
    for i, s in enumerate(secs):
        if not isinstance(s, dict):
            continue
        t = s.get("type")
        if t not in WIDGET_TYPES:
            continue
        if t in SAFETY_ONLY and not is_safety:
            continue
        sid = str(s.get("id") or f"sec-{i}").strip() or f"sec-{i}"
        while sid in seen:
            sid += "x"
        seen.add(sid)
        s["id"] = sid
        s["type"] = t
        s["title"] = str(s.get("title") or t.replace("_", " ").title())
        s["span"] = s.get("span") if s.get("span") in SPANS else "full"
        if not isinstance(s.get("props"), dict):
            s["props"] = _default_props(t, rec)
        clean.append(s)

    types = {s["type"] for s in clean}

    # Guarantee an operator widget.
    if not ({"agent_runner", "form_action"} & types):
        clean.insert(0, {
            "id": "runner", "type": "agent_runner", "title": f"Ask {name}", "span": "full",
            "props": _default_props("agent_runner", rec),
        })
        types.add("agent_runner")

    # Guarantee a markdown usage section.
    if "markdown" not in types:
        clean.append({
            "id": "usage", "type": "markdown", "title": "How to use it", "span": "full",
            "props": _default_props("markdown", rec),
        })
        types.add("markdown")

    # Guarantee >=3 sections with sensible extras.
    extras = [
        ("stats", "stat_cards", "Activity"),
        ("activity", "timeline", "History"),
        ("caps", "capabilities", "What it can do"),
    ]
    ei = 0
    while len(clean) < 3 and ei < len(extras):
        sid, t, title = extras[ei]
        ei += 1
        if t in types:
            continue
        clean.append({"id": sid, "type": t, "title": title, "span": "full",
                      "props": _default_props(t, rec)})
        types.add(t)

    schema["sections"] = clean[:MAX_SECTIONS]

    # Top-level fields.
    schema["schema_version"] = "1.0"
    schema["agent_id"] = rec.get("id")
    schema["use_case_type"] = uct
    if not str(schema.get("title") or "").strip():
        schema["title"] = str(name)
    if not str(schema.get("subtitle") or "").strip():
        schema["subtitle"] = rec.get("tagline") or rec.get("description") or ""
    if schema.get("accent") not in ACCENTS:
        schema["accent"] = rec.get("accent") if rec.get("accent") in ACCENTS else "brand"
    if schema.get("icon") not in ICONS:
        schema["icon"] = rec.get("icon") if rec.get("icon") in ICONS else "sparkle"
    if not str(schema.get("greeting") or "").strip():
        schema["greeting"] = f"Hi! I'm {name}. {rec.get('tagline') or ''}".strip()
    pa = schema.get("primary_action")
    first_op = next((s["id"] for s in schema["sections"]
                     if s["type"] in ("agent_runner", "form_action")), schema["sections"][0]["id"])
    if not isinstance(pa, dict) or not pa.get("widget") or \
            pa.get("widget") not in {s["id"] for s in schema["sections"]}:
        schema["primary_action"] = {"id": "open-runner", "label": f"Run {name}", "widget": first_op}
    if not str(schema.get("chat_context") or "").strip():
        caps = ", ".join(c.get("name", "") for c in (rec.get("capabilities") or []) if isinstance(c, dict))
        schema["chat_context"] = (
            f"You are the in-dashboard assistant for {name}, a {uct} agent on the Backstop marketplace. "
            f"Description: {rec.get('description') or rec.get('tagline') or ''}. Capabilities: {caps}. "
            "Help the user understand and operate this dashboard; you can suggest they click specific "
            "widgets by name. Be concise and friendly."
        )
    return schema


def _default_props(t: str, rec: dict) -> dict:
    name = rec.get("name", "your agent")
    examples = [str(x) for x in (rec.get("example_tasks") or [])][:3]
    if t == "agent_runner":
        return {"input_label": f"What should {name} do?",
                "placeholder": examples[0] if examples else "Describe the task…",
                "examples": examples, "cta": f"Run {name}"}
    if t == "form_action":
        return {"fields": [{"key": "task", "label": "Task", "type": "text",
                            "placeholder": examples[0] if examples else "Describe the task…"}],
                "submit": {"label": f"Run {name}", "task_template": "{task}"}}
    if t == "message_analyzer":
        return {"placeholder": "Paste the message, listing or document…",
                "accept": ["text"], "mode": "generic"}
    if t == "voice_guard":
        return {"mode": "vishing"}
    if t == "gmail_connect":
        return {"query": "in:inbox newer_than:1y", "actions": ["hold", "reply", "handoff", "report"]}
    if t == "stat_cards":
        return {"items": [
            {"label": "Tasks run", "source": "runs.length", "format": "int"},
            {"label": "Covered limit", "source": "certificate.per_incident_limit_usd", "format": "usd"},
            {"label": "Premium you pay", "value": 0, "format": "usd"},
        ]}
    if t == "item_list":
        return {"source": "runs", "columns": [
            {"key": "ts", "label": "When", "format": "date"},
            {"key": "agent", "label": "Agent", "format": "text"},
        ], "empty": "Nothing yet.", "limit": 20}
    if t == "timeline":
        return {"source": "runs", "empty": f"Nothing yet — give {name} a task."}
    if t == "chart":
        return {"kind": "line", "source": "runs", "x": "ts", "y": "premium_accrued_usd",
                "label": "Premium accrued"}
    if t == "capabilities":
        return {"source": "agent.capabilities"}
    if t == "markdown":
        steps = rec.get("usage") or []
        body = "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps)) or "1. Give the agent a task.\n2. Review what it did."
        return {"content": f"### How to use {name}\n{body}"}
    return {}


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------
def generate_ui_schema(rec: dict) -> dict:
    """Run the PLANNER -> BUILDER -> VALIDATOR pipeline and return a valid UI-schema.

    Raises RuntimeError if no LLM is available or a valid schema can't be produced even after
    programmatic repair + one escalation rebuild — so `api/pagegen.py` falls back to its
    deterministic generator. NEVER raises any other exception.
    """
    if not llm_available():
        raise RuntimeError("no LLM keys configured — deterministic fallback should take over")

    try:
        # Stage 1: plan.
        plan = _planner(rec)

        # Stage 2: build.
        schema = _builder(rec, plan)

        # Stage 3: validate -> repair -> (escalate) -> repair.
        if _validate(schema):
            schema = _repair(schema, rec, plan)
        if _validate(schema):
            # Repair wasn't enough; rebuild once on the stronger model, then repair again.
            schema = _builder(rec, plan, model=ESCALATION_MODEL)
            if _validate(schema):
                schema = _repair(schema, rec, plan)

        errs = _validate(schema)
        if errs:
            raise RuntimeError(f"schema invalid after repair+escalation: {errs}")
    except RuntimeError:
        raise
    except Exception as exc:  # any transport/parse/shape error -> fall back
        raise RuntimeError(f"pagegen pipeline failed: {exc}") from exc

    # Enforce server-owned identity fields last.
    schema["agent_id"] = rec.get("id")
    schema["use_case_type"] = rec.get("use_case_type")
    return schema
