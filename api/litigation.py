"""Litigation / claims with an autonomous support agent.

Endpoints (all auth'd, mounted under /litigation by api.main):
  - POST /litigation/cases                  open a claim: evidence (+ optional screenshot) -> first cross-question
  - GET  /litigation/cases                  list this user's cases (summaries)
  - GET  /litigation/cases/{case_id}        full case: Q&A transcript + decision
  - POST /litigation/cases/{case_id}/chat   answer the investigator -> next question OR a decision

The investigator (agents.support) cross-questions the user to establish that the scam genuinely
happened and that it happened via the specific marketplace agent they bought. Cases persist to
Firebase at litigation/{uid}/{case_id}.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from agents.support import open_case, advance_case

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _owned_agent(cust, agent_id: str | None) -> dict:
    """Return the owned-agent entry matching agent_id, or the active one, or {}."""
    agents = (cust.agents or []) if cust else []
    if agent_id:
        for a in agents:
            if a.get("agent_id") == agent_id:
                return a
    # fall back to the active agent if it is owned
    active = getattr(cust, "agent", None) if cust else None
    for a in agents:
        if a.get("agent_id") == active:
            return a
    return agents[0] if agents else {}


def _summary(case: dict) -> dict:
    return {
        "case_id": case.get("case_id"),
        "agent_id": case.get("agent_id"),
        "agent_name": case.get("agent_name"),
        "summary": case.get("summary"),
        "suspected_scam_type": case.get("suspected_scam_type"),
        "status": case.get("status"),
        "outcome": (case.get("decision") or {}).get("outcome"),
        "created_at": case.get("created_at"),
        "updated_at": case.get("updated_at"),
    }


class OpenIn(BaseModel):
    agent_id: str | None = None
    payment_id: str | None = None
    evidence_text: str
    screenshot: str | None = None        # data: URI (base64) of a screenshot


class ChatIn(BaseModel):
    answer: str


@router.post("/litigation/cases")
def litigation_open(body: OpenIn, authorization: str = Header(None)):
    from api.main import current_user, _load
    from api import firebase

    u = current_user(authorization)
    evidence = (body.evidence_text or "").strip()
    if not evidence and not body.screenshot:
        raise HTTPException(400, "describe what happened or upload a screenshot")

    cust = _load(u["uid"])
    entry = _owned_agent(cust, body.agent_id)
    if not entry:
        raise HTTPException(400, "add an agent to your account before filing a claim about it")
    agent_name = entry.get("agent_name") or "your agent"
    use_case = entry.get("use_case_type") or "unknown"

    # If a screenshot was uploaded, transcribe it with the multimodal model (best-effort).
    screenshot_text = ""
    if body.screenshot:
        try:
            from agents.analyze import transcribe_image
            screenshot_text = transcribe_image(body.screenshot) or ""
        except Exception as e:  # pragma: no cover
            screenshot_text = f"(could not read screenshot: {type(e).__name__})"

    opened = open_case(evidence, screenshot_text, agent_name, use_case)

    case_id = f"case-{int(time.time() * 1000)}"
    first_q = opened.get("next_question") or "Can you tell me what happened?"
    case = {
        "case_id": case_id,
        "uid": u["uid"],
        "agent_id": entry.get("agent_id"),
        "agent_name": agent_name,
        "use_case_type": use_case,
        "payment_id": body.payment_id,
        "evidence_text": evidence,
        "screenshot_text": screenshot_text,
        "summary": opened.get("summary"),
        "suspected_scam_type": opened.get("suspected_scam_type"),
        "confidence": opened.get("confidence"),
        "questions_remaining": opened.get("questions_remaining"),
        "status": "investigating",
        "decision": None,
        "transcript": [{"role": "agent", "content": first_q, "at": _now()}],
        "created_at": _now(),
        "updated_at": _now(),
    }
    firebase.db_put(f"litigation/{u['uid']}/{case_id}", case)
    return case


@router.get("/litigation/cases")
def litigation_list(authorization: str = Header(None)):
    from api.main import current_user
    from api import firebase

    u = current_user(authorization)
    data = firebase.db_get(f"litigation/{u['uid']}") or {}
    cases = list(data.values()) if isinstance(data, dict) else []
    out = [_summary(c) for c in cases if isinstance(c, dict)]
    out.sort(key=lambda c: c.get("created_at") or "", reverse=True)
    return out


@router.get("/litigation/cases/{case_id}")
def litigation_case(case_id: str, authorization: str = Header(None)):
    from api.main import current_user
    from api import firebase

    u = current_user(authorization)
    case = firebase.db_get(f"litigation/{u['uid']}/{case_id}")
    if not case:
        raise HTTPException(404, "no such case")
    case.setdefault("transcript", [])
    return case


@router.post("/litigation/cases/{case_id}/chat")
def litigation_chat(case_id: str, body: ChatIn, authorization: str = Header(None)):
    from api.main import current_user
    from api import firebase

    u = current_user(authorization)
    case = firebase.db_get(f"litigation/{u['uid']}/{case_id}")
    if not case:
        raise HTTPException(404, "no such case")
    if case.get("status") == "decided":
        return case  # already closed — nothing more to answer

    answer = (body.answer or "").strip()
    if not answer:
        raise HTTPException(400, "type an answer")

    case.setdefault("transcript", [])
    case["transcript"].append({"role": "user", "content": answer, "at": _now()})

    result = advance_case(case, answer)
    reply = (result.get("reply") or "").strip()

    if result.get("status") == "decided":
        case["transcript"].append({"role": "agent", "content": reply, "at": _now()})
        case["status"] = "decided"
        case["decision"] = result.get("decision")
        case["next_question"] = None
        # If approved and a payment is linked, note the adjudication on the case (ledger untouched).
        dec = case["decision"] or {}
        if dec.get("outcome") == "approved" and case.get("payment_id"):
            case["adjudication"] = {
                "payment_id": case["payment_id"],
                "amount_usd": dec.get("amount_usd"),
                "noted_at": _now(),
                "note": "Investigator approved; eligible for settlement against the linked payment.",
            }
    else:
        case["status"] = "investigating"
        nq = (result.get("next_question") or "").strip()
        # The agent turn carries its reaction + the next question (so the chat reads naturally).
        content = (reply + "\n\n" + nq).strip() if reply and reply != nq else (nq or reply)
        case["transcript"].append({"role": "agent", "content": content, "at": _now()})
        case["next_question"] = nq

    case["updated_at"] = _now()
    firebase.db_put(f"litigation/{u['uid']}/{case_id}", case)
    return case
