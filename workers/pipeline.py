"""Ingestion pipeline: scrape → normalize → dedupe → embed → upsert.

Every step is idempotent. Running the same scrape twice updates `last_seen_at`
and nothing else, because events are keyed on (source, external_id) and we only
re-embed when the content fingerprint changes.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from core.config import settings
from core.embeddings import embed_texts, to_pgvector
from core.links import is_direct_event_url
from core.models import NormalizedEvent
from core.supabase import SupabaseClient, chunked, service_client
from core.taxonomy import event_embedding_text
from workers.sources import EventSource, get_sources

log = logging.getLogger("qwendo.pipeline")

UPSERT_CHUNK = 100
LOOKUP_CHUNK = 150


async def _existing_fingerprints(
    db: SupabaseClient, source: str, external_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Map external_id → {content_hash, has_embedding} for events we already hold."""
    found: dict[str, dict[str, Any]] = {}
    for batch in chunked(external_ids, LOOKUP_CHUNK):
        quoted = ",".join(f'"{value}"' for value in batch)
        rows = await db.select(
            "events",
            columns="id,external_id,content_hash,embedded_at",
            filters={"source": f"eq.{source}", "external_id": f"in.({quoted})"},
            limit=LOOKUP_CHUNK,
        )
        for row in rows or []:
            found[row["external_id"]] = row
    return found


async def upsert_events(
    db: SupabaseClient, events: list[NormalizedEvent]
) -> tuple[int, int, int]:
    """Persist a batch. Returns (inserted, updated, skipped_unchanged)."""
    if not events:
        return 0, 0, 0

    # De-dupe within the batch itself (sources repeat events across pages).
    unique: dict[tuple[str, str], NormalizedEvent] = {}
    for event in events:
        unique[(event.source, event.external_id)] = event
    batch = list(unique.values())

    # Never store an event we can't send the user straight to.
    rejected = [
        event
        for event in batch
        if event.source != "demo" and not is_direct_event_url(event.source, event.url)
    ]
    if rejected:
        log.warning(
            "Dropping %s event(s) without a direct ticket link, e.g. %s → %s",
            len(rejected), rejected[0].title[:50], rejected[0].url,
        )
        batch = [event for event in batch if event not in rejected]
    if not batch:
        return 0, 0, 0

    source = batch[0].source
    existing = await _existing_fingerprints(db, source, [e.external_id for e in batch])

    needs_embedding: list[NormalizedEvent] = []
    unchanged: list[NormalizedEvent] = []
    for event in batch:
        prior = existing.get(event.external_id)
        if prior and prior.get("content_hash") == event.fingerprint and prior.get("embedded_at"):
            unchanged.append(event)
        else:
            needs_embedding.append(event)

    vectors: list[str | None] = []
    if needs_embedding:
        texts = [
            event_embedding_text(
                event.title,
                event.description or event.summary,
                event.categories,
                event.tags,
                event.venue_name,
                event.city,
                event.organizer,
            )
            for event in needs_embedding
        ]
        vectors = [to_pgvector(vector) for vector in await embed_texts(texts)]

    # PostgREST rejects a bulk insert whose objects don't share the same keys,
    # so the embedded rows and the heartbeat-only rows go up as separate batches.
    embedded_rows: list[dict[str, Any]] = [
        event.to_row(embedding=vector) for event, vector in zip(needs_embedding, vectors)
    ]
    # Unchanged events still get a heartbeat so we can spot dead listings.
    heartbeat_rows: list[dict[str, Any]] = [event.to_row() for event in unchanged]

    for rows in (embedded_rows, heartbeat_rows):
        for chunk in chunked(rows, UPSERT_CHUNK):
            await db.insert(
                "events",
                chunk,
                upsert=True,
                on_conflict="source,external_id",
                returning="minimal",
            )

    inserted = sum(1 for event in batch if event.external_id not in existing)
    return inserted, len(batch) - inserted, len(unchanged)


async def ingest_source(
    db: SupabaseClient,
    source: EventSource,
    *,
    city: str | None,
    query: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Run one source for one city, recording the attempt in ingestion_runs."""
    limit = limit or settings.max_events_per_source
    run = await db.insert(
        "ingestion_runs",
        {"source": source.slug, "query": f"{city or 'anywhere'}{f' / {query}' if query else ''}"},
    )
    run_id = (run or [{}])[0].get("id") if isinstance(run, list) else None

    summary: dict[str, Any] = {
        "source": source.slug,
        "city": city,
        "found": 0,
        "inserted": 0,
        "updated": 0,
        "skipped": 0,
        "status": "success",
        "error": None,
    }

    try:
        log.info("Fetching %s events for %s", source.name, city or "anywhere")
        events = await source.fetch(city=city, query=query, limit=limit)
        summary["found"] = len(events)

        inserted, updated, skipped = await upsert_events(db, events)
        summary.update(inserted=inserted, updated=updated, skipped=skipped)
        log.info(
            "%s/%s: %s found, %s new, %s updated",
            source.slug, city or "anywhere", len(events), inserted, updated,
        )
    except Exception as exc:  # noqa: BLE001 - a failing source must not stop the run
        summary.update(status="failed", error=str(exc))
        log.exception("Ingestion failed for %s/%s", source.slug, city)

    if run_id:
        await db.update(
            "ingestion_runs",
            {
                "status": summary["status"],
                "found": summary["found"],
                "inserted": summary["inserted"],
                "updated": summary["updated"],
                "skipped": summary["skipped"],
                "errors": 1 if summary["status"] == "failed" else 0,
                "error_text": summary["error"],
                "finished_at": datetime.now(timezone.utc).isoformat(),
            },
            filters={"id": f"eq.{run_id}"},
            returning="minimal",
        )

    return summary


async def run_ingestion(
    sources: list[str] | None = None,
    cities: list[str] | None = None,
    query: str | None = None,
    limit_per_source: int | None = None,
    db: SupabaseClient | None = None,
) -> list[dict[str, Any]]:
    """Scrape every requested source × city combination."""
    owns_client = db is None
    db = db or service_client()
    cities = cities or settings.default_cities
    selected = get_sources(sources)

    if not selected:
        log.warning("No sources are configured. Set TICKETMASTER_API_KEY or rely on scraped sources.")
        return []

    try:
        results: list[dict[str, Any]] = []
        for source in selected:
            if not source.is_configured():
                log.info("Skipping %s (missing credentials)", source.name)
                continue
            for city in cities:
                results.append(
                    await ingest_source(
                        db, source, city=city, query=query, limit=limit_per_source
                    )
                )
                await asyncio.sleep(1)  # be a good citizen between city sweeps
        await expire_past_events(db)
        return results
    finally:
        if owns_client:
            await db.aclose()


async def expire_past_events(db: SupabaseClient) -> None:
    """Flip events that already happened to `expired` so they leave the feeds."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
    await db.update(
        "events",
        {"status": "expired"},
        filters={"starts_at": f"lt.{cutoff}", "status": "neq.expired"},
        returning="minimal",
    )


async def backfill_embeddings(db: SupabaseClient, limit: int = 500) -> int:
    """Embed any events missing a vector (e.g. after switching provider)."""
    rows = await db.select(
        "events",
        columns="id,title,description,summary,categories,tags,venue_name,city,organizer",
        filters={"embedding": "is.null"},
        limit=limit,
    ) or []
    if not rows:
        return 0

    texts = [
        event_embedding_text(
            row["title"],
            row.get("description") or row.get("summary"),
            row.get("categories"),
            row.get("tags"),
            row.get("venue_name"),
            row.get("city"),
            row.get("organizer"),
        )
        for row in rows
    ]
    vectors = await embed_texts(texts)
    now = datetime.now(timezone.utc).isoformat()

    for row, vector in zip(rows, vectors):
        await db.update(
            "events",
            {"embedding": to_pgvector(vector), "embedded_at": now},
            filters={"id": f"eq.{row['id']}"},
            returning="minimal",
        )
    return len(rows)
