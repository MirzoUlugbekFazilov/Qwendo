"""Audit the outbound ticket links we store.

Two layers of checking:
  1. shape  — `core.links.classify_event_url` (is this an event page or a
     search page?). This also runs at ingest time, so stored rows should
     already be clean.
  2. liveness — an actual HTTP request following redirects, reporting the final
     status and host.

    python -m workers.run links              # sample across all sources
    python -m workers.run links -s luma -n 20
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from core.links import classify_event_url
from core.supabase import SupabaseClient, service_client
from workers.sources.base import BROWSER_HEADERS

log = logging.getLogger("qwendo.links")

CONCURRENCY = 6


@dataclass
class LinkCheck:
    source: str
    title: str
    url: str
    shape: str
    status: int | None = None
    final_host: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.shape == "direct" and self.status is not None and self.status < 400


async def _check(client: httpx.AsyncClient, row: dict, semaphore: asyncio.Semaphore) -> LinkCheck:
    check = LinkCheck(
        source=row["source"],
        title=row["title"],
        url=row["url"],
        shape=classify_event_url(row["source"], row["url"]),
    )
    if check.shape == "invalid":
        return check

    async with semaphore:
        try:
            # Some marketplaces reject HEAD; fall back to a ranged GET.
            response = await client.head(row["url"], follow_redirects=True)
            if response.status_code in (403, 405, 501):
                response = await client.get(
                    row["url"], follow_redirects=True, headers={"Range": "bytes=0-2048"}
                )
            check.status = response.status_code
            check.final_host = urlparse(str(response.url)).netloc
        except httpx.HTTPError as exc:
            check.error = type(exc).__name__
    return check


async def verify(
    db: SupabaseClient | None = None,
    sources: list[str] | None = None,
    limit: int = 30,
) -> list[LinkCheck]:
    owns_client = db is None
    db = db or service_client()
    try:
        filters: dict[str, str] = {"status": "neq.expired"}
        if sources:
            filters["source"] = f"in.({','.join(sources)})"

        rows = await db.select(
            "events",
            columns="source,title,url",
            filters=filters,
            order="starts_at.asc",
            limit=limit,
        ) or []

        semaphore = asyncio.Semaphore(CONCURRENCY)
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20), headers=BROWSER_HEADERS, follow_redirects=True
        ) as client:
            return await asyncio.gather(*(_check(client, row, semaphore) for row in rows))
    finally:
        if owns_client:
            await db.aclose()


def report(checks: list[LinkCheck]) -> int:
    """Print a summary. Returns the number of problem links."""
    if not checks:
        print("No events to check.")
        return 0

    by_source: dict[str, list[LinkCheck]] = {}
    for check in checks:
        by_source.setdefault(check.source, []).append(check)

    print(f"\n{'source':<14}{'checked':>8}{'direct':>8}{'live':>7}{'problems':>10}")
    print("-" * 47)
    problems: list[LinkCheck] = []
    for source, items in sorted(by_source.items()):
        direct = sum(1 for c in items if c.shape == "direct")
        live = sum(1 for c in items if c.ok)
        bad = [c for c in items if not c.ok]
        problems.extend(bad)
        print(f"{source:<14}{len(items):>8}{direct:>8}{live:>7}{len(bad):>10}")

    if problems:
        print("\nProblems:")
        for check in problems[:15]:
            reason = check.error or (f"HTTP {check.status}" if check.status else check.shape)
            print(f"  [{check.source}] {reason:<18} {check.title[:42]:<42} {check.url[:70]}")
    else:
        print("\nEvery checked link is a direct event page and responds OK.")

    return len(problems)
