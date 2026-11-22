# Deploying Qwendo

## Live

| Environment | URL | Vercel project |
|---|---|---|
| Frontend | <https://qwendo.vercel.app> | `qwendo` (Root Directory `web`) |
| API | <https://qwendo-api.vercel.app> | `qwendo-api` (Root Directory `.`) |
| Database | `hfpnbzadymxttjnilkkz.supabase.co` | Supabase, eu-west-1 |

The frontend and API have separate Vercel project roots. The frontend reads `web/vercel.json`. The root `vercel.json` routes API requests through `server.py`. Discovery and Radar run as scheduled Python processes.

## Frontend

Choose `web` as the project root. Set the following public build variables in each environment. Use a development database and API for previews that need isolation.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable or anon key |
| `NEXT_PUBLIC_API_URL` | Public FastAPI origin, reachable by browsers and Next.js |

Rebuild the frontend after changing any of these values.

## API

Choose the repository root for the Python deployment. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CORS_ORIGINS`. Set the latter to a comma-separated list of exact frontend origins. Keep the service-role credential on the API and worker hosts. The alternative process entrypoint is in `Procfile`.

## Database and workers

Review the migration files in filename order and exercise them on a disposable database before a separately approved hosted rollout. Introduce the discovery schema before starting workers or switching reads to the verified catalogue. Previously collected rows can require verification. Check source permissions and successful processing before assessing catalogue coverage.

For worker commands, provider credentials, registration, retries and monitoring, see [Discovery operations](docs/discovery-operations.md). Radar has a separate schedule in `.github/workflows/radar.yml`.

## Authentication

Set the Supabase Auth Site URL to the frontend origin. Add the frontend callback URL (`/auth/callback`) for each authorised environment. If Google sign-in is enabled, use the Supabase project’s `/auth/v1/callback` URL as the Google OAuth redirect URI. Access to `/admin/discovery` requires the boolean `qwendo_admin` in the verified account’s application metadata.

## Validation

- Check `GET /health` for `status: ok`, `ranking: deterministic` and `service_role_configured: true`. Health reports configuration presence. Verify database access separately with `GET /v1/events?limit=3`.
- Open `/discover`. For a known upcoming verified listing, open its details and check the official destination and source timestamps. An empty catalogue can be valid before a successful source run.
- Register a test account, review the six onboarding steps, open Top Picks and save an event. Check it under `/saved`.
- Submit an approved test listing through `/submit`. Check its pending review status in the operator dashboard. Confirm a regular account cannot access that dashboard.
- Check source last-success times, queue results, reviews and coverage in `/admin/discovery`.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Empty listings | API origin, source enablement and last success, job errors, verification status and event start time |
| Browser CORS failure | Exact protocol, host and port in `CORS_ORIGINS` |
| Private request rejected | Session validity, correct Supabase project and the operator application metadata for admin routes |
| API build creates multiple functions | Root Directory and the root `vercel.json` |
| Google sign-in fails | Provider credentials, redirect allowlist and callback URL |
