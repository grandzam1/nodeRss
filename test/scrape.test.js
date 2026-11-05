// Characterization tests for runScrape(): behavior must stay identical regardless of which
// job runner (local / trigger / inngest) executes it.
// Uses an in-memory SQLite DB and a fake provider, so no network or real data is touched.
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AuthError, NotFoundError, QuotaError } from '../src/brightdata.js';

process.env.STORAGE = 'sqlite';
process.env.APIFY_TOKEN = 'test-token';

// What the fake provider does for each call; tests replace this.
let fetchImpl = async () => [];
const calls = [];

mock.module(new URL('../src/provider.js', import.meta.url).href, {
  namedExports: {
    provider: { name: 'apify', label: 'Apify', envKey: 'APIFY_TOKEN', settingsKey: 'apifyKey' },
    fetchPosts: (apiKey, profile, n) => {
      calls.push(`${profile.platform}/${profile.username}`);
      return fetchImpl(apiKey, profile, n);
    },
    platformList: () => [{ value: 'tiktok', label: 'TikTok' }],
    normalizePlatform: (p) => String(p ?? '').trim().toLowerCase() || null,
    AuthError,
    NotFoundError,
    QuotaError,
  },
});

let runScrape;
before(async () => {
  ({ runScrape } = await import('../src/scrape.js'));
});

function makeDb(profiles) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE posts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, username TEXT NOT NULL,
    post_url TEXT UNIQUE, caption TEXT, media_url TEXT, posted_at TEXT, scraped_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
    username TEXT NOT NULL, UNIQUE (platform, username))`);
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO profiles (platform, username) VALUES (?, ?)');
  for (const [platform, username] of profiles) ins.run(platform, username);
  return db;
}

const post = (id) => ({ id, url: `https://example.com/${id}`, description: `post ${id}` });
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;

test('saves new posts and counts duplicates on a second run', async () => {
  calls.length = 0;
  const db = makeDb([['tiktok', 'a'], ['tiktok', 'b']]);
  fetchImpl = async (_k, p) => [post(`${p.username}1`), post(`${p.username}2`)];

  const logs = [];
  const first = await runScrape(db, (...l) => logs.push(l));
  assert.deepEqual(first, { profiles: 2, saved: 4, duplicates: 0, failed: 0 });
  assert.equal(count(db), 4);
  assert.equal(logs.length, 2);

  const second = await runScrape(db);
  assert.deepEqual(second, { profiles: 2, saved: 0, duplicates: 4, failed: 0 });
  assert.equal(count(db), 4);
});

test('a missing/private profile (NotFoundError) is skipped, not counted as failed', async () => {
  calls.length = 0;
  const db = makeDb([['tiktok', 'gone'], ['tiktok', 'ok']]);
  fetchImpl = async (_k, p) => {
    if (p.username === 'gone') throw new NotFoundError('profile not found');
    return [post('ok1')];
  };
  const logs = [];
  const totals = await runScrape(db, (level, msg, p) => logs.push([level, p?.username]));
  assert.deepEqual(totals, { profiles: 2, saved: 1, duplicates: 0, failed: 0 });
  assert.deepEqual(calls, ['tiktok/gone', 'tiktok/ok']); // no retry for permanent errors, keeps going
  assert.ok(logs.some(([level, u]) => level === 'WARN' && u === 'gone'));
});

test('AuthError counts as failed, is not retried, and stops the whole run', async () => {
  calls.length = 0;
  const db = makeDb([['tiktok', 'a'], ['tiktok', 'b']]);
  fetchImpl = async () => {
    throw new AuthError('bad key');
  };
  const totals = await runScrape(db);
  assert.deepEqual(totals, { profiles: 2, saved: 0, duplicates: 0, failed: 1 });
  assert.deepEqual(calls, ['tiktok/a']); // second profile never attempted
});

test('QuotaError also stops the whole run', async () => {
  calls.length = 0;
  const db = makeDb([['tiktok', 'a'], ['tiktok', 'b']]);
  fetchImpl = async () => {
    throw new QuotaError('out of credits');
  };
  const totals = await runScrape(db);
  assert.equal(totals.failed, 1);
  assert.deepEqual(calls, ['tiktok/a']);
});

test('a transient error is retried and then succeeds (waits 2s)', async () => {
  calls.length = 0;
  const db = makeDb([['tiktok', 'flaky']]);
  let n = 0;
  fetchImpl = async () => {
    if (++n === 1) throw new Error('timeout');
    return [post('f1')];
  };
  const logs = [];
  const totals = await runScrape(db, (level) => logs.push(level));
  assert.deepEqual(totals, { profiles: 1, saved: 1, duplicates: 0, failed: 0 });
  assert.equal(calls.length, 2);
  assert.ok(logs.includes('WARN'));
});

test('a non-fatal error on one profile does not stop the others', async () => {
  calls.length = 0;
  const db = makeDb([['tiktok', 'bad'], ['tiktok', 'good']]);
  fetchImpl = async (_k, p) => {
    if (p.username === 'bad') throw new Error('boom');
    return [post('g1')];
  };
  const totals = await runScrape(db);
  assert.deepEqual(totals, { profiles: 2, saved: 1, duplicates: 0, failed: 1 });
  assert.equal(calls.filter((c) => c === 'tiktok/bad').length, 4); // initial + 3 retries
  assert.ok(calls.includes('tiktok/good'));
});

test('throws a clear error when no API key is configured', async () => {
  const saved = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  try {
    await assert.rejects(() => runScrape(makeDb([['tiktok', 'a']])), /No Apify API key set/);
  } finally {
    process.env.APIFY_TOKEN = saved;
  }
});
