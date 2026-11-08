# API Reference

All endpoints are served under `/api/*` — locally by `npm run ui` (`http://localhost:3000`) and on Vercel by the `api/[...path].js` catch-all. Inngest's function endpoint (`/api/inngest`) is separate; it's handled by `api/inngest.js` (Vercel) or `npm run inngest:serve` (port 3001) and is called by Inngest, not by you.

## Auth

| Context | Read endpoints (`GET`s) | Write endpoints (`POST /api/profiles`, `DELETE /api/profiles/:id`, `PUT /api/settings`, `POST /api/run`) |
|---|---|---|
| Local (`npm run ui`) | open | open — server binds `127.0.0.1` and rejects non-localhost `Host` headers |
| Production (Vercel) | open | `Authorization: Bearer $ADMIN_TOKEN` required; `POST /api/run` also accepts `Bearer $CRON_SECRET` for the scheduler. If `ADMIN_TOKEN` is unset, writes fail closed with **503**. |

Token comparison is constant-time. `/api/health` and `/api/inngest` are unaffected.

## Endpoint table

| Method | Path | What it does | Who can call it | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/state` | Full UI state (platforms, profiles, settings, runner, running flag) | anyone | `200` state object | `500` |
| GET | `/api/posts` | Last 200 saved posts | anyone | `200` post array | `500` |
| GET | `/api/health` | Liveness/readiness — pings storage | anyone | `200` health object | `503` DB down |
| POST | `/api/profiles` | Add a profile | admin token (prod) / anyone (local) | `200` updated state | `400` bad input, `401`, `409` duplicate, `500`, `503` no ADMIN_TOKEN |
| DELETE | `/api/profiles/:id` | Delete a profile | admin token (prod) / anyone (local) | `200` updated state | `401`, `404` unknown id, `500`, `503` no ADMIN_TOKEN |
| PUT | `/api/settings` | Update settings (incl. scraper API key, schedule) | admin token (prod) / anyone (local) | `200` updated state | `400` invalid value, `401`, `500`, `503` no ADMIN_TOKEN |
| POST | `/api/run` | Start a scrape job → `{jobId, runner}` | admin token or `CRON_SECRET` (prod) / anyone (local) | `202` | `401`, `409` already running, `502` submit failed, `503` no ADMIN_TOKEN |
| GET | `/api/jobs/:id` | Poll a run's status | anyone | `200` job object | `404` unknown job, `502` status lookup failed |
| any | other `/api/*` | — | — | — | `404` |

Error responses are always `{error: string}`.

## Per-endpoint details

### `GET /api/state`

```json
{
  "platforms": [{ "value": "tiktok", "label": "TikTok" }],
  "profiles": [{ "id": 1, "platform": "tiktok", "username": "someuser" }],
  "settings": {
    "postsPerProfile": 5,
    "apiKeySet": true,
    "apiKeyFromEnv": false,
    "provider": "apify",
    "scheduleEnabled": true,
    "intervalMinutes": 15,
    "nextRunAt": "2026-01-01T00:00:00.000Z",
    "runner": "local"
  },
  "running": false
}
```

### `GET /api/posts`

```json
[{ "platform": "tiktok", "username": "someuser", "post_url": "https://…", "caption": "…", "posted_at": "…", "scraped_at": "…" }]
```

### `GET /api/health`

`{ "ok": true, "database": "ok", "storage": "sqlite", "runner": "local", "schedule": {…}, "time": "…" }` — returns `503` with `ok:false` when storage is broken.

### `POST /api/profiles`

Body `{ "platform": "tiktok", "username": "someuser" }`. `platform` must be `tiktok`, `instagram`, or `x` (`twitter` works as an alias, case-insensitive, trimmed). `username` is trimmed and a leading `@` stripped. Empty/missing fields → `400`; unsupported platform → `400`; duplicate → `409` ("That profile already exists."). Returns the same shape as `GET /api/state`.

### `DELETE /api/profiles/:id`

`:id` must be digits. Returns `404` ("Profile not found.") when no profile was deleted, otherwise `200` with updated state.

### `PUT /api/settings`

Body fields are independently optional:

| Field | Rule |
|---|---|
| `postsPerProfile` | integer 1–50 → else `400` |
| `scheduleEnabled` | boolean → else `400` |
| `intervalMinutes` | integer 5–1440 → else `400` |
| `apiKey` | non-empty string, trimmed; saved for the active provider |

Returns updated state. Enabling the schedule also refreshes the in-process/dispatched scheduler.

### `POST /api/run`

Body ignored. Starts a scrape via the configured `JOB_RUNNER` (`local`, `inngest`, or optional `github-actions`). The GitHub Actions runner requires the `scraper_jobs` Supabase migration and dispatch configuration. In production accepts `Bearer $ADMIN_TOKEN` or `Bearer $CRON_SECRET`; `CRON_SECRET` does **not** unlock the other write endpoints. Returns `409` when a run is already in progress, `502` when the job service rejects the submit. Internally the local scheduler calls this with an `internal` flag that bypasses auth.

### `GET /api/jobs/:id`

`{ "id": "…", "status": "RUNNING"|"COMPLETED"|"FAILED", "totals": {"profiles":0,"saved":0,"duplicates":0,"failed":0}|null, "logs": ["…"], "error": "…"|null }`. Returns `404` when the job is unknown — note the `local` runner keeps history in memory, so restarts lose it. GitHub Actions runner history/results are read from Supabase `scraper_jobs`. `502` means the job service/store couldn't be queried, not that the run failed.

### `/api/inngest` (Inngest only)

`GET` app info · `PUT` sync/register the app with Inngest Cloud · `POST` invoke a function step (signature-verified with `INNGEST_SIGNING_KEY`). Don't call `POST` yourself.
