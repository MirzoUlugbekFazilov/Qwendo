"""Qwendo API — FastAPI application entrypoint.

Run locally:  uvicorn api.main:app --reload --port 8000
Docs:         http://localhost:8000/docs
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.deps import close_clients
from api.routers import admin, events, me, recommendations
from core.config import settings
from core.supabase import SupabaseError


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_clients()


app = FastAPI(
    title="Qwendo API",
    version="0.1.0",
    summary="Event discovery that finds what you care about before the tickets run out.",
    description=(
        "Qwendo aggregates events from Ticketmaster, Eventbrite, Luma and more, "
        "then ranks them against each user's taste vector using pgvector."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(SupabaseError)
async def supabase_error_handler(_: Request, exc: SupabaseError) -> JSONResponse:
    """Surface database errors as clean HTTP responses instead of 500s."""
    status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
    return JSONResponse(status_code=status_code, content={"detail": exc.message})


@app.get("/health", tags=["meta"])
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "qwendo-api",
        "embedding_provider": settings.embedding_provider,
        "embedding_dim": settings.embedding_dim,
        "service_role_configured": settings.has_service_role,
    }


app.include_router(events.router, prefix="/v1")
app.include_router(recommendations.router, prefix="/v1")
app.include_router(me.router, prefix="/v1")
app.include_router(admin.router, prefix="/v1")
