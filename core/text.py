"""Text cleaning, date parsing and fingerprinting helpers."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil import parser as date_parser

_WHITESPACE_RE = re.compile(r"\s+")
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")


def strip_html(value: str | None) -> str:
    """Drop markup and collapse whitespace. Falls back to regex if selectolax is absent."""
    if not value:
        return ""
    if "<" in value and ">" in value:
        try:
            from selectolax.parser import HTMLParser

            value = HTMLParser(value).text(separator=" ")
        except Exception:  # noqa: BLE001 - parser is optional at runtime
            value = re.sub(r"<[^>]+>", " ", value)
    return _WHITESPACE_RE.sub(" ", value).strip()


def truncate(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def make_summary(description: str | None, limit: int = 220) -> str | None:
    """A short card blurb: whole sentences where possible."""
    text = strip_html(description)
    if not text:
        return None
    if len(text) <= limit:
        return text

    out = ""
    for sentence in _SENTENCE_END_RE.split(text):
        if len(out) + len(sentence) + 1 > limit:
            break
        out = f"{out} {sentence}".strip()
    return out or truncate(text, limit)


def parse_datetime(value: str | None, fallback_tz: str | None = None) -> datetime | None:
    """Parse any ISO-ish timestamp; naive values are assumed UTC."""
    if not value:
        return None
    try:
        parsed = date_parser.parse(value)
    except (ValueError, OverflowError, TypeError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_local_datetime(
    date_value: str | None, time_value: str | None, tz_name: str | None
) -> datetime | None:
    """Combine a naive local date + time with the event's own timezone.

    Sources like Eventbrite ship "2026-11-21", "19:00", "Europe/London" as three
    separate fields; treating that as UTC would shift every event by an hour in
    summer.
    """
    if not date_value:
        return None
    try:
        parsed = date_parser.parse(f"{date_value}T{time_value or '00:00'}")
    except (ValueError, OverflowError, TypeError):
        return None

    if parsed.tzinfo is None:
        tzinfo = timezone.utc
        if tz_name:
            try:
                tzinfo = ZoneInfo(tz_name)
            except (ZoneInfoNotFoundError, ValueError):
                tzinfo = timezone.utc
        parsed = parsed.replace(tzinfo=tzinfo)
    return parsed.astimezone(timezone.utc)


def to_iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def content_hash(*parts: object) -> str:
    """Stable fingerprint for identifying unchanged event content."""
    joined = "|".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:40]


def clean_title(value: str | None) -> str:
    title = strip_html(value)
    # marketplaces love suffixes like " | Eventbrite" or " - Tickets"
    title = re.sub(r"\s*[|•]\s*(Eventbrite|Luma|lu\.ma|Ticketmaster)\s*$", "", title, flags=re.I)
    return title.strip()


def normalize_city(value: str | None) -> str | None:
    if not value:
        return None
    city = _WHITESPACE_RE.sub(" ", value).strip()
    aliases = {
        "greater london": "London",
        "london, uk": "London",
        "city of london": "London",
        "nyc": "New York",
        "new york city": "New York",
        "sf": "San Francisco",
    }
    return aliases.get(city.lower(), city)
