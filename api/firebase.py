"""Firebase integration: real auth (Firebase Authentication email/password via the REST API) and
durable storage (Realtime Database via REST with the DB secret). No admin SDK / service account needed.

Auth: the frontend never touches Firebase directly — it calls our /auth endpoints, we proxy to Firebase
Identity Toolkit, and hand back the idToken. Every protected request carries that idToken as a Bearer
token; we verify it against Firebase on each call and resolve the uid.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]


def _load_env() -> None:
    env = _ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


_load_env()

API_KEY = os.environ.get("FIREBASE_API_KEY", "")
DB_URL = os.environ.get("FIREBASE_DB_URL", "").rstrip("/")
DB_SECRET = os.environ.get("FIREBASE_DB_SECRET", "")
IDENTITY = "https://identitytoolkit.googleapis.com/v1/accounts"
SECURETOKEN = "https://securetoken.googleapis.com/v1/token"


class FirebaseError(Exception):
    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.message = message
        self.code = code


def configured() -> bool:
    return bool(API_KEY and DB_URL and DB_SECRET)


# ---- HTTP helpers ------------------------------------------------------------
def _req(url: str, data: dict | None = None, method: str = "GET") -> dict | list | None:
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        try:
            payload = json.load(e)
        except Exception:
            payload = {"error": {"message": e.reason}}
        msg = payload.get("error", {}).get("message", str(payload)) if isinstance(payload, dict) else str(payload)
        raise FirebaseError(msg, code=str(e.code))


# ---- Realtime Database (REST) ------------------------------------------------
def _db(path: str) -> str:
    return f"{DB_URL}/{path.strip('/')}.json?auth={urllib.parse.quote(DB_SECRET)}"


def db_get(path: str):
    return _req(_db(path), method="GET")


def db_put(path: str, data) -> None:
    _req(_db(path), data=data, method="PUT")


def db_patch(path: str, data: dict) -> None:
    _req(_db(path), data=data, method="PATCH")


def db_delete(path: str) -> None:
    _req(_db(path), method="DELETE")


# ---- Firebase Authentication (Identity Toolkit REST) -------------------------
def auth_signup(email: str, password: str) -> dict:
    r = _req(f"{IDENTITY}:signUp?key={API_KEY}",
             {"email": email, "password": password, "returnSecureToken": True}, method="POST")
    return {"uid": r["localId"], "email": r["email"], "id_token": r["idToken"], "refresh_token": r.get("refreshToken")}


def auth_login(email: str, password: str) -> dict:
    r = _req(f"{IDENTITY}:signInWithPassword?key={API_KEY}",
             {"email": email, "password": password, "returnSecureToken": True}, method="POST")
    return {"uid": r["localId"], "email": r["email"], "id_token": r["idToken"], "refresh_token": r.get("refreshToken")}


def auth_refresh(refresh_token: str) -> dict:
    """Exchange a refresh token for a fresh idToken (Firebase Secure Token API). idTokens last 1 hour;
    this keeps a session alive without re-login."""
    r = _req(f"{SECURETOKEN}?key={API_KEY}",
             {"grant_type": "refresh_token", "refresh_token": refresh_token}, method="POST")
    return {"id_token": r["id_token"], "refresh_token": r.get("refresh_token", refresh_token),
            "uid": r.get("user_id")}


def auth_verify(id_token: str) -> dict:
    """Verify an idToken with Firebase and return {uid, email}. Raises FirebaseError if invalid/expired."""
    r = _req(f"{IDENTITY}:lookup?key={API_KEY}", {"idToken": id_token}, method="POST")
    users = (r or {}).get("users") or []
    if not users:
        raise FirebaseError("no such user", code="401")
    u = users[0]
    return {"uid": u["localId"], "email": u.get("email", "")}
