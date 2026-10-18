"""Voice / Vishing Guard — Inbox Guard for phone scams.

Audio comes in two ways:
  • live mic capture transcribed in the browser (Web Speech API — keyless), or
  • an uploaded voicemail/recording transcribed with Deepgram Nova-2 (the voice_ref stack).
Either way we get a transcript, then a model reasons over it for phone-scam (vishing) signals and tells
the user what's happening and exactly what to do. No call is placed; the analysis is the value.
"""
from __future__ import annotations

import json
import os
import urllib.request

from .live import _client, _DEFAULT_MODEL

DEEPGRAM_KEY = os.environ.get("DEEPGRAM_API_KEY", "")


def deepgram_available() -> bool:
    return bool(DEEPGRAM_KEY)


def transcribe_audio(raw: bytes, content_type: str = "audio/wav") -> str:
    """Transcribe audio bytes with Deepgram Nova-2 (REST). Raises if no key / on error."""
    if not DEEPGRAM_KEY:
        raise RuntimeError("no DEEPGRAM_API_KEY configured")
    url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true"
    req = urllib.request.Request(url, data=raw, method="POST",
                                 headers={"Authorization": f"Token {DEEPGRAM_KEY}", "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    try:
        return data["results"]["channels"][0]["alternatives"][0]["transcript"]
    except Exception:
        return ""


VISHING_SYS = (
    "You are Backstop Voice Guard, a phone-scam (vishing) analyst. You are given a transcript of a phone "
    "call or voicemail the user received. Decide if it is a scam. Watch for: someone impersonating a bank, "
    "the IRS/SSA, a utility, tech support, police, or a delivery service; requests for a one-time code / 2FA / "
    "OTP, gift cards, wire transfers, crypto, or remote access to a device; pressure and threats (account "
    "suspension, arrest, shutoff, legal action); 'verify your identity', 'confirm your card', or a callback "
    "number. Legitimate institutions never ask for OTP codes, gift cards, or remote access. "
    "Return ONLY JSON: {\"risk\":{\"level\":\"safe|caution|scam\",\"score\":0,\"scam_type\":\"impersonation|"
    "otp_theft|tech_support|refund_prize|debt_threat|other|none\",\"signals\":[\"\"],\"explanation\":\"\"},"
    "\"impersonating\":\"who the caller claims to be, or 'unknown'\",\"recommended_action\":\"what the user "
    "should do now\",\"safe_response\":\"one short line the user can say or do\"}"
)


def _parse(txt: str) -> dict:
    try:
        return json.loads(txt)
    except Exception:
        s, e = txt.find("{"), txt.rfind("}")
        if s >= 0 and e > s:
            try:
                return json.loads(txt[s:e + 1])
            except Exception:
                pass
    return {}


def analyze_voice(transcript: str, model: str | None = None) -> dict:
    client = _client()
    try:
        r = client.chat.completions.create(
            model=model or _DEFAULT_MODEL, max_tokens=900, temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": VISHING_SYS},
                      {"role": "user", "content": "CALL TRANSCRIPT:\n" + (transcript or "")[:4000]}],
        )
        data = _parse(r.choices[0].message.content or "{}")
    except Exception as e:
        return {"risk": {"level": "caution", "score": 50, "scam_type": "other", "signals": ["analysis unavailable"], "explanation": str(e)[:160]},
                "impersonating": "unknown", "recommended_action": "", "safe_response": "", "ok": False}
    risk = data.setdefault("risk", {})
    risk.setdefault("level", "caution")
    try:
        risk["score"] = int(risk.get("score", 50))
    except Exception:
        risk["score"] = 50
    risk.setdefault("signals", [])
    risk.setdefault("scam_type", "other")
    data.setdefault("impersonating", "unknown")
    data.setdefault("recommended_action", "")
    data.setdefault("safe_response", "")
    data["ok"] = True
    return data
