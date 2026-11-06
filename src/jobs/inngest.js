import { inngest, SCRAPE_EVENT } from '../inngest/client.js';

/**
 * Inngest runner — sends a `scrape/requested` event; the `scrape-posts` function
 * (src/inngest/functions.js, served at /api/inngest) does the work.
 * Env: INNGEST_EVENT_KEY (to send), INNGEST_SIGNING_KEY (to read run status back).
 * The job ID is the event ID; status comes from Inngest's REST API.
 */
const apiBase = () => {
  if (process.env.INNGEST_API_BASE_URL) return process.env.INNGEST_API_BASE_URL.replace(/\/$/, '');
  const dev = process.env.INNGEST_DEV;
  if (dev && /^https?:\/\//.test(dev)) return dev.replace(/\/$/, '');
  return dev && dev !== '0' && dev !== 'false' ? 'http://localhost:8288' : 'https://api.inngest.com';
};
// Talking to Inngest Cloud (not a dev server or a self-hosted base)?
const isCloud = () => apiBase() === 'https://api.inngest.com';

export async function submitRun(payload = {}) {
  if (isCloud() && !process.env.INNGEST_EVENT_KEY) {
    throw new Error('INNGEST_EVENT_KEY is not set — the app cannot submit runs to Inngest Cloud.');
  }
  try {
    const { ids } = await inngest.send({ name: SCRAPE_EVENT, data: payload });
    if (!ids?.[0]) throw new Error('Inngest accepted the event but returned no event ID.');
    return { jobId: ids[0] };
  } catch (err) {
    if (/401|unauthorized|event key/i.test(err.message) && isCloud()) {
      throw new Error('Inngest rejected the event (unauthorized) — check that INNGEST_EVENT_KEY is correct for this environment.');
    }
    throw err;
  }
}

const parse = (v) => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

const readJson = async (res) => {
  if (!res.ok) throw new Error(`Inngest HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data ?? [];
};

/**
 * Runs triggered by an event. Prefers the v2 API (returns the function's output with
 * ?include=output); falls back to v1 (status only on some deployments). Returns null only when
 * Inngest says the event does not exist — auth problems and outages throw instead, so a
 * temporary failure is never mistaken for a missing job.
 */
async function fetchRuns(eventId) {
  const headers = process.env.INNGEST_SIGNING_KEY ? { Authorization: `Bearer ${process.env.INNGEST_SIGNING_KEY}` } : {};
  if (isCloud() && !process.env.INNGEST_SIGNING_KEY) {
    throw new Error('INNGEST_SIGNING_KEY is not set — run status cannot be checked.');
  }
  const id = encodeURIComponent(eventId);
  const v2 = await fetch(`${apiBase()}/v2/events/${id}/runs?include=output`, { headers });
  if (v2.ok) return readJson(v2);
  if (![401, 403, 404, 405].includes(v2.status)) await readJson(v2); // throws with the HTTP error

  const v1 = await fetch(`${apiBase()}/v1/events/${id}/runs`, { headers });
  if (v1.status === 404) return null; // event genuinely unknown to Inngest
  if (v1.status === 401 || v1.status === 403) {
    throw new Error(`Inngest rejected the status lookup (HTTP ${v1.status}) — check INNGEST_SIGNING_KEY.`);
  }
  return readJson(v1);
}

/** An event can spawn several runs (retries, replays) — report the newest one. */
const latestRun = (runs) =>
  [...(runs ?? [])].sort((a, b) =>
    new Date(b.created_at ?? b.queued_at ?? b.run_started_at ?? 0) -
    new Date(a.created_at ?? a.queued_at ?? a.run_started_at ?? 0))[0];

export async function getRun(jobId) {
  const runs = await fetchRuns(jobId);
  if (runs === null) return null;
  const run = latestRun(runs);
  // No run yet: the event was accepted but the function hasn't started.
  if (!run) {
    const timestamp = /^[0-7][0-9A-HJKMNP-TV-Z]{9}/i.test(jobId)
      ? [...jobId.slice(0, 10).toUpperCase()].reduce((ms, char) => ms * 32 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(char), 0)
      : NaN;
    const expired = Date.now() - timestamp >= 60_000;
    return {
      id: jobId, status: expired ? 'FAILED' : 'RUNNING', totals: null, logs: [],
      error: expired ? 'Function never started. Check the Inngest environment and app sync.' : null,
    };
  }

  const status = String(run.status).toUpperCase(); // v1: "Completed", v2: "COMPLETED"
  const output = parse(run.output);
  if (status === 'COMPLETED') {
    return { id: jobId, status: 'COMPLETED', totals: output?.totals ?? null, logs: output?.logs ?? [], error: null };
  }
  if (['FAILED', 'CANCELLED', 'SKIPPED'].includes(status)) {
    return { id: jobId, status: 'FAILED', totals: null, logs: [], error: output?.message ?? `Run ${status.toLowerCase()}.` };
  }
  return { id: jobId, status: 'RUNNING', totals: null, logs: [], error: null };
}

export const isBusy = () => false; // concurrency is Inngest's problem (function concurrency: 1)
