"""The core of Qwendo: personalised event recommendations."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query

from api.deps import CurrentUser, Db
from api.schemas import EventListOut, EventOut, PreviewIn
from api.services import (
    build_taste_vector,
    categories_for_interests,
    get_profile,
    with_reasons,
)

router = APIRouter(tags=["recommendations"])


async def _match(
    db: Db,
    *,
    embedding: str | None,
    user_id: str | None = None,
    city: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: int | None = None,
    include_online: bool = True,
    categories: list[str] | None = None,
    sources: list[str] | None = None,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
    free_only: bool = False,
    max_price: float | None = None,
    limit: int = 24,
    offset: int = 0,
) -> list[dict[str, Any]]:
    return await db.rpc(
        "match_events",
        {
            "query_embedding": embedding,
            "p_user_id": user_id,
            "p_lat": lat,
            "p_lng": lng,
            "p_radius_km": radius_km,
            "p_city": city,
            "p_from": starts_after.isoformat() if starts_after else None,
            "p_to": starts_before.isoformat() if starts_before else None,
            "p_categories": categories or None,
            "p_sources": sources or None,
            "p_include_online": include_online,
            "p_free_only": free_only,
            "p_max_price": max_price,
            "p_limit": limit,
            "p_offset": offset,
        },
    ) or []


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
    """Ranked feed for the signed-in user, built from their taste vector."""
    profile = await get_profile(db, user)
    embedding = profile.get("embedding")

    rows = await _match(
        db,
        embedding=embedding,
        user_id=user["id"],
        city=city or profile.get("city"),
        lat=profile.get("lat"),
        lng=profile.get("lng"),
        radius_km=radius_km or profile.get("radius_km"),
        include_online=profile.get("include_online", True),
        categories=categories,
        sources=sources,
        starts_after=starts_after,
        starts_before=starts_before,
        free_only=free_only,
        max_price=max_price,
        limit=limit,
        offset=offset,
    )

    fallback = None if embedding else "no-taste-vector"
    if not rows and (city or profile.get("city")):
        # Nothing nearby — widen to anywhere rather than show an empty feed.
        rows = await _match(
            db,
            embedding=embedding,
            user_id=user["id"],
            include_online=True,
            categories=categories,
            limit=limit,
            offset=offset,
        )
        fallback = fallback or "widened-location"

    picked = await db.select(
        "user_interests", columns="interest_slug", filters={"user_id": f"eq.{user['id']}"}
    )
    user_categories = await categories_for_interests(
        db, [row["interest_slug"] for row in (picked or [])]
    )

    return EventListOut(
        items=[EventOut.model_validate(row) for row in with_reasons(rows, user_categories)],
        count=len(rows),
        limit=limit,
        offset=offset,
        personalized=bool(embedding),
        fallback=fallback,
    )


@router.post("/recommendations/preview", response_model=EventListOut)
async def preview(db: Db, payload: PreviewIn) -> EventListOut:
    """Instant 'what would Qwendo find for me?' demo — no account required.

    This is the landing-page hook: pick a few interests, see real matched events
    before signing up.
    """
    embedding, _ = await build_taste_vector(
        db,
        slugs=payload.interests,
        interest_text=payload.interest_text,
        city=payload.city,
    )

    rows = await _match(
        db,
        embedding=embedding,
        city=payload.city,
        limit=payload.limit,
    )
    if not rows:
        rows = await db.rpc(
            "trending_events", {"p_city": payload.city, "p_limit": payload.limit}
        ) or []

    user_categories = await categories_for_interests(db, payload.interests)
    return EventListOut(
        items=[EventOut.model_validate(row) for row in with_reasons(rows, user_categories)],
        count=len(rows),
        limit=payload.limit,
        offset=0,
        personalized=bool(embedding),
        fallback=None if embedding else "trending",
    )
