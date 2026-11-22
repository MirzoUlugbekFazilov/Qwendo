"""Dashboard picks and on-demand, in-app Radar."""
import asyncio
import re
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends

from api.deps import CurrentUser, get_anon_db
from api.discovery_ranking import CATEGORY_LABELS, identity, instant, mentions, norm, rank_events
from api.catalogue import LIST_COLUMNS, public_event, public_filters
from api.discovery_candidates import HISTORY_COLUMNS, load_candidates, origin_for
from api.services import legacy_preferences
from core.supabase import SupabaseClient

router = APIRouter(tags=["discovery"])
Db = Annotated[SupabaseClient, Depends(get_anon_db)]
SIGHTING_WINDOW = timedelta(days=7)
SOURCE_DOMAINS = {
    "luma": r"(?:lu\.ma|luma\.com)",
    "eventbrite": r"eventbrite\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})",
    "ticketmaster": r"(?:(?:ticketmaster|livenation|ticketweb)\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})|(?:universe|frontgatetickets|axs)\.com)",
}


def source_listing(event):
    domain = SOURCE_DOMAINS.get(event["source"])
    if not domain:
        return True  # public_event already requires verified source evidence
    url = urlsplit(event["official_url"])
    return (url.scheme in ("http", "https") and not url.username and not url.password
            and re.fullmatch(r"(?:[\w-]+\.)*" + domain, url.hostname or "") is not None)


async def pages(db, table, columns, filters, order):
    rows = []
    while True:
        batch = await db.select(table, columns=columns, filters=filters, order=order,
                                limit=500, offset=len(rows))
        rows.extend(batch)
        if len(batch) < 500:
            return rows


def radar_candidates(items, events, profile, settings, now):
    """Only alert on attributable catalogue evidence and confirmed preferences."""
    by_identity = {}
    for event in events:
        if (event := public_event(event, now)) and event.get("official_url"):
            by_identity.setdefault(identity(event), []).append(event)
    topics = [i["name"] for i in profile.get("interests", [])
              if i.get("priority") == "must" and (i.get("source") == "explicit" or i.get("confirmed"))]

    candidates = {}
    digest_kind = "weekly_digest:" + now.strftime("%G-W%V")
    for item in items:
        for event in by_identity.get(identity(item), []):
            if event.get("official_url") not in item["official_links"]:
                continue
            raw = event.get("raw") or {}
            sighting = instant(event.get("last_verified_at"))
            if (not source_listing(event) or not sighting
                    or not now - SIGHTING_WINDOW <= sighting <= now):
                continue
            # Ground must-see matches in the listing's title, organizer or taxonomy.
            fields = [event["title"], event.get("organizer"), *(event.get("tags") or [])]
            searchable = " " + " ".join(norm(value) for value in fields) + " "
            topic = next((t for t in topics if mentions(searchable, t)), None)
            first = instant(item.get("discovered_at"))
            source_first = instant(event.get("first_seen_at"))
            if (topic and settings["alerts"] and first and source_first
                    and now - SIGHTING_WINDOW <= first <= source_first <= sighting):
                candidates[item["id"], "great_match"] = f"Radar match for {topic} · {item['title']}"
            evidence = " " + " ".join(norm(value) for value in [
                *fields, event.get("summary"), event.get("description"), *(event.get("categories") or [])
            ]) + " "
            category_match = any(CATEGORY_LABELS.get(slug) == item["matched_interest"]
                                 and mentions(evidence, slug) for slug in profile.get("categories", []))
            reviewed_match = not item["exploratory"] and (
                category_match or mentions(evidence, item["matched_interest"]))
            if settings["digest"] and reviewed_match:
                candidates[item["id"], digest_kind] = f"Weekly digest · {item['title']}"
            sale = instant(raw.get("onsale")) if event["source"] == "ticketmaster" else None
            if (settings["tickets"] and (topic or reviewed_match) and sale
                    and now - timedelta(days=1) <= sale <= now + timedelta(days=1)
                    and sale <= instant(event["starts_at"])):
                candidates[item["id"], "ticket_reminder"] = (
                    f"Public ticket sale · {sale.isoformat()} · {item['title']}")
    return candidates


async def dashboard_radar(db, uid, candidates, now):
    if not candidates:
        return []
    filters = {"user_id": f"eq.{uid}"}
    existing = await pages(db, "user_radar_alerts", "event_id,kind,created_at", filters,
                           "created_at.desc,event_id,kind")
    known = {(row["event_id"], row["kind"]) for row in existing}
    digest_kind = "weekly_digest:" + now.strftime("%G-W%V")
    has_digest = any(kind == digest_kind for _, kind in known)
    digest_count = 0
    additions = []
    for event_id, kind in candidates:
        if (event_id, kind) in known:
            continue
        if kind == digest_kind:
            if has_digest or digest_count == 3:
                continue
            digest_count += 1
        additions.append({"user_id": uid, "event_id": event_id, "kind": kind})
    if additions:
        await db.insert("user_radar_alerts", additions, upsert=True, ignore_duplicates=True,
                        on_conflict="user_id,event_id,kind", returning="minimal")
        existing = await pages(db, "user_radar_alerts", "event_id,kind,created_at", filters,
                               "created_at.desc,event_id,kind")
    return [{**row, "title": candidates[key]} for row in existing
            if (key := (row["event_id"], row["kind"])) in candidates]


async def delivered_alerts(db, uid, profile, settings, history, now, origin):
    """Read the worker's delivered alerts for events the user can still see."""
    enabled = []
    if settings["alerts"]:
        enabled.extend(("kind.eq.great_match", "kind.like.event_update:*"))
    if settings["tickets"]:
        enabled.append("kind.eq.ticket_reminder")
    if settings["digest"]:
        enabled.append("kind.like.weekly_digest:*")
    if not enabled:
        return []
    filters = {"user_id": f"eq.{uid}", "or": "(" + ",".join(enabled) + ")",
               **{"events." + key: value for key, value in public_filters(now).items()}}
    rows = await db.select("user_radar_alerts",
                           columns=f"event_id,kind,created_at,events!inner({LIST_COLUMNS})",
                           filters=filters, order="created_at.desc,event_id,kind", limit=50) or []
    events = [row["events"] for row in rows if row.get("events")]
    ranked = {item["id"]: item for item in rank_events(events, profile, history, now, origin)}
    result = []
    for row in rows:
        event = ranked.get(row["event_id"])
        if not event or not event.get("official_url"):
            continue
        kind = row["kind"].partition(":")[0]
        label = {"great_match": "Radar match", "weekly_digest": "Weekly digest",
                 "event_update": "Event details updated", "ticket_reminder": "Public ticket sale"}.get(kind)
        if label:
            result.append({"event_id": event["id"], "kind": row["kind"],
                           "created_at": row["created_at"], "title": f"{label} · {event['title']}"})
    return result


async def load_dashboard(db, uid, now):
    """Load all dashboard inputs for one user and read delivered alerts."""
    owner = {"user_id": f"eq.{uid}"}
    profile_row, consent, location, history = await asyncio.gather(
        db.select("user_discovery_profiles", columns="profile", filters=owner, single=True),
        db.select("user_notification_settings", columns="alerts,digest,tickets", filters=owner, single=True),
        db.select("profiles", columns="city,lat,lng,include_online,radius_km,interest_text", filters={"id": f"eq.{uid}"}, single=True),
        pages(db, "saved_events", HISTORY_COLUMNS,
              owner, "event_id"),
    )
    settings = {k: (consent or {}).get(k) is True for k in ("alerts", "digest", "tickets")}
    profile = {**profile_row["profile"], "notifications": settings} if profile_row else None
    effective = profile if profile else await legacy_preferences(db, uid, location)
    origin = origin_for(effective, location)
    events = await load_candidates(db, effective, now, origin=origin)
    items = rank_events(events, effective, history, now, origin)
    radar = []
    if profile and any(settings.values()):
        radar = await delivered_alerts(db, uid, profile, settings, history, now, origin)
    return {"items": items, "radar": radar, "profile": profile}


@router.get("/me/picks")
async def picks(user: CurrentUser, anon: Db):
    return await load_dashboard(anon.as_user(user["access_token"]), user["id"], datetime.now(UTC))
