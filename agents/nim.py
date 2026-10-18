"""Shared structured-output helpers over the NVIDIA NIM client.

Every new agentic subsystem (enrichment, page-gen planner/builder/validator, crash-test
generation, RL defense, litigation support) talks to the LLM through here so there is one
place that:
  - round-robins the NVIDIA keys (reuses the pool in agents.live),
  - forces JSON and parses it *tolerantly* (gpt-oss "harmony" output leaks <|channel|>...
    markers and sometimes wraps JSON in prose — we recover the first balanced object/array),
  - retries once on a parse miss, and escalates to a stronger model on demand.

Keep this dependency-light: it must import cleanly even when the OpenAI SDK or keys are absent.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from .live import _client, _DEFAULT_MODEL, llm_available  # noqa: F401  (re-exported)

# A stronger model to escalate to when the default can't produce usable JSON / isn't "at par".
try:  # keep import-safe
    from .verify import ESCALATION_MODEL as _ESCALATION_MODEL
except Exception:  # pragma: no cover
    _ESCALATION_MODEL = "nvidia/nemotron-3-super-120b-a12b"

ESCALATION_MODEL = _ESCALATION_MODEL

# gpt-oss harmony channel markers that occasionally leak into content.
_HARMONY = re.compile(r"<\|[^>]*\|>")


def _strip_harmony(text: str) -> str:
    return _HARMONY.sub(" ", text or "")


def _first_balanced(text: str, open_ch: str, close_ch: str) -> Optional[str]:
    """Return the first balanced {...} or [...] substring, ignoring braces inside strings."""
    start = text.find(open_ch)
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def extract_json(text: str) -> Any:
    """Best-effort parse of a JSON object/array out of a model response. Raises ValueError on miss."""
    if not text:
        raise ValueError("empty response")
    cleaned = _strip_harmony(text).strip()
    # strip ``` fences
    if "```" in cleaned:
        cleaned = re.sub(r"```(?:json)?", "", cleaned).replace("```", "").strip()
    # fast path
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # recover the first balanced object, then array
    for o, c in (("{", "}"), ("[", "]")):
        cand = _first_balanced(cleaned, o, c)
        if cand:
            try:
                return json.loads(cand)
            except Exception:
                # tolerate trailing commas
                try:
                    return json.loads(re.sub(r",(\s*[}\]])", r"\1", cand))
                except Exception:
                    continue
    raise ValueError("no JSON object found in response")


def ask_json(
    system: str,
    user: str,
    *,
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 1800,
    retries: int = 1,
    escalate: bool = False,
    default: Any = None,
) -> Any:
    """Call the model, force JSON, return the parsed object.

    On a parse miss, retries `retries` times (nudging the model), then optionally escalates to a
    stronger model. Returns `default` (or {}) only if every attempt fails and `default` is given.
    """
    if not llm_available():
        if default is not None:
            return default
        raise RuntimeError("no LLM keys configured — set NVIDIA_API_KEYS in .env")

    models = [model or _DEFAULT_MODEL]
    if escalate and ESCALATION_MODEL not in models:
        models.append(ESCALATION_MODEL)

    last_err: Optional[Exception] = None
    for mdl in models:
        attempts = retries + 1
        sys_msg = system
        for attempt in range(attempts):
            try:
                resp = _client().chat.completions.create(
                    model=mdl,
                    messages=[
                        {"role": "system", "content": sys_msg},
                        {"role": "user", "content": user},
                    ],
                    response_format={"type": "json_object"},
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                content = resp.choices[0].message.content or ""
                return extract_json(content)
            except Exception as e:  # parse or transport error
                last_err = e
                # tighten the instruction and try again
                sys_msg = system + "\n\nRespond with ONLY a single valid JSON object. No prose, no markdown fences."
                continue
    if default is not None:
        return default
    raise ValueError(f"ask_json failed after {len(models)} model(s): {last_err}")


def ask_text(
    system: str,
    user: str,
    *,
    model: Optional[str] = None,
    temperature: float = 0.4,
    max_tokens: int = 900,
) -> str:
    """Plain-text completion (used for conversational turns, e.g. the support/litigation chatbot)."""
    if not llm_available():
        return ""
    resp = _client().chat.completions.create(
        model=model or _DEFAULT_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return _strip_harmony(resp.choices[0].message.content or "").strip()


def chat_text(messages: list[dict], *, system: Optional[str] = None,
              model: Optional[str] = None, temperature: float = 0.4, max_tokens: int = 900) -> str:
    """Multi-turn plain-text completion. `messages` is OpenAI-style [{role, content}, ...]."""
    if not llm_available():
        return ""
    msgs = ([{"role": "system", "content": system}] if system else []) + list(messages)
    resp = _client().chat.completions.create(
        model=model or _DEFAULT_MODEL,
        messages=msgs,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return _strip_harmony(resp.choices[0].message.content or "").strip()
