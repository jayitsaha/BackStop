"""Vercel serverless entrypoint for the Backstop FastAPI backend.

Vercel's `@vercel/python` runtime wraps the module-level ASGI callable named `app`.
The real app (api.main:app) defines its routes at the root (/health, /listings, ...),
but the browser calls them under the `/api/*` prefix (same-origin, routed here by
vercel.json). This thin ASGI wrapper strips a leading `/api` so the existing routes
match unchanged — and forwards the `lifespan` scope untouched so startup still runs
wherever the platform supports it. Seeding is ALSO guarded lazily in api.main, so the
app is correct even if the platform skips lifespan events.
"""
from __future__ import annotations

from api.main import app as _app

_PREFIX = "/api"


async def app(scope, receive, send):  # ASGI 3 application
    if scope.get("type") in ("http", "websocket"):
        path = scope.get("path", "") or ""
        if path == _PREFIX or path.startswith(_PREFIX + "/"):
            scope = dict(scope)
            scope["path"] = path[len(_PREFIX):] or "/"
            raw = scope.get("raw_path")
            if isinstance(raw, (bytes, bytearray)) and raw.startswith(_PREFIX.encode()):
                scope["raw_path"] = raw[len(_PREFIX):] or b"/"
    await _app(scope, receive, send)
