"""Account endpoints: profile, interests, saved events."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status

from api.deps import CurrentUser, Db, get_anon_db
from api.catalogue import LIST_COLUMNS, public_filters, public_items
from api.routers.events import get_event
from api.schemas import (
    EventListOut,
    EventOut,
    InterestsUpdateIn,
    MeOut,
    MessageOut,
    ProfileOut,
    ProfileUpdateIn,
    SaveIn,
)
from api.services import get_profile

router = APIRouter(tags=["me"])


async def _interest_slugs(db: Db, user_id: str) -> list[str]:
    rows = await db.select(
        "user_interests", columns="interest_slug", filters={"user_id": f"eq.{user_id}"}
    )
    return [row["interest_slug"] for row in (rows or [])]


@router.get("/me", response_model=MeOut)
async def me(db: Db, user: CurrentUser) -> MeOut:
    profile = await get_profile(db, user)
    return MeOut(
        profile=ProfileOut.model_validate(profile),
        interests=await _interest_slugs(db, user["id"]),
    )


@router.put("/me/profile", response_model=MeOut)
async def update_profile(db: Db, user: CurrentUser, payload: ProfileUpdateIn) -> MeOut:
    await get_profile(db, user)  # ensure the row exists
    values = payload.model_dump(exclude_none=True)

    if values:
        await db.update(
            "profiles", values, filters={"id": f"eq.{user['id']}"}, returning="minimal"
        )

    profile = await get_profile(db, user)
    return MeOut(
        profile=ProfileOut.model_validate(profile),
        interests=await _interest_slugs(db, user["id"]),
    )


@router.put("/me/interests", response_model=MeOut)
async def update_interests(db: Db, user: CurrentUser, payload: InterestsUpdateIn) -> MeOut:
    user_id = user["id"]
    await get_profile(db, user)

    known = await db.select("interests", columns="slug", filters={"is_active": "eq.true"})
    valid = {row["slug"] for row in (known or [])}
    unknown = [slug for slug in payload.interests if slug not in valid]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown interests: {', '.join(sorted(unknown))}",
        )

    await db.delete("user_interests", filters={"user_id": f"eq.{user_id}"})
    if payload.interests:
        await db.insert(
            "user_interests",
            [{"user_id": user_id, "interest_slug": slug} for slug in payload.interests],
            upsert=True,
            on_conflict="user_id,interest_slug",
            returning="minimal",
        )

    updates: dict[str, Any] = {}
    if payload.interest_text is not None:
        updates["interest_text"] = payload.interest_text.strip() or None
    if payload.city is not None:
        updates["city"] = payload.city.strip() or None
    if payload.mark_onboarded:
        updates["onboarded"] = True
    if updates:
        await db.update(
            "profiles", updates, filters={"id": f"eq.{user_id}"}, returning="minimal"
        )

    profile = await get_profile(db, user)
    return MeOut(profile=ProfileOut.model_validate(profile), interests=payload.interests)


@router.get("/me/saved", response_model=EventListOut)
async def saved_events(
    user: CurrentUser,
    state: Annotated[str, Query(pattern="^(saved|going|dismissed)$")] = "saved",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> EventListOut:
    rows = await get_anon_db().as_user(user["access_token"]).select(
        "saved_events",
        columns=f"state,created_at,events!saved_events_event_id_fkey!inner({LIST_COLUMNS})",
        filters={"user_id": f"eq.{user['id']}", "state": f"eq.{state}",
                 **{"events." + key: value for key, value in public_filters().items()}},
        order="created_at.desc",
        limit=limit,
    ) or []

    items = [EventOut.model_validate(item) for item in public_items(
        [row["events"] for row in rows if row.get("events")])]
    return EventListOut(items=items, count=len(items), limit=limit, offset=0)


@router.put("/events/{event_id}/save", response_model=MessageOut)
async def save_event(user: CurrentUser, event_id: str, payload: SaveIn) -> MessageOut:
    db = get_anon_db().as_user(user["access_token"])
    await get_event(db, event_id)
    await db.insert(
        "saved_events",
        {"user_id": user["id"], "event_id": event_id, "state": payload.state},
        upsert=True,
        on_conflict="user_id,event_id",
        returning="minimal",
    )
    return MessageOut(ok=True, message=f"event marked {payload.state}")


@router.delete("/events/{event_id}/save", response_model=MessageOut)
async def unsave_event(user: CurrentUser, event_id: str) -> MessageOut:
    await get_anon_db().as_user(user["access_token"]).delete(
        "saved_events", filters={"user_id": f"eq.{user['id']}", "event_id": f"eq.{event_id}"}
    )
    return MessageOut(ok=True, message="removed")
