"""Request/response models for the public API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EventOut(BaseModel):
    """An event as the clients consume it."""

    model_config = ConfigDict(extra="ignore")

    id: str
    source: str
    url: str
    official_url: str | None = None
    verification_status: str | None = None
    first_seen_at: datetime | None = None
    source_published_at: datetime | None = None
    last_verified_at: datetime | None = None
    canonical_event_id: str | None = None
    title: str
    summary: str | None = None
    description: str | None = None
    image_url: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    timezone: str | None = None
    is_online: bool = False
    venue_name: str | None = None
    address: str | None = None
    city: str | None = None
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
    popularity: float = 0

    # ranking metadata, present on recommendation responses
    score: float | None = None
    similarity: float | None = None
    distance_km: float | None = None
    reason: str | None = None


class EventListOut(BaseModel):
    items: list[EventOut]
    count: int
    limit: int
    offset: int
    personalized: bool = False
    fallback: str | None = Field(
        default=None,
        description="Set when results came from a cold-start strategy instead of declared preferences.",
    )


class StatsOut(BaseModel):
    """Live catalogue figures, counted at request time."""

    model_config = ConfigDict(extra="ignore")

    events: int = 0
    sources: int = 0
    cities: int = 0
    interests: int = 0
    last_updated: datetime | None = None


class InterestOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    slug: str
    label: str
    category: str
    sort_order: int = 100


class ProfileOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    email: str | None = None
    full_name: str | None = None
    avatar_url: str | None = None
    city: str | None = None
    country: str | None = None
    lat: float | None = None
    lng: float | None = None
    radius_km: int = 40
    include_online: bool = True
    interest_text: str | None = None
    onboarded: bool = False
    digest_opt_in: bool = True


class MeOut(BaseModel):
    profile: ProfileOut
    interests: list[str] = Field(default_factory=list)


class ProfileUpdateIn(BaseModel):
    full_name: str | None = None
    city: str | None = None
    country: str | None = None
    lat: float | None = None
    lng: float | None = None
    radius_km: int | None = Field(default=None, ge=1, le=500)
    include_online: bool | None = None
    digest_opt_in: bool | None = None


class InterestsUpdateIn(BaseModel):
    interests: list[str] = Field(default_factory=list, max_length=60)
    interest_text: str | None = Field(default=None, max_length=2000)
    city: str | None = None
    mark_onboarded: bool = True


class PreviewIn(BaseModel):
    """Taste preview for logged-out visitors — the landing page demo."""

    interests: list[str] = Field(default_factory=list, max_length=60)
    interest_text: str | None = Field(default=None, max_length=2000)
    city: str | None = None
    limit: int = Field(default=12, ge=1, le=50)


class SaveIn(BaseModel):
    state: str = Field(default="saved", pattern="^(saved|going|dismissed)$")


class ClickIn(BaseModel):
    surface: str | None = Field(default=None, max_length=60)


class IngestIn(BaseModel):
    sources: list[str] | None = None
    cities: list[str] | None = None
    query: str | None = None
    limit_per_source: int | None = Field(default=None, ge=1, le=1000)


class IngestRunOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    source: str
    status: str
    found: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    error_text: str | None = None
    started_at: datetime
    finished_at: datetime | None = None


class MessageOut(BaseModel):
    ok: bool = True
    message: str | None = None
    data: dict[str, Any] | None = None
