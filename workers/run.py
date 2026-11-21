"""Command line entrypoint for the ingestion workers.

    python -m workers.run seed                        # load the demo catalogue
    python -m workers.run ingest                      # every configured source, default cities
    python -m workers.run ingest -s ticketmaster -c London -c Manchester
    python -m workers.run ingest -s luma --query "ai"
    python -m workers.run links -n 40                 # audit outbound ticket links
    python -m workers.run embed --limit 1000          # backfill missing vectors
    python -m workers.run expire                      # retire events that already happened
    python -m workers.run sources                     # show configuration status
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from core.config import settings
from core.supabase import service_client
from workers.pipeline import backfill_embeddings, expire_past_events, run_ingestion
from workers.seed_demo import seed
from workers.sources import SOURCES


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def _ingest(args: argparse.Namespace) -> int:
    results = await run_ingestion(
        sources=args.source or None,
        cities=args.city or None,
        query=args.query,
        limit_per_source=args.limit,
    )
    if not results:
        print("Nothing ran. Check your source credentials in .env.")
        return 1

    print(f"\n{'source':<14}{'city':<16}{'found':>7}{'new':>7}{'upd':>7}  status")
    print("-" * 62)
    for row in results:
        print(
            f"{row['source']:<14}{(row['city'] or 'anywhere'):<16}"
            f"{row['found']:>7}{row['inserted']:>7}{row['updated']:>7}  {row['status']}"
        )
        if row.get("error"):
            print(f"  ↳ {row['error']}")
    return 0 if all(row["status"] == "success" for row in results) else 1


async def _seed(_: argparse.Namespace) -> int:
    inserted, updated, _skipped = await seed()
    print(f"Demo catalogue ready: {inserted} inserted, {updated} updated.")
    print(
        "\nNote: demo events are fictional and link to marketplace search pages,\n"
        "not real ticket listings. Clear them before any public demo:\n"
        "  delete from public.events where source = 'demo';"
    )
    return 0


async def _embed(args: argparse.Namespace) -> int:
    db = service_client()
    try:
        total = 0
        while True:
            count = await backfill_embeddings(db, limit=min(args.limit - total, 500))
            total += count
            print(f"Embedded {total} events…")
            if count == 0 or total >= args.limit:
                break
        print(f"Done. {total} events embedded with provider '{settings.embedding_provider}'.")
        return 0
    finally:
        await db.aclose()


async def _expire(_: argparse.Namespace) -> int:
    db = service_client()
    try:
        await expire_past_events(db)
        print("Past events retired.")
        return 0
    finally:
        await db.aclose()


async def _links(args: argparse.Namespace) -> int:
    from workers.verify_links import report, verify

    checks = await verify(sources=args.source or None, limit=args.limit)
    return 1 if report(checks) else 0


async def _sources(_: argparse.Namespace) -> int:
    print(f"{'source':<16}{'configured':<13}homepage")
    print("-" * 62)
    for slug, source in SOURCES.items():
        state = "yes" if source.is_configured() else "no (needs key)"
        print(f"{slug:<16}{state:<13}{source.homepage}")
    print(f"\nEmbedding provider: {settings.embedding_provider} ({settings.embedding_dim}d)")
    print(f"Supabase project:   {settings.supabase_url}")
    print(f"Service role key:   {'set' if settings.has_service_role else 'MISSING'}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="workers.run", description="Qwendo ingestion workers")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="scrape sources and upsert events")
    ingest.add_argument("-s", "--source", action="append", help="source slug (repeatable)")
    ingest.add_argument("-c", "--city", action="append", help="city (repeatable)")
    ingest.add_argument("-q", "--query", help="keyword filter passed to the source")
    ingest.add_argument("-n", "--limit", type=int, help="max events per source")
    ingest.set_defaults(handler=_ingest)

    sub.add_parser("seed", help="insert the demo catalogue").set_defaults(handler=_seed)

    embed = sub.add_parser("embed", help="backfill missing embeddings")
    embed.add_argument("-n", "--limit", type=int, default=2000)
    embed.set_defaults(handler=_embed)

    links = sub.add_parser("links", help="audit outbound ticket links")
    links.add_argument("-s", "--source", action="append", help="source slug (repeatable)")
    links.add_argument("-n", "--limit", type=int, default=30)
    links.set_defaults(handler=_links)

    sub.add_parser("expire", help="retire past events").set_defaults(handler=_expire)
    sub.add_parser("sources", help="show source configuration").set_defaults(handler=_sources)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    _configure_logging(args.verbose)
    try:
        return asyncio.run(args.handler(args))
    except KeyboardInterrupt:
        return 130
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
