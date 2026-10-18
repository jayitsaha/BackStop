"""Agent enrichment — turn a maker's (name, system_prompt, optional pitch) into the rich
marketplace metadata the storefront and the dynamic dashboard need.

Backstop is a general agentic marketplace, so an agent is NOT assumed to be about fraud/bill-pay.
This LLM pass classifies the agent into a use-case type and writes a customer-facing description,
a capability list, a usage guide, and the inputs/outputs it works with — always as strict JSON.
Deterministic fallback keeps publishing working even with no LLM keys.
"""
from __future__ import annotations

from typing import Optional

from .nim import ask_json, llm_available

USE_CASE_TYPES = [
    "fraud-detector", "bill-pay", "ticket-buyer", "shopping", "travel-booker",
    "bot-detector", "web-monitor", "research", "scheduler", "support-agent",
    "trading", "generic",
]

CATEGORIES = [
    "Fraud & Safety", "Finance & Payments", "Commerce & Tickets", "Travel",
    "Web & Bots", "Research & Data", "Productivity", "Trading", "Other",
]

_SYS = """You are the listing editor for Backstop, a secure marketplace of identity-verified,
crash-tested, insured AI agents. Agents can do ANYTHING (buy concert tickets, detect web bots,
book travel, defend against payment fraud, research, trade, schedule, etc.) — do NOT assume the
agent is about fraud or bill-paying unless its purpose clearly says so.

Given an agent's name and system prompt, produce a crisp, honest marketplace listing. Infer what
the agent actually does from its prompt. Write for a non-technical buyer deciding whether to use it.

Return ONLY a JSON object with EXACTLY these keys:
{
  "use_case_type": one of %s,
  "category": one of %s,
  "tagline": one punchy sentence (<= 90 chars),
  "description": 2-4 sentences in markdown describing what it is and the value it delivers,
  "capabilities": [ {"name": short title, "description": one sentence} ]  (3-6 items),
  "usage": [ step strings ]  (3-6 short imperative steps a user follows),
  "inputs": [ short strings: what the agent consumes, e.g. "an artist name", "a bill screenshot" ],
  "outputs": [ short strings: what the agent produces/does, e.g. "a purchased ticket", "a scam verdict" ],
  "example_tasks": [ 2-3 realistic one-line tasks a user might give this agent ],
  "icon": one of ["shield","ticket","bot","plane","cart","chart","search","calendar","phone","mail","bank","sparkle"],
  "accent": one of ["brand","info","safe","warn","bad"]
}
Pick icon/accent that fit the domain (fraud/safety -> shield/bad or warn; tickets -> ticket/info;
bots -> bot/info; travel -> plane/info; finance -> bank/brand; trading -> chart/brand). No prose.""" % (
    USE_CASE_TYPES,
    CATEGORIES,
)


def _fallback(name: str, system_prompt: str, pitch: str) -> dict:
    """Deterministic, keyword-based enrichment when no LLM is available."""
    text = f"{name} {pitch} {system_prompt}".lower()
    mapping = [
        (("scam", "fraud", "phish", "vish", "mandate", "bill", "payment"), "fraud-detector", "Fraud & Safety", "shield", "bad"),
        (("ticket", "concert", "event", "seat"), "ticket-buyer", "Commerce & Tickets", "ticket", "info"),
        (("bot", "captcha", "scrap", "traffic"), "bot-detector", "Web & Bots", "bot", "info"),
        (("flight", "hotel", "travel", "trip", "book"), "travel-booker", "Travel", "plane", "info"),
        (("buy", "shop", "cart", "order", "price"), "shopping", "Commerce & Tickets", "cart", "info"),
        (("trade", "stock", "crypto", "portfolio"), "trading", "Trading", "chart", "brand"),
        (("research", "summar", "search", "analy"), "research", "Research & Data", "search", "info"),
        (("schedule", "calendar", "meeting"), "scheduler", "Productivity", "calendar", "info"),
    ]
    uct, cat, icon, accent = "generic", "Other", "sparkle", "brand"
    for keys, u, c, ic, ac in mapping:
        if any(k in text for k in keys):
            uct, cat, icon, accent = u, c, ic, ac
            break
    return {
        "use_case_type": uct,
        "category": cat,
        "tagline": pitch[:90] or f"{name}, a verified and insured agent.",
        "description": pitch or f"{name} is an identity-verified, crash-tested, insured agent on Backstop.",
        "capabilities": [
            {"name": "Acts within a mandate", "description": "Operates only inside the rules you set."},
            {"name": "Crash-tested", "description": "Passed Backstop's adversarial safety suite before listing."},
            {"name": "Insured", "description": "Mistakes are covered up to the policy limit."},
        ],
        "usage": ["Add the agent to your account.", "Give it a task.", "Review what it did."],
        "inputs": ["a task described in plain language"],
        "outputs": ["an action taken on your behalf", "a short report of what it did"],
        "example_tasks": [f"Help me with {name}'s specialty."],
        "icon": icon,
        "accent": accent,
    }


def _coerce(data: dict, name: str) -> dict:
    """Clamp/normalize LLM output to the contract."""
    out = dict(data or {})
    if out.get("use_case_type") not in USE_CASE_TYPES:
        out["use_case_type"] = "generic"
    if out.get("category") not in CATEGORIES:
        out["category"] = "Other"
    if out.get("icon") not in {"shield", "ticket", "bot", "plane", "cart", "chart", "search", "calendar", "phone", "mail", "bank", "sparkle"}:
        out["icon"] = "sparkle"
    if out.get("accent") not in {"brand", "info", "safe", "warn", "bad"}:
        out["accent"] = "brand"

    def _strlist(v):
        if isinstance(v, list):
            return [str(x) for x in v if str(x).strip()][:8]
        return []

    out["usage"] = _strlist(out.get("usage")) or ["Give the agent a task.", "Review what it did."]
    out["inputs"] = _strlist(out.get("inputs")) or ["a task"]
    out["outputs"] = _strlist(out.get("outputs")) or ["a result"]
    out["example_tasks"] = _strlist(out.get("example_tasks")) or [f"Try {name}."]
    caps = out.get("capabilities")
    norm_caps = []
    if isinstance(caps, list):
        for c in caps[:6]:
            if isinstance(c, dict) and c.get("name"):
                norm_caps.append({"name": str(c["name"]), "description": str(c.get("description", ""))})
            elif isinstance(c, str):
                norm_caps.append({"name": c, "description": ""})
    out["capabilities"] = norm_caps or [{"name": "Verified & insured", "description": "Crash-tested before listing."}]
    out["tagline"] = str(out.get("tagline") or f"{name}, a verified agent.")[:140]
    out["description"] = str(out.get("description") or out["tagline"])
    return out


def enrich_agent(name: str, system_prompt: str, pitch: str = "", model: Optional[str] = None) -> dict:
    """Return rich marketplace metadata for an agent. Never raises."""
    if not llm_available():
        return _fallback(name, system_prompt, pitch)
    user = f"Agent name: {name}\n\nMaker pitch (optional): {pitch or '(none)'}\n\nSystem prompt:\n{system_prompt}"
    try:
        data = ask_json(_SYS, user, model=model, temperature=0.3, max_tokens=1400,
                        default=_fallback(name, system_prompt, pitch))
        return _coerce(data, name)
    except Exception:
        return _fallback(name, system_prompt, pitch)
