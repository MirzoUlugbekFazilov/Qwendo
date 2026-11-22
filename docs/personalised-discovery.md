# Personalised discovery

New accounts start at `/onboarding` after email registration or confirmation, or after a successful OAuth callback. A session is required to load or save answers. The six steps end in a review. Confirming opens `/picks`; the dashboard links back to the editor. Returning members with an older profile start the editor with their existing interests and city.

## Storage and consent

The personalised discovery and Radar consent migrations add four owner-scoped tables and consent checks. A draft stores the current step and editable answers. The final profile stores a bounded structured document so that each user can add arbitrary topics without creating public taxonomy entries. Notification settings are a separate record. Confirmation uses one transaction to publish that document, save consent, update the existing account and remove its draft. Each private request uses the signed-in user's token. Deleting the underlying Supabase account cascades to the four new tables.

A topic keeps its origin, confidence, source text, related concepts, priority and confirmation status. Confirming a suggested topic preserves its inferred origin. Users can review or remove individual topics and change notification settings in the editor. Keep raw user text out of application logs and analytics.

## Matching

The ranker in `api/discovery_ranking.py` reads `RANKING_WEIGHTS` from the shared settings in `core/config.py`. Default weights are 40% for topics, 25% for motivations and formats, 15% for location, 10% for scheduling and 10% for budget. These scores order events; they are not probabilities. Precise location permission is unnecessary. When coordinates are missing, city-level matching is approximate. GBP limits use known prices; the ranker does not estimate exchange rates. An active listing alone does not verify ticket availability.

## Interest suggestions

On the interests step, choose **Suggest interests from my text**. On the Radar step, choose **Suggest radar interests**. Free-text extraction uses deterministic terms and aliases. Users review extracted topics, can add their own, and can remove related suggestions.

## Event details

On a pick, **View Details** opens the catalogue record. **View Official Event** opens a verified official destination when available. **Source listing** credits a distinct verified publisher URL, including syndication-only listings. **Discovered** is the first time Qwendo recorded the listing. **Announced** uses the source publication timestamp when supplied. **Last verified** refers to the most recent verification. The source controls current prices and availability.

## Radar delivery

In step six, **Radar delivery** lets users choose Immediate (the default), Daily or Weekly, select an IANA time zone, and optionally enable a pair of quiet hours. Quiet hours can cross midnight. Frequencies control the minimum time between eligible batches. Notification consent is set separately. Use **Edit preferences** in Top Picks to change delivery settings later.

Radar entries are delivered in the signed-in dashboard. They use recorded marketplace sightings and the user's separate opt-ins. Ticket reminders require an actual sale timestamp supplied by the source. With match alerts enabled, Radar can also report a recent verified change to an event’s schedule, venue, status, price or availability. A revision timestamp distinguishes each material change from routine verification checks. A uniqueness constraint prevents repeated entries for the same user, event and notification kind. The weekly kind includes its ISO week.

`python -m workers.radar` prepares in-app entries using the server service-role credential. The separate Radar workflow runs every six hours when enabled on GitHub's default branch and configured with the same Supabase secrets as ingestion. Opening the dashboard reads alerts already delivered by the worker. Immediate delivery is eligible on the worker’s next run outside quiet hours. No email, SMS or browser-push provider is configured by this feature.

## Verification

Run `make check` from the repository root for Python tests, frontend type checking and picks-model tests. Use `make build` for the frontend production build. The SQL assertions in `tests/discovery_rls.sql` use two temporary accounts inside a transaction and roll back. The browser fixture in `tests/discovery-browser.cjs` exercises the real Next.js UI against local test accounts and labelled fixture services; see the file header for prerequisites.
