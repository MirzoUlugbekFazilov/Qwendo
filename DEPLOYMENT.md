# Deploying Qwendo

Qwendo is **two deployables plus a scheduled job**, all from this one repository:

| Piece | What it is | Where it goes |
|---|---|---|
| `web/` | Next.js frontend | Vercel project #1 (Root Directory `web`) |
| `server.py` → `api/` | FastAPI backend | Vercel project #2 (Root Directory `.`) or Railway/Render |
| `workers/` | Scrapers | GitHub Actions cron (already in `.github/workflows/ingest.yml`) |

They are separate Vercel projects on purpose: a Next.js build and a Python build can't
share one project. The frontend project never reads the root `vercel.json`, because
setting its Root Directory to `web` makes that folder its project root.

---

## 1. Frontend → Vercel

1. **Add New → Project** → import `MirzoUlugbekFazilov/Qwendo`.
2. **Root Directory: `web`** ← the single most important setting. Framework preset will
   auto-detect as Next.js.
3. Environment variables (all three, for Production **and** Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://hfpnbzadymxttjnilkkz.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_eSOHgP5vpIDo5lhiL3ou5Q_CUBSMF3i` |
   | `NEXT_PUBLIC_API_URL` | your deployed API URL (step 2) |

   These are public by design — they're shipped to the browser and constrained by RLS.
   The `sb_secret_…` key must **never** appear in this project.
4. Deploy. Note the URL, e.g. `https://qwendo.vercel.app`.

`NEXT_PUBLIC_*` values are baked in at build time, so after changing `NEXT_PUBLIC_API_URL`
you must **redeploy**, not just restart.

---

## 2. API → Vercel (or Railway)

### Option A — Vercel

1. **Add New → Project** → import the same repo again.
2. **Root Directory: `.`** (repo root). The root `vercel.json` takes over: it builds only
   `server.py` with the Python runtime and routes every path to it. Without that file
   Vercel would try to turn every module in `api/` into its own function.
3. Environment variables:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://hfpnbzadymxttjnilkkz.supabase.co` |
   | `SUPABASE_ANON_KEY` | the `sb_publishable_…` key |
   | `SUPABASE_SERVICE_ROLE_KEY` | the `sb_secret_…` key — **server-side only** |
   | `CORS_ORIGINS` | your frontend URL, e.g. `https://qwendo.vercel.app` |
   | `EMBEDDING_PROVIDER` | `local`, or `openai` with `OPENAI_API_KEY` |
   | `INGEST_TOKEN` | `openssl rand -hex 32` |

4. Deploy, then check `https://<api-domain>/health`.

The deploy bundle is ~71 MB (Playwright lives in `requirements-scrapers.txt` and is not
installed here). The browser fallback is therefore unavailable in this environment, which
only affects `POST /v1/admin/ingest` — the scheduled GitHub Action does the real scraping
and has Chromium installed.

### Option B — Railway / Render / Fly

Same environment variables. `Procfile` already defines the start command:

```
web: uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

Build command: `pip install -r requirements.txt` (add `-r requirements-scrapers.txt`
plus `python -m playwright install chromium` if you want ingestion to run there too).

### Then update the frontend

Set `NEXT_PUBLIC_API_URL` to the API domain and redeploy the frontend.

---

## 3. Workers → GitHub Actions

`.github/workflows/ingest.yml` runs every 6 hours and on demand. In
**Settings → Secrets and variables → Actions**, add:

**Secrets:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`TICKETMASTER_API_KEY`, and `OPENAI_API_KEY` if using OpenAI embeddings.

**Variables:** `DEFAULT_CITIES` (e.g. `London,Manchester`), `EMBEDDING_PROVIDER`.

Trigger a first run from the Actions tab → *Ingest events* → *Run workflow*.

---

## 4. Supabase — after you have real domains

**Authentication → URL Configuration**

- Site URL: `https://qwendo.vercel.app`
- Redirect URLs: add `https://qwendo.vercel.app/**` and
  `https://*-<your-team>.vercel.app/**` if you want preview deploys to sign in.

**Google Cloud Console** (if Google sign-in is enabled)

- Authorized JavaScript origins: add `https://qwendo.vercel.app`
- Authorized redirect URI stays `https://hfpnbzadymxttjnilkkz.supabase.co/auth/v1/callback`
- Publish the OAuth consent screen, or only listed test users can sign in.

---

## Post-deploy checklist

```bash
curl https://<api-domain>/health                      # service_role_configured: true
curl "https://<api-domain>/v1/events?city=London&limit=3"
curl -s -o /dev/null -w "%{http_code}\n" https://<frontend-domain>/discover   # 200
```

- [ ] `/discover` lists events (if empty, the API URL or ingestion is the problem)
- [ ] An event's "Get tickets" button opens the official listing
- [ ] Sign up with email, then with Google — both land on `/onboarding`
- [ ] Saving an event works, and it appears on `/saved`
- [ ] Ingest workflow run succeeds; check `ingestion_runs` in Supabase

## Troubleshooting

| Symptom | Cause |
|---|---|
| Frontend builds but every list is empty | `NEXT_PUBLIC_API_URL` wrong or not redeployed after changing it |
| Browser console shows CORS errors | `CORS_ORIGINS` on the API doesn't include the exact frontend origin |
| API returns 403 "permission denied" | `SUPABASE_SERVICE_ROLE_KEY` missing or using the publishable key |
| Vercel Python build creates many functions | Root `vercel.json` missing or Root Directory not set to `.` |
| Google sign-in: "provider is not enabled" | Provider not saved in Supabase dashboard |
| Google sign-in redirects back to `/login` | Deployed URL not in Supabase Redirect URLs |
