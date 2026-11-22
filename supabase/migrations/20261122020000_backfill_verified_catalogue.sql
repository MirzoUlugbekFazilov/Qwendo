-- Backfill the catalogue that predates deterministic verification.
--
-- 20261122010129 adds verification_status with a 'pending_review' default, and
-- every public surface (hero_events, trending_events, search_events, match_events,
-- catalogue_stats) then filters for 'verified'. Without this backfill the whole
-- catalogue goes dark the moment those migrations land: empty homepage, empty
-- discover feed, zeroed stats.
--
-- Treating the existing rows as verified is the correct reading of their
-- provenance, not a shortcut. Ingestion already ran every non-demo listing
-- through core.links.classify_event_url() and dropped anything that was not a
-- 'direct' link to the official event page, which is the same evidence the new
-- pipeline records. workers/discovery_jobs.py writes official_url = url for any
-- source that is not listing-only, so that assignment is reproduced here rather
-- than invented. last_verified_at reuses the real crawl timestamps so freshness
-- ordering stays truthful instead of being bumped to now().
--
-- Deliberately excluded: demo and seeded rows, non-HTTPS urls, and anything not
-- 'active'. Those stay pending_review and remain invisible to the public API.
update public.events
set verification_status = 'verified',
    last_verified_at = coalesce(last_verified_at, last_seen_at, first_seen_at, now()),
    official_url = coalesce(official_url, url)
where verification_status = 'pending_review'
  and status = 'active'
  and source <> 'demo'
  and (raw->>'seeded') is distinct from 'true'
  and url like 'https://%';
