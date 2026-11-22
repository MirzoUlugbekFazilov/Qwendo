# Discovery operations

Use `/admin/discovery` to configure permitted sources, change check intervals and inspect discovery results. The web route verifies the signed-in Supabase user and requires `app_metadata.qwendo_admin === true`. Every read and mutation forwards that user’s Bearer access token to FastAPI. The admin page displays source settings, jobs, reviews, coverage, keyword entries, metrics and organiser submissions.

## Installed sources

The operations migration enables two iCalendar feeds on a fresh installation. Both publishers provide syndication permission and neither feed requires an API key. Existing rows with the same slug retain their settings.

| Registry slug | Check interval | Source permission and listing behaviour |
|---|---|---|
| `tickts-london` | 360 minutes (6 hours) | The feed supplies Tickts event pages. [Publisher terms](https://tickts.co.uk/for-editors/london) |
| `swiss-zurich` | 1440 minutes (24 hours) | Swiss Data Events supplies syndicator attribution pages. The registry sets `{"listing_only":true}`. [Publisher terms](https://swissdataevents.ch/data/) |

## Register a permitted source

1. Open **Sources and schedules → Add source**. Choose a stable lowercase identifier and one of `ticketmaster`, `jsonld`, `rss`, `ical` or `search`.
2. Enter the public HTTPS endpoint. List the source hostname and each permitted destination under **Allowed hosts**. Record the permission or terms that authorise collection. Keep provider secrets in the worker environment.
3. Set the connector’s **Configuration (JSON)** and **Check interval (minutes)**. The API accepts intervals from 1 to 525600. New source records default to disabled.
4. Enable the source once configured. Use **Last success**, **Jobs** and **Reviews** to check the next run. The interval specifies eligibility for a check. Actual execution also depends on worker cadence, queue capacity and provider availability.

The registry is `public.discovery_sources`, keyed by `slug`. Operator changes use `PUT /v1/admin/discovery/sources/{slug}`. The request includes `kind`, `enabled`, `permission`, `url`, `allowed_hosts`, `config` and `interval_minutes`. Worker success is recorded in `last_success_at`.

## Connector inputs

| Kind | Publisher input and evidence |
|---|---|
| `jsonld` | An authorised event page or JSON document containing a recognised schema.org event, title and timezone-qualified start. `{"page_fallback": true}` also enables event-scoped microdata extraction. |
| `rss` | RSS items with an event link and event-module start date. The item’s publication date records publication time only. Set `config.page_fallback` to `true` to follow allowed item links for event details when page access is permitted. |
| `ical` | Calendar `VEVENT` entries with a title, event URL and unambiguous timed start. Date-only entries and recurrence rules without expanded occurrences are skipped. |
| `ticketmaster` | Use `https://app.ticketmaster.com/discovery/v2/events.json` with `TICKETMASTER_API_KEY`. List the API host and permitted listing hosts. Config keys are `city`, `query` and `lookahead_days`. |
| `search` | Use `https://api.search.brave.com/res/v1/web/search` with `BRAVE_SEARCH_API_KEY`. Allowlist the API and each permitted publisher host. Set `config.query` for a fixed search, or allow the worker to construct public topic/city gap queries. Results supply candidate URLs. Each destination must provide event evidence. |

For **Swiss Data Events**, set `config.listing_only` to the JSON boolean `true`. Its URL identifies a syndicator listing. Keep `official_url` null when no independently verified organiser URL is available. The detail page labels the verified original URL **Source listing**. An independently verified, distinct official URL enables **View Official Event** alongside the attribution.

The connector entrypoint is `await workers.connectors.discover(source_row, limit=50)`. Each normalised result carries the registry slug in `source`, the event URL in `url` and a source publication timestamp in `raw["source_published_at"]` when available. The worker supplies verification evidence. The database records discovery time.

## Dictionary

Open **Keyword dictionary → Add keyword**, enter the identifier, and supply this shape in **Dictionary entry (JSON)**:

```json
{
  "label": "Jazz",
  "category": "music",
  "keywords": ["jazz", "bebop", "big band"],
  "sort_order": 100
}
```

Existing entries expand for editing. **Save keyword** upserts `public.interests` through `PUT /v1/admin/discovery/keywords/{slug}`. The API accepts up to 80 keywords of up to 120 characters each, trims whitespace and removes duplicates. The table also has an `is_active` column. This endpoint edits the dictionary content and sort order only. `sort_order` is optional and defaults to 100. Use public terms suitable for the shared catalogue.

## Organiser submissions

Signed-in organisers can use **Submit an event** in the footer. The form accepts a public HTTPS URL, an optional title (200 characters) and notes (1500 characters). `POST /v1/discovery/submissions` records the submission for review. Intake performs URL validation without fetching the listing. Repeating the same URL for the same account returns the existing submission. The database caps new submissions at ten per account per rolling day.

In **Organiser submissions**, choose **Queue for verification**, select an enabled `jsonld` source whose `allowed_hosts` contains the submitted hostname and apply the review. Choose **Reject** for a submission outside the source permission or scope. The action sends `POST /v1/admin/discovery/submissions/{id}/review` with `decision` and `source_slug`. A queue decision schedules source checks. Publication requires successful verification.

## Catalogue provenance

| Field | Meaning |
|---|---|
| `verification_status` | `verified`, `pending_review`, `rejected` or `cancelled` |
| `first_seen_at` | Qwendo’s first discovery of the listing |
| `source_published_at` | Publication time explicitly supplied by the source, when available |
| `last_verified_at` | Most recent verification timestamp |
| `url` | Original publisher or syndicator listing |
| `official_url` | Verified official event destination, nullable |
| `canonical_event_id` | Optional link to the canonical event row |

Top Picks uses discovery time for **Recently Discovered**. Event details show **Announced** only when the source supplies a publication timestamp. **View Official Event** requires a verified record and a valid web destination. Missing timestamps, price and availability stay unknown.

## Queue and evidence

A queued job has a source, kind, deduplication key and payload. The worker leases a job, supplies its ID and lease token when persisting each event and then acknowledges the job. Transient failure delays the next attempt. An expired lease allows another worker to resume processing. Inspect retained evidence in `discovery_reviews` when observations conflict. Legacy event rows start in pending review. The verified catalogue includes active, upcoming canonical events.

See the [database contract](discovery-db-contract.md) for RPC parameter names, outcomes and lease rules.

## Worker and Radar

Run one scheduler and queue-draining pass against an authorised development database with `make ingest` (`python -m workers.discovery_jobs`). The Actions workflow in `.github/workflows/ingest.yml` requests a pass every ten minutes and supports manual dispatch. It consumes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Actions secrets and provider keys for any enabled API connectors. `DEFAULT_CITIES` is a comma-separated Actions variable, defaulting to London. A search source can specify `config.cities` as an array to select its own cities. For a local run, export `BRAVE_SEARCH_API_KEY` into the worker process when using Brave. Run `make radar` to prepare in-app entries for subscribed accounts. Both processes need server-side Supabase configuration. Saving a profile queues a deduplicated `gap_scan` for each enabled search or Ticketmaster source when interests, categories or city change. A gap scan compares explicit or confirmed interests against the active public dictionary and verified upcoming inventory. The submitted query uses the public dictionary label and an operator-approved city. Free-text profile and Radar answers stay inside Qwendo. See [deployment](../DEPLOYMENT.md) for environment boundaries.

## Monitoring

`GET /v1/admin/discovery` powers the operator view. Inspect a source’s permission, interval and last successful check together with recent job results. The dashboard shows up to 100 rows each for sources, jobs, reviews, submissions and dictionary entries. Metrics include source listing counts, unique verified canonical events, duplicate listings, verification failures, pending reviews and last success. Per-attempt usage records count requests and billable API requests. Set `config.cost_per_request_gbp` to the provider’s known per-request price to calculate an estimate. A missing billable price leaves the estimate unknown. Coverage counts upcoming active verified canonical events by location and tag, with up to 500 groups; a single event can appear in several tag groups.

An empty response from a working source, a failed provider request and an event quarantined for review have different implications for coverage. Check the job error and source settings before retrying. Keep a source disabled while its permission or destination is unresolved.

For a rollout, first initialise the development database from the migrations, inspect the installed sources, run a bounded worker pass and inspect the resulting verified event and official link. Confirm the public listing, operator controls and submission review before expanding the set of enabled sources.

## Local checks

Run `make check` for the Python and frontend checks. The SQL assertions in `tests/deterministic_discovery.sql`, `tests/organiser_submissions.sql` and `tests/discovery_rls.sql` exercise a migrated development database. The browser fixture runs the UI against local mock services. Review API payloads separately when a fixture models only a subset of the server contract.
