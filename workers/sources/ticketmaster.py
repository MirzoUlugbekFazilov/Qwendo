"""Ticketmaster Discovery API v2.

Official, documented, and the most reliable source in the mix.
https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/

Contract details this client honours:
  * root https://app.ticketmaster.com/discovery/v2/, `apikey` as a query param
  * deep paging is capped: size * page must stay below 1000
  * rate limits: 5 requests/second, 5000 calls/day
  * `url` on each event is the exact Ticketmaster purchase page — that is what
    we store and what the "Get tickets" button opens
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode, urlsplit

from core.config import settings
from core.models import NormalizedEvent
from core.taxonomy import extract_tags, infer_categories, map_source_category
from core.text import (
    clean_title,
    make_summary,
    normalize_city,
    strip_html,
)
from workers.sources.base import EventSource
from workers.connectors.fetch import Fetcher, checked_url
from workers.connectors.parsers import instant
from workers.connectors.reviews import review

log = logging.getLogger("qwendo.sources.ticketmaster")

API_URL = "https://app.ticketmaster.com/discovery/v2/events.json"

PAGE_SIZE = 100
DEEP_PAGING_CAP = 1000  # size * page must stay under this

# Ticketmaster matches city names loosely, so pin the country too: without it
# "London" also returns London, Ontario.
CITY_COUNTRY = {
    "london": "GB",
    "manchester": "GB",
    "birmingham": "GB",
    "edinburgh": "GB",
    "glasgow": "GB",
    "bristol": "GB",
    "leeds": "GB",
    "liverpool": "GB",
    "dublin": "IE",
    "new york": "US",
    "los angeles": "US",
    "san francisco": "US",
    "chicago": "US",
    "miami": "US",
    "toronto": "CA",
    "vancouver": "CA",
    "berlin": "DE",
    "hamburg": "DE",
    "munich": "DE",
    "paris": "FR",
    "amsterdam": "NL",
    "madrid": "ES",
    "barcelona": "ES",
    "stockholm": "SE",
    "istanbul": "TR",
    "dubai": "AE",
    "sydney": "AU",
    "melbourne": "AU",
    "auckland": "NZ",
    "mexico city": "MX",
}

# dates.status.code → our status vocabulary
STATUS_MAP = {
    "onsale": "active",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "postponed": "postponed",
    "rescheduled": "postponed",
}


class TicketmasterSource(EventSource):
    slug = "ticketmaster"
    name = "Ticketmaster"
    homepage = "https://www.ticketmaster.com"
    requires_key = True

    def is_configured(self) -> bool:
        return bool(settings.ticketmaster_api_key)

    async def fetch(
        self,
        *,
        city: str | None = None,
        query: str | None = None,
        limit: int = 200,
        lookahead_days: int | None = None,
        allowed_hosts: frozenset[str] | None = None,
        review_source: dict | None = None,
    ) -> list[NormalizedEvent]:
        if not self.is_configured():
            log.info("Skipping Ticketmaster: TICKETMASTER_API_KEY is not set")
            return []

        now = datetime.now(timezone.utc)
        end = now + timedelta(days=lookahead_days or settings.ingest_lookahead_days)

        base_params: dict[str, Any] = {
            "apikey": settings.ticketmaster_api_key,
            "size": PAGE_SIZE,
            "sort": "date,asc",
            "startDateTime": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endDateTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            # Events without a confirmed date can't be recommended usefully.
            "includeTBA": "no",
            "includeTBD": "no",
            "includeTest": "no",
            "locale": "*",
        }
        if city:
            base_params["city"] = city
            country = CITY_COUNTRY.get(city.strip().lower())
            if country:
                base_params["countryCode"] = country
        if query:
            base_params["keyword"] = query

        events: list[NormalizedEvent] = []
        seen: set[str] = set()
        max_page = max(DEEP_PAGING_CAP // PAGE_SIZE - 1, 0)

        fetcher = Fetcher(["app.ticketmaster.com"])
        for page in range(max_page + 1):
            if len(events) >= limit:
                break
            params = {**base_params, "page": page}
            _, body = await fetcher.get(API_URL + "?" + urlencode(params), api=True)
            payload = json.loads(body)
            batch = (payload.get("_embedded") or {}).get("events") or []
            if not batch:
                break
            for raw in batch:
                if not isinstance(raw, dict):
                    continue
                normalized = self._normalize(raw, city, allowed_hosts=allowed_hosts)
                if normalized is None and review_source is not None:
                    review(review_source, "unusable_ticketmaster_record", raw.get("url"),
                           raw.get("name"), raw.get("id"))
                if normalized and normalized.external_id not in seen:
                    seen.add(normalized.external_id)
                    events.append(normalized)
            if page + 1 >= int((payload.get("page") or {}).get("totalPages") or 0):
                break

        log.info("Ticketmaster returned %s events for %s", len(events), city or "anywhere")
        return events[:limit]

    # ── normalization ───────────────────────────────────────────
    def _normalize(self, raw: dict[str, Any], fallback_city: str | None,
                   *, allowed_hosts=None) -> NormalizedEvent | None:
        try:
            # The purchase page. Without it the listing is useless to a user.
            url = raw.get("url")
            if not url or not raw.get("name") or not raw.get("id"):
                log.debug("Skipping Ticketmaster event %s: no ticket URL", raw.get("id"))
                return None

            dates = raw.get("dates") or {}
            if not checked_url(url, allowed_hosts if allowed_hosts is not None else {urlsplit(url).hostname}).path.strip("/"):
                return None
            code = (dates.get("status") or {}).get("code")
            if code not in STATUS_MAP:
                return None
            start = dates.get("start") or {}
            tz_name = dates.get("timezone")

            if any(start.get(flag) for flag in ("dateTBA", "dateTBD", "timeTBA", "noSpecificTime")):
                return None
            starts_at = instant(start.get("dateTime")) or instant(
                f"{start.get('localDate')}T{start.get('localTime')}", tz_name)
            if not starts_at:
                return None

            end = dates.get("end") or {}
            ends_at = instant(end.get("dateTime")) or instant(
                f"{end.get('localDate')}T{end.get('localTime')}", tz_name)

            embedded = raw.get("_embedded") or {}
            venues = (embedded.get("venues") or [{}])[0]
            location = venues.get("location") or {}
            address = venues.get("address") or {}
            attractions = [
                attraction.get("name")
                for attraction in (embedded.get("attractions") or [])
                if isinstance(attraction, dict) and attraction.get("name")
            ]

            classification = self._primary_classification(raw.get("classifications") or [])
            segment = (classification.get("segment") or {}).get("name")
            genre = (classification.get("genre") or {}).get("name")
            sub_genre = (classification.get("subGenre") or {}).get("name")

            price_min, price_max, currency = self._price_range(raw.get("priceRanges") or [])

            description = strip_html(
                raw.get("info") or raw.get("description") or raw.get("pleaseNote") or ""
            )
            title = clean_title(raw.get("name"))
            seed = [c for c in [map_source_category("ticketmaster", segment)] if c]
            signal = " ".join(filter(None, [title, genre, sub_genre, *attractions, description]))

            promoter = (raw.get("promoter") or {}).get("name")
            tz_name = tz_name or venues.get("timezone")

            return NormalizedEvent(
                source=self.slug,
                external_id=str(raw["id"]),
                url=url,
                title=title,
                description=description or None,
                summary=make_summary(description),
                image_url=None,
                starts_at=starts_at,
                ends_at=ends_at,
                timezone=tz_name,
                is_online=False,
                venue_name=venues.get("name"),
                address=" ".join(
                    filter(None, [address.get("line1"), address.get("line2")])
                ) or None,
                city=normalize_city((venues.get("city") or {}).get("name")),
                region=(venues.get("state") or {}).get("name"),
                country=(venues.get("country") or {}).get("countryCode"),
                lat=self._to_float(location.get("latitude")),
                lng=self._to_float(location.get("longitude")),
                price_min=price_min,
                price_max=price_max,
                currency=currency,
                is_free=price_min == 0,
                organizer=promoter,
                categories=infer_categories(
                    title, description, genre, sub_genre, " ".join(attractions), seed=seed
                ),
                tags=self._tags(genre, sub_genre, attractions, signal),
                # Ticketed, venue-scale events: a higher floor than community listings,
                # lifted when the event carries published pricing (a real on-sale).
                popularity=55.0 if price_min is not None else 45.0,
                status=STATUS_MAP[code],
                raw={
                    "segment": segment,
                    "genre": genre,
                    "subGenre": sub_genre,
                    "attractions": attractions[:5],
                    "venue": venues.get("name"),
                    "onsale": (raw.get("sales") or {}).get("public", {}).get("startDateTime"),
                },
            )
        except Exception as exc:  # noqa: BLE001 - one bad record must not kill the run
            log.debug("Skipping malformed Ticketmaster event %s: %s", raw.get("id"), exc)
            return None

    # ── helpers ─────────────────────────────────────────────────
    @staticmethod
    def _primary_classification(classifications: list[dict[str, Any]]) -> dict[str, Any]:
        for classification in classifications:
            if classification.get("primary"):
                return classification
        return classifications[0] if classifications else {}

    @staticmethod
    def _price_range(
        ranges: list[dict[str, Any]],
    ) -> tuple[float | None, float | None, str | None]:
        """Ticketmaster can return several bands (standard, VIP, resale)."""
        mins = [r["min"] for r in ranges if isinstance(r.get("min"), (int, float))]
        maxes = [r["max"] for r in ranges if isinstance(r.get("max"), (int, float))]
        currency = next((r.get("currency") for r in ranges if r.get("currency")), None)
        return (
            float(min(mins)) if mins else None,
            float(max(maxes)) if maxes else None,
            currency,
        )

    @staticmethod
    def _tags(
        genre: str | None, sub_genre: str | None, attractions: list[str], signal: str
    ) -> list[str]:
        tags: list[str] = []
        for value in [genre, sub_genre, *attractions[:3]]:
            if value and value.lower() not in {"undefined", "other"} and value not in tags:
                tags.append(value)
        for extra in extract_tags(signal, limit=8):
            if extra not in tags:
                tags.append(extra)
        return tags[:10]

    @staticmethod
    def _to_float(value: Any) -> float | None:
        try:
            return float(value) if value not in (None, "") else None
        except (TypeError, ValueError):
            return None
