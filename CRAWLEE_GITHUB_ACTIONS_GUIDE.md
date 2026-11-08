# Crawlee + Playwright / GitHub Actions Development Guide

This guide is for the development implementation in this project. It does not deploy anything or authorize production data access.

## What this adds

- `SCRAPER_PROVIDER=crawlee` selects a third, keyless browser adapter. Bright Data and Apify remain available and unchanged.
- The adapter returns raw post records that flow through the existing shared normalization, retry, profile-status and database-save code.
- `JOB_RUNNER=github-actions` makes Vercel dispatch the workflow worker. The worker uses Linux + Chromium and writes job history to Supabase `scraper_jobs`.
- `supabase/github-runner.sql` creates the runner's job history table and a database lock to prevent overlapping jobs.
- `Crawlee validation` is a credential-free GitHub Actions test matrix for `ubuntu-latest` and `windows-latest`.

## Local development tests

Prerequisites: Node.js 22 (the repository requires Node >=22.5) and npm.

### Windows PowerShell

```powershell
cd nodeRss
npm ci
npx playwright install chromium
npm test
```

### Linux

```bash
cd nodeRss
npm ci
npx playwright install --with-deps chromium
npm test
```

The browser integration tests host a local fixture on `127.0.0.1`; they do not need Apify, Bright Data, GitHub, or Supabase credentials. `npm test` also exercises the existing duplicate handling, common transient retries, and permanent error handling. Run `npm run build` to verify the asset build.

## GitHub Actions CI test

`.github/workflows/crawlee-validation.yml` runs the same test suite on Linux and Windows. Push the branch `feat/crawlee-playwright-github-actions` or open a pull request to `main`; the workflow uses no repository secrets and does not invoke the production deploy workflow. A manual run is also available once the workflow exists on the repository default branch.

The development branch was committed locally as `b33f624c90149526494ab3b499518b96759c336b`. The current GitHub connection rejected pushing `.github/workflows/*` because it lacks the `workflows` permission, so **no remote Actions run has yet occurred**. The local Windows commands above have not been run on a Windows computer; the Windows matrix is ready but has not run.

## Development Supabase setup for an actual worker run

Do this only with a dedicated development Supabase project:

1. Create a separate test Supabase project. Never use the production URL or service-role key for this test.
2. Apply the project's normal application schema as appropriate (`supabase/schema.sql` for generic storage, or use the existing `watch_*` schema for `STORAGE=watch`). Then apply `supabase/github-runner.sql` to that same development project.
3. Set Vercel **Preview** environment variables (not Production):
   - `JOB_RUNNER=github-actions`
   - `SCRAPER_PROVIDER=crawlee`
   - `STORAGE=supabase` or `STORAGE=watch`
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the development Supabase project
   - `GITHUB_ACTIONS_TOKEN` — repository-scoped GitHub token with Actions: write and Contents: read
   - `GITHUB_ACTIONS_REPOSITORY=grandzam1/nodeRss`
   - `GITHUB_ACTIONS_WORKFLOW=crawlee-worker.yml`
   - `GITHUB_ACTIONS_REF` — the development branch to check out
4. In the GitHub repository, add **development-only** secrets:
   - `CRAWLEE_DEV_SUPABASE_URL`
   - `CRAWLEE_DEV_SUPABASE_SERVICE_ROLE_KEY`
5. Add the GitHub repository variable `CRAWLEE_DEV_STORAGE`, set to `supabase` or `watch`.
6. The Vercel Preview Supabase settings and `CRAWLEE_DEV_*` secrets must refer to the same development project. The worker refuses to scrape unless the matching job has first been created in `scraper_jobs`.
7. With the app configured for Preview/development, invoke a run from the dashboard/API and confirm status/results in `scraper_jobs` and the posts table.

A service-role secret bypasses Supabase row-level security. Keep it confined to the development project and rotate it if exposed.

### GitHub workflow-dispatch constraint

GitHub requires `crawlee-worker.yml` to exist on the repository's **default branch** before the workflow-dispatch API can run it. In this repository, pushes to `main` trigger `.github/workflows/deploy.yml`, which deploys to production. Do **not** merge or push this worker workflow to production `main` solely to test it. Use a separate test repository/fork with a development default branch and dedicated development Supabase, or wait for an approved release path.

## What was actually verified

- Local Linux Chromium + Crawlee: passed on a local HTML fixture.
- Shared data shape: verified via the existing normalizer and saved SQLite row.
- Database writes and repeated-run de-duplication: verified against in-memory SQLite (first run inserted 2, second run saved 0 and counted 2 duplicates).
- Errors and retries: the shared suite covers permanent failures and transient retries; the new Crawlee test confirms a platform bot-check becomes a transient error.
- Existing project tests: 62/62 passed locally; asset build succeeded.
- Live logged-out page smoke test: TikTok returned HTTP 200 but rendered “Something went wrong” and no visible posts. Crawlee now surfaces that as an error instead of treating it as a successful empty scrape.

## Not verified / known limitations

- Apify and Bright Data result parity was not tested: no provider API keys or test profiles were available in this sandbox.
- No Supabase writes were performed. There were no Supabase credentials, and the runner SQL migration was not applied to a database.
- The actual `crawlee-worker.yml` scrape workflow was not dispatched. It requires a development Supabase project/secrets, the workflow on a default branch, and a GitHub token with workflow permission.
- Linux GitHub Actions and Windows GitHub Actions were not run because GitHub rejected the branch push for missing workflow-file permission. A Windows-hosted Actions test is also not a local Windows test.
- Results are not guaranteed to match hosted providers. Crawlee depends on logged-out browser-visible page markup; authentication walls, bot checks, rate limits, hydration changes, and social-site anti-automation can produce fewer/no posts or failures. There is no CAPTCHA bypass, authenticated session, or proxy layer in this implementation.
