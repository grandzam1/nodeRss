// Tests for the Inngest job runner's status mapping (what GET /api/jobs/:id returns to the UI).
// fetch is faked, so nothing talks to Inngest.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

mock.module(new URL('../src/inngest/client.js', import.meta.url).href, {
  namedExports: {
    SCRAPE_EVENT: 'scrape/requested',
    inngest: { send: async () => ({ ids: [EVENT] }) },
  },
});
const { getRun, submitRun } = await import('../src/jobs/inngest.js');

const realFetch = globalThis.fetch;
let requests;
let routes; // { '/v2/...': Response-producing fn }

beforeEach(() => {
  requests = [];
  routes = {};
  delete process.env.INNGEST_DEV;
  delete process.env.INNGEST_API_BASE_URL;
  process.env.INNGEST_SIGNING_KEY = 'signkey-test';
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    requests.push({ url: String(url), headers: init?.headers ?? {} });
    const handler = routes[u.pathname];
    if (!handler) throw new Error(`unexpected request to ${url}`);
    return handler();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.INNGEST_SIGNING_KEY;
});

const json = (data, status = 200) => () => Response.json({ data }, { status });
const EVENT = '01EVENT';

test('completed run (v2) returns totals and logs from the function output', async () => {
  const output = { totals: { profiles: 2, saved: 6, duplicates: 0, failed: 0 }, logs: ['a', 'b'] };
  routes[`/v2/events/${EVENT}/runs`] = json([{ id: 'r1', status: 'COMPLETED', output }]);
  assert.deepEqual(await getRun(EVENT), { id: EVENT, status: 'COMPLETED', totals: output.totals, logs: ['a', 'b'], error: null });
  assert.equal(requests[0].url, `https://api.inngest.com/v2/events/${EVENT}/runs?include=output`);
  assert.equal(requests[0].headers.Authorization, 'Bearer signkey-test');
});

test('no run yet means the job is still RUNNING', async () => {
  routes[`/v2/events/${EVENT}/runs`] = json([]);
  assert.equal((await getRun(EVENT)).status, 'RUNNING');
});

test('v2 response without data means the job is still RUNNING', async () => {
  routes[`/v2/events/${EVENT}/runs`] = () => Response.json({ metadata: {}, page: {} });
  assert.equal((await getRun(EVENT)).status, 'RUNNING');
});

test('no run with an event younger than 60 seconds remains RUNNING', async (t) => {
  t.mock.method(Date, 'now', () => 60_000);
  const event = '00000000010000000000000000';
  routes[`/v2/events/${event}/runs`] = json([]);
  assert.equal((await getRun(event)).status, 'RUNNING');
});

test('no run with an event older than 60 seconds fails', async (t) => {
  t.mock.method(Date, 'now', () => 60_002);
  const event = '00000000010000000000000000';
  routes[`/v2/events/${event}/runs`] = () => Response.json({ metadata: {}, page: {} });
  assert.deepEqual(await getRun(event), {
    id: event, status: 'FAILED', totals: null, logs: [],
    error: 'Function never started. Check the Inngest environment and app sync.',
  });
});

test('Crockford base32 timestamp expires at exactly 60 seconds', async (t) => {
  t.mock.method(Date, 'now', () => 61_023);
  const event = '00000000ZZ0000000000000000';
  routes[`/v2/events/${event}/runs`] = json([]);
  assert.equal((await getRun(event)).status, 'FAILED');
});

test('an existing run for an old event retains its normal status', async (t) => {
  t.mock.method(Date, 'now', () => 60_002);
  const event = '00000000010000000000000000';
  for (const status of ['RUNNING', 'COMPLETED']) {
    routes[`/v2/events/${event}/runs`] = json([{ id: 'r1', status }]);
    assert.equal((await getRun(event)).status, status);
  }
});

test('queued and running runs are RUNNING', async () => {
  for (const status of ['QUEUED', 'RUNNING', 'PAUSED']) {
    routes[`/v2/events/${EVENT}/runs`] = json([{ id: 'r1', status }]);
    assert.equal((await getRun(EVENT)).status, 'RUNNING', status);
  }
});

test('failed and cancelled runs are FAILED with an error message', async () => {
  routes[`/v2/events/${EVENT}/runs`] = json([{ id: 'r1', status: 'FAILED', output: { message: 'No Apify API key set.' } }]);
  assert.deepEqual(await getRun(EVENT), { id: EVENT, status: 'FAILED', totals: null, logs: [], error: 'No Apify API key set.' });

  routes[`/v2/events/${EVENT}/runs`] = json([{ id: 'r1', status: 'CANCELLED' }]);
  const cancelled = await getRun(EVENT);
  assert.equal(cancelled.status, 'FAILED');
  assert.equal(cancelled.error, 'Run cancelled.');
});

test('falls back to v1 when v2 is not available', async () => {
  routes[`/v2/events/${EVENT}/runs`] = () => new Response('forbidden', { status: 403 });
  routes[`/v1/events/${EVENT}/runs`] = json([{ run_id: 'r1', status: 'Completed', output: '{"totals":{"saved":1},"logs":["x"]}' }]);
  const job = await getRun(EVENT);
  assert.equal(job.status, 'COMPLETED');
  assert.deepEqual(job.totals, { saved: 1 }); // string output from v1 is parsed
});

test('returns null for an unknown job (404 on both APIs)', async () => {
  routes[`/v2/events/${EVENT}/runs`] = () => new Response('', { status: 404 });
  routes[`/v1/events/${EVENT}/runs`] = () => new Response('', { status: 404 });
  assert.equal(await getRun(EVENT), null);
});

test('surfaces unexpected API errors instead of hiding them', async () => {
  routes[`/v2/events/${EVENT}/runs`] = () => new Response('upstream down', { status: 500 });
  await assert.rejects(() => getRun(EVENT), /Inngest HTTP 500/);
});

test('INNGEST_DEV points the status calls at the local dev server', async () => {
  process.env.INNGEST_DEV = '1';
  routes[`/v2/events/${EVENT}/runs`] = json([]);
  await getRun(EVENT);
  assert.ok(requests[0].url.startsWith('http://localhost:8288/v2/'));
});

// --- Reliability: keys, temporary-vs-missing, run selection ---

test('status lookup without a signing key fails loudly instead of reporting a missing job', async () => {
  delete process.env.INNGEST_SIGNING_KEY;
  await assert.rejects(() => getRun(EVENT), /INNGEST_SIGNING_KEY/);
});

test('auth failure on both APIs reports a signing-key problem, not a missing job', async () => {
  routes[`/v2/events/${EVENT}/runs`] = () => new Response('nope', { status: 401 });
  routes[`/v1/events/${EVENT}/runs`] = () => new Response('nope', { status: 401 });
  await assert.rejects(() => getRun(EVENT), /INNGEST_SIGNING_KEY/);
});

test('the newest run wins when an event spawned several runs', async () => {
  routes[`/v2/events/${EVENT}/runs`] = json([
    { id: 'r1', status: 'COMPLETED', created_at: '2026-11-05T10:00:00Z' },
    { id: 'r2', status: 'RUNNING', created_at: '2026-11-05T10:05:00Z' },
  ]);
  assert.equal((await getRun(EVENT)).status, 'RUNNING');
});

test('submitRun fails loudly when the event key is missing on cloud', async () => {
  delete process.env.INNGEST_EVENT_KEY;
  await assert.rejects(() => submitRun(), /INNGEST_EVENT_KEY/);
});

test('submitRun returns the event id as the job id', async () => {
  process.env.INNGEST_EVENT_KEY = 'eventkey-test';
  assert.deepEqual(await submitRun(), { jobId: EVENT });
  delete process.env.INNGEST_EVENT_KEY;
});
