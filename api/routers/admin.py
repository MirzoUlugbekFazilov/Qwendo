"""Operator endpoints: trigger ingestion and inspect scraper runs."""

from __future__ import annotations

import hashlib
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from api.deps import Db, require_ingest_token
from api.schemas import IngestIn, IngestRunOut, MessageOut
from core.config import settings

router = APIRouter(
    prefix="/admin", tags=["admin"], dependencies=[Depends(require_ingest_token)]
)


@router.post("/ingest", response_model=MessageOut, status_code=202)
async def trigger_ingest(payload: IngestIn, db: Db) -> MessageOut:
    """Schedule discovery for enabled sources using the same queue as the worker."""
    sources = await db.select("discovery_sources", columns="slug,kind",
                              filters={"enabled": "eq.true"}, order="slug.asc")
    jobs = []
    for source in sources:
        if payload.sources and source["slug"] not in payload.sources:
            continue
        cities = (payload.cities or settings.default_cities) if source["kind"] in ("ticketmaster", "search") else [None]
        for city in cities:
            options = {key: value for key, value in {
                "city": city, "query": payload.query, "limit": payload.limit_per_source
            }.items() if value is not None}
            fingerprint = hashlib.sha256(json.dumps(options, sort_keys=True).encode()).hexdigest()
            job = await db.rpc("discovery_enqueue", {
                "p_source": source["slug"], "p_kind": "refresh",
                "p_key": "manual:" + fingerprint, "p_payload": options,
            })
            if job:
                jobs.append(job)
    return MessageOut(ok=True, message="Discovery queued.", data={"jobs": jobs})


@router.get("/runs", response_model=list[IngestRunOut])
async def list_runs(
    db: Db,
    source: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[dict]:
    filters = {"source": f"eq.{source}"} if source else {}
    return await db.select(
        "ingestion_runs", filters=filters, order="started_at.desc", limit=limit
    ) or []
