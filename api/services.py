"""Business logic shared by the routers: taste vectors and result explanations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from core.embeddings import embed_text, to_pgvector
from core.supabase import SupabaseClient
from core.taxonomy import CANONICAL_CATEGORIES, build_interest_text

INTEREST_COLUMNS = "slug,label,category,keywords,sort_order"


async def fetch_interests(db: SupabaseClient, slugs: list[str] | None = None) -> list[dict[str, Any]]:
    filters: dict[str, str] = {"is_active": "eq.true"}
    if slugs is not None:
        if not slugs:
            return []
        quoted = ",".join(f'"{slug}"' for slug in slugs)
        filters["slug"] = f"in.({quoted})"
    rows = await db.select(
        "interests", columns=INTEREST_COLUMNS, filters=filters, order="sort_order.asc"
    )
    return rows or []


async def build_taste_vector(
    db: SupabaseClient,
    *,
    slugs: list[str],
    interest_text: str | None = None,
    city: str | None = None,
) -> tuple[str | None, str]:
    """Embed a user's declared taste. Returns (pgvector literal, source text)."""
    rows = await fetch_interests(db, slugs)
    labels = [row["label"] for row in rows]
    keywords: list[str] = []
    for row in rows:
        keywords.extend(row.get("keywords") or [])

    text = build_interest_text(labels, keywords, interest_text, city)
    if not text:
        return None, ""
    vector = await embed_text(text)
    return to_pgvector(vector), text


async def refresh_profile_embedding(
    db: SupabaseClient,
    user_id: str,
    *,
    slugs: list[str] | None = None,
    interest_text: str | None = None,
    city: str | None = None,
) -> str | None:
    """Recompute and persist a user's taste vector from their current selections."""
    if slugs is None:
        rows = await db.select(
            "user_interests", columns="interest_slug", filters={"user_id": f"eq.{user_id}"}
        )
        slugs = [row["interest_slug"] for row in (rows or [])]

    if interest_text is None or city is None:
        profile = await db.select(
            "profiles",
            columns="interest_text,city",
            filters={"id": f"eq.{user_id}"},
            single=True,
        )
        if profile:
            interest_text = interest_text if interest_text is not None else profile.get("interest_text")
            city = city if city is not None else profile.get("city")

    vector, text = await build_taste_vector(
        db, slugs=slugs, interest_text=interest_text, city=city
    )
    await db.update(
        "profiles",
        {
            "embedding": vector,
            "embedded_at": datetime.now(timezone.utc).isoformat() if vector else None,
        },
        filters={"id": f"eq.{user_id}"},
        returning="minimal",
    )
    return vector


async def get_profile(db: SupabaseClient, user: dict[str, Any]) -> dict[str, Any]:
    """Fetch the caller's profile, self-healing if the signup trigger was skipped."""
    user_id = user["id"]
    profile = await db.select("profiles", filters={"id": f"eq.{user_id}"}, single=True)
    if profile:
        return profile

    created = await db.insert(
        "profiles",
        {
            "id": user_id,
            "email": user.get("email"),
            "full_name": (user.get("user_metadata") or {}).get("full_name"),
            "avatar_url": (user.get("user_metadata") or {}).get("avatar_url"),
        },
        upsert=True,
        on_conflict="id",
    )
    return (created or [{}])[0] if isinstance(created, list) else created


def explain_match(event: dict[str, Any], user_categories: set[str]) -> str:
    """A short, honest 'why am I seeing this' line for the card.

    Only claims a match for categories the user actually picked; everything
    else is described neutrally rather than invented.
    """
    bits: list[str] = []
    categories = event.get("categories") or []

    matched = [CANONICAL_CATEGORIES.get(c, c) for c in categories if c in user_categories][:2]
    if matched:
        bits.append("Matches your " + " & ".join(matched) + " interests")
    elif categories:
        bits.append(CANONICAL_CATEGORIES.get(categories[0], categories[0]))

    distance = event.get("distance_km")
    if event.get("is_online"):
        bits.append("online")
    elif isinstance(distance, (int, float)):
        bits.append(f"{distance:.1f} km away" if distance < 10 else f"{round(distance)} km away")

    starts_at = event.get("starts_at")
    if isinstance(starts_at, str):
        try:
            when = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
            days = (when - datetime.now(timezone.utc)).days
            if days <= 0:
                bits.append("happening today")
            elif days <= 7:
                bits.append(f"in {days} day{'s' if days > 1 else ''}")
        except ValueError:
            pass

    return " · ".join(bits) if bits else "Picked for you"


def with_reasons(
    events: list[dict[str, Any]], user_categories: set[str] | None = None
) -> list[dict[str, Any]]:
    categories = user_categories or set()
    for event in events:
        event["reason"] = explain_match(event, categories)
    return events


async def categories_for_interests(db: SupabaseClient, slugs: list[str]) -> set[str]:
    """The canonical categories behind a user's selected interests."""
    if not slugs:
        return set()
    rows = await fetch_interests(db, slugs)
    return {row["category"] for row in rows}
