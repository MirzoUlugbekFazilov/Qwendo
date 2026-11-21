"""Outbound link integrity.

Qwendo's whole promise is "we found this for you — here's where to get it".
A link that lands on a marketplace *search page* instead of the event's own
page breaks that promise, so every ingested event is checked before it is
stored, and anything that isn't a direct event page is dropped.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# Path fragments that mean "a list of events", never a single event.
LISTING_MARKERS = (
    "/d/",
    "/discover",
    "/search",
    "/browse",
    "/explore",
    "/all-events",
    "/events-near",
    "/category",
    "/collections",
)

# Hosts that serve event pages for Ticketmaster's other ticketing platforms
# (the Discovery API returns these under source=universe / frontgate / tmr).
PARTNER_HOSTS = (
    "universe.com",
    "frontgatetickets.com",
    "ticketweb.",
    "livenation.",
    "axs.com",
)

# Per-source proof that a URL points at one specific event.
DIRECT_PATH_HINTS: dict[str, tuple[str, ...]] = {
    "eventbrite": ("/e/",),
    "ticketmaster": ("/event/",),
}

_TICKETMASTER_HOST = re.compile(r"(^|\.)ticketmaster\.", re.I)


def classify_event_url(source: str, url: str | None) -> str:
    """Return 'direct', 'listing' or 'invalid'.

    'direct'  — a page for this event alone; safe to send a user to.
    'listing' — a search/browse page; rejected.
    'invalid' — not a usable absolute http(s) URL.
    """
    if not url or not isinstance(url, str):
        return "invalid"

    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return "invalid"

    path = parsed.path.rstrip("/")
    if not path:
        return "listing"  # a bare homepage is not an event

    host = parsed.netloc.lower()
    lowered = path.lower()

    if any(marker in lowered for marker in LISTING_MARKERS):
        return "listing"

    # Ticketmaster-family links: their own domains must carry /event/, but the
    # API also returns partner platforms whose URL shapes differ.
    if source == "ticketmaster":
        if _TICKETMASTER_HOST.search(host):
            return "direct" if "/event/" in lowered else "listing"
        if any(partner in host for partner in PARTNER_HOSTS):
            return "direct"
        # Unknown partner host with a real path: accept, it isn't a search page.
        return "direct"

    hints = DIRECT_PATH_HINTS.get(source)
    if hints and not any(hint in lowered for hint in hints):
        return "listing"

    return "direct"


def is_direct_event_url(source: str, url: str | None) -> bool:
    return classify_event_url(source, url) == "direct"
