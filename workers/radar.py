"""Materialise personal in-app alerts, using the same rules as the dashboard."""
import asyncio
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from api.discovery_candidates import HISTORY_COLUMNS, load_candidates, origin_for
from api.discovery_ranking import instant, rank_events
from api.routers.picks import dashboard_radar, pages, radar_candidates
from core.supabase import service_client


def delivery_due(settings, now, latest=None):
    """Check a user's local quiet window and minimum time between alert batches."""
    frequency = settings.get("frequency", "immediate")
    periods = {"immediate": timedelta(), "daily": timedelta(days=1), "weekly": timedelta(days=7)}
    if frequency not in periods or (latest and now - latest < periods[frequency]):
        return False
    start, end = settings.get("quiet_start"), settings.get("quiet_end")
    if start is None and end is None:
        return True
    try:
        local = now.astimezone(ZoneInfo(settings.get("timezone") or "UTC")).time()
        start, end = time.fromisoformat(start), time.fromisoformat(end)
        quiet = start <= local < end if start <= end else local >= start or local < end
        return not quiet
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        return False


def update_alerts(items, events, settings, now):
    """A DB-recorded material revision identifies one alert even after later heartbeats."""
    if not settings.get("alerts"):
        return {}
    relevant = {item["id"] for item in items if not item["exploratory"]}
    result = {}
    for event in events:
        changed = instant(event.get("meaningful_updated_at"))
        verified = instant(event.get("last_verified_at"))
        if (event["id"] in relevant and event.get("verification_status") == "verified"
                and changed and verified and now - timedelta(days=7) <= changed <= verified <= now):
            kind = "event_update:" + changed.astimezone(UTC).isoformat(timespec="microseconds")
            result[event["id"], kind] = f"Event details updated · {event['title']}"
    return result


async def refresh(db, now=None):
    now = now or datetime.now(UTC)
    subscribers = await pages(db, "user_notification_settings", "*",
                              {"or": "(alerts.eq.true,digest.eq.true,tickets.eq.true)"}, "user_id")
    if not subscribers:
        return 0
    for subscriber in subscribers:
        uid = subscriber["user_id"]
        owner = {"user_id": f"eq.{uid}"}
        row, history, location, latest = await asyncio.gather(
            db.select("user_discovery_profiles", columns="profile", filters=owner, single=True),
            pages(db, "saved_events", HISTORY_COLUMNS, owner, "event_id"),
            db.select("profiles",columns="city,lat,lng",filters={"id":f"eq.{uid}"},single=True),
            db.select("user_radar_alerts", columns="created_at", filters=owner,
                      order="created_at.desc", limit=1),
        )
        if not row:
            continue
        profile = row["profile"]
        prefs = {**profile.get("radar_preferences", {}), **subscriber}
        if not delivery_due(prefs, now, instant(latest[0]["created_at"]) if latest else None):
            continue
        coordinates = origin_for(profile, location)
        listings = await load_candidates(db, profile, now, origin=coordinates)
        items = rank_events(listings, profile, history, now, coordinates)
        candidates = radar_candidates(items, listings, profile, subscriber, now)
        candidates.update(update_alerts(items, listings, subscriber, now))
        await dashboard_radar(db, uid, candidates, now)
    return len(subscribers)


async def main():
    db = service_client()
    try:
        count = await refresh(db)
        print(f"Radar checked {count} subscribed accounts.")
    finally:
        await db.aclose()


if __name__ == "__main__":
    asyncio.run(main())
