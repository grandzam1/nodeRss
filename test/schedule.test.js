import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let values = new Map();
const db = {};
mock.module(new URL('../src/db.js', import.meta.url).href, {
  namedExports: {
    storageName: 'sqlite', openDb: () => db,
    getSetting: async (_db, key, fallback = null) => values.get(key) ?? fallback,
    setSetting: async (_db, key, value) => values.set(key, value),
    listProfiles: async () => [], seedProfiles: async () => {},
  },
});
mock.module(new URL('../src/scrape.js', import.meta.url).href, {
  namedExports: { getApiKey: async () => 'test', getPostsPerProfile: async () => 5, scrapeProfile: async () => ({ saved: 0, duplicates: 0 }) },
});
mock.module(new URL('../src/inngest/client.js', import.meta.url).href, {
  namedExports: { SCRAPE_EVENT: 'scrape/requested', inngest: { createFunction: (config, handler) => ({ config, handler }) } },
});
const { readSchedule, saveSchedule, advanceSchedule, validateSchedule, scheduleDue, scheduleEventId, scheduledRunAllowed } = await import('../src/schedule-store.js');
const { dispatchSchedule, scrapePosts, scheduleDispatcher } = await import('../src/inngest/functions.js');

beforeEach(() => {
  values = new Map();
  delete process.env.NODE_ENV;
  delete process.env.VERCEL;
});

const step = (events = []) => ({
  run: async (_id, fn) => fn(),
  sendEvent: async (_id, event) => events.push(event),
});
const dueSchedule = async () => {
  const schedule = await saveSchedule({ scheduleEnabled: true, intervalMinutes: 5 });
  schedule.next_run_at = new Date(Date.now() - 60000).toISOString();
  values.set('autoRunSchedule', JSON.stringify(schedule));
  return schedule;
};

test('enabling persists enabled, interval, next due and revision', async () => {
  const now = Date.now();
  const saved = await saveSchedule({ scheduleEnabled: true, intervalMinutes: 10 });
  assert.equal(saved.auto_run_enabled, true);
  assert.equal(saved.interval_minutes, 10);
  assert.equal(saved.revision, 1);
  assert.ok(Date.parse(saved.next_run_at) >= now + 600000);
  assert.deepEqual(await readSchedule(), saved);
  assert.equal(scheduleDue(saved), false);
});

test('disabling clears due time, prevents dispatch and invalidates queued event', async () => {
  const prior = await dueSchedule();
  const disabled = await saveSchedule({ scheduleEnabled: false });
  assert.equal(disabled.next_run_at, null);
  assert.equal(scheduledRunAllowed(disabled, { revision: prior.revision }), false);
  const events = [];
  assert.deepEqual(await dispatchSchedule({ step: step(events) }), { dispatched: false });
  assert.equal(events.length, 0);
});

test('changing interval resets due time and invalidates old queued events', async () => {
  const prior = await dueSchedule();
  const changed = await saveSchedule({ intervalMinutes: 30 });
  assert.equal(changed.interval_minutes, 30);
  assert.equal(changed.revision, prior.revision + 1);
  assert.ok(Date.parse(changed.next_run_at) >= Date.now() + 30 * 60000 - 100);
  assert.equal(scheduledRunAllowed(changed, { revision: prior.revision }), false);
  await advanceSchedule(prior);
  assert.deepEqual(await readSchedule(), changed);
});

test('reloads and identical saves do not reset or duplicate the schedule', async () => {
  const saved = await dueSchedule();
  await readSchedule();
  assert.deepEqual(await saveSchedule({ scheduleEnabled: true, intervalMinutes: 5 }), saved);
  assert.equal(scheduleEventId(saved), scheduleEventId(await readSchedule()));
});

test('due heartbeat dispatches existing pipeline once then advances', async () => {
  const saved = await dueSchedule();
  const events = [];
  await dispatchSchedule({ step: step(events) });
  await dispatchSchedule({ step: step(events) });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'scrape/requested');
  assert.equal(events[0].id, scheduleEventId(saved));
  assert.equal(events[0].data.revision, saved.revision);
  assert.equal(scheduleDue(await readSchedule()), false);
});

test('delivery failure leaves due schedule available for heartbeat recovery', async () => {
  const saved = await dueSchedule();
  await assert.rejects(dispatchSchedule({ step: { ...step(), sendEvent: async () => { throw new Error('offline'); } } }), /offline/);
  assert.deepEqual(await readSchedule(), saved);
  const events = [];
  await dispatchSchedule({ step: step(events) });
  assert.equal(events[0].id, scheduleEventId(saved));
});

test('replayed dispatches use the same deduplication ID', async () => {
  const saved = await dueSchedule();
  const events = [];
  const replay = { run: async (id, fn) => id === 'read-due-schedule' ? saved : fn(), sendEvent: async (_id, event) => events.push(event) };
  await dispatchSchedule({ step: replay });
  await dispatchSchedule({ step: replay });
  assert.equal(new Set(events.map((event) => event.id)).size, 1);
});

test('manual runs work with auto-run off; scheduled stale runs skip work', async () => {
  const manual = await scrapePosts.handler({ step: step(), event: { data: {} } });
  assert.equal(manual.totals.profiles, 0);
  const stale = await scrapePosts.handler({ step: step(), event: { data: { scheduled: true, revision: 99 } } });
  assert.match(stale.logs[0], /invalidated/);
  assert.equal(scrapePosts.config.concurrency, 1);
  assert.equal(scrapePosts.config.retries, 2);
  assert.deepEqual(scheduleDispatcher.config.triggers, [{ cron: '* * * * *' }]);
});

test('validation rejects unsafe intervals and non-boolean flags', () => {
  for (const intervalMinutes of [0, 1, 4, 1441, 5.5, '', 'bad', null]) {
    assert.throws(() => validateSchedule({ intervalMinutes }), /Interval/);
  }
  assert.throws(() => validateSchedule({ scheduleEnabled: 'false' }), /boolean/);
  for (const intervalMinutes of [5, '15', 1440]) validateSchedule({ intervalMinutes });
});

test('legacy local settings are migrated once and unsafe intervals are raised to minimum', async () => {
  values.set('scheduleEnabled', 'true');
  values.set('intervalMinutes', '1');
  const migrated = await readSchedule();
  assert.equal(migrated.auto_run_enabled, true);
  assert.equal(migrated.interval_minutes, 5);
  assert.ok(migrated.next_run_at);
  assert.deepEqual(await readSchedule(), migrated);
});

test('production cannot silently use SQLite scheduling', async () => {
  process.env.NODE_ENV = 'production';
  await assert.rejects(readSchedule(), /Supabase/);
  delete process.env.NODE_ENV;
});
