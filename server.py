"""Deployment entrypoint for the Qwendo API.

Platforms that look for a single ASGI callable (Vercel's Python runtime,
Railway, Render, Fly) import `app` from here. Local development uses
`uvicorn api.main:app` directly — both resolve to the same application.
"""

from api.main import app

__all__ = ["app"]
