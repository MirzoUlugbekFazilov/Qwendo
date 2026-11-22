"""Authorised deterministic discovery.

await discover(registry_row, limit=50) -> list[NormalizedEvent]
source is the registry slug and url is the publisher's event listing URL.
config.listing_only=true sets raw.listing_only=true so persistence keeps official_url null.
For RSS/iCal, config.city can label a matching locality explicitly stated in LOCATION.
The iCal limit reserves space for upcoming cancellations, then one upcoming session
per series or title and venue, then additional sessions in chronological order.
Wrap discover in collect_reviews() to retain bounded incomplete observations. Its rows
survive VerificationFailure and match the discovery_reviews listing/evidence shape.
raw.source_published_at is optional. Persistence assigns discovery time and verification status.

Each enabled source needs permission evidence, an HTTPS URL and exact allowed_hosts.
For rss/ical use the feed itself; jsonld uses the authorised page. config.page_fallback
allows RSS links to be read and HTML event microdata to be used when permission covers pages.
For search, url is BRAVE_URL and config.query is required. Authorise the provider and
each publisher host explicitly. BRAVE_SEARCH_API_KEY is read from the server environment.
For ticketmaster, url is the Discovery events endpoint and config accepts city, query,
lookahead_days. TICKETMASTER_API_KEY is server-side. Include permitted listing hosts.
"""

import asyncio
import json
import os
import re
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urlencode

from core.models import NormalizedEvent
from .fetch import Fetcher, checked_url
from .parsers import ical, jsonld, rss
from .reviews import collect_reviews, review, VerificationFailure

BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"


def allowed_detail(url, hosts):
    try:
        return bool(checked_url(url, hosts).path.strip("/"))
    except ValueError:
        return False


def location_contains_city(location, city):
    def fold(value):
        return "".join(char for char in unicodedata.normalize("NFKD", value.casefold())
                       if not unicodedata.combining(char)).strip()

    # Compare whole locality components, including e.g. "8001 Zürich".
    # A city inside a venue name or a street name is insufficient evidence.
    for component in re.split(r"[,;\n]", location or ""):
        locality = re.sub(r"^(?:[a-z]{2}-)?\d{4,6}\s+", "", fold(component))
        if locality == fold(city):
            return True
    return False


def select_sessions(events, limit, now):
    def order(event):
        return event.starts_at.astimezone(timezone.utc), event.external_id

    cancellations, first, extra = [], [], []
    ids, groups = set(), set()
    upcoming = sorted((e for e in events if e and e.starts_at >= now),
                      key=lambda e: (e.status != "cancelled", *order(e)))
    for event in upcoming:
        if event.external_id in ids:
            continue
        ids.add(event.external_id)
        if event.status == "cancelled":
            cancellations.append(event)
            continue
        series = (event.raw or {}).get("ical_series_uid")
        group = (series,) if series else tuple(" ".join(value.casefold().split())
                                              for value in (event.title, event.venue_name or ""))
        if group in groups:
            extra.append(event)
        else:
            groups.add(group)
            first.append(event)
    return sorted((cancellations + first + extra)[:limit], key=order)


async def discover(source_row: dict, *, limit: int = 50) -> list[NormalizedEvent]:
    if (source_row.get("enabled") is not True or not (source_row.get("permission") or "").strip()
            or limit <= 0):
        return []
    with collect_reviews() as reviews:
        async with asyncio.timeout(90):
            events = await _discover(source_row, min(limit, 200))
        if not events and source_row["kind"] == "jsonld" and not reviews:
            review(source_row, "missing_event_evidence", source_row["url"])
        if not events and reviews:
            raise VerificationFailure(f"No usable event evidence ({reviews[0]['reason']})")
    config = source_row.get("config") or {}
    for event in events:
        if config.get("listing_only") is True:
            event.raw = {**(event.raw or {}), "listing_only": True}
        city = config.get("city")
        if (source_row["kind"] in {"ical", "rss"} and not event.city and not event.is_online
                and isinstance(city, str) and city.strip() and location_contains_city(event.venue_name, city)):
            event.city = city.strip()
    return events


async def _discover(row, limit):
    kind, url, config = row["kind"], row["url"], row.get("config") or {}
    fetcher = Fetcher(row["allowed_hosts"])
    checked_url(url, fetcher.hosts)
    if kind == "ticketmaster":
        from workers.sources.ticketmaster import API_URL, TicketmasterSource
        if url != API_URL:
            raise ValueError("Expected official Ticketmaster Discovery endpoint")
        provider = TicketmasterSource()
        if not provider.is_configured():
            raise ValueError("Ticketmaster credentials missing")
        events = await provider.fetch(city=config.get("city"), query=config.get("query"),
                                      limit=limit, lookahead_days=config.get("lookahead_days"),
                                      allowed_hosts=fetcher.hosts, review_source=row)
        return [e.model_copy(update={"source": row["slug"]}) for e in events]

    results, seen = [], set()

    def collect(events):
        for item in events:
            if item and item.external_id not in seen:
                seen.add(item.external_id)
                results.append(item)
                if len(results) >= limit:
                    break

    if kind == "search":
        if url != BRAVE_URL or not isinstance(config.get("query"), str) or not config["query"].strip():
            raise ValueError("Expected official Brave endpoint and a search query")
        key = os.environ.get("BRAVE_SEARCH_API_KEY")
        if not key:
            raise ValueError("Brave Search credentials missing")
        params = urlencode({"q": config["query"], "count": min(limit, 20)})
        _, body = await fetcher.get(url + "?" + params, api=True, headers={"X-Subscription-Token": key})
        candidates = (r.get("url") for r in json.loads(body).get("web", {}).get("results", [])
                      if isinstance(r, dict))
    elif kind in {"jsonld", "ical", "rss"}:
        page, body = await fetcher.get(url)
        if kind == "jsonld":
            collect(jsonld(body, row, page))
            return results
        if kind == "ical":
            return select_sessions(ical(body, row), limit, datetime.now(timezone.utc))
        candidates = []
        for link, item in rss(body, row):
            if item:
                collect([item])
            elif config.get("page_fallback") is True:
                candidates.append(link)
            if len(results) >= limit:
                return results
    else:
        raise ValueError("Unknown discovery source kind")

    visited = set()
    detail_hosts = fetcher.hosts - {"api.search.brave.com"}
    for link in candidates:
        if not allowed_detail(link, detail_hosts) or link in visited:
            continue
        if len(visited) >= 20 or len(results) >= limit:
            break
        visited.add(link)
        page, body = await fetcher.get(link)
        parsed = [event for event in jsonld(body, row, page) if event]
        if not parsed:
            review(row, "missing_event_evidence", page)
        collect(parsed)
    return results
