"""Wander — bespoke travel-concierge backend utilities.

Endpoints under /apps/wander/* powering the Wander "My account" desk. Wander DRIVES: it proposes
complete trips with zero input, parses a free-text dream into a search itself, and screens bookings.
  - POST /apps/wander/propose         — invents 2-3 complete, scam-checked trip ideas with no input.
  - POST /apps/wander/search          — budget-aware search; accepts either structured fields OR a
                                         natural-language `query` the model parses itself.
  - POST /apps/wander/verify-booking  — paste a booking email / link; Wander judges safe|caution|scam.

Every prompt is grounded in Wander's REAL stored system_prompt (fetched via _agent_record) so the desk
behaves exactly like the insured, scam-aware agent the user bought. api.main is imported INSIDE the
request functions to keep this module import-safe and avoid a circular import at load time.
"""
from __future__ import annotations

from fastapi import APIRouter, Header
from pydantic import BaseModel, ConfigDict, Field
from typing import Any

router = APIRouter()

WANDER_ID = "wander-e3e2e1"


def _wander_prompt() -> str:
    """Real Wander system_prompt from the agent record (resolve by id, then by name)."""
    from api.main import _agent_record  # noqa: WPS433 (import inside fn — keeps module import-safe)
    try:
        rec = _agent_record(WANDER_ID)
    except Exception:
        from api import firebase
        agents = firebase.db_get("agents") or {}
        rec = next((v for v in (agents.values() if isinstance(agents, dict) else [])
                    if str(v.get("name", "")).lower() == "wander"), {})
    return (rec.get("system_prompt") or "").strip() or (
        "You are Wander, a scam-aware, insured travel-booking concierge. You find flights and hotels "
        "that fit the user's dates, budget and policy, compare honestly, flag 'too good to be true' "
        "fares and unverified sites, and confirm before booking."
    )


def _norm_option(o: Any) -> dict[str, Any] | None:
    """Coerce one LLM option into the strict shape the dashboard renders."""
    if not isinstance(o, dict):
        return None
    risk = str(o.get("scam_risk", "none")).lower()
    if risk not in ("none", "low", "high"):
        risk = "none"
    typ = str(o.get("type", "package")).lower()
    if typ not in ("flight", "hotel", "package"):
        typ = "package"
    return {
        "type": typ,
        "title": str(o.get("title", "Option")),
        "provider": str(o.get("provider", "—")),
        "price_usd": float(o.get("price_usd", 0) or 0),
        "itinerary": str(o.get("itinerary", "")),
        "fits_budget": bool(o.get("fits_budget", True)),
        "scam_risk": risk,
        "notes": str(o.get("notes", "")),
    }


# ============================= /apps/wander/propose =============================
class ProposeIn(BaseModel):
    budget: float = 0.0           # assumed per-person budget; 0 → model picks a sensible one
    vibe: str = ""                # optional mood, e.g. "a relaxing beach escape"


@router.post("/apps/wander/propose")
def wander_propose(body: ProposeIn, authorization: str = Header(None)) -> dict[str, Any]:
    from api.main import current_user  # noqa: WPS433
    current_user(authorization)
    from agents.nim import ask_json

    budget = float(body.budget or 0)
    vibe = (body.vibe or "").strip()

    system = _wander_prompt() + (
        "\n\nYou are powering the HOME of your dashboard. With little or NO input from the user, you "
        "PROACTIVELY invent 2-3 complete, inspiring trip ideas you would genuinely recommend. This is a "
        "demo — there is no live travel API, so make the trips coherent and clearly plausible, never "
        "fabricated as real confirmed bookings. Apply your scam-awareness honestly: price each trip vs the "
        "assumed budget, and if any component is a suspiciously cheap fare or a lookalike / unverified "
        "reseller, flag its scam_risk. Speak in first person as the agent who found these.\n\n"
        "Respond with ONLY a single valid JSON object of EXACTLY this shape:\n"
        '{"intro": string (1 sentence, first-person, e.g. "I scouted a few trips you might love"),'
        ' "trips": [ {'
        ' "destination": string, "origin": string (a sensible major hub, e.g. "New York (JFK)"),'
        ' "depart": string (YYYY-MM-DD, a realistic near-future date), "return": string (YYYY-MM-DD),'
        ' "travelers": number, "headline": string (short, catchy),'
        ' "why": string (1-2 sentences, first-person, why you picked it),'
        ' "assumed_budget_usd": number (per person), "total_estimate_usd": number (flight+hotel per person),'
        ' "within_budget": boolean, "scam_risk": "none"|"low"|"high",'
        ' "options": [ a FLIGHT then a HOTEL, each: {"type":"flight"|"hotel","title":string,"provider":string,'
        ' "price_usd":number,"itinerary":string,"fits_budget":boolean,"scam_risk":"none"|"low"|"high","notes":string} ]'
        ' } ] }\n'
        "Make each trip distinct (different destinations/styles). Keep at least one trip comfortably within "
        "budget. Be honest that these are illustrative ideas."
    )
    user = (
        "Propose trips for me.\n"
        f"- Assumed budget per person: {('$' + format(budget, ',.0f')) if budget > 0 else 'you choose something sensible'}\n"
        f"- Vibe / mood: {vibe or 'open — surprise me with a good mix'}\n"
    )

    data = ask_json(system, user, max_tokens=2400, temperature=0.7, default={
        "intro": "I couldn't reach my trip ideas just now — tap retry.",
        "trips": [],
    })

    trips = []
    for tr in (data.get("trips") if isinstance(data, dict) else []) or []:
        if not isinstance(tr, dict):
            continue
        opts = [_norm_option(o) for o in (tr.get("options") or [])]
        opts = [o for o in opts if o]
        risk = str(tr.get("scam_risk", "none")).lower()
        if risk not in ("none", "low", "high"):
            risk = "none"
        trips.append({
            "destination": str(tr.get("destination", "Somewhere good")),
            "origin": str(tr.get("origin", "")),
            "depart": str(tr.get("depart", "")),
            "return": str(tr.get("return", "")),
            "travelers": int(tr.get("travelers", 1) or 1),
            "headline": str(tr.get("headline", "")),
            "why": str(tr.get("why", "")),
            "assumed_budget_usd": float(tr.get("assumed_budget_usd", budget) or budget),
            "total_estimate_usd": float(tr.get("total_estimate_usd", 0) or 0),
            "within_budget": bool(tr.get("within_budget", True)),
            "scam_risk": risk,
            "options": opts,
        })
    return {"intro": str(data.get("intro", "")) if isinstance(data, dict) else "", "trips": trips}


# ============================= /apps/wander/search =============================
class SearchIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # Free-text dream — when present, the MODEL parses origin/dest/dates/budget/travelers from it.
    query: str = ""
    origin: str = ""
    destination: str = ""
    depart: str = ""
    # `return` is reserved in Python — accept it from the client under that key via an alias.
    return_: str = Field(default="", alias="return")
    travelers: int = 1
    budget_per_person: float = 0.0
    prefs: str = ""


@router.post("/apps/wander/search")
def wander_search(body: SearchIn, authorization: str = Header(None)) -> dict[str, Any]:
    from api.main import current_user  # noqa: WPS433
    current_user(authorization)
    from agents.nim import ask_json

    travelers = max(1, int(body.travelers or 1))
    budget_pp = float(body.budget_per_person or 0)
    total_budget = budget_pp * travelers
    query = (body.query or "").strip()

    system = _wander_prompt() + (
        "\n\nYou are powering the SEARCH desk of your dashboard. Generate a realistic, HONEST set of "
        "illustrative travel options (this is a demo — there is no live travel API, so make the options "
        "coherent and clearly plausible, never fabricated as real bookings). If the user gave a free-text "
        "request, PARSE the origin, destination, dates, traveler count and budget out of it yourself and "
        "state what you understood in the summary (first person, e.g. \"I read that as…\"). Apply your "
        "scam-awareness: if an option is unusually cheap vs the budget or comes from a lookalike / "
        "unverified reseller, mark its scam_risk honestly. Respect the budget.\n\n"
        "Respond with ONLY a single valid JSON object of EXACTLY this shape:\n"
        '{"summary": string (1-2 sentences, first-person; restate the trip you understood; note it is illustrative),'
        ' "within_budget": boolean,'
        ' "options": [ {"type": "flight"|"hotel"|"package", "title": string, "provider": string,'
        ' "price_usd": number (per person for flights, total-stay for hotels/packages),'
        ' "itinerary": string (short), "fits_budget": boolean, "scam_risk": "none"|"low"|"high",'
        ' "notes": string} ],'
        ' "total_estimate_usd": number, "warnings": [string] }\n'
        "Include 5-7 options across flight/hotel/package, with at least one non-'none' scam_risk and a clear note why."
    )
    if query:
        user = (
            "Here is what the traveler told me (parse everything out of this sentence yourself):\n"
            f"\"{query}\"\n\n"
            f"If a budget/traveler count isn't stated, assume {travelers} traveler(s) and a sensible budget."
        )
    else:
        user = (
            f"Trip request:\n"
            f"- From: {body.origin or 'unspecified'}\n"
            f"- To: {body.destination or 'unspecified'}\n"
            f"- Depart: {body.depart or 'flexible'}\n"
            f"- Return: {body.return_ or 'flexible / one-way'}\n"
            f"- Travelers: {travelers}\n"
            f"- Budget per person: ${budget_pp:,.0f} (total ${total_budget:,.0f})\n"
            f"- Preferences: {body.prefs or 'none stated'}\n"
        )

    data = ask_json(system, user, max_tokens=2200, temperature=0.5, default={
        "summary": "Couldn't reach the concierge model just now — try again.",
        "within_budget": False, "options": [], "total_estimate_usd": 0, "warnings": ["Search temporarily unavailable."],
    })

    opts = [_norm_option(o) for o in (data.get("options") if isinstance(data, dict) else []) or []]
    norm_opts = [o for o in opts if o]
    return {
        "summary": str(data.get("summary", "")) if isinstance(data, dict) else "",
        "within_budget": bool(data.get("within_budget", False)) if isinstance(data, dict) else False,
        "options": norm_opts,
        "total_estimate_usd": float(data.get("total_estimate_usd", 0) or 0) if isinstance(data, dict) else 0,
        "warnings": [str(w) for w in (data.get("warnings") or [])] if isinstance(data, dict) else [],
        "budget": {"per_person": budget_pp, "total": total_budget, "travelers": travelers},
    }


# ========================== /apps/wander/verify-booking ==========================
class VerifyIn(BaseModel):
    text_or_link: str = ""


@router.post("/apps/wander/verify-booking")
def wander_verify_booking(body: VerifyIn, authorization: str = Header(None)) -> dict[str, Any]:
    from api.main import current_user  # noqa: WPS433
    current_user(authorization)
    from agents.nim import ask_json

    system = _wander_prompt() + (
        "\n\nYou are powering the VERIFY-BOOKING desk. The user pastes a booking confirmation email, a "
        "payment / deposit request, or a booking link. Judge whether it is a legitimate booking or a scam "
        "(lookalike domain, fake deposit to an unknown account, too-good-to-be-true fare, pressure / "
        "urgency, mismatched sender, hidden instructions). Be concrete and honest; if you are unsure, say "
        "caution rather than safe. NEVER tell the user to pay a deposit to an unverified account. Speak in "
        "first person as the agent who screened it.\n\n"
        "Respond with ONLY a single valid JSON object of EXACTLY this shape:\n"
        '{"verdict": "safe"|"caution"|"scam",'
        ' "reasons": [string] (3-6 concrete signals you observed, good or bad),'
        ' "advice": string (1-2 sentences: the single safest next step for the traveler)}'
    )
    user = f"Verify this booking message / link:\n\n{(body.text_or_link or '').strip() or '(empty)'}"

    data = ask_json(system, user, max_tokens=900, temperature=0.2, default={
        "verdict": "caution", "reasons": ["Verifier temporarily unavailable."],
        "advice": "Try again, and never pay a deposit to an unverified account.",
    })

    verdict = str(data.get("verdict", "caution")).lower() if isinstance(data, dict) else "caution"
    if verdict not in ("safe", "caution", "scam"):
        verdict = "caution"
    reasons = [str(r) for r in (data.get("reasons") or [])] if isinstance(data, dict) else []
    return {
        "verdict": verdict,
        "reasons": reasons or ["No specific signals extracted."],
        "advice": str(data.get("advice", "")) if isinstance(data, dict) else "",
    }
