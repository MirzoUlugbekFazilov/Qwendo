# Qwendo

**Never miss the event you actually care about.**

**Live:** [qwendo.vercel.app](https://qwendo.vercel.app) · **API:**
[qwendo-api.vercel.app/docs](https://qwendo-api.vercel.app/docs)

Qwendo helps people find upcoming events around their specific interests, goals and practical preferences. The discovery engine checks permitted sources and ranks eligible listings with transparent rules. Booking takes place on the official event website.

---

Read [Personalised discovery](docs/personalised-discovery.md) for the six-step onboarding flow and Radar. Read [Discovery operations](docs/discovery-operations.md) for source permissions, schedules, organiser submissions and review.

## Architecture

| Component | Location | Role |
|---|---|---|
| Next.js App Router | `web/` | Public catalogue, onboarding, picks, organiser form and operator dashboard |
| FastAPI | `api/` | Catalogue queries, authenticated profile updates and operator controls |
| Supabase | `supabase/migrations/` | Postgres catalogue, discovery jobs, private account data and Auth |
| Python workers | `workers/` | Collect permitted listings, persist evidence and prepare in-app alerts |

## Local development

From the repository root, run `make setup` with Python 3.12 and Node.js 22.18 or later. Setup installs the Python runtime and locked web dependencies and copies missing environment files. Point both environment files at the same development Supabase instance and initialise that instance with the migrations in filename order. The operations migration enables two feeds that need no API key: `tickts-london` (six-hour interval) and `swiss-zurich` (24-hour interval, source attribution only). Other new sources default to disabled. The catalogue can be empty until the worker processes its first listings.

| File | Settings |
|---|---|
| `.env` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Set `CORS_ORIGINS` to the allowed frontend origins. |
| `web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`. The local API URL is `http://localhost:8000`. |

Run `make dev`, then open [Qwendo](http://localhost:3000) or the [FastAPI reference](http://localhost:8000/docs). Use `make help` to list commands and `make check` for local checks.

## How recommendations work

By default, Top Picks weights topics at 40%, motivations and formats at 25%, location at 15%, timing at 10% and budget at 10%. Priorities, recognised aliases and related topics contribute different weights. Verification, cancellation, start time and strict preferences determine eligibility before ranking. Set `RANKING_WEIGHTS` in the API environment to override the five relative weights. A dismissal applies to the individual event.

## API

Public clients can browse `GET /v1/events`, inspect `GET /v1/events/{id}` and try `POST /v1/recommendations/preview`. Personal profile, picks and submission endpoints take a Supabase access token as a Bearer JWT. Discovery admin endpoints also require a verified operator account.

```bash
curl -X POST localhost:8000/v1/recommendations/preview \
  -H 'Content-Type: application/json' \
  -d '{"interests":["comics-superheroes"],"interest_text":"spiderman","city":"London"}'
```

---

## Curating the featured surfaces

The landing page shows real event artwork from the live catalogue, and source
artwork varies in quality. Any event can be vetoed from the **hero and the
trending grid** without removing it from the product:

```sql
-- hide from featured surfaces (still searchable and recommendable)
update public.events set featured_eligible = false where id = '<event-id>';

-- see what's currently hidden
select title, source from public.events where not featured_eligible;

-- put one back
update public.events set featured_eligible = true where id = '<event-id>';
```

Both `hero_events()` and `trending_events()` honour the flag and skip events
with no artwork. They're ordered by popularity, which also tends to surface the
best-produced key art, since larger promoters ship proper artwork. The hero
then picks one event per category, and the landing page removes anything the
hero already used from the trending grid — the same event twice on one page
makes the catalogue look thinner than it is.

Note the veto applies to a specific event row. A recurring series re-ingested
next week arrives as a new row with the flag back at its default.

### Artwork is never cropped

Event images arrive in every aspect ratio. `object-cover` fills the frame but
guillotines whatever sits near an edge — on a poster that's usually the title.
Cards therefore render the image with `object-contain` over a blurred, scaled
copy of itself, giving a full-bleed frame with nothing cut off.

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
| `/onboarding` | Six steps for interests, preferences and notification choices, followed by review |
| `/picks` | Ranked events, recent discoveries and Radar |
| `/submit` | Signed-in organiser submission for review |
| `/admin/discovery` | Operator source configuration, schedules, dictionary and monitoring |
| `/saved` | Bookmarked events |
| `/login` | Email/password and Google sign-in |

## Deploying

Full walkthrough with environment variables and a post-deploy checklist:
**[DEPLOYMENT.md](DEPLOYMENT.md)**.

In short — two Vercel projects from this one repo (frontend with Root Directory `web`,
API with Root Directory `.` using the root `vercel.json`), plus the GitHub Action for
ingestion. The API also runs anywhere that reads a `Procfile`.

---

## Coverage

Results depend on the permissions, availability and coverage of enabled sources. Missing prices, availability, publication dates and organiser details stay unknown. Credentials for optional providers belong on the worker.
