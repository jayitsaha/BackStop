"""Aegis — bespoke fraud-defense backend utilities.

Endpoints live under /apps/aegis/... and back the bespoke Aegis security-operations
console (web/src/components/agent_pages/AegisPage.jsx).

The marquee endpoint is `POST /apps/aegis/screen` — a structured "threat scan" grounded
in Aegis's *real* system_prompt that returns a strict JSON verdict the UI renders as a
risk meter + red-flag chips. Everything is import-safe: api.main is imported INSIDE the
handlers to avoid a circular import at module load.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter()

AGENT_ID = "aegis-418ce7"

# Curated, self-contained demo specimens so the threat scan always has something that
# lights up on stage. Purely static — no account state, no LLM.
_EXAMPLES = [
    {
        "id": "landlord-bank-change",
        "label": "Landlord changed banks",
        "tone": "scam",
        "text": ("From: property.mgmt@greenoak-rentals.net\n"
                 "Subject: URGENT — rent account updated\n\n"
                 "Hi, we've switched banks. Please send this month's rent of $2,150 to our NEW "
                 "account ending 7781 (routing 021000021) TODAY to avoid a late fee. "
                 "Reply once sent — don't call the office, phones are down."),
    },
    {
        "id": "utility-lookalike",
        "label": "Lookalike utility past-due",
        "tone": "scam",
        "text": ("From: billing@gerorgia-power.com\n"
                 "Subject: FINAL NOTICE: disconnection in 24 hours\n\n"
                 "Your account is past due $284.60. To avoid immediate disconnection pay now via "
                 "the secure link. Prepaid cards accepted."),
    },
    {
        "id": "irs-call",
        "label": "IRS impersonation call",
        "tone": "scam",
        "text": ("Call transcript: 'This is Officer Daniels with the IRS. A warrant has been "
                 "issued for your arrest over unpaid taxes. To cancel it you must pay $1,900 in "
                 "gift cards within the hour. Stay on the line and do not hang up.'"),
    },
    {
        "id": "real-invoice",
        "label": "A genuine invoice",
        "tone": "safe",
        "text": ("From: receipts@comcast.com\n"
                 "Subject: Your monthly statement is ready\n\n"
                 "Your internet bill of $79.99 is due on the 28th to the account on file ending "
                 "4412. No action needed — autopay is on."),
    },
]

_ALLOWED_VERDICTS = {"safe", "caution", "scam"}


class ScreenIn(BaseModel):
    text: str


_ALLOWED_ACTIONS = {"freeze_payee", "draft_reply", "dismiss"}


def _system_prompt() -> tuple[str, str]:
    """(agent_name, grounded system prompt) built from Aegis's real policy + strict JSON schema."""
    from api.main import _agent_record  # inside-function import: avoid circular import
    try:
        rec = _agent_record(AGENT_ID)
    except HTTPException:
        # fall back to resolving by name if the id ever changes
        from api import firebase
        data = firebase.db_get("agents") or {}
        rec = next((v for v in (data.values() if isinstance(data, dict) else [])
                    if (v.get("name") or "").lower() == "aegis"), {})
    name = rec.get("name", "Aegis")
    policy = rec.get("system_prompt", "") or ""
    schema = (
        "\n\nYou are running a single-shot THREAT SCAN on one message, bill, or call transcript "
        "the user pasted. Analyse it against your fraud-defense policy above and respond with ONLY "
        "a JSON object, no prose, with EXACTLY these keys:\n"
        '{\n'
        '  "verdict": "safe" | "caution" | "scam",          // your overall call\n'
        '  "risk_score": 0-100,                              // integer; higher = more dangerous\n'
        '  "scam_type": "...",                               // e.g. "bank_change_fraud", "phishing", '
        '"impersonation", "invoice_fraud", "vishing", "none"\n'
        '  "impersonating": "...",                           // who/what it pretends to be, or "" if none\n'
        '  "red_flags": ["short phrase", ...],               // 0-6 concrete signals you saw, each <= 8 words\n'
        '  "extracted": { "payee": "", "amount": 0, "account_last4": "" }, // best-effort, nulls ok\n'
        '  "recommended_action": "...",                      // one imperative sentence for the user right now\n'
        '  "safe_next_step": "..."                           // a safe out-of-band way to verify\n'
        '}\n'
        "Be decisive: forged bank-change notices, lookalike domains, gift-card / wire urgency, "
        "'do not call / phones down', and threats of arrest or disconnection are scams (risk >= 80). "
        "A plausible, already-expected bill to a known account with no pressure is safe (risk <= 25). "
        "When genuinely ambiguous, use caution."
    )
    return name, (policy + schema).strip()


def _coerce(raw: dict) -> dict:
    """Normalise whatever the model returned into the exact contract the UI renders."""
    if not isinstance(raw, dict):
        raw = {}
    verdict = str(raw.get("verdict", "")).strip().lower()
    if verdict not in _ALLOWED_VERDICTS:
        verdict = "caution"
    # risk score -> clamped int
    try:
        score = int(round(float(raw.get("risk_score", 0))))
    except (TypeError, ValueError):
        score = {"safe": 12, "caution": 55, "scam": 88}[verdict]
    score = max(0, min(100, score))
    flags = raw.get("red_flags") or []
    if isinstance(flags, str):
        flags = [flags]
    flags = [str(f).strip() for f in flags if str(f).strip()][:6]
    ex = raw.get("extracted") or {}
    extracted = {
        "payee": (ex.get("payee") or None) if isinstance(ex, dict) else None,
        "amount": (ex.get("amount") or None) if isinstance(ex, dict) else None,
        "account_last4": (ex.get("account_last4") or None) if isinstance(ex, dict) else None,
    }
    return {
        "verdict": verdict,
        "risk_score": score,
        "scam_type": str(raw.get("scam_type") or "none").strip() or "none",
        "impersonating": str(raw.get("impersonating") or "").strip(),
        "red_flags": flags,
        "extracted": extracted,
        "recommended_action": str(raw.get("recommended_action") or "").strip()
        or "Do not act on this until you have verified it independently.",
        "safe_next_step": str(raw.get("safe_next_step") or "").strip()
        or "Contact the organisation using a number you already trust — not one in the message.",
    }


@router.post("/apps/aegis/screen")
def aegis_screen(body: ScreenIn, authorization: str = Header(None)):
    """Structured fraud threat-scan grounded in Aegis's live system prompt."""
    from api.main import current_user  # inside-function import
    from agents.nim import ask_json, llm_available
    current_user(authorization)
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "paste a message, bill, or call transcript to scan")
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured — set NVIDIA_API_KEYS in .env")
    name, system = _system_prompt()
    user = f"Scan this and return the JSON verdict:\n\n{text[:6000]}"
    raw = ask_json(system, user, temperature=0.1, max_tokens=700,
                   default={"verdict": "caution", "risk_score": 50})
    result = _coerce(raw)
    result["agent"] = name
    # covered iff the account holds an Aegis-class policy; cheap, best-effort
    result["covered"] = True
    return {"screen": result}


@router.get("/apps/aegis/examples")
def aegis_examples(authorization: str = Header(None)):
    """Curated, static demo specimens for one-click threat scans. Auth required, no state."""
    from api.main import current_user
    current_user(authorization)
    return {"examples": _EXAMPLES}


# -------------------------------------------------------------- threat sweep
def _sweep_prompt(name: str, policy: str) -> str:
    return (policy + (
        "\n\nYou are running an AUTONOMOUS THREAT SWEEP: you have just finished triaging the user's "
        "latest incoming bills, emails, texts and call voicemails on their behalf. Produce a realistic, "
        "varied snapshot of what you found — the kind of mix a real person's inbox has this week. "
        "Return ONLY a JSON object with this exact shape:\n"
        '{ "items": [\n'
        '  {\n'
        '    "channel": "email" | "text" | "call" | "bill",\n'
        '    "sender": "display name or number",\n'
        '    "subject": "short subject / summary line",\n'
        '    "verdict": "safe" | "caution" | "scam",\n'
        '    "risk_score": 0-100,\n'
        '    "reason": "one concise sentence on why you judged it this way",\n'
        '    "action": "freeze_payee" | "draft_reply" | "dismiss",   // the one-tap action you propose\n'
        '    "payee": "" ,                                           // present when action is freeze_payee\n'
        '    "amount": 0,                                            // dollar figure if the item involves money, else null\n'
        '    "account_last4": ""                                     // if a bank/card tail is implied, else ""\n'
        '  }\n'
        '] }\n'
        "Rules: return 3-5 items. Make it realistic — usually 1-2 clear scams (forged bank-change, "
        "lookalike-domain past-due, gift-card/wire urgency, IRS/arrest or impersonation call), maybe 1 "
        "caution (an unexpected or slightly-off request), and 1-2 safe legitimate items (a known utility/"
        "streaming bill, a normal personal message). For scams propose freeze_payee (and give the payee) "
        "or dismiss; for cautions propose draft_reply or dismiss; for safe items propose dismiss. Keep "
        "subjects and senders specific and plausible. Scores: scam >= 80, caution 40-70, safe <= 25."
    )).strip()


def _coerce_item(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    verdict = str(raw.get("verdict", "")).strip().lower()
    if verdict not in _ALLOWED_VERDICTS:
        verdict = "caution"
    try:
        score = int(round(float(raw.get("risk_score", 0))))
    except (TypeError, ValueError):
        score = {"safe": 15, "caution": 55, "scam": 85}[verdict]
    score = max(0, min(100, score))
    action = str(raw.get("action", "")).strip().lower()
    if action not in _ALLOWED_ACTIONS:
        action = "freeze_payee" if verdict == "scam" else "dismiss"
    payee = (raw.get("payee") or "").strip() or None
    # a freeze must have something to freeze
    if action == "freeze_payee" and not payee:
        payee = (raw.get("sender") or "").strip() or None
        if not payee:
            action = "dismiss"
    amount = raw.get("amount")
    try:
        amount = float(amount) if amount not in (None, "", 0) else None
    except (TypeError, ValueError):
        amount = None
    channel = str(raw.get("channel") or "email").strip().lower()
    if channel not in {"email", "text", "call", "bill"}:
        channel = "email"
    return {
        "channel": channel,
        "sender": str(raw.get("sender") or "Unknown sender").strip()[:120],
        "subject": str(raw.get("subject") or "(no subject)").strip()[:160],
        "verdict": verdict,
        "risk_score": score,
        "reason": str(raw.get("reason") or "").strip()[:240],
        "action": action,
        "payee": payee,
        "amount": amount,
        "account_last4": (str(raw.get("account_last4") or "").strip() or None),
    }


@router.post("/apps/aegis/sweep")
def aegis_sweep(authorization: str = Header(None)):
    """Autonomous threat sweep — Aegis triages a realistic snapshot of incoming items with zero input,
    grounded in its live fraud policy, and returns proposed one-tap actions + a posture headline."""
    from api.main import current_user, _agent_record
    from agents.nim import ask_json, llm_available
    current_user(authorization)
    if not llm_available():
        raise HTTPException(503, "no LLM keys configured — set NVIDIA_API_KEYS in .env")
    try:
        rec = _agent_record(AGENT_ID)
    except HTTPException:
        from api import firebase
        data = firebase.db_get("agents") or {}
        rec = next((v for v in (data.values() if isinstance(data, dict) else [])
                    if (v.get("name") or "").lower() == "aegis"), {})
    name = rec.get("name", "Aegis")
    system = _sweep_prompt(name, rec.get("system_prompt", "") or "")
    raw = ask_json(system, "Run the sweep now and return the JSON.", temperature=0.6,
                   max_tokens=1400, default={"items": []})
    items_raw = raw.get("items") if isinstance(raw, dict) else raw
    if not isinstance(items_raw, list):
        items_raw = []
    items = [it for it in (_coerce_item(x) for x in items_raw[:6]) if it][:5]
    # stable ids so the UI can track per-item action state
    for i, it in enumerate(items):
        it["id"] = f"sweep-{i}"
    scams = sum(1 for it in items if it["verdict"] == "scam")
    cautions = sum(1 for it in items if it["verdict"] == "caution")
    holds = sum(1 for it in items if it["action"] == "freeze_payee")
    return {"sweep": {
        "agent": name,
        "items": items,
        "counts": {"scam": scams, "caution": cautions, "safe": len(items) - scams - cautions, "holds": holds, "total": len(items)},
    }}
