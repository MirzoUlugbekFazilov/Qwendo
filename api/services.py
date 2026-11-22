"""Business logic shared by the routers: interest taxonomy and profiles."""

from __future__ import annotations

from typing import Any

from api.catalogue import literal
from api.routers.interest_extraction import parse_interests
from core.supabase import SupabaseClient

INTEREST_COLUMNS = "slug,label,category,keywords,sort_order"


async def fetch_interests(db: SupabaseClient, slugs: list[str] | None = None) -> list[dict[str, Any]]:
    filters: dict[str, str] = {"is_active": "eq.true"}
    if slugs is not None:
        if not slugs:
            return []
        quoted = ",".join(map(literal, slugs))
        filters["slug"] = f"in.({quoted})"
    rows = await db.select(
        "interests", columns=INTEREST_COLUMNS, filters=filters, order="sort_order.asc"
    )
    return rows or []


async def get_profile(db: SupabaseClient, user: dict[str, Any]) -> dict[str, Any]:
    """Fetch the caller's profile, self-healing if the signup trigger was skipped."""
    user_id = user["id"]
    profile = await db.select("profiles", columns="id,email,full_name,avatar_url,city,country,lat,lng,"
                              "radius_km,include_online,interest_text,onboarded,digest_opt_in",
                              filters={"id": f"eq.{user_id}"}, single=True)
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


def preference_profile(taxonomy, legacy):
    topics = [{"name": row["label"], "related": row.get("keywords") or [], "priority": "very",
               "source": "explicit"} for row in taxonomy]
    text = (legacy.get("interest_text") or "").strip()
    if text:
        topics.extend(topic.model_dump() for topic in parse_interests(text[:4000]))
    return {"city": legacy.get("city"), "online": legacy.get("include_online", True),
            "radius": (legacy.get("radius_km") or 40) / 1.609344, "interests": topics,
            "categories": list(dict.fromkeys(row["category"] for row in taxonomy))}


async def legacy_preferences(db, uid, legacy):
    selected = await db.select("user_interests", columns="interests(label,category,keywords)",
                               filters={"user_id": f"eq.{uid}"})
    return preference_profile([row["interests"] for row in selected or [] if row.get("interests")],
                              legacy or {})
