"""Public event browsing: list, search, detail, trending, outbound click tracking."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from api.catalogue import LIST_COLUMNS, literal, overlap, public_filters, public_items
from api.event_search import catalogue_query
from api.deps import OptionalUser, get_anon_db
from api.schemas import ClickIn, EventListOut, EventOut, InterestOut, MessageOut, StatsOut
from api.services import fetch_interests

from core.supabase import SupabaseClient

Db = Annotated[SupabaseClient, Depends(get_anon_db)]
router = APIRouter(tags=["events"])


@router.get("/stats", response_model=StatsOut)
async def stats(db: Db) -> dict[str, Any]:
    """Live catalogue figures for the landing page."""
    payload = await db.rpc("catalogue_stats")
    return payload or {}


@router.get("/interests", response_model=list[InterestOut])
async def list_interests(db: Db) -> list[dict[str, Any]]:
    """The onboarding taxonomy."""
    return await fetch_interests(db)


@router.get("/events", response_model=EventListOut)
async def list_events(
    db: Db,
    q: Annotated[str | None, Query(max_length=200, description="Full-text query")] = None,
    city: Annotated[str | None, Query(max_length=120)] = None,
    categories: Annotated[list[str] | None, Query(description="Canonical category slugs")] = None,
    sources: Annotated[list[str] | None, Query()] = None,
    starts_after: Annotated[datetime | None, Query()] = None,
    starts_before: Annotated[datetime | None, Query()] = None,
    free_only: Annotated[bool, Query()] = False,
    include_online: Annotated[bool, Query()] = True,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> EventListOut:
    """Browse the catalogue. Uses Postgres full-text search when `q` is present."""
    q, conditions = catalogue_query(q or "")
    now = datetime.now(UTC)
    filters = public_filters(now)
    if starts_after and starts_after.astimezone(UTC) > now:
        filters["starts_at"] = f"gte.{starts_after.astimezone(UTC).isoformat()}"
    if starts_before:
        conditions.append(f"starts_at.lte.{starts_before.astimezone(UTC).isoformat()}")
    if conditions:
        filters["and"] = "(" + ",".join(conditions) + ")"
    if q:
        filters["search_tsv"] = f"wfts(english).{q}"
    if categories:
        filters["categories"] = overlap(categories)
    if sources:
        filters["source"] = "in.(" + ",".join(map(literal, sources)) + ")"
    if free_only:
        filters["is_free"] = "eq.true"
    if not include_online:
        filters["is_online"] = "eq.false"
    if city:
        filters["or"] = (f"(city.ilike.{literal(city)},is_online.eq.true)" if include_online
                         else f"(city.ilike.{literal(city)})")
    rows = await db.select("events", columns=LIST_COLUMNS, filters=filters,
                           order="starts_at.asc,id.asc", limit=limit, offset=offset)
    items = public_items(rows, now)

    return EventListOut(
        items=[EventOut.model_validate(item) for item in items],
        count=len(items),
        limit=limit,
        offset=offset,
    )


async def featured(db, rpc, city, limit):
    rows = await db.rpc(rpc, {"p_city": city, "p_limit": limit}) or []
    if rows and "verification_status" not in rows[0]:
        # Older featured functions return a projected record. Recheck the selected IDs.
        ids = [str(row["id"]) for row in rows]
        filters = {**public_filters(), "id": "in.(" + ",".join(map(literal, ids)) + ")"}
        records = await db.select("events", columns=LIST_COLUMNS, filters=filters, limit=limit)
        by_id = {row["id"]: row for row in records}
        rows = [by_id[key] for key in ids if key in by_id]
    return public_items(rows)


@router.get("/events/hero", response_model=EventListOut)
async def hero(
    db: Db,
    city: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=40)] = 12,
) -> EventListOut:
    """Verified upcoming events selected for the landing-page artwork."""
    rows = await featured(db, "hero_events", city, limit)
    return EventListOut(
        items=[EventOut.model_validate(row) for row in rows],
        count=len(rows),
        limit=limit,
        offset=0,
        fallback="hero",
    )


@router.get("/events/trending", response_model=EventListOut)
async def trending(
    db: Db,
    city: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
) -> EventListOut:
    """Cold-start feed: what everyone else is clicking on."""
    rows = await featured(db, "trending_events", city, limit)
    return EventListOut(
        items=[EventOut.model_validate(row) for row in rows],
        count=len(rows),
        limit=limit,
        offset=0,
        fallback="trending",
    )


@router.get("/events/{event_id}", response_model=EventOut)
async def get_event(db: Db, event_id: str) -> dict[str, Any]:
    event = await db.select(
        "events", columns=LIST_COLUMNS, filters={**public_filters(), "id": f"eq.{event_id}"}, single=True
    )
    items = public_items([event] if event else [])
    if not items:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    return items[0]


@router.post(
    "/events/{event_id}/click", response_model=MessageOut, status_code=status.HTTP_202_ACCEPTED
)
async def track_click(
    event_id: str, payload: ClickIn, user: OptionalUser
) -> MessageOut:
    """Logged when a user heads off to the official ticket page."""
    db = get_anon_db().as_user(user["access_token"] if user else None)
    await get_event(db, event_id)
    await db.insert(
        "event_clicks",
        {
            "event_id": event_id,
            "user_id": user["id"] if user else None,
            "surface": payload.surface,
        },
        returning="minimal",
    )
    return MessageOut(ok=True, message="click recorded")
