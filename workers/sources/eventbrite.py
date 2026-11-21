"""Eventbrite.

Eventbrite retired public search from their REST API, so we read the JSON the
search page already ships to the browser. Two islands carry it —
`window.__SERVER_DATA__` and `window.__REACT_QUERY_STATE__` — both inside the
same <script>, which is why we decode with a brace-accurate scanner rather than
a regex that would run from one variable into the next.

Verified against the live page shape on 2026-11-21:
  search_data.events.results[] → {id, name, url, summary, start_date,
  start_time, timezone, image, primary_venue, tags, is_online_event, …}
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Iterator

from core.models import NormalizedEvent
from core.taxonomy import extract_tags, infer_categories, map_source_category
from core.text import (
    clean_title,
    make_summary,
    normalize_city,
    parse_local_datetime,
    strip_html,
)
from workers.sources.base import EventSource, render_with_playwright

log = logging.getLogger("qwendo.sources.eventbrite")

DECODER = json.JSONDecoder()
MAX_PAGES = 15

# Eventbrite slugs: country--city. Extend as you open new markets.
CITY_SLUGS = {
    "london": "united-kingdom--london",
    "manchester": "united-kingdom--manchester",
    "birmingham": "united-kingdom--birmingham",
    "edinburgh": "united-kingdom--edinburgh",
    "bristol": "united-kingdom--bristol",
    "new york": "ny--new-york",
    "san francisco": "ca--san-francisco",
    "berlin": "germany--berlin",
    "paris": "france--paris",
    "amsterdam": "netherlands--amsterdam",
    "dubai": "united-arab-emirates--dubai",
    "tashkent": "uzbekistan--tashkent",
}


class EventbriteSource(EventSource):
    slug = "eventbrite"
    name = "Eventbrite"
    homepage = "https://www.eventbrite.com"

    def _city_slug(self, city: str | None) -> str:
        if not city:
            return CITY_SLUGS["london"]
        return CITY_SLUGS.get(city.strip().lower(), city.strip().lower().replace(" ", "-"))

    async def fetch(
        self,
        *,
        city: str | None = None,
        query: str | None = None,
        limit: int = 200,
        lookahead_days: int | None = None,
    ) -> list[NormalizedEvent]:
        slug = self._city_slug(city)
        segment = query.strip().replace(" ", "-") if query else "all-events"
        base = f"https://www.eventbrite.co.uk/d/{slug}/{segment}/"

        events: list[NormalizedEvent] = []
        seen: set[str] = set()

        async with self.http_client() as client:
            for page in range(1, MAX_PAGES + 1):
                if len(events) >= limit:
                    break

                url = f"{base}?page={page}"
                html: str | None = None
                try:
                    response = await self.get(client, url)
                    if response.status_code == 200:
                        html = response.text
                    else:
                        log.warning("Eventbrite %s for %s", response.status_code, url)
                except Exception as exc:  # noqa: BLE001
                    log.warning("Eventbrite request failed (%s): %s", url, exc)

                results = self._results_from(html)
                if not results and page == 1:
                    log.info("Falling back to Playwright for %s", url)
                    results = self._results_from(
                        await render_with_playwright(url, wait_selector="[data-event-id]")
                    )
                if not results:
                    break

                before = len(events)
                for raw in results:
                    external_id = str(raw.get("id") or raw.get("eid") or "")
                    if not external_id or external_id in seen:
                        continue
                    seen.add(external_id)
                    normalized = self._normalize(raw, city)
                    if normalized:
                        events.append(normalized)

                if len(events) == before:  # page produced nothing new → stop paging
                    break

        return events[:limit]

    # ── payload plumbing ────────────────────────────────────────
    @staticmethod
    def _json_islands(html: str) -> Iterator[dict[str, Any]]:
        """Decode every `window.__X__ = {…}` blob, stopping at its own closing brace."""
        for match in re.finditer(r"window\.(__[A-Z_]+__)\s*=\s*(?=\{)", html):
            try:
                payload, _ = DECODER.raw_decode(html[match.end() :])
            except json.JSONDecodeError:
                log.debug("Could not decode %s", match.group(1))
                continue
            if isinstance(payload, dict):
                yield payload

    @classmethod
    def _walk_results(cls, node: Any, depth: int = 0) -> Iterator[dict[str, Any]]:
        """Find event records wherever Eventbrite moves them next."""
        if depth > 12:
            return
        if isinstance(node, dict):
            if node.get("id") and node.get("name") and node.get("start_date"):
                yield node
                return
            for value in node.values():
                yield from cls._walk_results(value, depth + 1)
        elif isinstance(node, list):
            for item in node:
                yield from cls._walk_results(item, depth + 1)

    @classmethod
    def _results_from(cls, html: str | None) -> list[dict[str, Any]]:
        if not html:
            return []

        for payload in cls._json_islands(html):
            # Fast path: the documented location.
            results = (
                ((payload.get("search_data") or {}).get("events") or {}).get("results")
            )
            if isinstance(results, list) and results:
                return results

            # Slow path: hunt for the records anywhere in the tree.
            found = list(cls._walk_results(payload))
            if found:
                return found
        return []

    # ── normalization ───────────────────────────────────────────
    def _normalize(self, raw: dict[str, Any], fallback_city: str | None) -> NormalizedEvent | None:
        try:
            tz_name = raw.get("timezone")
            starts_at = parse_local_datetime(raw.get("start_date"), raw.get("start_time"), tz_name)
            if not starts_at:
                return None

            venue = raw.get("primary_venue") or {}
            address = venue.get("address") or {}

            title = clean_title(raw.get("name"))
            description = strip_html(raw.get("full_description") or raw.get("summary") or "")

            # tags arrive as {prefix: "EventbriteCategory", display_name: "Music"}
            category: str | None = None
            labels: list[str] = []
            for tag in raw.get("tags") or []:
                if not isinstance(tag, dict):
                    continue
                label = tag.get("display_name")
                if not label:
                    continue
                prefix = tag.get("prefix") or ""
                if prefix == "EventbriteCategory" and category is None:
                    category = label
                if label.lower() not in {"other"}:
                    labels.append(label)

            seed = [c for c in [map_source_category("eventbrite", category)] if c]
            image = raw.get("image") or {}
            image_url = (image.get("original") or {}).get("url") or image.get("url")

            city_value = address.get("city") or self._locality(raw) or fallback_city
            latitude, longitude = address.get("latitude"), address.get("longitude")

            return NormalizedEvent(
                source=self.slug,
                external_id=str(raw.get("id") or raw.get("eid")),
                url=raw.get("url") or raw.get("tickets_url") or self.homepage,
                title=title,
                description=description or None,
                summary=make_summary(description) or strip_html(raw.get("summary")) or None,
                image_url=image_url,
                starts_at=starts_at,
                ends_at=parse_local_datetime(raw.get("end_date"), raw.get("end_time"), tz_name),
                timezone=tz_name,
                is_online=bool(raw.get("is_online_event")),
                venue_name=venue.get("name"),
                address=address.get("localized_address_display"),
                city=normalize_city(city_value),
                region=address.get("region") or None,
                country=address.get("country"),
                lat=float(latitude) if latitude else None,
                lng=float(longitude) if longitude else None,
                # The search payload carries no pricing; the detail page does.
                price_min=None,
                price_max=None,
                currency=None,
                is_free=False,
                organizer=raw.get("tickets_by"),
                categories=infer_categories(
                    title, description, category, " ".join(labels), seed=seed
                ),
                tags=labels[:8] or extract_tags(f"{title} {description}", limit=8),
                popularity=20.0 + (10.0 if (raw.get("urgency_signals") or {}).get("messages") else 0.0),
                status="cancelled" if raw.get("is_cancelled") else "active",
                raw={"category": category, "series_id": raw.get("series_id")},
            )
        except Exception as exc:  # noqa: BLE001 - one bad record must not kill the run
            log.debug("Skipping malformed Eventbrite event: %s", exc)
            return None

    @staticmethod
    def _locality(raw: dict[str, Any]) -> str | None:
        for location in raw.get("locations") or []:
            if isinstance(location, dict) and location.get("type") == "locality":
                return location.get("name")
        return None
