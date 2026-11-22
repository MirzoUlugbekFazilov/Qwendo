"""Operate Qwendo's discovery queue and inspect the catalogue."""
import argparse
import asyncio
from datetime import UTC, datetime, timedelta
import hashlib
import json
import logging
import sys

import httpx

from core.config import settings
from core.links import classify_event_url
from core.supabase import service_client
from workers import discovery_jobs
from workers.connectors.fetch import checked_url


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("limit must be positive")
    return number


def build_parser():
    parser = argparse.ArgumentParser(prog="workers.run", description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command")
    ingest = sub.add_parser("ingest", help="enqueue refreshes for authorised sources")
    ingest.add_argument("-c", "--city", action="append")
    ingest.add_argument("-q", "--query")
    links = sub.add_parser("links", help="audit stored URL shape and approved hosts offline")
    for command in (ingest, links):
        command.add_argument("-s", "--source", action="append", help="source slug (repeatable)")
        command.add_argument("-n", "--limit", type=positive)
    sub.add_parser("sources", help="list source registry status")
    sub.add_parser("expire", help="retire active events that started over 12 hours ago")
    sub.add_parser("seed", help="explain demo seeding retirement")
    embed = sub.add_parser("embed", help="explain embedding retirement")
    embed.add_argument("-n", "--limit", type=int)
    return parser


async def audit_links(db, selected, permitted, remaining):
    problems = 0
    for slug in selected:
        rows = await db.select("events", columns="url,title", filters={
            "source": f"eq.{slug}", "status": "eq.active"}, order="starts_at,id", limit=remaining)
        for row in rows:
            try:
                checked_url(row["url"], permitted[slug]["allowed_hosts"])
                result = classify_event_url(slug, row["url"])
            except ValueError:
                result = "invalid"
            print(slug, result, row["title"], sep="\t")
            problems += int(result != "direct")
        remaining -= len(rows)
        if not remaining:
            break
    return int(bool(problems))


async def operate(args):
    if args.command is None:
        return int(await discovery_jobs.main())
    if args.command == "embed":
        print("Embedding backfill is retired. Discovery uses the public keyword dictionary.")
        return 1
    if args.command == "seed":
        print("Demo seeding is retired with the legacy ingestion pipeline.")
        return 1
    db = service_client()
    try:
        if args.command == "expire":
            cutoff = datetime.now(UTC) - timedelta(hours=12)
            await db.update("events", {"status": "expired"}, returning="minimal",
                            filters={"status": "eq.active", "starts_at": f"lt.{cutoff.isoformat()}"})
            print("Past active events retired.")
            return 0
        registry = await discovery_jobs.read_all(db, "discovery_sources",
            "slug,kind,enabled,permission,allowed_hosts", "slug")
        permitted = {s["slug"]: s for s in registry if s["enabled"] and
                     (s["permission"] or "").strip() and s["allowed_hosts"]}
        if args.command == "sources":
            for source in registry:
                state = "enabled" if source["slug"] in permitted else "disabled"
                print(source["slug"], source["kind"], state, sep="\t")
            return 0
        selected = list(dict.fromkeys(args.source or permitted))
        missing = [slug for slug in selected if slug not in permitted]
        if missing or not selected:
            print("Unauthorised or unknown sources:" if missing else "No authorised sources.",
                  *missing, file=sys.stderr)
            return 1
        if args.command == "links":
            return await audit_links(db, selected, permitted, args.limit or 30)
        for slug in selected:
            supports_city = permitted[slug]["kind"] in ("ticketmaster", "search")
            cities = (args.city or settings.default_cities) if supports_city else [None]
            for city in dict.fromkeys(cities):
                options = {"city": city, "query": args.query, "limit": args.limit}
                payload = {k: v for k, v in options.items() if v is not None}
                # Match the operator API so a retry through either interface shares the job.
                digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
                job = await discovery_jobs.enqueue(db, slug, "refresh", "manual:" + digest, payload)
                print(f"Queued {slug} refresh {job}")
        return 0
    finally:
        await db.aclose()


def main(argv=None):
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        return asyncio.run(operate(args))
    except KeyboardInterrupt:
        return 130
    except (RuntimeError, httpx.HTTPError) as exc:
        print(f"Worker command failed ({type(exc).__name__}).", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
