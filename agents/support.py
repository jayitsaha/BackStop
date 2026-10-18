"""Autonomous claims investigator — the litigation support chatbot.

A customer files a claim (evidence text + optionally a screenshot we've already transcribed). This
module runs a *cross-questioning loop*: a customer-support investigator that probes the user until it
is satisfied about two things specifically:
  1. did a scam / loss actually occur, and
  2. was it via the SPECIFIC marketplace agent the user bought (not something unrelated)?

Only then does it return a decision (approved / denied / needs_human) with a rationale and the pieces
of evidence it relied on.

Everything routes through agents.nim (tolerant JSON + llm_available). If no LLM is configured we fall
back to a tiny deterministic script: ask two fixed questions, then approve iff the evidence mentions a
money loss. No randomness is used anywhere.
"""
from __future__ import annotations

import re
from typing import Any

from .nim import ask_json, llm_available

# How many probing questions we allow before we force a decision (keeps the loop bounded).
MAX_QUESTIONS = 5

_INVESTIGATOR_SYS = (
    "You are Backstop's autonomous claims investigator — a sharp, fair, and concise customer-support "
    "agent handling an insurance claim for an AI agent a customer bought from the Backstop marketplace. "
    "Your job is to CROSS-QUESTION the customer to establish two things before you decide:\n"
    "  (1) that a scam / financial loss actually occurred, and\n"
    "  (2) that it happened specifically through the marketplace agent they bought (named below) — not "
    "some unrelated transaction, not user error outside the agent's mandate, and not a fabricated claim.\n\n"
    "Ask ONE focused question at a time. Probe for concrete, verifiable specifics: dates, amounts, the "
    "payee/counterparty, what the agent actually did vs. what the user authorised, how the user noticed, "
    "and anything in the evidence that is vague or inconsistent. Be skeptical but respectful — never "
    "accuse, never lecture. Do not give legal advice. If the user is evasive or contradicts the evidence, "
    "note it. Once you have enough to decide (or you've asked several questions and further probing won't "
    "help), STOP asking and return a decision.\n\n"
    "Outcomes: 'approved' (a covered scam/loss via this agent is established), 'denied' (no scam, user "
    "authorised it, or it wasn't this agent / outside its mandate), 'needs_human' (plausible but needs a "
    "human adjudicator — e.g. large amount or unresolved doubt). Keep every text field short."
)


def _clamp_conf(v: Any) -> float:
    try:
        f = float(v)
    except Exception:
        return 0.5
    return max(0.0, min(1.0, f))


def _mentions_loss(*texts: str) -> bool:
    blob = " ".join(t for t in texts if t).lower()
    if not blob:
        return False
    if re.search(r"\$\s?\d|\d+\s?(usd|dollars)", blob):
        return True
    keywords = ("lost", "stolen", "scam", "fraud", "charged", "paid", "wired", "unauthor", "refund",
                "money", "withdraw", "drained", "debited")
    return any(k in blob for k in keywords)


def _evidence_block(case: dict) -> str:
    parts = [
        f"MARKETPLACE AGENT INVOLVED: {case.get('agent_name') or 'unknown'} "
        f"(use-case: {case.get('use_case_type') or 'unknown'})",
    ]
    if case.get("payment_id"):
        parts.append(f"LINKED PAYMENT ID: {case['payment_id']}")
    if case.get("evidence_text"):
        parts.append("CUSTOMER'S WRITTEN ACCOUNT:\n" + str(case["evidence_text"])[:2500])
    if case.get("screenshot_text"):
        parts.append("TEXT EXTRACTED FROM UPLOADED SCREENSHOT:\n" + str(case["screenshot_text"])[:2500])
    return "\n\n".join(parts)


def _transcript_block(case: dict) -> str:
    lines = []
    for turn in case.get("transcript", []) or []:
        who = "INVESTIGATOR" if turn.get("role") == "agent" else "CUSTOMER"
        lines.append(f"{who}: {turn.get('content', '')}")
    return "\n".join(lines) if lines else "(no questions asked yet)"


# ============================ open a case ============================
def open_case(evidence_text: str, screenshot_text: str, agent_name: str, use_case_type: str) -> dict:
    """Produce the initial case assessment + the FIRST cross-question."""
    base = {
        "agent_name": agent_name,
        "use_case_type": use_case_type,
        "evidence_text": evidence_text,
        "screenshot_text": screenshot_text,
    }
    if not llm_available():
        return _fallback_open(base)

    user = (
        _evidence_block(base)
        + "\n\nAssess this claim and begin the investigation. Return JSON with exactly these keys: "
        '"summary" (1-2 sentences of what the customer is claiming), "suspected_scam_type" (short label, '
        'e.g. "fake invoice / bank-change", or "unclear"), "confidence" (0..1 that a covered scam via this '
        'specific agent occurred, given only the evidence so far), "questions_remaining" (integer estimate), '
        '"next_question" (the single most important question to ask the customer first), '
        '"status" (always "investigating").'
    )
    data = ask_json(_INVESTIGATOR_SYS, user, default={}) or {}
    summary = str(data.get("summary") or "Claim about a possible scam via a purchased agent.")[:400]
    q = str(data.get("next_question") or "").strip()
    if not q:
        q = (f"Can you walk me through exactly what {agent_name} did, and how you realised it was a scam?")
    return {
        "summary": summary,
        "suspected_scam_type": str(data.get("suspected_scam_type") or "unclear")[:80],
        "confidence": _clamp_conf(data.get("confidence", 0.4)),
        "questions_remaining": int(data.get("questions_remaining") or 3) if str(
            data.get("questions_remaining", "")).lstrip("-").isdigit() else 3,
        "next_question": q[:500],
        "status": "investigating",
    }


def _fallback_open(base: dict) -> dict:
    return {
        "summary": "Claim filed about a possible scam involving "
                   + (base.get("agent_name") or "a purchased agent") + ".",
        "suspected_scam_type": "unclear",
        "confidence": 0.4,
        "questions_remaining": 2,
        "next_question": (
            f"To start: how much money was involved, and what exactly did {base.get('agent_name') or 'the agent'} "
            "do that you believe was a scam?"
        ),
        "status": "investigating",
    }


# ============================ advance a case ============================
def advance_case(case: dict, user_answer: str) -> dict:
    """Given the running case and the customer's latest answer, either ask the NEXT question or DECIDE.

    `case` is expected to already carry the evidence + a `transcript` list of {role, content}. The caller
    is responsible for appending this answer to the transcript and persisting; here we only reason about
    the state as given (the latest user_answer is passed explicitly and also assumed to be the last
    CUSTOMER turn in the transcript).
    """
    asked = sum(1 for t in (case.get("transcript") or []) if t.get("role") == "agent")
    if not llm_available():
        return _fallback_advance(case, user_answer, asked)

    user = (
        _evidence_block(case)
        + "\n\nINVESTIGATION SO FAR:\n" + _transcript_block(case)
        + f"\n\nThe customer just answered: \"{str(user_answer)[:1500]}\""
        + f"\n\nYou have asked {asked} question(s) (limit {MAX_QUESTIONS}). Decide your next move. "
        "If you still need a specific fact to establish whether a scam occurred AND that it was via the "
        f"agent named above, ask ONE more question. Otherwise return a decision now.\n\n"
        'Return JSON with exactly: "reply" (a short, warm 1-2 sentence message to the customer reacting to '
        'their answer), "status" ("investigating" or "decided"). '
        'If status is "investigating", also include "next_question" (the single next question). '
        'If status is "decided", also include "decision": {"outcome": "approved"|"denied"|"needs_human", '
        '"amount_usd" (number, the loss to cover; 0 if denied/unknown), "rationale" (1-3 sentences), '
        '"evidence_cited" (array of short strings naming the specific facts/evidence you relied on)}.'
    )
    data = ask_json(_INVESTIGATOR_SYS, user, default={}) or {}
    status = "decided" if str(data.get("status")) == "decided" else "investigating"
    reply = str(data.get("reply") or "").strip()[:600]

    # Force a decision if we've hit the question budget.
    if status != "decided" and asked >= MAX_QUESTIONS:
        status = "decided"
        if not (isinstance(data.get("decision"), dict)):
            data["decision"] = {
                "outcome": "needs_human",
                "amount_usd": 0,
                "rationale": "Reached the question limit without conclusive proof; routing to a human adjudicator.",
                "evidence_cited": [],
            }

    if status == "decided":
        dec = data.get("decision") if isinstance(data.get("decision"), dict) else {}
        outcome = dec.get("outcome")
        if outcome not in ("approved", "denied", "needs_human"):
            outcome = "needs_human"
        try:
            amount = float(dec.get("amount_usd") or 0)
        except Exception:
            amount = 0.0
        cited = dec.get("evidence_cited")
        cited = [str(c)[:160] for c in cited][:8] if isinstance(cited, list) else []
        decision = {
            "outcome": outcome,
            "amount_usd": round(amount, 2),
            "rationale": str(dec.get("rationale") or "Decision reached after investigation.")[:600],
            "evidence_cited": cited,
        }
        return {
            "reply": reply or "Thank you — I have what I need to reach a decision.",
            "status": "decided",
            "decision": decision,
        }

    nq = str(data.get("next_question") or "").strip()
    if not nq:
        nq = "Is there anything else about this transaction — dates, amounts, or messages — you can share?"
    return {
        "reply": reply or "Thanks, that helps.",
        "next_question": nq[:500],
        "status": "investigating",
    }


def _fallback_advance(case: dict, user_answer: str, asked: int) -> dict:
    """No LLM: ask two fixed probing questions, then approve iff evidence mentions a money loss."""
    fixed = [
        (f"Did {case.get('agent_name') or 'the agent'} make or authorise this payment itself, or did you "
         "approve it? Please describe what it did."),
        "When did you first notice the loss, and roughly how much money was involved?",
    ]
    if asked < len(fixed):
        return {
            "reply": "Thanks — noted.",
            "next_question": fixed[asked],
            "status": "investigating",
        }
    # Decide from the accumulated text.
    answers = " ".join(t.get("content", "") for t in (case.get("transcript") or []) if t.get("role") == "user")
    loss = _mentions_loss(case.get("evidence_text", ""), case.get("screenshot_text", ""), answers, user_answer)
    if loss:
        decision = {
            "outcome": "approved",
            "amount_usd": 0,
            "rationale": ("Evidence and the customer's answers describe a financial loss tied to the purchased "
                          "agent. Approved for review (offline mode — amount to be confirmed)."),
            "evidence_cited": ["customer-reported money loss", "claim evidence text"],
        }
        reply = "Thank you. Based on what you've described, I'm approving this claim for processing."
    else:
        decision = {
            "outcome": "needs_human",
            "amount_usd": 0,
            "rationale": ("Could not confirm a financial loss tied to this specific agent from the information "
                          "provided; routing to a human adjudicator."),
            "evidence_cited": [],
        }
        reply = "Thank you. I wasn't able to confirm a loss from this, so I'm sending it to a human adjudicator."
    return {"reply": reply, "status": "decided", "decision": decision}
