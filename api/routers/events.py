"""Public event browsing: list, search, detail, trending, outbound click tracking."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status

from api.deps import Db, OptionalUser
from api.schemas import ClickIn, EventListOut, EventOut, InterestOut, MessageOut
from api.services import fetch_interests

router = APIRouter(tags=["events"])

LIST_COLUMNS = (
    "id,source,url,title,summary,description,image_url,starts_at,ends_at,timezone,is_online,"
    "venue_name,address,city,country,lat,lng,price_min,price_max,currency,is_free,organizer,"
    "categories,tags,popularity"
)


def _quote_list(values: list[str]) -> str:
    return "{" + ",".join(f'"{value}"' for value in values) + "}"


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
    if q:
        rows = await db.rpc(
            "search_events",
            {
                "p_query": q,
                "p_city": city,
                "p_from": starts_after.isoformat() if starts_after else None,
                "p_to": starts_before.isoformat() if starts_before else None,
                "p_categories": categories or None,
                "p_limit": limit,
                "p_offset": offset,
            },
        )
        items = rows or []
    else:
        filters: dict[str, str] = {"status": "neq.expired"}
        filters["starts_at"] = f"gte.{(starts_after or datetime.now().astimezone()).isoformat()}"
        if starts_before:
            filters["and"] = f"(starts_at.lte.{starts_before.isoformat()})"
        if categories:
            filters["categories"] = f"ov.{_quote_list(categories)}"
        if sources:
            filters["source"] = f"in.({','.join(sources)})"
        if free_only:
            filters["is_free"] = "eq.true"
        if city:
            filters["or"] = (
                f"(city.ilike.{city},is_online.eq.true)" if include_online else f"(city.ilike.{city})"
            )
        elif not include_online:
            filters["is_online"] = "eq.false"

        items = await db.select(
            "events",
            columns=LIST_COLUMNS,
            filters=filters,
            order="starts_at.asc",
            limit=limit,
            offset=offset,
        ) or []

    return EventListOut(
        items=[EventOut.model_validate(item) for item in items],
        count=len(items),
        limit=limit,
        offset=offset,
    )


@router.get("/events/trending", response_model=EventListOut)
async def trending(
    db: Db,
    city: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
) -> EventListOut:
    """Cold-start feed: what everyone else is clicking on."""
    rows = await db.rpc("trending_events", {"p_city": city, "p_limit": limit}) or []
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
        "events", columns=LIST_COLUMNS, filters={"id": f"eq.{event_id}"}, single=True
    )
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    return event


@router.post(
    "/events/{event_id}/click", response_model=MessageOut, status_code=status.HTTP_202_ACCEPTED
)
async def track_click(
    db: Db, event_id: str, payload: ClickIn, user: OptionalUser
) -> MessageOut:
    """Logged when a user heads off to the official ticket page."""
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
