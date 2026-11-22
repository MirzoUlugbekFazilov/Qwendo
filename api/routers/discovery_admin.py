"""Operator controls and signed-in organiser submissions for discovery."""
from __future__ import annotations

import asyncio
import ipaddress
import re
from typing import Annotated, Any, Literal
from urllib.parse import parse_qsl, urlsplit, urlunsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.deps import CurrentUser, get_service_db
from core.supabase import SupabaseClient

router = APIRouter(tags=["discovery operations"])
Service = Annotated[SupabaseClient, Depends(get_service_db)]


def public_url(value: str) -> str:
    """Validate syntax at intake. The worker checks DNS and permission before fetching."""
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        invalid = (url.scheme != "https" or url.username is not None or url.password is not None
                   or url.port not in (None, 443) or "." not in host or len(host) > 253
                   or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part)
                          for part in host.split("."))
                   or host.endswith((".localhost", ".local", ".internal", ".test"))
                   or any(ord(c) < 33 or ord(c) == 127 or c == chr(92) for c in value)
                   or any(re.search("token|secret|password|api[_-]?key|signature", k, re.I)
                          for k, _ in parse_qsl(url.query, keep_blank_values=True)))
        try:
            ipaddress.ip_address(host)
            invalid = True
        except ValueError:
            pass
        if not invalid:
            return urlunsplit(("https", host, url.path or "/", url.query, ""))
    except ValueError:
        pass
    raise HTTPException(422, "Enter a public HTTPS event URL.")


def require_operator(user: CurrentUser) -> None:
    if (user.get("app_metadata") or {}).get("qwendo_admin") is not True:
        raise HTTPException(403, "Discovery administrator access is required.")


admin = APIRouter(prefix="/admin/discovery", dependencies=[Depends(require_operator)])


class Submission(BaseModel):
    url: str = Field(min_length=9, max_length=2000)
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1500)


@router.post("/discovery/submissions", status_code=202)
async def submit(body: Submission, user: CurrentUser, db: Service):
    identifier = await db.rpc("submit_organiser_url", {
        "p_user": user["id"], "p_url": public_url(body.url),
        "p_title": body.title, "p_notes": body.notes,
    })
    if not identifier:
        raise HTTPException(429, "Daily submission limit reached.")
    return {"id": identifier}


class SourceSettings(BaseModel):
    kind: Literal["ticketmaster", "jsonld", "rss", "ical", "search"]
    enabled: bool = False
    permission: str = Field(default="", max_length=2000)
    url: str = Field(min_length=9, max_length=2000)
    allowed_hosts: list[str] = Field(max_length=64)
    config: dict[str, Any] = Field(default_factory=dict)
    interval_minutes: int = Field(ge=1, le=525600)


def valid_slug(slug: str):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", slug):
        raise HTTPException(422, "Invalid identifier.")


@admin.put("/sources/{slug}")
async def save_source(slug: str, body: SourceSettings, db: Service):
    valid_slug(slug)
    url = public_url(body.url)
    hosts = sorted({host.strip().lower() for host in body.allowed_hosts})
    if (any(not host or public_url("https://" + host) != "https://" + host + "/" for host in hosts)
            or urlsplit(url).hostname not in hosts):
        raise HTTPException(422, "List the source hostname and each permitted destination explicitly.")
    if body.enabled and not body.permission.strip():
        raise HTTPException(422, "Record the source permission before enabling it.")
    cost = body.config.get("cost_per_request_gbp")
    if cost is not None and (type(cost) not in (int, float) or not 0 <= cost <= 1000000):
        raise HTTPException(422, "Set a finite, non-negative GBP cost per provider request.")
    row = {**body.model_dump(), "slug": slug, "url": url, "allowed_hosts": hosts}
    return (await db.insert("discovery_sources", row, upsert=True, on_conflict="slug"))[0]


class Keyword(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=80)
    keywords: list[str] = Field(max_length=80)
    sort_order: int = Field(default=100, ge=0, le=100000)


@admin.put("/keywords/{slug}")
async def save_keyword(slug: str, body: Keyword, db: Service):
    valid_slug(slug)
    keywords = list(dict.fromkeys(term.strip() for term in body.keywords if term.strip()))
    if any(len(term) > 120 for term in keywords):
        raise HTTPException(422, "Keep each keyword under 121 characters.")
    return (await db.insert("interests", {**body.model_dump(), "slug": slug, "keywords": keywords},
                            upsert=True, on_conflict="slug"))[0]


class Review(BaseModel):
    decision: Literal["queue", "reject"]
    source_slug: str | None = None


@admin.get("")
async def dashboard(db: Service):
    tables = {
        "sources": ("discovery_sources", "*", "slug.asc"),
        "jobs": ("discovery_jobs", "id,source_slug,kind,status,attempts,available_at,last_error", "created_at.desc"),
        "reviews": ("discovery_reviews", "id,source_slug,external_id,event_id,reason,status,created_at", "created_at.desc"),
        "keywords": ("interests", "slug,label,category,keywords,sort_order", "slug.asc"),
        "submissions": ("organiser_submissions", "id,url,title,notes,status,created_at", "created_at.desc"),
    }
    results = await asyncio.gather(*(
        db.select(table, columns=columns, order=order, limit=1000 if name in ("keywords", "sources") else 100)
        for name, (table, columns, order) in tables.items()
    ))
    data = dict(zip(tables, results))
    stats = await db.rpc("discovery_operator_metrics")
    return {**data, **stats}


@admin.post("/submissions/{submission_id}/review")
async def review_submission(submission_id: UUID, body: Review, db: Service):
    if body.decision == "queue":
        valid_slug(body.source_slug or "")
    result = await db.rpc("review_organiser_submission", {
        "p_id": str(submission_id), "p_source": body.source_slug, "p_decision": body.decision
    })
    if result is None:
        raise HTTPException(409, "Check the pending submission and its permitted source.")
    return {"status": result}
