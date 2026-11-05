// Tests for the Inngest job runner's status mapping (what GET /api/jobs/:id returns to the UI).
// fetch is faked, so nothing talks to Inngest.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { getRun } = await import('../src/jobs/inngest.js');

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
