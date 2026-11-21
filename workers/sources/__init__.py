"""Source registry. Add a new marketplace by implementing EventSource and listing it here."""

from __future__ import annotations

from workers.sources.base import EventSource
from workers.sources.eventbrite import EventbriteSource
from workers.sources.luma import LumaSource
from workers.sources.ticketmaster import TicketmasterSource

SOURCES: dict[str, EventSource] = {
    source.slug: source
    for source in (TicketmasterSource(), EventbriteSource(), LumaSource())
}


def get_sources(slugs: list[str] | None = None) -> list[EventSource]:
    """Resolve requested source slugs, defaulting to every configured source."""
    if not slugs:
        return [source for source in SOURCES.values() if source.is_configured()]

    resolved: list[EventSource] = []
    for slug in slugs:
        source = SOURCES.get(slug.strip().lower())
        if source is None:
            raise KeyError(f"Unknown source '{slug}'. Known: {', '.join(SOURCES)}")
        resolved.append(source)
    return resolved


__all__ = ["SOURCES", "EventSource", "get_sources"]
