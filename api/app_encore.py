"""Encore — bespoke ticket-buyer backend utilities.

Endpoints under /apps/encore/* powering the Encore "My account" desk. Encore DRIVES: on load it
proactively surfaces a RADAR of hot shows it is tracking with ZERO input, parses a free-text ask
into a search itself, and screens resale listings for fake-ticket scams.
  - POST /apps/encore/radar          — surfaces 3-4 hot shows/events with price, trend & scam-risk,
                                        with little or no input (a vibe/budget may be passed).
  - POST /apps/encore/search         — budget-aware event search; accepts a natural-language `query`
                                        the model parses itself (artist / city / budget / date).
  - POST /apps/encore/verify-listing — paste a resale listing / DM / link; Encore judges safe|caution|scam.

Every prompt is grounded in Encore's REAL stored system_prompt (fetched via _agent_record) so the desk
behaves exactly like the insured, scam-aware, budget-enforcing agent the user bought. api.main is imported
INSIDE the request functions to keep this module import-safe and avoid a circular import at load time.
Model output is normalized/clamped so the UI can't break.
"""
from __future__ import annotations

from fastapi import APIRouter, Header
from pydantic import BaseModel
from typing import Any

router = APIRouter()

ENCORE_ID = "encore-e10b15"


def _encore_prompt() -> str:
    """Real Encore system_prompt from the agent record (resolve by id, then by name)."""
    from api.main import _agent_record  # noqa: WPS433 (import inside fn — keeps module import-safe)
    try:
        rec = _agent_record(ENCORE_ID)
    except Exception:
        rec = {}
    if not rec:
        try:
            from api import firebase
            agents = firebase.db_get("agents") or {}
            rec = next((v for v in (agents.values() if isinstance(agents, dict) else [])
                        if str(v.get("name", "")).lower() == "encore"), {})
        except Exception:
            rec = {}
    return (rec.get("system_prompt") or "").strip() or (
        "You are Encore, a concert ticket buying assistant. You search listings, watch prices, and buy "
        "tickets within the user budget. You never overpay, never buy from unverified sellers, and always "
        "confirm before spending above budget."
    )


def _clamp_enum(val: Any, allowed: tuple[str, ...], fallback: str) -> str:
    v = str(val or "").strip().lower()
    return v if v in allowed else fallback


def _norm_pick(p: Any) -> dict[str, Any] | None:
    """Coerce one LLM event pick into the strict shape the dashboard renders."""
    if not isinstance(p, dict):
        return None
    best = float(p.get("best_price_usd", 0) or 0)
    face = float(p.get("face_value_usd", 0) or 0)
    return {
        "artist_or_event": str(p.get("artist_or_event", "Live event")).strip() or "Live event",
        "venue": str(p.get("venue", "")).strip(),
        "city": str(p.get("city", "")).strip(),
        "date": str(p.get("date", "")).strip(),
        "best_price_usd": round(max(0.0, best), 2),
        "face_value_usd": round(max(0.0, face), 2),
        "within_budget": bool(p.get("within_budget", True)),
        "price_trend": _clamp_enum(p.get("price_trend"), ("up", "down", "flat"), "flat"),
        "scam_risk": _clamp_enum(p.get("scam_risk"), ("none", "low", "high"), "none"),
        "seats_note": str(p.get("seats_note", "")).strip(),
        "why": str(p.get("why", "")).strip(),
    }


def _norm_picks(data: Any, limit: int = 4) -> list[dict[str, Any]]:
    raw = (data.get("picks") if isinstance(data, dict) else None) or []
    out = [_norm_pick(p) for p in raw]
    return [p for p in out if p][:limit]


# ============================= /apps/encore/radar =============================
class RadarIn(BaseModel):
    budget: float = 0.0           # per-ticket budget ceiling; 0 → model picks a sensible one
    vibe: str = ""                # optional mood/genre, e.g. "EDM festival" / "NBA courtside"


@router.post("/apps/encore/radar")
def encore_radar(body: RadarIn, authorization: str = Header(None)) -> dict[str, Any]:
    from api.main import current_user  # noqa: WPS433
    current_user(authorization)
    from agents.nim import ask_json

    budget = float(body.budget or 0)
    vibe = (body.vibe or "").strip()

    system = _encore_prompt() + (
        "\n\nYou are powering the HOME 'RADAR' of your dashboard. With little or NO input from the user, you "
        "PROACTIVELY surface 3-4 hot, currently-relevant shows or events you are tracking that you would "
        "genuinely flag for this fan. Make the events, venues, dates and prices coherent and specific. Apply "
        "your real behaviour honestly: compare the best current resale price vs face value and vs the budget, "
        "note the price trend you're seeing, call out seat quality, and flag scam_risk when an event or price "
        "pattern attracts fake-ticket scalping. Speak in first person as the agent who is watching these.\n\n"
        "Respond with ONLY a single valid JSON object of EXACTLY this shape:\n"
        '{"intro": string (1 sentence, first-person, e.g. "Here\'s what I\'m watching for you right now"),'
        ' "picks": [ {'
        ' "artist_or_event": string, "venue": string, "city": string,'
        ' "date": string (a realistic near-future date, e.g. "Sat, Nov 15 2026" or YYYY-MM-DD),'
        ' "best_price_usd": number (best verified get-in price I am seeing),'
        ' "face_value_usd": number (original face value),'
        ' "within_budget": boolean (is best_price_usd within the fan\'s budget),'
        ' "price_trend": "up"|"down"|"flat" (where the resale price is heading),'
        ' "scam_risk": "none"|"low"|"high" (fake-ticket / scalping risk for this event),'
        ' "seats_note": string (short — section / view, e.g. "Lower bowl, aisle"),'
        ' "why": string (1-2 sentences, first-person, why I flagged it / my read on timing)'
        ' } ] }\n'
        "Make each pick distinct (different artists/events/genres). Keep at least one comfortably within budget."
    )
    user = (
        "Surface the shows you're watching for me right now.\n"
        f"- Per-ticket budget ceiling: {('$' + format(budget, ',.0f')) if budget > 0 else 'you choose something sensible'}\n"
        f"- Vibe / genre: {vibe or 'open — mix it up with a few strong, varied picks'}\n"
    )

    data = ask_json(system, user, max_tokens=2200, temperature=0.7, default={
        "intro": "I couldn't reach my radar just now — tap retry.",
        "picks": [],
    })
    return {
        "intro": str(data.get("intro", "")) if isinstance(data, dict) else "",
        "picks": _norm_picks(data, limit=4),
    }


# ============================= /apps/encore/search =============================
class SearchIn(BaseModel):
    # Free-text ask — the MODEL parses artist / city / budget / date out of it.
    query: str = ""
    budget: float = 0.0


@router.post("/apps/encore/search")
def encore_search(body: SearchIn, authorization: str = Header(None)) -> dict[str, Any]:
    from api.main import current_user  # noqa: WPS433
    current_user(authorization)
    from agents.nim import ask_json

    query = (body.query or "").strip()
    budget = float(body.budget or 0)

    system = _encore_prompt() + (
        "\n\nYou are powering the SEARCH desk of your dashboard. The fan tells you in their own words who "
        "they want to see. PARSE the artist/event, city, budget and date out of their sentence yourself and "
        "restate what you understood in the summary (first person, e.g. \"I read that as…\"). Make the options "
        "coherent and specific. Apply your scam-awareness and budget enforcement: compare best price vs face "
        "value and the budget, note the price trend, and flag scam_risk honestly.\n\n"
        "Respond with ONLY a single valid JSON object of EXACTLY this shape:\n"
        '{"summary": string (1-2 sentences, first-person; restate the show/budget you understood),'
        ' "within_budget": boolean (can I likely get a ticket within the stated/assumed budget),'
        ' "picks": [ {'
        ' "artist_or_event": string, "venue": string, "city": string, "date": string,'
        ' "best_price_usd": number, "face_value_usd": number, "within_budget": boolean,'
        ' "price_trend": "up"|"down"|"flat", "scam_risk": "none"|"low"|"high",'
        ' "seats_note": string, "why": string } ] }\n'
        "Return 3-5 picks (e.g. different dates / cities / seating tiers for the artist asked for). If no budget "
        "is stated, assume a sensible one and say so."
    )
    user = (
        "Here is what the fan told me (parse artist, city, budget and date out of this sentence yourself):\n"
        f"\"{query or '(empty — suggest something strong anyway)'}\"\n\n"
        f"{('A per-ticket budget ceiling of $' + format(budget, ',.0f') + ' applies.') if budget > 0 else 'If no budget is stated, assume a sensible one.'}"
    )

    data = ask_json(system, user, max_tokens=2000, temperature=0.5, default={
        "summary": "Couldn't reach my search just now — try again.",
        "within_budget": False, "picks": [],
    })
    return {
        "summary": str(data.get("summary", "")) if isinstance(data, dict) else "",
        "within_budget": bool(data.get("within_budget", False)) if isinstance(data, dict) else False,
        "picks": _norm_picks(data, limit=5),
    }


# ========================== /apps/encore/verify-listing ==========================
class VerifyIn(BaseModel):
    text_or_link: str = ""


@router.post("/apps/encore/verify-listing")
def encore_verify_listing(body: VerifyIn, authorization: str = Header(None)) -> dict[str, Any]:
    from api.main import current_user  # noqa: WPS433
    current_user(authorization)
    from agents.nim import ask_json

    system = _encore_prompt() + (
        "\n\nYou are powering the VERIFY-LISTING desk. The fan pastes a resale ticket listing, a seller DM, a "
        "marketplace link, or a 'I'll sell you my tickets' message. Judge whether it is a legitimate resale or a "
        "fake-ticket / scalping scam (seller asking to move off-platform, pay by gift card / Venmo / Zelle / wire "
        "/ crypto, 'send first and I'll transfer', screenshotted barcodes, price far below market, urgency / "
        "pressure, brand-new or unverified account, lookalike domain, duplicate-sold barcodes). Be concrete and "
        "honest; if unsure, say caution rather than safe. NEVER tell the fan to pay a stranger off-platform or by "
        "irreversible methods. Speak in first person as the agent who screened it.\n\n"
        "Respond with ONLY a single valid JSON object of EXACTLY this shape:\n"
        '{"verdict": "safe"|"caution"|"scam",'
        ' "reasons": [string] (3-6 concrete signals you observed, good or bad),'
        ' "advice": string (1-2 sentences: the single safest next step for the fan)}'
    )
    user = f"Verify this resale listing / message / link:\n\n{(body.text_or_link or '').strip() or '(empty)'}"

    data = ask_json(system, user, max_tokens=900, temperature=0.2, default={
        "verdict": "caution", "reasons": ["Verifier temporarily unavailable."],
        "advice": "Try again, and never pay a stranger off-platform or by gift card / wire.",
    })

    verdict = _clamp_enum(data.get("verdict") if isinstance(data, dict) else None,
                          ("safe", "caution", "scam"), "caution")
    reasons = [str(r) for r in (data.get("reasons") or [])] if isinstance(data, dict) else []
    return {
        "verdict": verdict,
        "reasons": reasons or ["No specific signals extracted."],
        "advice": str(data.get("advice", "")) if isinstance(data, dict) else "",
    }
