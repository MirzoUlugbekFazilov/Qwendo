"""Schedule permitted discovery and consume fenced PostgREST leases.

refresh accepts operator city/query/limit. verify_url accepts one approved JSON-LD
detail URL. gap_scan plans shared searches. interest_gap carries only a dictionary
slug and an operator-configured city, which are revalidated before every request.
Per-attempt HTTP measurements use discovery_usage(job_id, attempt).
"""
import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
import re

from core.config import settings
from core.supabase import service_client
from workers.usage import measure_requests


def words(value):
    return " ".join(re.findall(r"\w+", value.casefold())) if isinstance(value, str) else ""


def terms_for(entry):
    return {words(v) for v in [entry["slug"], entry["label"], *entry["keywords"]]} - {""}


def gap_pairs(profiles, taxonomy, cities, inventory):
    """One followed public term can start a search shared across a city."""
    places = {words(city): city for city in cities}
    terms = {entry["slug"]: terms_for(entry) for entry in taxonomy}
    demand = set()
    for profile in profiles:
        city = places.get(words(profile.get("city")))
        if city:
            selected = {words(t.get("name")) for t in profile.get("interests") or []
                        if isinstance(t, dict) and (t.get("confirmed") is True or t.get("source") == "explicit")}
            categories = {c for c in profile.get("categories") or [] if isinstance(c, str)}
            for entry in taxonomy:
                slug = entry["slug"]
                if selected & terms[slug] or slug in categories:
                    demand.add((city, slug))
    coverage = {}
    for event in inventory:
        fields = [event.get("title"), *(event.get("tags") or []), *(event.get("categories") or [])]
        corpus = " " + " ".join(map(words, fields)) + " "
        coverage.setdefault(words(event.get("city")), []).append(corpus)
    labels = {e["slug"]: e["label"] for e in taxonomy}
    return [(city, slug, labels[slug]) for city, slug in sorted(demand)
            if not any(f" {term} " in corpus for term in terms[slug]
                       for corpus in coverage.get(words(city), []))]


async def read_all(db, table, columns, order, filters=None):
    result = []
    while True:
        page = await db.select(table, columns=columns, filters=filters, order=order,
                               limit=500, offset=len(result))
        result.extend(page)
        if len(page) < 500:
            return result


async def active_dictionary(db):
    return await read_all(db, "interests", "slug,label,category,keywords", "sort_order,slug",
                          {"is_active":"eq.true"})


async def gaps(db, source, now):
    profiles, taxonomy, inventory = await asyncio.gather(
        read_all(db, "user_discovery_profiles",
                 "city:profile->>city,categories:profile->categories,interests:profile->interests", "user_id"),
        active_dictionary(db),
        read_all(db, "events", "city,title,tags,categories", "id", {
            "status":"eq.active", "verification_status":"eq.verified",
            "canonical_event_id":"is.null", "starts_at":f"gt.{now.isoformat()}"}),
    )
    return gap_pairs(profiles, taxonomy,
                     (source.get("config") or {}).get("cities", settings.default_cities), inventory)


def event_row(event, now, taxonomy=()):
    row = event.to_row()
    fields = [event.title, event.summary, event.description, event.organizer, *event.tags]
    corpus = " " + " ".join(map(words, fields)) + " "
    for entry in taxonomy:
        if any(f" {term} " in corpus for term in terms_for(entry)):
            for key, value in (("tags", entry["slug"]), ("categories", entry["category"])):
                if value not in row[key]:
                    row[key] = [*row[key], value]
    raw = event.raw or {}
    row.update(official_url=None if raw.get("listing_only") is True else event.url,
               last_verified_at=now.isoformat(),
               verification_status="cancelled" if event.status == "cancelled" else "verified")
    if published := raw.get("source_published_at"):
        row["source_published_at"] = published
    return row


async def enqueue(db, source, kind, key, payload):
    return await db.rpc("discovery_enqueue", {"p_source":source, "p_kind":kind,
                                               "p_key":key, "p_payload":payload})


async def schedule(db, now):
    sources = await read_all(db, "discovery_sources", "*", "slug", {"enabled":"eq.true"})
    for source in sources:
        last = source["last_success_at"]
        if last and datetime.fromisoformat(last) + timedelta(minutes=source["interval_minutes"]) > now:
            continue
        kinds = []
        if source["kind"] in ("search", "ticketmaster"):
            kinds.append("gap_scan")
        if source["kind"] != "search" or (source.get("config") or {}).get("query"):
            kinds.append("refresh")
        for kind in kinds:
            recent = await db.select("discovery_jobs", columns="id", filters={
                "source_slug":f"eq.{source['slug']}", "kind":f"eq.{kind}", "dedupe_key":"eq.scheduled",
                "created_at":f"gt.{(now-timedelta(minutes=source['interval_minutes'])).isoformat()}"},
                limit=1)
            if not recent:
                await enqueue(db, source["slug"], kind, "scheduled", {})


def estimated_cost(price, billable):
    if price is None:
        return None
    try:
        amount = Decimal(str(price))
        return str(amount * billable) if amount.is_finite() and amount >= 0 else None
    except InvalidOperation:
        return None


async def execute(db, job, discover):
    price = None
    with measure_requests() as usage:
        try:
            source = await db.select("discovery_sources", filters={"slug":f"eq.{job['source_slug']}"}, single=True)
            if source:
                price = (source.get("config") or {}).get("cost_per_request_gbp")
            return await process_job(db, job, source, discover)
        finally:
            await db.insert("discovery_usage", {
                "job_id":job["id"], "attempt":job["attempts"], "source_slug":job["source_slug"],
                "requests":usage.requests, "billable_requests":usage.billable_requests,
                "estimated_cost_gbp":estimated_cost(price, usage.billable_requests),
            }, upsert=True, on_conflict="job_id,attempt", returning="minimal")


async def covered_images(db, source):
    """External ids this source has already supplied a cover for.

    Calendar feeds carry no artwork, so without this the connector cannot tell
    a cover it fetched last run from one it has never had, and would spend its
    whole page budget re-fetching the same events every time.
    """
    if (source.get("config") or {}).get("detail_images") is not True:
        return set()
    rows = await read_all(db, "events", "external_id", "external_id",
                          {"source": f"eq.{source['slug']}", "image_url": "not.is.null"})
    return {row["external_id"] for row in rows if row.get("external_id")}


async def process_job(db, job, source, discover):
    if not source or not source["enabled"] or not source["permission"].strip() or not source["allowed_hosts"]:
        raise ValueError("Source permission required")
    now = datetime.now(UTC)
    kind, payload = job["kind"], job["payload"]
    config = dict(source.get("config") or {})
    if kind in ("gap_scan", "interest_gap"):
        if source["kind"] not in ("search", "ticketmaster"):
            raise ValueError("Source does not support gap search")
        pairs = await gaps(db, source, now)
        if kind != "interest_gap":
            for city, slug, _ in pairs:
                await enqueue(db, source["slug"], "interest_gap", f"{city}/{slug}", {"city":city,"slug":slug})
            return False
        match = next(((city, label) for city, slug, label in pairs
                      if city == payload.get("city") and slug == payload.get("slug")), None)
        if not match:
            return False
        config.update(city=match[0], query=match[1])
    if kind == "refresh":
        config.update({k:payload[k] for k in ("city","query") if payload.get(k)})
    elif kind == "verify_url":
        if source["kind"] != "jsonld":
            raise ValueError("Detail checks require a permitted JSON-LD source")
        source = {**source, "url":payload["url"]}
    elif kind != "interest_gap":
        raise ValueError("Unknown discovery job kind")
    if source["kind"] == "search" and config.get("city"):
        config["query"] = f"{config.get('query', '')} events in {config['city']}".strip()
    limit = max(1, min(400, int(payload.get("limit") or 50)))
    run = (await db.insert("ingestion_runs", {"source":source["slug"], "query":kind}))[0]
    stats = {"found":0,"skipped":0,"status":"failed","errors":1}
    try:
        from workers.connectors import collect_reviews
        with collect_reviews() as reviews:
            try:
                events = await discover(
                    {**source, "config": config, "covered_images": await covered_images(db, source)},
                    limit=limit)
            finally:
                if reviews:
                    await db.rpc("discovery_quarantine", {
                        "p_source": source["slug"], "p_reviews": reviews,
                        "p_job_id": job["id"], "p_token": job["lease_token"],
                    })
                    stats["skipped"] += len(reviews)
        stats["found"] = len(events)
        if kind == "verify_url" and not events:
            raise ValueError("No verifiable event on submitted page")
        taxonomy = await active_dictionary(db) if events else []
        for event in events:
            if config.get("listing_only") is True:
                event = event.model_copy(update={"raw":{**(event.raw or {}), "listing_only":True}})
            row = event_row(event, now, taxonomy)
            outcome = await db.rpc("discovery_persist", {
                "p_source":source["slug"], "p_event":row,
                "p_evidence":{"verification_status":row["verification_status"],
                              "reason":f"Permitted {source['kind']} listing", "url":event.url},
                "p_job_id":job["id"], "p_token":job["lease_token"]})
            stats["skipped"] += int(outcome["outcome"] == "quarantined")
        stats.update(status="partial" if stats["skipped"] else "success", errors=0)
    except Exception as exc:
        stats["error_text"] = type(exc).__name__
        raise
    finally:
        await db.update("ingestion_runs", {**stats, "finished_at":datetime.now(UTC).isoformat()},
                        filters={"id":f"eq.{run['id']}"}, returning="minimal")
    return True


async def drain(db, *, discover, max_jobs=100):
    failures = 0
    for _ in range(max_jobs):
        jobs = await db.rpc("discovery_lease", {"p_limit":1, "p_lease_seconds":600})
        if not jobs:
            break
        job = jobs[0]
        lease = {"p_id":job["id"], "p_token":job["lease_token"]}
        try:
            async with asyncio.timeout(540):
                observed = await execute(db, job, discover)
        except Exception as exc:
            failures += 1
            await db.rpc("discovery_fail", {**lease, "p_error":type(exc).__name__,
                         "p_retry_seconds":min(3600, 60 * 2**min(6, job["attempts"]-1))})
        else:
            if not await db.rpc("discovery_ack", lease):
                failures += 1
            elif observed:
                await db.update("discovery_sources", {"last_success_at":datetime.now(UTC).isoformat()},
                                filters={"slug":f"eq.{job['source_slug']}"}, returning="minimal")
    return failures


async def main():
    from workers.connectors import discover
    db = service_client()
    try:
        await schedule(db, datetime.now(UTC))
        return bool(await drain(db, discover=discover))
    finally:
        await db.aclose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
