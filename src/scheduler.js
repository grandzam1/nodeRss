import { openDb, getSetting } from './db.js';

export const DEFAULT_INTERVAL_MINUTES = 15;

let timer = null;
let nextRunAt = null;
let tick = null;

/** Read schedule settings and (re)arm the timer. Call after settings change. */
export async function refreshSchedule() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    nextRunAt = null;
  }
  const db = openDb();
  const enabled = String(await getSetting(db, 'scheduleEnabled', 'false')) === 'true';
  const minutes = Math.min(1440, Math.max(1, Number(await getSetting(db, 'intervalMinutes', DEFAULT_INTERVAL_MINUTES)) || DEFAULT_INTERVAL_MINUTES));
  if (enabled && tick) {
    timer = setInterval(() => tick().catch(() => {}), minutes * 60_000);
    timer.unref?.();
    nextRunAt = Date.now() + minutes * 60_000;
  }
  return { enabled, minutes };
}

/** Start the scheduler. `tick` is called on every interval (e.g. an /api/run). */
export async function startScheduler(tickFn) {
  tick = tickFn;
  return refreshSchedule();
}

export const scheduleState = () => ({
  timerRunning: Boolean(timer),
  nextRunAt: nextRunAt ? new Date(nextRunAt).toISOString() : null,
});
