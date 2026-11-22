"""Public catalogue eligibility shared by browsing, ranking and account actions."""
from datetime import UTC, datetime
from urllib.parse import urlsplit

from core.links import is_direct_event_url


LIST_COLUMNS = (
    "id,source,url,title,summary,description,image_url,starts_at,ends_at,timezone,is_online,"
    "venue_name,address,city,country,lat,lng,price_min,price_max,currency,is_free,organizer,"
    "categories,tags,popularity,status,verification_status,official_url,canonical_event_id,"
    "last_verified_at,source_published_at,first_seen_at"
)


def instant(value):
    try:
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.utcoffset() is not None else None
    except (TypeError, ValueError):
        return None


def public_filters(now=None):
    timestamp = (now or datetime.now(UTC)).isoformat()
    return {
        "status": "eq.active", "verification_status": "eq.verified",
        "last_verified_at": f"lte.{timestamp}", "starts_at": f"gt.{timestamp}",
        "canonical_event_id": "is.null", "source": "neq.demo", "url": "like.https://*",
        "raw->>seeded": "isdistinct.true",
    }


def public_event(row, now):
    start = instant(row.get("starts_at"))
    verified = instant(row.get("last_verified_at"))
    if (row.get("status") != "active" or row.get("verification_status") != "verified"
            or not verified or verified > now or not start or start <= now
            or row.get("canonical_event_id") or row.get("source") == "demo" or (row.get("raw") or {}).get("seeded")):
        return None
    if not valid_listing_url(row["source"], row.get("url")):
        return None
    official = row.get("official_url")
    if official and not valid_listing_url("", official):
        return {**row, "official_url": None}
    return row


def valid_listing_url(source, url):
    if not isinstance(url, str) or any(ord(c) <= 32 or ord(c) == 127 or c == chr(92) for c in url):
        return False
    try:
        parsed = urlsplit(url)
        return bool(parsed.scheme == "https" and parsed.hostname and parsed.port in (None, 443) and parsed.username is None
                    and parsed.password is None and is_direct_event_url(source, url))
    except ValueError:
        return False


def literal(value):
    """Quote a PostgREST array or logic-tree value."""
    return '"' + value.replace(chr(92), chr(92) * 2).replace('"', chr(92) + '"') + '"'


def overlap(values):
    return "ov.{" + ",".join(literal(value) for value in values) + "}"


def public_items(rows, now=None):
    now = now or datetime.now(UTC)
    return [item for row in rows or [] if (item := public_event(row, now))]
