"""LiveKit room tokens for the live call guardian.

The browser joins a LiveKit room and publishes its mic; a separate guardian worker (scripts/call_guardian.py)
joins the same room, transcribes with Deepgram, screens for vishing with our model, and publishes live
alerts back over the room data channel. This module just mints the join token (a standard LiveKit JWT).
"""
from __future__ import annotations

import os
import time

import jwt  # PyJWT


def url() -> str:
    return os.environ.get("LIVEKIT_URL", "")


def configured() -> bool:
    return bool(os.environ.get("LIVEKIT_URL") and os.environ.get("LIVEKIT_API_KEY") and os.environ.get("LIVEKIT_API_SECRET"))


def mint_token(identity: str, room: str, ttl_seconds: int = 3600) -> str:
    key = os.environ["LIVEKIT_API_KEY"]
    secret = os.environ["LIVEKIT_API_SECRET"]
    now = int(time.time())
    payload = {
        "iss": key,
        "sub": identity,
        "name": identity,
        "nbf": now - 5,
        "exp": now + ttl_seconds,
        "video": {
            "room": room,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    return jwt.encode(payload, secret, algorithm="HS256")
