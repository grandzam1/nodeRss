// Tests for handleApi: health check, job status lookups, and error mapping.
// db.js, jobs and provider are mocked — nothing touches storage, Inngest, or a scraper.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { ApiError } = await import('../src/errors.js');

let values = new Map();
let profiles = [];
let posts = [];
let profilesFail = false;
const db = {};
const jobs = new Map();
let submitError = null;
let addError = null;
let deleteFound = true;

mock.module(new URL('../src/db.js', import.meta.url).href, {
  namedExports: {
    storageName: 'sqlite',
    openDb: () => db,
    getSetting: async (_db, key, fallback = null) => values.get(key) ?? fallback,
    setSetting: async (_db, key, value) => values.set(key, value),
    listProfiles: async () => {
      if (profilesFail) throw new Error('database is locked');
      return profiles;
    },
    addProfile: async (_db, platform, username) => {
      if (addError) throw addError;
      profiles.push({ id: profiles.length + 1, platform, username });
    },
    deleteProfile: async () => deleteFound,
    listPosts: async () => posts,
    seedProfiles: async () => {},
  },
});
mock.module(new URL('../src/scrape.js', import.meta.url).href, {
  namedExports: { getApiKey: async () => 'key', getPostsPerProfile: async () => 5 },
});
mock.module(new URL('../src/schedule-store.js', import.meta.url).href, {
  namedExports: {
    readSchedule: async () => ({ auto_run_enabled: false, interval_minutes: 15, next_run_at: null, revision: 0 }),
    saveSchedule: async () => {},
    validateSchedule: ({ scheduleEnabled, intervalMinutes }) => {
      if (scheduleEnabled !== undefined && typeof scheduleEnabled !== 'boolean') throw new ApiError(400, 'Auto-run must be a boolean.');
      if (intervalMinutes !== undefined && (!Number.isInteger(Number(intervalMinutes)) || Number(intervalMinutes) < 5 || Number(intervalMinutes) > 1440)) {
        throw new ApiError(400, 'Interval must be 5-1440 whole minutes.');
      }
    },
  },
});
mock.module(new URL('../src/scheduler.js', import.meta.url).href, {
  namedExports: { refreshSchedule: async () => ({ enabled: false, minutes: 15 }) },
});
mock.module(new URL('../src/provider.js', import.meta.url).href, {
  namedExports: {
    platformList: () => [{ value: 'tiktok', label: 'TikTok' }],
    provider: { name: 'test', label: 'Test Provider', envKey: 'TEST_KEY', settingsKey: 'apiKey' },
  },
});
mock.module(new URL('../src/jobs/index.js', import.meta.url).href, {
  namedExports: {
    runnerName: 'local',
    isBusy: () => false,
    submitRun: async () => {
      if (submitError) throw new Error(submitError);
      return { jobId: 'local-1' };
    },
    getRun: async (id) => jobs.get(id) ?? null,
  },
});

const { handleApi } = await import('../src/api.js');

beforeEach(() => {
  values = new Map();
  profiles = [];
  posts = [];
  profilesFail = false;
  submitError = null;
  addError = null;
  deleteFound = true;
  jobs.clear();
  delete process.env.VERCEL;
  delete process.env.ADMIN_TOKEN;
  delete process.env.CRON_SECRET;
});

test('GET /api/health reports ok when storage works', async () => {
  const { status, data } = await handleApi('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.database, 'ok');
  assert.equal(data.runner, 'local');
});

test('GET /api/health degrades to 503 when storage fails', async () => {
  profilesFail = true;
  const { status, data } = await handleApi('GET', '/api/health');
  assert.equal(status, 503);
  assert.equal(data.ok, false);
  assert.match(data.database, /database is locked/);
});

test('GET /api/jobs/:id returns a clear 404 for an unknown job', async () => {
  await assert.rejects(() => handleApi('GET', '/api/jobs/local-999'), (err) => {
    assert.equal(err.status, 404);
    assert.match(err.message, /Job not found/);
    return true;
  });
});

test('GET /api/jobs/:id returns the job when it exists', async () => {
  jobs.set('local-1', { id: 'local-1', status: 'RUNNING' });
  const { status, data } = await handleApi('GET', '/api/jobs/local-1');
  assert.equal(status, 200);
  assert.equal(data.status, 'RUNNING');
});

test('POST /api/run returns 202 with a job id', async () => {
  const { status, data } = await handleApi('POST', '/api/run');
  assert.equal(status, 202);
  assert.equal(data.jobId, 'local-1');
});

test('POST /api/run maps "already in progress" to 409', async () => {
  submitError = 'A run is already in progress.';
  await assert.rejects(() => handleApi('POST', '/api/run'), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test('unknown routes are a clear 404', async () => {
  await assert.rejects(() => handleApi('GET', '/api/nope'), (err) => {
    assert.equal(err.status, 404);
    return true;
  });
});

test('DELETE /api/profiles/:id returns 404 when nothing was deleted', async () => {
  deleteFound = false;
  await assert.rejects(() => handleApi('DELETE', '/api/profiles/9'), (err) => {
    assert.equal(err.status, 404);
    assert.match(err.message, /Profile not found/);
    return true;
  });
});

test('POST /api/profiles maps a duplicate to 409', async () => {
  addError = new ApiError(409, 'That profile already exists.');
  await assert.rejects(() => handleApi('POST', '/api/profiles', { platform: 'tiktok', username: 'a' }), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test('PUT /api/settings maps invalid input to 400', async () => {
  await assert.rejects(() => handleApi('PUT', '/api/settings', { postsPerProfile: 0 }), (err) => {
    assert.equal(err.status, 400);
    return true;
  });
  await assert.rejects(() => handleApi('PUT', '/api/settings', { intervalMinutes: 3 }), (err) => {
    assert.equal(err.status, 400);
    return true;
  });
});

// --- Production write auth (ADMIN_TOKEN) ---

const prodEnv = (token = 'secret-admin') => {
  process.env.VERCEL = '1';
  if (token !== null) process.env.ADMIN_TOKEN = token;
};
const authed = { headers: { authorization: 'Bearer secret-admin' } };

test('production write endpoints fail closed (503) when ADMIN_TOKEN is unset', async () => {
  prodEnv(null);
  await assert.rejects(() => handleApi('POST', '/api/profiles', { platform: 'tiktok', username: 'a' }), (err) => {
    assert.equal(err.status, 503);
    assert.match(err.message, /ADMIN_TOKEN/);
    return true;
  });
  await assert.rejects(() => handleApi('POST', '/api/run'), (err) => err.status === 503);
  await assert.rejects(() => handleApi('PUT', '/api/settings', { postsPerProfile: 5 }), (err) => err.status === 503);
  await assert.rejects(() => handleApi('DELETE', '/api/profiles/1'), (err) => err.status === 503);
});

test('production write endpoints return 401 without a valid bearer token', async () => {
  prodEnv();
  await assert.rejects(() => handleApi('POST', '/api/profiles', { platform: 'tiktok', username: 'a' }), (err) => err.status === 401);
  await assert.rejects(() => handleApi('POST', '/api/profiles', { platform: 'tiktok', username: 'a' }, { headers: { authorization: 'Bearer wrong' } }), (err) => err.status === 401);
});

test('a wrong-length token returns 401, not a crash (length checked before timingSafeEqual)', async () => {
  prodEnv();
  await assert.rejects(
    () => handleApi('POST', '/api/profiles', { platform: 'tiktok', username: 'a' }, { headers: { authorization: 'Bearer x' } }),
    (err) => err.status === 401,
  );
  await assert.rejects(
    () => handleApi('POST', '/api/profiles', { platform: 'tiktok', username: 'a' }, { headers: { authorization: 'Bearer ' + 'x'.repeat(64) } }),
    (err) => err.status === 401,
  );
});

test('production write endpoints accept the admin token', async () => {
  prodEnv();
  const { status } = await handleApi('POST', '/api/profiles', { platform: 'tiktok', username: 'a' }, authed);
  assert.equal(status, 200);
});

test('POST /api/run also accepts CRON_SECRET in production', async () => {
  prodEnv();
  process.env.CRON_SECRET = 'cron-key';
  const { status } = await handleApi('POST', '/api/run', {}, { headers: { authorization: 'Bearer cron-key' } });
  assert.equal(status, 202);
});

test('CRON_SECRET does not unlock other write endpoints', async () => {
  prodEnv();
  process.env.CRON_SECRET = 'cron-key';
  await assert.rejects(
    () => handleApi('PUT', '/api/settings', { postsPerProfile: 5 }, { headers: { authorization: 'Bearer cron-key' } }),
    (err) => err.status === 401,
  );
});

test('internal calls bypass auth (local scheduler path)', async () => {
  prodEnv();
  const { status } = await handleApi('POST', '/api/run', {}, { internal: true });
  assert.equal(status, 202);
});

test('read endpoints stay open in production', async () => {
  prodEnv();
  const { status } = await handleApi('GET', '/api/state', {}, {});
  assert.equal(status, 200);
});
