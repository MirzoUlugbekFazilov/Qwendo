"""A thin async client for Supabase PostgREST + Auth.

We talk to PostgREST over plain HTTP instead of pulling in supabase-py: fewer
moving parts, full control over retries/timeouts, and the same client works for
both the request-scoped user token and the service-role key used by workers.
"""

from __future__ import annotations

from typing import Any, Iterable, Literal

import httpx

from core.config import settings


class SupabaseError(RuntimeError):
    """Raised when PostgREST or GoTrue answers with a non-2xx status."""

    def __init__(self, status_code: int, message: str, detail: Any = None) -> None:
        super().__init__(f"[{status_code}] {message}")
        self.status_code = status_code
        self.message = message
        self.detail = detail


class SupabaseClient:
    """PostgREST wrapper.

    Parameters
    ----------
    key:
        The API key sent as ``apikey``. Use the anon key for user-scoped calls
        and the service-role key for ingestion.
    access_token:
        A user JWT. When present it becomes the ``Authorization`` bearer, so RLS
        evaluates ``auth.uid()`` as that user.
    """

    def __init__(self, key: str | None = None, access_token: str | None = None) -> None:
        self.key = key or settings.supabase_anon_key
        self.access_token = access_token
        self._client: httpx.AsyncClient | None = None

    # ── plumbing ────────────────────────────────────────────────
    @property
    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.access_token or self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=settings.supabase_url.rstrip("/"),
                timeout=httpx.Timeout(settings.request_timeout_seconds),
                headers=self._headers,
            )
        return self._client

    def as_user(self, access_token: str | None) -> "SupabaseClient":
        """A view of this client that acts as a given user, sharing the HTTP pool."""
        if not access_token:
            return self
        clone = SupabaseClient(key=self.key, access_token=access_token)
        clone._client = self._client or self.client  # reuse the connection pool
        return clone

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        headers = dict(self._headers)
        if extra_headers:
            headers.update(extra_headers)

        response = await self.client.request(
            method, path, params=params, json=json, headers=headers
        )

        if response.status_code >= 400:
            try:
                payload = response.json()
                message = payload.get("message") or payload.get("msg") or response.text
            except Exception:  # noqa: BLE001 - non-JSON error bodies happen
                payload, message = None, response.text
            raise SupabaseError(response.status_code, message, payload)

        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    # ── PostgREST verbs ─────────────────────────────────────────
    async def select(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        single: bool = False,
    ) -> Any:
        params: dict[str, Any] = {"select": columns, **(filters or {})}
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = limit
        if offset:
            params["offset"] = offset

        headers = {"Accept": "application/vnd.pgrst.object+json"} if single else None
        try:
            return await self._request(
                "GET", f"/rest/v1/{table}", params=params, extra_headers=headers
            )
        except SupabaseError as exc:
            # PGRST116 == "0 rows returned" when a single object was requested
            if single and exc.status_code == 406:
                return None
            if single and isinstance(exc.detail, dict) and exc.detail.get("code") == "PGRST116":
                return None
            raise

    async def insert(
        self,
        table: str,
        rows: list[dict[str, Any]] | dict[str, Any],
        *,
        upsert: bool = False,
        on_conflict: str | None = None,
        returning: Literal["representation", "minimal"] = "representation",
        ignore_duplicates: bool = False,
    ) -> Any:
        if not rows:
            return []

        prefer = [f"return={returning}"]
        if upsert:
            prefer.append(
                "resolution=ignore-duplicates" if ignore_duplicates else "resolution=merge-duplicates"
            )
        params = {"on_conflict": on_conflict} if on_conflict else None

        return await self._request(
            "POST",
            f"/rest/v1/{table}",
            params=params,
            json=rows,
            extra_headers={"Prefer": ",".join(prefer)},
        )

    async def update(
        self,
        table: str,
        values: dict[str, Any],
        *,
        filters: dict[str, str],
        returning: Literal["representation", "minimal"] = "representation",
    ) -> Any:
        return await self._request(
            "PATCH",
            f"/rest/v1/{table}",
            params=filters,
            json=values,
            extra_headers={"Prefer": f"return={returning}"},
        )

    async def delete(self, table: str, *, filters: dict[str, str]) -> Any:
        return await self._request(
            "DELETE",
            f"/rest/v1/{table}",
            params=filters,
            extra_headers={"Prefer": "return=minimal"},
        )

    async def rpc(self, function: str, payload: dict[str, Any] | None = None) -> Any:
        return await self._request("POST", f"/rest/v1/rpc/{function}", json=payload or {})

    # ── GoTrue ──────────────────────────────────────────────────
    async def get_user(self, access_token: str) -> dict[str, Any] | None:
        """Validate a user JWT against GoTrue and return the user record."""
        try:
            return await self._request(
                "GET",
                "/auth/v1/user",
                extra_headers={"Authorization": f"Bearer {access_token}"},
            )
        except SupabaseError as exc:
            if exc.status_code in (401, 403):
                return None
            raise


def service_client() -> SupabaseClient:
    """Client that bypasses RLS. Server-side only."""
    if not settings.has_service_role:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env "
            "(Supabase dashboard → Project Settings → API Keys → service_role)."
        )
    return SupabaseClient(key=settings.supabase_service_role_key)


def anon_client(access_token: str | None = None) -> SupabaseClient:
    return SupabaseClient(key=settings.supabase_anon_key, access_token=access_token)


def chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]
