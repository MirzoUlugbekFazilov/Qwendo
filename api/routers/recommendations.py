"""The core of Qwendo: personalised event recommendations."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query

from api.deps import CurrentUser, Db
from api.discovery_ranking import miles, norm, rank_events
from api.routers.discovery import account_db
from api.catalogue import literal, overlap
from api.discovery_candidates import HISTORY_COLUMNS, load_candidates, origin_for
from api.routers.picks import pages
from api.schemas import EventListOut, EventOut, PreviewIn
from api.services import fetch_interests, get_profile, legacy_preferences, preference_profile

router = APIRouter(tags=["recommendations"])


async def _confirmed_profile(db, uid):
    row = await db.select("user_discovery_profiles", columns="profile",
                          filters={"user_id": f"eq.{uid}"}, single=True)
    return row["profile"] if row else None


async def _structured_rank(db, uid, profile, *, event_id=None, city=None, categories=None,
                           sources=None, starts_after=None, starts_before=None, free_only=False,
                           max_price=None, radius_km=None, candidate_limit=300):
    now = datetime.now(UTC)
    filters = {}
    if starts_after and starts_after.astimezone(UTC) > now:
        filters["starts_at"] = f"gte.{starts_after.astimezone(UTC).isoformat()}"
    if categories:
        filters["categories"] = overlap(categories)
    if sources:
        filters["source"] = "in.(" + ",".join(map(literal, sources)) + ")"
    if max_price is not None:
        filters["price_min"] = f"lte.{max_price}"
    if starts_before:
        filters["and"] = f"(starts_at.lte.{starts_before.isoformat()})"
    if event_id:
        filters["id"] = f"eq.{event_id}"
    if free_only:
        filters["is_free"] = "eq.true"
    history, location = await asyncio.gather(
        pages(db, "saved_events", HISTORY_COLUMNS, {"user_id": f"eq.{uid}"}, "event_id"),
        db.select("profiles", columns="city,lat,lng", filters={"id": f"eq.{uid}"}, single=True),
    )
    effective = dict(profile)
    if city:
        effective.update(city=city, flexible_travel=False)
    origin = origin_for(effective, location)
    if radius_km is not None:
        effective.update(radius=radius_km / 1.609344, flexible_travel=False)
    events = await load_candidates(db, effective, now, origin=origin, filters=filters, limit=candidate_limit)

    def requested(event):
        if categories and not set(categories).intersection(event.get("categories") or []):
            return False
        if sources and event["source"] not in sources:
            return False
        if max_price is not None and event.get("price_min") is not None and event["price_min"] > max_price:
            return False
        if not event.get("is_online"):
            if city and norm(city) != norm(event.get("city")):
                return False
            distance = miles(origin, event) if radius_km is not None else None
            if distance is not None and distance > effective["radius"]:
                return False
        return True

    return rank_events([e for e in events if requested(e)], effective, history, now, origin)


@router.get("/me/relevance/{event_id}")
async def relevance(user: CurrentUser, event_id: str):
    db = account_db(user)
    profile = await _confirmed_profile(db, user["id"])
    if profile is None:
        profile = await legacy_preferences(db, user["id"], await get_profile(db, user))
    items = await _structured_rank(db, user["id"], profile, event_id=event_id)
    if items:
        return {key: items[0][key] for key in ("reason", "matched_interest")}
    return None


@router.get("/recommendations", response_model=EventListOut)
async def recommendations(
    db: Db,
    user: CurrentUser,
    city: Annotated[str | None, Query(max_length=120)] = None,
    categories: Annotated[list[str] | None, Query()] = None,
    sources: Annotated[list[str] | None, Query()] = None,
    starts_after: Annotated[datetime | None, Query()] = None,
    starts_before: Annotated[datetime | None, Query()] = None,
    free_only: Annotated[bool, Query()] = False,
    max_price: Annotated[float | None, Query(ge=0)] = None,
    radius_km: Annotated[int | None, Query(ge=1, le=500)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0, le=5000)] = 0,
) -> EventListOut:
    scoped = account_db(user)
    profile = await _confirmed_profile(scoped, user["id"])
    if profile is None:
        profile = await legacy_preferences(scoped, user["id"], await get_profile(scoped, user))
    ranked = await _structured_rank(
        scoped, user["id"], profile, city=city, categories=categories, sources=sources,
        starts_after=starts_after, starts_before=starts_before, free_only=free_only,
        max_price=max_price, radius_km=radius_km,
    )
    page = [EventOut.model_validate(row) for row in ranked[offset:offset + limit]]
    return EventListOut(items=page, count=len(page), limit=limit, offset=offset,
                        personalized=bool(profile.get("interests") or profile.get("categories")))


@router.post("/recommendations/preview", response_model=EventListOut)
async def preview(db: Db, payload: PreviewIn) -> EventListOut:
    taxonomy = await fetch_interests(db, payload.interests)
    profile = preference_profile(taxonomy, payload.model_dump())
    now = datetime.now(UTC)
    rows = await load_candidates(db, profile, now, origin=origin_for(profile, None))
    ranked = rank_events(rows, profile, [], now)[:payload.limit]
    items = [EventOut.model_validate(row) for row in ranked]
    return EventListOut(items=items, count=len(items), limit=payload.limit, offset=0,
                        personalized=bool(profile["interests"]))
