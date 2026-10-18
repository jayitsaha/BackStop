"""Runtime dashboard page-generation.

When a developer publishes an agent, Backstop generates that agent's "My account" dashboard at
runtime as a JSON UI-schema (see docs/UI_SCHEMA_CONTRACT.md). This module exposes:

  - generate_and_store(rec)      -> build + persist a UI-schema for an agent record
  - get_or_generate(agent_id)    -> fetch the stored schema, building one on demand if absent
  - router                       -> GET /agents/{id}/ui, POST /agents/{id}/ui/regenerate

The baseline implementation here is a *deterministic* generator keyed off use_case_type, so every
agent always has a coherent, working dashboard even with no LLM. The planner -> builder -> validator
LLM pipeline (agents/pagegen.py) upgrades this when available; this stays as the guaranteed fallback.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from api import firebase

router = APIRouter()

# Widget blueprints per use-case type. 'generic' is the universal fallback.
_ACCENT_DEFAULT = "brand"


def _fraud_sections(rec: dict) -> list[dict]:
    return [
        {"id": "stats", "type": "stat_cards", "title": "Your coverage", "span": "full", "props": {"items": [
            {"label": "Covered limit", "source": "certificate.per_incident_limit_usd", "format": "usd"},
            {"label": "Premium you pay", "value": 0, "format": "usd"},
            {"label": "Actions taken", "source": "runs.length", "format": "int"},
            {"label": "Payees frozen", "source": "frozen.length", "format": "int"},
        ]}},
        {"id": "analyze", "type": "message_analyzer", "title": "Is this real?", "span": "full", "props": {
            "placeholder": "Paste the email, bill or message — or upload a screenshot…",
            "accept": ["text", "image"], "mode": "fraud",
            "verdict_labels": {"safe": "Looks legit", "caution": "Double-check", "scam": "Likely a scam"}}},
        {"id": "voice", "type": "voice_guard", "title": "Is this call a scam?", "span": "half", "props": {"mode": "vishing"}},
        {"id": "live", "type": "live_call_guard", "title": "Live call guardian", "span": "half", "props": {}},
        {"id": "gmail", "type": "gmail_connect", "title": "Triage your Gmail", "span": "full", "props": {
            "query": "in:inbox newer_than:1y", "actions": ["hold", "reply", "handoff", "report"]}},
        {"id": "runner", "type": "agent_runner", "title": f"Ask {rec.get('name')}", "span": "full", "props": {
            "input_label": "Give your agent a task",
            "placeholder": "Triage my inbox and pay what's legit", "cta": f"Run {rec.get('name')}"}},
        {"id": "activity", "type": "timeline", "title": "What your agent did", "span": "half", "props": {
            "source": "runs", "empty": "Nothing yet — run the agent."}},
        {"id": "claims", "type": "claims_panel", "title": "Claims", "span": "half", "props": {}},
        {"id": "usage", "type": "markdown", "title": "How it works", "span": "full", "props": {
            "content": "### How " + str(rec.get("name")) + " works\n" +
                       "\n".join(f"{i+1}. {s}" for i, s in enumerate(rec.get("usage") or []))}},
    ]


def _generic_sections(rec: dict) -> list[dict]:
    name = rec.get("name", "your agent")
    examples = rec.get("example_tasks") or []
    cols = [
        {"key": "ts", "label": "When", "format": "date"},
        {"key": "agent", "label": "Agent", "format": "text"},
    ]
    sections = [
        {"id": "caps", "type": "capabilities", "title": "What it can do", "span": "full",
         "props": {"source": "agent.capabilities"}},
        {"id": "runner", "type": "agent_runner", "title": f"Ask {name}", "span": "full", "props": {
            "input_label": f"What should {name} do?",
            "placeholder": examples[0] if examples else "Describe the task…",
            "examples": examples[:3], "cta": f"Run {name}"}},
        {"id": "stats", "type": "stat_cards", "title": "Activity", "span": "full", "props": {"items": [
            {"label": "Tasks run", "source": "runs.length", "format": "int"},
            {"label": "Covered limit", "source": "certificate.per_incident_limit_usd", "format": "usd"},
            {"label": "Premium you pay", "value": 0, "format": "usd"},
        ]}},
        {"id": "activity", "type": "timeline", "title": "History", "span": "full", "props": {
            "source": "runs", "empty": f"Nothing yet — give {name} a task."}},
        {"id": "usage", "type": "markdown", "title": "How to use it", "span": "half", "props": {
            "content": "### How to use " + str(name) + "\n" +
                       "\n".join(f"{i+1}. {s}" for i, s in enumerate(rec.get("usage") or []))}},
        {"id": "claims", "type": "claims_panel", "title": "Insurance & claims", "span": "half", "props": {}},
    ]
    return sections


# use_case_type -> section builder. Fraud-ish types get the full guard stack.
_FRAUD_TYPES = {"fraud-detector", "bill-pay"}


def build_schema(rec: dict) -> dict:
    """Deterministic UI-schema for an agent record (the guaranteed baseline)."""
    uct = rec.get("use_case_type") or "generic"
    name = rec.get("name", "Agent")
    sections = _fraud_sections(rec) if uct in _FRAUD_TYPES else _generic_sections(rec)
    caps = ", ".join(c.get("name", "") for c in (rec.get("capabilities") or []))
    return {
        "schema_version": "1.0",
        "agent_id": rec.get("id"),
        "use_case_type": uct,
        "title": f"{name}",
        "subtitle": rec.get("tagline") or rec.get("description") or "",
        "accent": rec.get("accent") or _ACCENT_DEFAULT,
        "icon": rec.get("icon") or "shield",
        "greeting": f"Hi! I'm {name}. {rec.get('tagline') or ''}".strip(),
        "primary_action": {"id": "open-runner", "label": f"Run {name}", "widget": "runner"},
        "sections": sections,
        "chat_context": (
            f"You are the in-dashboard assistant for {name}, a {uct} agent on the Backstop marketplace. "
            f"Description: {rec.get('description') or rec.get('tagline') or ''}. "
            f"Capabilities: {caps}. "
            "Help the user understand and operate this dashboard. You can suggest they click specific "
            "widgets by name (e.g. 'use the Ask box to give it a task'). Be concise and friendly."
        ),
    }


def generate_and_store(rec: dict) -> dict:
    """Build a UI-schema for `rec` and persist it on the agent record + a quick-fetch mirror.

    Tries the LLM planner->builder->validator pipeline first (if present); always falls back to the
    deterministic baseline so publishing never fails.
    """
    schema = None
    try:
        from agents.pagegen import generate_ui_schema  # LLM pipeline (optional)
        schema = generate_ui_schema(rec)
    except Exception as exc:  # pragma: no cover - optional path
        print(f"[pagegen.llm] {rec.get('id')}: {exc}")
    if not schema or not isinstance(schema, dict) or not schema.get("sections"):
        schema = build_schema(rec)
    aid = rec.get("id")
    if aid:
        try:
            firebase.db_patch(f"agents/{aid}", {"ui_schema": schema})
            firebase.db_put(f"ui_schemas/{aid}", schema)
        except Exception as exc:  # pragma: no cover
            print(f"[pagegen.store] {aid}: {exc}")
    return schema


def get_or_generate(agent_id: str) -> dict:
    rec = firebase.db_get(f"agents/{agent_id}")
    if not rec:
        raise HTTPException(404, "unknown agent")
    schema = rec.get("ui_schema") or firebase.db_get(f"ui_schemas/{agent_id}")
    if not schema:
        schema = generate_and_store(rec)
    return schema


@router.get("/agents/{agent_id}/ui")
def get_ui(agent_id: str):
    return {"ui_schema": get_or_generate(agent_id)}


@router.post("/agents/{agent_id}/ui/regenerate")
def regenerate_ui(agent_id: str, authorization: str = Header(None)):
    from api.main import current_user, _agent_record
    u = current_user(authorization)
    rec = _agent_record(agent_id)
    if rec.get("owner_uid") and rec.get("owner_uid") != u["uid"] and rec.get("kind") != "reference":
        raise HTTPException(403, "only the agent's owner can regenerate its dashboard")
    return {"ui_schema": generate_and_store(rec)}
