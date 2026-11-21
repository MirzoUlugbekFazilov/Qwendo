"""The normalized event contract every scraper must produce."""

from __future__ import annotations

from datetime import datetime, timezone as dt_timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator

from core.text import content_hash, to_iso


class NormalizedEvent(BaseModel):
    """One event, source-agnostic. Maps 1:1 onto public.events."""

    source: str
    external_id: str
    url: str
    title: str
    description: str | None = None
    summary: str | None = None
    image_url: str | None = None

    starts_at: datetime
    ends_at: datetime | None = None
    timezone: str | None = None

    is_online: bool = False
    venue_name: str | None = None
    address: str | None = None
    city: str | None = None
    region: str | None = None
    country: str | None = None
    lat: float | None = None
    lng: float | None = None

    price_min: float | None = None
    price_max: float | None = None
    currency: str | None = None
    is_free: bool = False

    organizer: str | None = None
    categories: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    popularity: float = 0.0
    status: str = "active"
    raw: dict[str, Any] | None = None

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("event title cannot be empty")
        return value

    @property
    def fingerprint(self) -> str:
        """Changes only when user-visible content changes → cheap re-embed guard."""
        return content_hash(
            self.title,
            self.description,
            to_iso(self.starts_at),
            self.summary,
            self.organizer,
            to_iso(self.ends_at) if self.ends_at else None,
            self.address,
            self.venue_name,
            self.city,
            self.price_min,
            self.status,
            ",".join(sorted(self.categories)),
        )

    def to_row(self, *, embedding: str | None = None) -> dict[str, Any]:
        now = datetime.now(dt_timezone.utc).isoformat()
        row: dict[str, Any] = {
            "source": self.source,
            "external_id": self.external_id,
            "url": self.url,
            "title": self.title,
            "description": self.description,
            "summary": self.summary,
            "image_url": self.image_url,
            "starts_at": to_iso(self.starts_at),
            "ends_at": to_iso(self.ends_at),
            "timezone": self.timezone,
            "is_online": self.is_online,
            "venue_name": self.venue_name,
            "address": self.address,
            "city": self.city,
            "region": self.region,
            "country": self.country,
            "lat": self.lat,
            "lng": self.lng,
            "price_min": self.price_min,
            "price_max": self.price_max,
            "currency": self.currency,
            "is_free": self.is_free,
            "organizer": self.organizer,
            "categories": self.categories,
            "tags": self.tags,
            "popularity": self.popularity,
            "status": self.status,
            "content_hash": self.fingerprint,
            "raw": self.raw,
            "last_seen_at": now,
        }
        if embedding is not None:
            row["embedding"] = embedding
            row["embedded_at"] = now
        return row
