"""Vanta — bespoke bot-detection / abuse-defense backend utilities.

Endpoints live under /apps/vanta/... and are grounded in Vanta's REAL system_prompt
(pulled from the agent record) so every verdict reflects the exact agent the customer
bought. All model calls go through agents.nim.ask_json, which forces + repairs JSON.

Phases (mirrored in the page file):
  1) IDEATE  — the killer bot-defense utilities (log triage, single-request fingerprint,
               curated blocklist, human/bot traffic mix, freeform "Ask Vanta").
  2) PLAN    — one endpoint per structured utility, each returning a strict JSON schema
               the front-end renders into gauges / tables / chips / charts.
  3) BUILD   — wired below to real structured backend results.

Import api.main INSIDE the handlers (avoids a circular import at module load).
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter()

VANTA_ID = "vanta-e76ad4"


# --------------------------------------------------------------------------- helpers
def _resolve_vanta(agent_id: Optional[str] = None) -> dict:
    """Return the Vanta agent record. Tries the given id, then the canonical id, then
    resolves by name 'Vanta' / use_case_type 'bot-detector' via the agents table."""
    from api.main import _agent_record, _all_agents

    for candidate in (agent_id, VANTA_ID):
        if not candidate:
            continue
        try:
            return _agent_record(candidate)
        except HTTPException:
            pass
    for rec in _all_agents():
        if (rec.get("name") or "").lower() == "vanta" or rec.get("use_case_type") == "bot-detector":
            return rec
    raise HTTPException(404, "Vanta agent not found")


def _vanta_system(rec: dict, schema_instruction: str) -> str:
    """Build the system prompt from Vanta's real system_prompt + a strict JSON contract."""
    sp = (rec.get("system_prompt") or "").strip()
    caps = rec.get("capabilities") or []
    cap_lines = "\n".join(f"- {c.get('name')}: {c.get('description')}" for c in caps if isinstance(c, dict))
    return (
        f"{sp}\n\n"
        f"Your detection capabilities:\n{cap_lines}\n\n"
        "You are operating as a structured analysis API. Apply real bot-detection reasoning: "
        "weigh user-agent strings (headless/non-browser/outdated), request velocity and timing "
        "regularity, IP reputation (datacenter/Tor/residential), path targeting (/login, /signup, "
        "/api, product pages), credential-stuffing and fake-signup patterns, and disposable/pattern "
        "emails. Never condemn a client without evidence; state your confidence honestly.\n\n"
        f"{schema_instruction}\n"
        "Respond with ONLY a single valid JSON object. No prose, no markdown fences."
    )


def _clamp_int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(round(float(v)))))
    except Exception:
        return default


# --------------------------------------------------------------------------- /analyze
class AnalyzeIn(BaseModel):
    logs: str
    agent_id: Optional[str] = None


_ANALYZE_SCHEMA = (
    "Return JSON with EXACTLY these keys:\n"
    '{\n'
    '  "verdict": "one short sentence overall judgement",\n'
    '  "bot_score": integer 0-100 (share of traffic that is automated/abusive),\n'
    '  "human_pct": integer 0-100 (share that is genuine humans),\n'
    '  "confidence": float 0.0-1.0,\n'
    '  "signals": [ {"name": short label, "detail": one clause of evidence, '
    '"severity": "low"|"medium"|"high"} ],\n'
    '  "entities": [ {"id": the ip/user-agent/email seen, "score": integer 0-100, '
    '"classification": "human"|"suspect"|"bot", "reason": short evidence} ],\n'
    '  "recommended_mitigations": [ short imperative strings like "Rate-limit /login to 5/min per IP" ]\n'
    '}\n'
    "Give 3-6 signals, one entity per distinct client you can identify (cap at 12), and 3-5 mitigations."
)


@router.post("/apps/vanta/analyze")
def vanta_analyze(body: AnalyzeIn, authorization: str = Header(None)):
    from api.main import current_user
    current_user(authorization)
    logs = (body.logs or "").strip()
    if not logs:
        raise HTTPException(400, "paste some logs, signups or request lines to analyze")

    rec = _resolve_vanta(body.agent_id)
    from agents.nim import ask_json

    system = _vanta_system(rec, _ANALYZE_SCHEMA)
    user = (
        "Analyze the following access/traffic logs (or list of signups/requests). "
        "Classify each distinct client and the traffic overall.\n\n"
        f"```\n{logs[:8000]}\n```"
    )
    default = {
        "verdict": "Could not complete analysis.", "bot_score": 0, "human_pct": 0,
        "confidence": 0.0, "signals": [], "entities": [], "recommended_mitigations": [],
    }
    result = ask_json(system, user, max_tokens=1800, retries=1, default=default)
    return _normalize_analysis(result if isinstance(result, dict) else default, rec)


def _normalize_analysis(result: dict, rec: dict) -> dict:
    """Coerce a raw analyze-shaped model object into the strict UI contract so the
    front-end never breaks on a sloppy field. Shared by /analyze and /live."""
    bot = _clamp_int(result.get("bot_score"), 0, 100, 0)
    human = _clamp_int(result.get("human_pct"), 0, 100, max(0, 100 - bot))
    sig = result.get("signals") if isinstance(result.get("signals"), list) else []
    ents = result.get("entities") if isinstance(result.get("entities"), list) else []
    mits = result.get("recommended_mitigations")
    mits = mits if isinstance(mits, list) else []

    norm_ents = []
    for e in ents:
        if not isinstance(e, dict):
            continue
        cls = str(e.get("classification", "suspect")).lower()
        if cls not in ("human", "suspect", "bot"):
            cls = "suspect"
        norm_ents.append({
            "id": str(e.get("id", "unknown")),
            "score": _clamp_int(e.get("score"), 0, 100, 50),
            "classification": cls,
            "reason": str(e.get("reason", "")),
        })

    norm_sig = []
    for s in sig:
        if not isinstance(s, dict):
            continue
        sev = str(s.get("severity", "medium")).lower()
        if sev not in ("low", "medium", "high"):
            sev = "medium"
        norm_sig.append({
            "name": str(s.get("name", "signal")),
            "detail": str(s.get("detail", "")),
            "severity": sev,
        })

    # Derive the human/bot/suspect traffic breakdown from the classified entities when possible.
    counts = {"human": 0, "suspect": 0, "bot": 0}
    for e in norm_ents:
        counts[e["classification"]] += 1
    total = sum(counts.values())
    if total:
        breakdown = [
            {"label": "Human", "key": "human", "count": counts["human"],
             "pct": round(counts["human"] / total * 100)},
            {"label": "Suspect", "key": "suspect", "count": counts["suspect"],
             "pct": round(counts["suspect"] / total * 100)},
            {"label": "Bot", "key": "bot", "count": counts["bot"],
             "pct": round(counts["bot"] / total * 100)},
        ]
    else:
        suspect = max(0, 100 - human - bot)
        breakdown = [
            {"label": "Human", "key": "human", "count": human, "pct": human},
            {"label": "Suspect", "key": "suspect", "count": suspect, "pct": suspect},
            {"label": "Bot", "key": "bot", "count": bot, "pct": bot},
        ]

    bot_sources = sum(1 for e in norm_ents if e["classification"] == "bot")
    return {
        "verdict": str(result.get("verdict", "")),
        "bot_score": bot,
        "human_pct": human,
        "confidence": float(result.get("confidence") or 0.0),
        "signals": norm_sig,
        "entities": norm_ents,
        "recommended_mitigations": [str(m) for m in mits],
        "breakdown": breakdown,
        "bot_sources": bot_sources,
        "agent": {"name": rec.get("name"), "grade": (rec.get("grade") or {}).get("grade")},
    }


# ------------------------------------------------------------------------------- /live
class LiveIn(BaseModel):
    window: Optional[str] = None       # e.g. "last 60s" — labels the synthesized window
    agent_id: Optional[str] = None


_LIVE_SCHEMA = (
    "You are the ALWAYS-ON monitor. In ONE step: (1) SYNTHESIZE a realistic sample of the "
    "CURRENT traffic window for a mid-size web app — a believable mix of genuine human "
    "browsers, known good crawlers (Googlebot/Bingbot), and real abuse (a scraper hammering "
    "/api or product pages, a credential-stuffing run against /login, a fake-signup burst "
    "from disposable emails, maybe a headless/datacenter client). Vary it each call so the "
    "numbers move. (2) ANALYZE that same window.\n"
    "Return JSON with EXACTLY these keys:\n"
    '{\n'
    '  "verdict": "one short sentence framed as what you are doing RIGHT NOW '
    '(e.g. \\"Blocking 3 scraper sources hitting /api; human traffic healthy.\\")",\n'
    '  "bot_score": integer 0-100 (share of this window that is automated/abusive),\n'
    '  "human_pct": integer 0-100,\n'
    '  "confidence": float 0.0-1.0,\n'
    '  "signals": [ {"name": short label, "detail": one clause of live evidence, '
    '"severity": "low"|"medium"|"high"} ],\n'
    '  "entities": [ {"id": a realistic ip / user-agent / email seen this window, '
    '"score": integer 0-100, "classification": "human"|"suspect"|"bot", "reason": short evidence} ],\n'
    '  "recommended_mitigations": [ short imperative strings ]\n'
    '}\n'
    "Give 4-6 signals, 6-10 entities (a realistic spread across human/suspect/bot), and 3-5 mitigations."
)


@router.post("/apps/vanta/live")
def vanta_live(body: LiveIn, authorization: str = Header(None)):
    """Zero-input continuous-monitoring tick: Vanta synthesizes a fresh current-traffic
    window and analyzes it in a single grounded call, returning the analyze shape."""
    from api.main import current_user
    current_user(authorization)

    rec = _resolve_vanta(body.agent_id)
    from agents.nim import ask_json

    system = _vanta_system(rec, _LIVE_SCHEMA)
    window = (body.window or "the last 60 seconds").strip()
    # A nonce nudges the model to produce a different window on every refresh.
    import time
    user = (
        f"Monitoring tick for {window}. Generate and analyze a fresh live traffic window now. "
        f"Make this window distinct from previous ones (tick #{int(time.time()) % 100000})."
    )
    default = {
        "verdict": "Monitoring paused — could not read the traffic window.",
        "bot_score": 0, "human_pct": 0, "confidence": 0.0,
        "signals": [], "entities": [], "recommended_mitigations": [],
    }
    result = ask_json(system, user, temperature=0.7, max_tokens=1800, retries=1, default=default)
    out = _normalize_analysis(result if isinstance(result, dict) else default, rec)
    out["window"] = window
    out["live"] = True
    return out


# ------------------------------------------------------------------------ /fingerprint
class FingerprintIn(BaseModel):
    user_agent: str
    ip: Optional[str] = None
    behavior: Optional[str] = None
    agent_id: Optional[str] = None


_FP_SCHEMA = (
    "Return JSON with EXACTLY these keys:\n"
    '{\n'
    '  "classification": "human"|"suspect"|"bot",\n'
    '  "score": integer 0-100 (higher = more bot-like),\n'
    '  "confidence": float 0.0-1.0,\n'
    '  "reasons": [ short evidence strings, 2-5 of them ]\n'
    '}'
)


@router.post("/apps/vanta/fingerprint")
def vanta_fingerprint(body: FingerprintIn, authorization: str = Header(None)):
    from api.main import current_user
    current_user(authorization)
    ua = (body.user_agent or "").strip()
    if not ua:
        raise HTTPException(400, "a user-agent string is required")

    rec = _resolve_vanta(body.agent_id)
    from agents.nim import ask_json

    system = _vanta_system(rec, _FP_SCHEMA)
    parts = [f"User-Agent: {ua}"]
    if body.ip:
        parts.append(f"IP: {body.ip.strip()}")
    if body.behavior:
        parts.append(f"Observed behavior: {body.behavior.strip()}")
    user = "Fingerprint this single client and give a verdict.\n\n" + "\n".join(parts)

    default = {"classification": "suspect", "score": 50, "confidence": 0.0,
               "reasons": ["Analysis unavailable."]}
    result = ask_json(system, user, max_tokens=700, retries=1, default=default)
    if not isinstance(result, dict):
        result = default

    cls = str(result.get("classification", "suspect")).lower()
    if cls not in ("human", "suspect", "bot"):
        cls = "suspect"
    reasons = result.get("reasons")
    reasons = [str(r) for r in reasons] if isinstance(reasons, list) else []
    return {
        "classification": cls,
        "score": _clamp_int(result.get("score"), 0, 100, 50),
        "confidence": float(result.get("confidence") or 0.0),
        "reasons": reasons,
        "echo": {"user_agent": ua, "ip": body.ip or "", "behavior": body.behavior or ""},
    }
