# Social Post Scraper

Fetches the latest public posts from TikTok, Instagram and X for the profiles you add (via Bright Data or Apify) and saves new ones to Supabase. Requires **Node 22.5+**.

## Web UI

```bash
npm run ui     # then open http://localhost:3000
```

From the page you can add/remove profiles, set posts per profile, save your API key, run a fetch, and browse saved posts. The server only listens on localhost.

## Command line

```bash
npm start        # fetch posts for all saved profiles
npm run posts    # print saved posts
```

## API key & provider

Two backends are supported: **Bright Data** (default) and **Apify**.

```env
SCRAPER_PROVIDER=brightdata   # or apify
BRIGHTDATA_API_KEY=...
APIFY_TOKEN=...
```

Set these in `.env`, or paste the key into the UI settings (it is saved under the active provider). If `SCRAPER_PROVIDER` is unset, the provider is auto-detected from which env key is present. The env var wins over a saved key, and a key saved from the UI is stored in plain text in the local database, so keep `data/` private.

## Supabase & Vercel

1. Run `supabase/schema.sql` in the Supabase SQL editor (creates `posts`, `profiles`, `settings`, and a `pg_cron` job).
2. Set env vars (locally in `.env`, on Vercel in project settings):
   - `STORAGE=sqlite|supabase` (auto-detected if unset: Supabase when its keys exist, else SQLite)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (only for `STORAGE=supabase`)
   - `SCRAPER_PROVIDER` + `BRIGHTDATA_API_KEY` or `APIFY_TOKEN`
   - `CRON_SECRET` — protects `POST /api/run` so only the scheduler can trigger it.
3. Deploy to Vercel (the `api/[...path].js` catch-all serves all `/api/*` routes; `public/` is served statically). `maxDuration` is 300s.
4. To change the schedule: `select cron.alter_job((select jobid from cron.job where jobname='social-post-scraper'), schedule := '*/30 * * * *');`

## Notes

- Storage is pluggable: SQLite (`data/posts.sqlite3`) or Supabase — same `posts`, `profiles`, `settings` shape either way. `profiles.json` only seeds an empty `profiles` table on first run. Local runs also append to `data/scrape.log`.
- Supported platforms: TikTok, Instagram, X. To add another, add an entry to `PLATFORMS` in `src/brightdata.js` / `src/apify.js`.
- Instagram and X discovery jobs can take a minute or more; the scraper waits for them.
- Each run asks for the latest N posts per profile, so posts can be missed if more than N are published between runs.
- CLI exit code: `0` success, `1` a profile failed, `2` config error.
