"""Luma (lu.ma).

Luma's city pages are Next.js apps, so the full event list is already in the
`__NEXT_DATA__` JSON island. Rather than hard-coding a path into that blob
(which Luma reshuffles often), we walk the tree and pick up anything that looks
like an event record. Tolerant beats precise for scrapers.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Iterator

from core.models import NormalizedEvent
from core.taxonomy import extract_tags, infer_categories
from core.text import clean_title, make_summary, normalize_city, parse_datetime, strip_html
from workers.sources.base import EventSource, render_with_playwright

log = logging.getLogger("qwendo.sources.luma")

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>', re.S
)

CITY_SLUGS = {
    "london": "london",
    "manchester": "manchester",
    "new york": "nyc",
    "san francisco": "sf",
    "berlin": "berlin",
    "paris": "paris",
    "amsterdam": "amsterdam",
    "dubai": "dubai",
    "singapore": "singapore",
    "bangalore": "bangalore",
    "tashkent": "tashkent",
}


class LumaSource(EventSource):
    slug = "luma"
    name = "Luma"
    homepage = "https://lu.ma"

    def _city_slug(self, city: str | None) -> str:
        if not city:
            return "london"
        return CITY_SLUGS.get(city.strip().lower(), city.strip().lower().replace(" ", "-"))

    async def fetch(
        self,
        *,
        city: str | None = None,
        query: str | None = None,
        limit: int = 200,
        lookahead_days: int | None = None,
    ) -> list[NormalizedEvent]:
        url = f"{self.homepage}/{self._city_slug(city)}"

        html: str | None = None
        async with self.http_client() as client:
            try:
                response = await self.get(client, url)
                if response.status_code == 200:
                    html = response.text
                else:
                    log.warning("Luma %s for %s", response.status_code, url)
            except Exception as exc:  # noqa: BLE001
                log.warning("Luma request failed (%s): %s", url, exc)

        payload = self._extract_payload(html)
        if payload is None:
            log.info("Falling back to Playwright for %s", url)
            payload = self._extract_payload(await render_with_playwright(url))
        if payload is None:
            return []

        events: list[NormalizedEvent] = []
        seen: set[str] = set()
        for record in self._walk_events(payload):
            external_id = str(record.get("api_id") or "")
            if not external_id or external_id in seen:
                continue
            seen.add(external_id)

            normalized = self._normalize(record, city)
            if normalized:
                if query and query.lower() not in f"{normalized.title} {normalized.description or ''}".lower():
                    continue
                events.append(normalized)
            if len(events) >= limit:
                break

        return events

    # ── payload plumbing ────────────────────────────────────────
    @staticmethod
    def _extract_payload(html: str | None) -> dict[str, Any] | None:
        if not html:
            return None
        match = NEXT_DATA_RE.search(html)
        if not match:
            return None
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            log.warning("Could not decode Luma __NEXT_DATA__")
            return None

    @classmethod
    def _walk_events(cls, node: Any, depth: int = 0) -> Iterator[dict[str, Any]]:
        """Yield Luma event records, merged with their listing wrapper.

        The page nests each event inside an entry that also carries the host
        calendar, ticket info and guest count — all of which we want, so we
        flatten the wrapper onto the event rather than walking past it.
        """
        if depth > 12:
            return
        if isinstance(node, dict):
            event = node.get("event")
            if isinstance(event, dict) and event.get("api_id") and event.get("name"):
                yield {
                    **event,
                    "calendar": node.get("calendar"),
                    "hosts": node.get("hosts"),
                    "ticket_info": node.get("ticket_info"),
                    "guest_count": node.get("guest_count"),
                }
                return
            if node.get("api_id") and node.get("name") and (node.get("start_at") or node.get("start_time")):
                yield node
                return
            for value in node.values():
                yield from cls._walk_events(value, depth + 1)
        elif isinstance(node, list):
            for item in node:
                yield from cls._walk_events(item, depth + 1)

    # ── normalization ───────────────────────────────────────────
    def _normalize(self, raw: dict[str, Any], fallback_city: str | None) -> NormalizedEvent | None:
        try:
            starts_at = parse_datetime(raw.get("start_at") or raw.get("start_time"))
            if not starts_at:
                return None

            geo = raw.get("geo_address_info") or {}
            coordinate = raw.get("coordinate") or {}
            title = clean_title(raw.get("name"))
            description = strip_html(raw.get("description") or raw.get("description_short") or "")
            slug = raw.get("url") or raw.get("api_id")

            ticket_info = raw.get("ticket_info") or {}
            price = ticket_info.get("price") or {}
            cents = price.get("cents")
            amount = (cents / 100) if isinstance(cents, (int, float)) else None

            hosts = raw.get("hosts") or []
            organizer = (raw.get("calendar") or {}).get("name") or (
                hosts[0].get("name") if hosts and isinstance(hosts[0], dict) else None
            )

            is_online = raw.get("location_type") == "virtual" or geo.get("mode") == "virtual"
            guests = raw.get("guest_count") or 0

            return NormalizedEvent(
                source=self.slug,
                external_id=str(raw["api_id"]),
                url=f"{self.homepage}/{slug}" if not str(slug).startswith("http") else str(slug),
                title=title,
                description=description or None,
                summary=make_summary(description),
                image_url=raw.get("cover_url") or raw.get("social_image_url"),
                starts_at=starts_at,
                ends_at=parse_datetime(raw.get("end_at") or raw.get("end_time")),
                timezone=raw.get("timezone"),
                is_online=bool(is_online),
                venue_name=geo.get("address") or geo.get("name"),
                address=geo.get("full_address"),
                city=normalize_city(geo.get("city") or geo.get("city_state") or fallback_city),
                region=geo.get("region"),
                country=geo.get("country_code") or geo.get("country"),
                lat=float(coordinate["latitude"]) if coordinate.get("latitude") else None,
                lng=float(coordinate["longitude"]) if coordinate.get("longitude") else None,
                price_min=amount,
                price_max=amount,
                currency=(price.get("currency") or "").upper() or None,
                is_free=bool(ticket_info.get("is_free")) or cents == 0,
                organizer=organizer,
                categories=infer_categories(title, description, organizer),
                tags=extract_tags(f"{title} {description} {organizer or ''}", limit=8),
                popularity=float(min(guests / 5, 60)),
                status="active",
                raw={"calendar": organizer, "event_type": raw.get("event_type")},
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("Skipping malformed Luma event: %s", exc)
            return None
