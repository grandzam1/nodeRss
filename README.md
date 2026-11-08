# Social Post Scraper

Fetches the latest public posts from TikTok, Instagram and X for the profiles you add (via Bright Data, Apify, or Crawlee + Playwright) and saves new ones to SQLite or Supabase.

In plain terms: you give it a list of social media profiles, it periodically pulls each profile's newest posts through a scraping service, and stores whatever is new so you can browse or export it later — from a small web UI on your laptop, or deployed to Vercel where it can run on a schedule.

## Prerequisites

- **Node.js >= 22.5** (uses `--env-file`; check with `node -v`)
- A scraper API key for Bright Data or Apify. Crawlee + Playwright uses public browser-visible pages and needs no scraper API key.
- (Production only) a [Supabase](https://supabase.com) project and an [Inngest](https://www.inngest.com) account

## Quick start (local, no accounts needed)

```bash
git clone <this-repo> && cd social-post-scraper
npm install
cp .env.example .env       # Windows: copy .env.example .env
```

Edit `.env` and set your scraper key (`APIFY_TOKEN` or `BRIGHTDATA_API_KEY`), or skip this and paste the key in the UI settings later.

```bash
npm run ui                 # open http://localhost:3000
```

That's it — `JOB_RUNNER` defaults to `local` (scrapes run in-process) and storage defaults to SQLite at `data/posts.sqlite3`.

Useful commands:

```bash
npm start        # fetch posts for all saved profiles (CLI)
npm run posts    # print saved posts
npm run doctor   # check your setup
npm test         # run the test suite
npm run build    # rebuild public/styles.css (build:css to watch)
```

## Local development with Inngest

Use the Inngest Dev Server — no cloud keys needed:

```bash
npm run inngest:serve                                               # functions on :3001
npx inngest-cli@latest dev -u http://localhost:3001/api/inngest    # dev dashboard at :8288
```

Then in `.env` set `JOB_RUNNER=inngest` and `INNGEST_DEV=1` (leave `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` empty) and run `npm run ui`.

## Production on Vercel

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `JOB_RUNNER` | yes | `inngest` (default) or optional `github-actions` |
| `INNGEST_EVENT_KEY` | when `JOB_RUNNER=inngest` | Sends `scrape/requested` events — **must come from the same Inngest environment as the signing key** |
| `INNGEST_SIGNING_KEY` | when `JOB_RUNNER=inngest` | Verifies Inngest's calls to `/api/inngest` and reads run status |
| `SCRAPER_PROVIDER` | yes | `brightdata`, `apify`, or `crawlee` |
| `APIFY_TOKEN` / `BRIGHTDATA_API_KEY` | yes (for API providers) | Scraper key matching the provider; Crawlee needs neither |
| `STORAGE` | yes | `supabase` (or `watch`) — SQLite is not for production |
| `SUPABASE_URL` | yes | Project Settings > Data API |
| `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | yes | Server-side Supabase key |
| `ADMIN_TOKEN` | yes | Bearer token for all write endpoints (profiles, settings, run); unset → writes fail closed with 503 |
| `CRON_SECRET` | yes | Bearer token for `POST /api/run` (scheduler callers only) |
| `GITHUB_ACTIONS_TOKEN` | when `JOB_RUNNER=github-actions` | Fine-grained repo token with Actions: write and Contents: read |
| `GITHUB_ACTIONS_REPOSITORY` | when `JOB_RUNNER=github-actions` | `owner/repository` to dispatch |
| `GITHUB_ACTIONS_WORKFLOW` | optional | Worker workflow filename; defaults to `crawlee-worker.yml` |
| `GITHUB_ACTIONS_REF` | when `JOB_RUNNER=github-actions` | Branch whose worker code the action checks out |

### Deploy steps

1. **Database:** run `supabase/schema.sql` in the Supabase SQL editor, then apply `supabase/schedule.sql`. The migration preserves saved schedule settings and only unschedules the legacy cron job named `social-post-scraper`; review before applying.
2. **Connect the repo** to a Vercel project (deploys on push to `main`). The `api/[...path].js` catch-all serves `/api/*`; `public/` is served statically.
3. **Inngest keys:** in the Inngest dashboard, pick one environment (e.g. Production) and copy **both** the event key (Manage → Event keys) and the signing key (Manage → Signing key) **from that same environment**. Add them to Vercel and redeploy.
4. **Sync the app** so Inngest knows where your functions live:

   ```bash
   curl -X PUT https://<your-domain>/api/inngest
   # expect: {"message":"Successfully registered","modified":true}
   ```

   (Or use Apps → Sync new app in the dashboard, or install the Inngest Vercel integration.)
5. Use the Auto-run toggle in the UI, or "Run now" for a manual scrape.

In production, `JOB_RUNNER` defaults to `inngest`. Supabase is the schedule source of truth and Inngest runs `scrape-schedule-dispatcher` every minute. When `github-actions` is explicitly selected, due schedule events dispatch the GitHub worker instead of scraping inside the Vercel function. Times shown in the UI are due times — execution may start about a minute later.

### Optional GitHub Actions + Crawlee worker (development first)

This is an additional execution path; Bright Data and Apify remain available and unchanged. Set `SCRAPER_PROVIDER=crawlee` and `JOB_RUNNER=github-actions` in the **Vercel Preview/development environment**. Vercel dispatches `.github/workflows/crawlee-worker.yml`; the Linux runner loads the same profiles/settings and uses `runScrape()` → shared normalization → the existing storage adapter. The worker writes its job record/results to `scraper_jobs` in Supabase.

Before enabling it, apply `supabase/github-runner.sql` to a **separate development Supabase project**. Configure Vercel Preview variables `GITHUB_ACTIONS_TOKEN` (fine-grained token scoped to this repository with Actions: write and Contents: read), `GITHUB_ACTIONS_REPOSITORY=grandzam1/nodeRss`, `GITHUB_ACTIONS_WORKFLOW=crawlee-worker.yml`, and `GITHUB_ACTIONS_REF` (the branch containing the worker). The Vercel Preview Supabase URL/key and the Actions development Supabase secrets must refer to the same development project.

Add these GitHub repository secrets: `CRAWLEE_DEV_SUPABASE_URL` and `CRAWLEE_DEV_SUPABASE_SERVICE_ROLE_KEY`. Add repository variable `CRAWLEE_DEV_STORAGE` with value `watch` or `supabase`. The worker intentionally does not fall back to generic or production Supabase secrets. A service-role key bypasses RLS; restrict it to a dedicated test project and rotate it if exposed. GitHub `workflow_dispatch` requires the workflow file to exist on the repository's default branch before the API can dispatch it; the Actions validation workflow itself can be tested from this development branch.

The `Crawlee validation` workflow runs the browser-backed test suite on `ubuntu-latest` and `windows-latest` without any Supabase or provider credentials. To test locally on Windows, install Node.js 22, run `npm ci`, `npx playwright install chromium`, then `npm test`. The sandbox run in this task is Linux; a Windows-hosted Actions run is not the same as testing on your own Windows computer.

Do not configure these variables in Vercel Production or point the worker at production Supabase during development. GitHub Actions is a Linux worker; public pages may present login walls, bot checks, rate limits, or different markup, so Crawlee is not guaranteed to return the same completeness as paid providers.

## Self-hosting

Two deployment paths are supported:

1. **Vercel + Supabase**, using Inngest by default or the optional GitHub Actions runner described above.
2. **Local-only** — `npm run ui` on a machine you control, `JOB_RUNNER=local`, SQLite storage. To reach the UI from another device, tunnel in with SSH (`ssh -L 3000:localhost:3000 your-server`) — the server binds `127.0.0.1` and refuses non-localhost requests on purpose.

**A plain "install on a VPS and open the port" setup is not supported yet.** The reasons: the write-endpoint auth (`ADMIN_TOKEN`) only activates when `NODE_ENV=production` or `VERCEL=1`, and nothing else guards a public port; the scheduler and job history are in-process, so they die with restarts; and `JOB_RUNNER=inngest` additionally requires a publicly reachable, signature-verified `/api/inngest` URL that a hand-rolled server doesn't provide out of the box. Running `npm run ui` with `NODE_ENV=production` and an `ADMIN_TOKEN` set is *possible* on a private network, but treat it as experimental — the supported paths are the two above.

## Troubleshooting

- **`Could not check the run's status (runs is not iterable)`** — the Inngest v2 API returned a body with no `data` array when the event had no runs yet; the status check crashed instead of reporting RUNNING. Fixed by treating a missing `data` field as an empty run list.
- **Event accepted (200) but no run ever appears** — almost always `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` from different Inngest environments. Events land in the event key's env; the app (and its functions) is synced in the signing key's env. Copy both keys from one environment. Also confirm the app is actually synced there (dashboard → Apps → your app → Sync URL).
- **`INNGEST_SIGNING_KEY is not set`** / 401 on status — production requires the signing key to read run status back.
- **`Production requires JOB_RUNNER=inngest or JOB_RUNNER=github-actions`** — the default is `inngest`; GitHub Actions requires its token, worker workflow, and Supabase job-history migration.
- **⚠️ NEVER sync an ngrok/tunnel URL to a production Inngest environment.** A `curl -X PUT https://<tunnel>/api/inngest` repoints every scheduled run at your laptop — and keeps working (or failing silently) after the tunnel dies. Use the Inngest Dev Server locally, or create a separate Inngest environment for testing. If it happens, re-sync immediately: `curl -X PUT https://<your-prod-domain>/api/inngest`.
- **`GET /api/health`** reports storage and runner status for monitoring.

## Notes

- Storage is pluggable: SQLite (`data/posts.sqlite3`) or Supabase — same `posts`, `profiles`, `settings` shape. `profiles.json` only seeds an empty `profiles` table on first run. Local runs also append to `data/scrape.log`.
- Keys saved from the UI are stored in plain text in the database — keep `data/` private.
- Supported platforms: TikTok, Instagram, X. Provider-specific profile URL and extraction logic lives in `src/brightdata.js`, `src/apify.js`, and `src/crawlee.js`.
- The optional GitHub runner adds `scraper_jobs` history via `supabase/github-runner.sql`; existing Inngest jobs are not migrated into that table.
- Each run asks for the latest N posts per profile, so posts can be missed if more than N are published between runs.
- CLI exit code: `0` success, `1` a profile failed, `2` config error.
- `JOB_RUNNER=trigger` (Trigger.dev) is deprecated — see `trigger/`, `src/jobs/trigger.js`, `trigger.config.ts` and the `@trigger.dev/*` packages.
