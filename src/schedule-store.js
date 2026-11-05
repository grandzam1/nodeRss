import { openDb, storageName, getSetting, setSetting } from './db.js';

export const MIN_INTERVAL_MINUTES = 5;
export const DEFAULT_INTERVAL_MINUTES = 15;
export const production = () => process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

export function validateSchedule({ scheduleEnabled, intervalMinutes }) {
  if (scheduleEnabled !== undefined && typeof scheduleEnabled !== 'boolean') throw new Error('Auto-run must be a boolean.');
  if (intervalMinutes !== undefined && (!Number.isInteger(Number(intervalMinutes)) || Number(intervalMinutes) < MIN_INTERVAL_MINUTES || Number(intervalMinutes) > 1440)) {
    throw new Error('Interval must be 5-1440 whole minutes.');
  }
}

function checkStorage() {
  if (production() && storageName === 'sqlite') throw new Error('Production scheduling requires Supabase storage.');
}

export async function readSchedule(db = openDb()) {
  checkStorage();
  if (storageName === 'sqlite') {
    const saved = await getSetting(db, 'autoRunSchedule');
    if (saved) return JSON.parse(saved);
    const enabled = String(await getSetting(db, 'scheduleEnabled', 'false')) === 'true';
    const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.min(1440, Math.trunc(Number(await getSetting(db, 'intervalMinutes', DEFAULT_INTERVAL_MINUTES))) || DEFAULT_INTERVAL_MINUTES));
    const initial = { auto_run_enabled: enabled, interval_minutes: minutes, next_run_at: enabled ? new Date(Date.now() + minutes * 60000).toISOString() : null, revision: 0 };
    await setSetting(db, 'autoRunSchedule', JSON.stringify(initial));
    return initial;
  }
  const { data, error } = await db.from('scraper_schedule').select('*').eq('id', 1).single();
  if (error) throw new Error(`Schedule: ${error.message}. Apply the schedule migration.`);
  return data;
}

export async function saveSchedule(patch, db = openDb()) {
  validateSchedule(patch);
  checkStorage();
  if (storageName !== 'sqlite') {
    const { data, error } = await db.rpc('update_scraper_schedule', {
      enabled: patch.scheduleEnabled ?? null,
      minutes: patch.intervalMinutes === undefined ? null : Number(patch.intervalMinutes),
    });
    if (error) throw new Error(`Schedule: ${error.message}`);
    return data;
  }
  const old = await readSchedule(db);
  const enabled = patch.scheduleEnabled ?? old.auto_run_enabled;
  const minutes = patch.intervalMinutes === undefined ? old.interval_minutes : Number(patch.intervalMinutes);
  if (enabled === old.auto_run_enabled && minutes === old.interval_minutes) return old;
  const next = { auto_run_enabled: enabled, interval_minutes: minutes, revision: old.revision + 1, next_run_at: enabled ? new Date(Date.now() + minutes * 60000).toISOString() : null };
  await setSetting(db, 'autoRunSchedule', JSON.stringify(next));
  return next;
}

export async function advanceSchedule(schedule, db = openDb()) {
  if (storageName === 'sqlite') {
    const current = await readSchedule(db);
    if (current.revision === schedule.revision && current.next_run_at === schedule.next_run_at) {
      await setSetting(db, 'autoRunSchedule', JSON.stringify({ ...current, next_run_at: new Date(Date.now() + current.interval_minutes * 60000).toISOString() }));
    }
    return;
  }
  const { error } = await db.rpc('advance_scraper_schedule', { expected_revision: schedule.revision, expected_due: schedule.next_run_at });
  if (error) throw new Error(`Schedule: ${error.message}`);
}

export const scheduledRunAllowed = (schedule, event) => schedule.auto_run_enabled && schedule.revision === event.revision;
export const scheduleDue = (schedule, now = Date.now()) => schedule.auto_run_enabled && schedule.next_run_at !== null && Date.parse(schedule.next_run_at) <= now;
export const scheduleEventId = (schedule) => `scraper-${schedule.revision}-${Date.parse(schedule.next_run_at)}`;
