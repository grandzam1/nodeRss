# Troubleshooting

> ## Start here
>
> 1. `GET /api/health` — is storage ok? (503 = database problem)
> 2. Did the scrape actually start? If you clicked Run Now and saw an error pop-up, that's your answer: "Unauthorized" or "ADMIN_TOKEN" means a login/token problem, "already in progress" means a scrape is still running, and "Could not check"/"status" means the app couldn't reach the job service.
> 3. Run started but status never resolves → see "Status / run errors".
> 4. Changed an env var and nothing changed → see "Env var changed but nothing happened".

## Glossary

- **Inngest** — the managed job queue that runs scrapes in production. Your app registers its functions at `/api/inngest`; Inngest calls that endpoint to execute them, one step per profile.
- **Environment** — an isolated space inside your Inngest account (e.g. Production, or a branch env). Apps, keys, events and runs never cross environments.
- **Event key** (`INNGEST_EVENT_KEY`) — lets your app *send* events to one Inngest environment.
- **Signing key** (`INNGEST_SIGNING_KEY`) — lets Inngest prove it's really Inngest calling `/api/inngest`, and lets your app *read* run status back. Keys are environment-scoped: **both keys must come from the same environment.**
- **Sync** — telling Inngest "this app's functions live at this URL" (`PUT /api/inngest` or Apps → Sync in the dashboard). If a stale/tunnel URL is synced, Inngest calls the wrong host.

## Status / run errors

**`Could not check the run's status (runs is not iterable)`**
The Inngest v2 API returns no `data` field when an event has no runs yet. Older code spread that `undefined` value and crashed; the API surfaced it as a 502. Fixed: a missing `data` field is treated as "no runs yet" (reported as RUNNING). If you still see this, you're running the old build — pull/redeploy.

**Event accepted (HTTP 200) but no run ever appears**
Almost always a key/environment mismatch: `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` must come from the **same** Inngest environment. Events land in the event key's env; the app and its functions are synced into the signing key's env. Copy both keys from one environment (dashboard → env selector → Manage → Event keys / Signing key). Also confirm the app is synced there (dashboard → Apps → your app → Sync URL).

**`INNGEST_SIGNING_KEY is not set — run status cannot be checked.`**
Against Inngest Cloud the signing key is required to read run status back. Set it, or use `INNGEST_DEV=1` locally.

**`Production requires JOB_RUNNER=inngest.`**
On Vercel (`VERCEL=1` or `NODE_ENV=production`) the only allowed runner is `inngest`. Fix or remove the `JOB_RUNNER` env var — the production default is already `inngest`.

**`Job not found. Local run history is cleared when the app restarts`**
The `local` runner keeps job state in memory. Restarting `npm run ui` loses it — start a new run.

**404 right after clicking Run Now (production)**
A 404 immediately after `POST /api/run` usually just means Inngest hasn't registered the run for the event yet — the UI keeps polling briefly for that reason. If it persists, open the Inngest dashboard → your environment → **Apps → your app** and check the app's diagnostics page: it shows sync status, the registered URL, and per-run errors (unreachable URL, signature failures). Also verify the synced URL is your production domain, not an old tunnel — see the ngrok warning below.

## Scheduling

**Auto-run works locally but not in production**
Production scheduling requires Supabase (`STORAGE=supabase` or `watch`) — SQLite scheduling throws "Production scheduling requires Supabase storage." Apply `supabase/schedule.sql` in the Supabase SQL editor.

**`Schedule: <error>. Apply the schedule migration.`**
The `scraper_schedule` table or RPCs don't exist — run `supabase/schedule.sql`.

**Scheduled scrape didn't fire at the exact time**
Expected. The dispatcher cron runs every minute and UI times are *due* times — execution can start ~1 minute later plus queue delay.

## Configuration

**`Unknown SCRAPER_PROVIDER "…"`** — must be `brightdata` or `apify`.
**`Unknown STORAGE "…"`** — must be `sqlite`, `supabase`, or `watch`.
**`No Bright Data/Apify API key set.`** — set the env key or save one via UI Settings.

**401 on write endpoints (`POST /api/profiles`, `DELETE /api/profiles/:id`, `PUT /api/settings`, `POST /api/run`)**
Production requires `Authorization: Bearer $ADMIN_TOKEN`. The UI asks for the token once and keeps it in `sessionStorage` (per-tab). `POST /api/run` additionally accepts `Bearer $CRON_SECRET` — that's for the cron caller only and does not unlock the other endpoints.

**503 "ADMIN_TOKEN is not set" on a write**
Fail closed by design: production refuses writes until `ADMIN_TOKEN` exists in the environment **and the app is redeployed** — see the next entry.

**403 locally**
The UI server only accepts `localhost`/`127.0.0.1` Host headers — don't reach it via your LAN IP.

**Env var changed but nothing happened**
Environment variables are baked in at deploy time — editing them in the Vercel dashboard does **not** update the running deployment. Deploys happen via `.github/workflows/deploy.yml`: a push to `main` (or a manual `workflow_dispatch` run) does `vercel pull --environment=production` → `vercel build --prod` → `vercel deploy --prebuilt --prod`, and `npm test` runs before the build so a failing suite blocks the deploy. To apply an env change:
1. Set/change the var in Vercel → Project → Settings → Environment Variables (Production).
2. Trigger a redeploy: push a commit to `main`, or run the "Deploy Production" workflow manually (Actions → Deploy Production → Run workflow). Vercel's dashboard Redeploy button is blocked for prebuilt deployments, which is how this project deploys.
3. Verify on the new deployment (e.g. `GET /api/health`).

**`GET /favicon.ico` → 404 in the logs**
Expected — no favicon is shipped. The log line is harmless noise.

## ⚠️ Never sync a tunnel URL to a production Inngest environment

Running `curl -X PUT https://<ngrok-or-tunnel-url>/api/inngest` repoints **every run in that environment** — including the cron schedule — at your laptop. It keeps "working" (or silently failing) after the tunnel dies, and local functions read your local `.env`, not production's.

- For local Inngest work, use the Dev Server: `npx inngest-cli@latest dev -u http://localhost:3001/api/inngest` with `INNGEST_DEV=1`. No cloud keys involved.
- If you must test cloud integration, create a **separate Inngest environment** — never reuse Production.
- **If it already happened:** immediately re-sync production back to Vercel:
  `curl -X PUT https://<your-prod-domain>/api/inngest` → expect `{"message":"Successfully registered","modified":true}`.

## Health check

`GET /api/health` returns `{ok, database, storage, runner, schedule, time}` — 503 when storage is broken. Point uptime monitoring there.
