"""Shared FastAPI dependencies: database handles and auth."""

from __future__ import annotations

import time
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, status

from core.config import settings
from core.supabase import SupabaseClient, anon_client, service_client

# One client (and therefore one connection pool) per role, created lazily.
_service: SupabaseClient | None = None
_anon: SupabaseClient | None = None

# GoTrue token validation is a network hop; cache verified tokens briefly.
_USER_CACHE_TTL = 60.0
_user_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def get_service_db() -> SupabaseClient:
    global _service
    if _service is None:
        _service = service_client()
    return _service


def get_anon_db() -> SupabaseClient:
    global _anon
    if _anon is None:
        _anon = anon_client()
    return _anon


def get_db() -> SupabaseClient:
    """Preferred read/write handle: service role when configured, anon otherwise."""
    return get_service_db() if settings.has_service_role else get_anon_db()


async def close_clients() -> None:
    for client in (_service, _anon):
        if client is not None:
            await client.aclose()


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


async def get_optional_user(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any] | None:
    """Resolve the caller from a Supabase JWT, or None when anonymous."""
    token = _bearer(authorization)
    if not token:
        return None

    cached = _user_cache.get(token)
    now = time.monotonic()
    if cached and cached[0] > now:
        return cached[1]

    user = await get_anon_db().get_user(token)
    if not user:
        return None

    user = {**user, "access_token": token}
    _user_cache[token] = (now + _USER_CACHE_TTL, user)
    if len(_user_cache) > 2000:  # keep the cache from growing without bound
        for key in list(_user_cache)[:500]:
            _user_cache.pop(key, None)
    return user


async def get_current_user(
    user: Annotated[dict[str, Any] | None, Depends(get_optional_user)],
) -> dict[str, Any]:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to use this endpoint.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_ingest_token(
    x_ingest_token: Annotated[str | None, Header()] = None,
) -> None:
    if not settings.ingest_token or settings.ingest_token == "change-me-in-production":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INGEST_TOKEN is not configured on the server.",
        )
    if x_ingest_token != settings.ingest_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid ingest token.")


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]
OptionalUser = Annotated[dict[str, Any] | None, Depends(get_optional_user)]
Db = Annotated[SupabaseClient, Depends(get_db)]
