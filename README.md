# Qwendo

**Never miss the event you actually care about.**

**Live:** [qwendo.vercel.app](https://qwendo.vercel.app) · **API:**
[qwendo-api.vercel.app/docs](https://qwendo-api.vercel.app/docs)

Qwendo aggregates events from Ticketmaster, Eventbrite, Luma and more, then ranks
them against each user's interests using vector search — so people hear about the
Spider-Man fan meet, the hackathon or the gig *while tickets are still on sale*,
not a week after it happened.

Qwendo never sells tickets. Every listing links back to the official source.

---

## Architecture

| Layer | Technology | Where |
|---|---|---|
| Frontend | Next.js 15 (App Router) + Tailwind CSS v4 | `web/` |
| API | FastAPI (Python 3.12+) | `api/` |
| Database & AI search | Supabase — Postgres 17 + pgvector + Auth + RLS | `supabase/migrations/` |
| Scrapers / workers | Python (httpx, Playwright) | `workers/` |
| Shared library | config, Supabase client, embeddings, taxonomy | `core/` |

```
browser ──► Next.js ──► FastAPI ──► Supabase (PostgREST + RPC)
                 │                      ▲
          Supabase Auth                 │
                                  workers/run.py ──► Ticketmaster / Eventbrite / Luma
```

**Live Supabase project:** `hfpnbzadymxttjnilkkz` (eu-west-1) — schema already applied.

---

## Quick start

```bash
cd ~/Desktop/Qwendo

make setup                 # venv + pip install + npm install + copy .env files
# add SUPABASE_SERVICE_ROLE_KEY (the sb_secret_… key) to .env

make seed                  # 24-event demo catalogue, embedded
make ingest                # pull real events from the configured sources
make dev                   # API on :8000, web on :3000
```

Then open <http://localhost:3000>. API docs live at <http://localhost:8000/docs>.

Without `make`:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt            # API + httpx scrapers
.venv/bin/pip install -r requirements-scrapers.txt   # adds Playwright (optional)
.venv/bin/python -m uvicorn api.main:app --reload --port 8000
cd web && npm install && npm run dev
```

---

## Environment

`.env` (repo root — backend + workers):

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | pre-filled |
| `SUPABASE_ANON_KEY` | yes | publishable key, pre-filled |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **secret** key. Server-side only — bypasses RLS |
| `EMBEDDING_PROVIDER` | — | `local` (default, free) or `openai` |
| `OPENAI_API_KEY` | if openai | for `text-embedding-3-small` |
| `TICKETMASTER_API_KEY` | optional | free key at developer.ticketmaster.com |
| `INGEST_TOKEN` | for `/v1/admin/*` | `openssl rand -hex 32` |
| `DEFAULT_CITIES` | — | comma-separated, e.g. `London,Manchester` |

`web/.env.local` (frontend): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_API_URL`. Only publishable values — the secret key never reaches the browser.

---

## How recommendations work

1. **Onboarding** — the user picks interests from a 53-entry taxonomy, adds free text
   ("huge Spider-Man fan, into AI startups") and a city.
2. **Taste vector** — labels + keywords + free text are embedded into
   `profiles.embedding` (`vector(1536)`).
3. **Event vectors** — every ingested event is embedded from its title, categories,
   tags, venue and description, stored in `events.embedding` with an **HNSW cosine index**.
4. **Ranking** — the `match_events` RPC blends four signals:

   | Weight | Signal |
   |---|---|
   | 0.62 | semantic similarity (pgvector cosine) |
   | 0.16 | happening-soon decay (45-day half-life) |
   | 0.14 | proximity to the user, within their radius |
   | 0.08 | popularity |

   It also filters by city/radius/date/category/price and drops anything the user dismissed.

5. **Explanation** — each card says *why* it surfaced, naming only categories the user
   actually selected.

**Embedding providers.** `local` is a deterministic hashed bag-of-words + bigram
projection: no API key, no cost, works offline, and cosine similarity degrades to
weighted vocabulary overlap — enough to build and demo on. Switch to `openai` for real
semantics (it knows "Spider-Man" relates to "superhero" without a literal word match),
then re-embed: `make embed`.

---

## Ingestion

```bash
python -m workers.run sources                        # what's configured
python -m workers.run ingest                         # all sources × DEFAULT_CITIES
python -m workers.run ingest -s luma -c London -n 60
python -m workers.run ingest -s ticketmaster -q "comic con"
python -m workers.run seed                           # demo catalogue
python -m workers.run links -n 40                    # audit outbound ticket links
python -m workers.run embed                          # backfill missing vectors
python -m workers.run expire                         # retire past events
```

| Source | Method | Key needed | Status |
|---|---|---|---|
| **Ticketmaster** | Official Discovery API v2 | yes (free) | wired; add `TICKETMASTER_API_KEY` to activate |
| **Eventbrite** | Parses the search page's `__SERVER_DATA__` JSON island | no | ✅ verified 2026-11-21 |
| **Luma** | Parses `__NEXT_DATA__` on city pages | no | ✅ verified 2026-11-21 |

### Ticketmaster setup

1. Sign up at <https://developer.ticketmaster.com> → **My Apps** → copy the **Consumer Key**.
2. Put it in `.env`: `TICKETMASTER_API_KEY=your_consumer_key`
3. `make ingest` — or just that source: `python -m workers.run ingest -s ticketmaster -c London`

The client honours the documented contract: `size × page < 1000` deep-paging cap,
≤5 requests/second (250 ms spacing), `includeTBA/TBD/Test=no` so every event has a real
date, `locale=*`, `sort=date,asc`, and a city→`countryCode` map so "London" doesn't also
return London, Ontario. It handles 401 (clear error), 429 (back off and retry) and
partial pages. Events arrive with venue coordinates, price bands merged across standard
and VIP tiers, the widest non-fallback 16:9 artwork, and the attraction/genre names as tags.

Ingestion is **idempotent**: events are keyed on `(source, external_id)` and a content
fingerprint means unchanged events are never re-embedded. Every run is recorded in
`ingestion_runs`.

Scraped sources depend on page structure that can change without notice — both have a
Playwright fallback (`python -m playwright install chromium`) and a tolerant tree-walk
that finds event records wherever they move. When a source breaks, the run is marked
`failed` in `ingestion_runs` and the other sources carry on. A source that returns zero
events is recorded as `partial`, never `success`, so a silent block is visible.

**Eventbrite blocks datacenter IPs.** Verified 2026-11-21: the same request that returns
80 events from a home connection returns `HTTP 405` from a GitHub Actions runner, and the
Playwright fallback gets the same treatment. Practical consequences:

| Environment | Ticketmaster | Eventbrite | Luma |
|---|---|---|---|
| Local machine | ✅ | ✅ | ✅ |
| GitHub Actions / cloud host | ✅ (official API) | ❌ blocked | ✅ |

So the scheduled job keeps Luma (and Ticketmaster, once you add a key) fresh, while
Eventbrite needs either `make ingest` from your own machine or a residential proxy.
A blocked source does **not** fail the workflow — the others still complete.

Scheduling: `.github/workflows/ingest.yml` runs every 6 hours. Add the same env vars as
repository secrets.

### Outbound link integrity

Every event must link to **its own** page on the official source — never a search or
browse page. This is enforced in two places:

- **At ingest.** `core/links.py` classifies each URL as `direct` / `listing` / `invalid`.
  Anything that isn't `direct` is dropped before it reaches the database, with the
  rejection logged. Eventbrite links must contain `/e/`; Ticketmaster's own domains must
  contain `/event/` (partner platforms like Universe and Frontgate are allowed their own
  shapes); listing markers such as `/d/`, `/discover`, `/search` are always rejected.
- **On demand.** `make links` re-checks stored URLs over HTTP, following redirects, and
  reports the final status and host per source.

```
source         checked  direct   live  problems
eventbrite          22      22     22         0
luma                16      16     16         0
```

The event page also shows the destination domain next to the "Get tickets" button, so
users see where they're going before they click. Clicks are logged to `event_clicks`
without delaying the navigation.

Adding a source: implement `EventSource` in `workers/sources/`, return
`NormalizedEvent`s, register it in `workers/sources/__init__.py`. Nothing else changes.

---

## Database

| Table | Purpose |
|---|---|
| `profiles` | user, location, radius, taste embedding |
| `interests` / `user_interests` | taxonomy and selections |
| `events` | normalized catalogue + embedding + full-text vector |
| `saved_events` | saved / going / dismissed |
| `event_clicks` | outbound click analytics, feeds trending |
| `ingestion_runs` | scraper observability |

RPCs: `match_events` (vector ranking), `search_events` (full-text), `trending_events`
(cold start), `haversine_km`.

**RLS is on for every table.** Events and interests are world-readable; profiles,
interests and saves are owner-only; `ingestion_runs` is service-role only. A new signup
auto-provisions a profile via an `auth.users` trigger.

Rebuild from scratch: `supabase/migrations/20261121120000_qwendo_init.sql`.

---

## API

Public: `GET /v1/interests`, `/v1/stats`, `/v1/events`, `/v1/events/trending`,
`/v1/events/{id}`, `POST /v1/events/{id}/click`, `POST /v1/recommendations/preview`.

Authenticated (Supabase JWT as bearer): `GET /v1/recommendations`, `/v1/me`,
`PUT /v1/me/profile`, `PUT /v1/me/interests`, `GET /v1/me/saved`,
`PUT|DELETE /v1/events/{id}/save`.

Operator (`X-Ingest-Token`): `POST /v1/admin/ingest`, `GET /v1/admin/runs`.

```bash
curl -X POST localhost:8000/v1/recommendations/preview \
  -H 'Content-Type: application/json' \
  -d '{"interests":["comics-superheroes"],"interest_text":"spiderman","city":"London"}'
```

---

## Curating the landing-page hero

The hero shows real event artwork from the live catalogue. Scraped artwork
varies in quality, so any event can be vetoed from the hero without removing it
from the product:

```sql
-- hide from the hero only (still searchable and recommendable)
update public.events set hero_eligible = false where id = '<event-id>';

-- see what's currently hidden
select title, source from public.events where not hero_eligible;

-- put one back
update public.events set hero_eligible = true where id = '<event-id>';
```

Eligible events are served by `GET /v1/events/hero`, ordered by popularity —
which also tends to surface the best-produced artwork, since larger promoters
ship proper key art. The frontend then picks one event per category so the hero
shows the breadth of the catalogue rather than three of the same thing.

## Authentication

Email + password and **Sign in with Google**, both through Supabase Auth. The app code
needs no Google credentials — they live in the Supabase dashboard, and Supabase performs
the OAuth exchange.

### Enabling Google (one-time)

**1. Google Cloud Console** — <https://console.cloud.google.com/apis/credentials>

- Configure the OAuth consent screen (External; app name, support email, logo).
- Create credentials → **OAuth client ID** → **Web application**.
- **Authorized JavaScript origins:** `http://localhost:3000` (add your production domain later)
- **Authorized redirect URI** — this must be the *Supabase* callback, not Qwendo's:

  ```
  https://hfpnbzadymxttjnilkkz.supabase.co/auth/v1/callback
  ```

- Copy the **Client ID** and **Client secret**.

**2. Supabase dashboard**

- *Authentication → Sign In / Providers → Google*: enable, paste the Client ID and secret, save.
- *Authentication → URL Configuration*: Site URL `http://localhost:3000`, and add
  `http://localhost:3000/**` to Redirect URLs (plus your production URL when you deploy).

Verify it's live:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://hfpnbzadymxttjnilkkz.supabase.co/auth/v1/authorize?provider=google"
# 400 = provider still disabled, 302 = enabled
```

### Flow

`/login` → "Continue with Google" → Google consent → Supabase → `/auth/callback`
(exchanges the code for a session cookie) → `/onboarding` for new users, or wherever they
were headed. A database trigger provisions the profile, pulling name and avatar from the
Google claims (`full_name`/`name`/`given_name`, `avatar_url`/`picture`). Someone who
signed up by email and later uses Google keeps the same account — Supabase links them on
the verified email address — and the trigger fills in any blank profile fields without
overwriting what's there.

## Frontend

| Route | What it does |
|---|---|
| `/` | Landing: search hero, problem framing, **live taste demo** (real matches, no account), trending |
| `/discover` | Public browse + search + filters; personalises automatically when signed in |
| `/events/[id]` | Detail, sticky booking rail, outbound CTA with click tracking, related events |
| `/onboarding` | Interest picker, city, travel radius, free text |
| `/saved` | Bookmarked events |
| `/login` | Email + password auth |

Design: committed OLED-dark theme, amber accent, DM Sans + Inter, SVG icons only,
visible focus rings, `prefers-reduced-motion` respected, responsive from 375px.

---

## Deploying

Full walkthrough with environment variables and a post-deploy checklist:
**[DEPLOYMENT.md](DEPLOYMENT.md)**.

In short — two Vercel projects from this one repo (frontend with Root Directory `web`,
API with Root Directory `.` using the root `vercel.json`), plus the GitHub Action for
ingestion. The API also runs anywhere that reads a `Procfile`.

---

## Known limits

- Eventbrite's search payload has no pricing, so those events show "See tickets" until a
  detail-page fetch is added.
- Ticketmaster is implemented but unverified — it needs an API key to run.
- `local` embeddings match on vocabulary overlap, not meaning. Use `openai` in production.
- Geocoding is per-source; events without coordinates get a neutral proximity score
  rather than being dropped.
- `make seed` is **development only**: those events are fictional, so they have no ticket
  page and link to marketplace search pages instead. They are flagged by `make links` and
  were cleared from the live database. Remove them any time with
  `delete from public.events where source = 'demo';`
