import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let response;
let calls;
const db = {
  from: (table) => {
    calls.push({ table });
    return { select: () => ({ eq: (key, value) => {
      calls.push({ key, value });
      return { single: async () => response };
    } }) };
  },
  rpc: async (name, args) => {
    calls.push({ name, args });
    return response;
  },
};
mock.module(new URL('../src/db.js', import.meta.url).href, {
  namedExports: { storageName: 'watch', openDb: () => db, getSetting: async () => null, setSetting: async () => {} },
});
const { readSchedule, saveSchedule, advanceSchedule } = await import('../src/schedule-store.js');

beforeEach(() => {
  calls = [];
  response = { data: { id: 1, auto_run_enabled: true, interval_minutes: 15, revision: 3, next_run_at: '2026-11-05T12:00:00Z' }, error: null };
});

test('watch backend reads the typed Supabase singleton', async () => {
  assert.deepEqual(await readSchedule(), response.data);
  assert.deepEqual(calls, [{ table: 'scraper_schedule' }, { key: 'id', value: 1 }]);
});

test('settings changes use an atomic RPC with nullable unchanged fields', async () => {
  await saveSchedule({ intervalMinutes: '30' });
  assert.deepEqual(calls, [{ name: 'update_scraper_schedule', args: { enabled: null, minutes: 30 } }]);
  calls = [];
  await saveSchedule({ scheduleEnabled: false });
  assert.deepEqual(calls, [{ name: 'update_scraper_schedule', args: { enabled: false, minutes: null } }]);
});

test('advance passes revision and due time for compare-and-swap', async () => {
  await advanceSchedule(response.data);
  assert.deepEqual(calls, [{ name: 'advance_scraper_schedule', args: { expected_revision: 3, expected_due: '2026-11-05T12:00:00Z' } }]);
});

test('Supabase errors are surfaced, not silently treated as disabled', async () => {
  response = { data: null, error: { message: 'database unavailable' } };
  await assert.rejects(readSchedule(), /database unavailable/);
  await assert.rejects(saveSchedule({ scheduleEnabled: true }), /database unavailable/);
  await assert.rejects(advanceSchedule({ revision: 1, next_run_at: '2026-11-05T12:00:00Z' }), /database unavailable/);
});

test('invalid settings never call Supabase', async () => {
  await assert.rejects(saveSchedule({ intervalMinutes: 1 }), /Interval/);
  assert.equal(calls.length, 0);
});
