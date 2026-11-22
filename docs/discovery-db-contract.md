# Discovery database contract

Migration `20261122010129_deterministic_discovery.sql`. Call these public RPCs with the service role. Parameter names are PostgREST JSON keys.

| RPC | Result |
| --- | --- |
| discovery_enqueue(p_source text, p_kind text, p_key text, p_payload jsonb) | UUID. Repeated keys within a source and kind reuse the active job. |
| discovery_lease(p_limit int, p_lease_seconds int) | Array of discovery_jobs including id, source_slug, kind, payload, attempts and lease_token. |
| discovery_ack(p_id uuid, p_token uuid) | Boolean. Only the current unexpired lease can acknowledge. |
| discovery_fail(p_id uuid, p_token uuid, p_error text, p_retry_seconds int) | Boolean. Delay the next attempt. A negative delay or exhausted attempts ends the job. |
| discovery_persist(p_source text, p_event jsonb, p_evidence jsonb, p_job_id uuid default null, p_token uuid default null) | Object with event_id and outcome (stored or quarantined). Supply both lease arguments on worker calls. Ack after processing all listings. |
| discovery_monitor() | Object with job_counts and review_counts grouped by status. |
| discovery_quarantine(p_source text, p_reviews jsonb, p_job_id uuid, p_token uuid) | Integer count of distinct open review keys inserted or refreshed. Pass the array from `collect_reviews()` before ack or fail. Empty arrays return zero. |

Each connector review supplies `external_id`, `reason`, `listing` and `evidence`. An optional `source_slug` must match the job source. The RPC requires the current unexpired lease on an enabled source and accepts up to 200 rows atomically. Within a batch the last observation for each external ID and reason wins. Retrying refreshes its pending review. Closed reviews retain their history. The RPC writes only to `discovery_reviews`.

Connectors return normalized event fields. Required fields are external_id, title, url (original provider listing) and starts_at with an explicit timezone. Supply official_url only for a stable event detail page. source_published_at is the provider's publication time. The database assigns first_seen_at. Evidence keys are verification_status, reason, url. Omitted status defaults to pending_review. Verified, rejected and cancelled observations require a reason and evidence URL. Workers check permission, DNS, redirects and allowed_hosts before any fetch. Search hits require authorized detail-page verification before promotion.

The registry is discovery_sources. Only enabled sources with recorded permission may run. Operators update the existing interests table (slug, label, category, keywords, sort_order, is_active). Canonical event rows have null canonical_event_id. Eligible rows are active, verified canonical events with upcoming starts_at. Provider listing history is in event_source_listings. Quarantined observations are retained in discovery_reviews with their incoming event and evidence. Legacy rows retain their IDs, links and timestamps and default to pending_review.

The connector entry point is `await workers.connectors.discover(source_row, limit=50)`, returning a list of `NormalizedEvent`. The worker supplies the registry slug, normalized event and verification evidence to `discovery_persist`. For an attributed feed, set `config.listing_only` to JSON `true`. The verified source page remains in `events.url`. A missing official URL stays null, and a listing-only source cannot promote its own attribution link to an official link. REST, search and trending can return these verified listings.

The source and external ID identify a provider listing. URL matches also require the same start instant. A verified update from the canonical provider can change its schedule and venue using the same external ID. Conflicting provider observations set affected verified canonical rows to pending review. Open conflicts block republication until an operator resolves the review and the worker supplies fresh evidence. Missing start offsets and unknown locations produce quarantined observations.

For discovery writes, public `events.raw` accepts a recognized availability token, a valid offset-bearing ISO sale timestamp in `onsale`, and the seeded exclusion flag. An authoritative refresh clears obsolete availability or sale data. Service-only listing and review records retain the input evidence. Saved associations retain owner access and authenticated owners can read their verified historical records.
