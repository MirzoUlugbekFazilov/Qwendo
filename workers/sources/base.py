"""Contract every event source implements."""

from __future__ import annotations

import abc
import logging
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from core.config import settings
from core.models import NormalizedEvent

log = logging.getLogger("qwendo.sources")

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-GB,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
}


class SourceNotConfigured(RuntimeError):
    """Raised when a source needs credentials that are missing."""


class EventSource(abc.ABC):
    """A marketplace we pull events from.

    Implementations are responsible for paging and for turning whatever shape
    the upstream returns into `NormalizedEvent`s. They must never raise for a
    single bad record — skip it and keep going.
    """

    slug: str = "base"
    name: str = "Base"
    homepage: str = ""
    requires_key: bool = False

    def is_configured(self) -> bool:
        return True

    @abc.abstractmethod
    async def fetch(
        self,
        *,
        city: str | None = None,
        query: str | None = None,
        limit: int = 200,
        lookahead_days: int | None = None,
    ) -> list[NormalizedEvent]:
        """Return up to `limit` upcoming events for `city`."""

    # ── shared HTTP helpers ─────────────────────────────────────
    @staticmethod
    def http_client(**kwargs: Any) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(settings.request_timeout_seconds),
            headers=BROWSER_HEADERS,
            follow_redirects=True,
            **kwargs,
        )

    @staticmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
        reraise=True,
    )
    async def get(client: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
        """GET with exponential backoff on transport-level failures."""
        response = await client.get(url, **kwargs)
        if response.status_code == 429:
            log.warning("Rate limited by %s", url)
        return response


async def render_with_playwright(url: str, wait_selector: str | None = None) -> str | None:
    """Last-resort HTML fetch for JS-rendered pages.

    Returns None (rather than raising) when Playwright isn't installed, so a
    missing optional dependency degrades the source instead of the whole run.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        log.warning("Playwright not installed; skipping rendered fetch for %s", url)
        return None

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                page = await browser.new_page(user_agent=BROWSER_HEADERS["User-Agent"])
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                if wait_selector:
                    try:
                        await page.wait_for_selector(wait_selector, timeout=10_000)
                    except Exception:  # noqa: BLE001 - selector is a best-effort hint
                        pass
                await page.wait_for_timeout(1_500)
                return await page.content()
            finally:
                await browser.close()
    except Exception as exc:  # noqa: BLE001 - browser automation fails in many ways
        log.warning("Playwright render failed for %s: %s", url, exc)
        return None
