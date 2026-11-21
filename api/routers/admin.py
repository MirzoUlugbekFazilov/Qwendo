"""Operator endpoints: trigger ingestion and inspect scraper runs."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from api.deps import Db, require_ingest_token
from api.schemas import IngestIn, IngestRunOut, MessageOut
from core.config import settings

router = APIRouter(
    prefix="/admin", tags=["admin"], dependencies=[Depends(require_ingest_token)]
)


async def _run_ingestion(payload: IngestIn) -> None:
    # Imported lazily so the API boots even when Playwright isn't installed.
    from workers.pipeline import run_ingestion

    await run_ingestion(
        sources=payload.sources,
        cities=payload.cities or settings.default_cities,
        query=payload.query,
        limit_per_source=payload.limit_per_source,
    )


@router.post("/ingest", response_model=MessageOut, status_code=202)
async def trigger_ingest(payload: IngestIn, background: BackgroundTasks) -> MessageOut:
    """Kick off a scrape in the background; poll /v1/admin/runs for progress."""
    background.add_task(_run_ingestion, payload)
    return MessageOut(
        ok=True,
        message="Ingestion started.",
        data={
            "sources": payload.sources or ["all configured"],
            "cities": payload.cities or settings.default_cities,
        },
    )


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
