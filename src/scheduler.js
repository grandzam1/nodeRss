import { readSchedule, advanceSchedule, scheduleDue, production, DEFAULT_INTERVAL_MINUTES } from './schedule-store.js';

export { DEFAULT_INTERVAL_MINUTES };

let timer = null;
let nextRunAt = null;
let tick = null;
let processing = false;

/** Read schedule settings and (re)arm the timer. Call after settings change. */
export async function refreshSchedule() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const schedule = await readSchedule();
  nextRunAt = schedule.next_run_at;
  const local = !production() && (process.env.JOB_RUNNER ?? 'local') === 'local';
  if (local && schedule.auto_run_enabled && tick) {
    timer = setInterval(async () => {
      if (processing) return;
      processing = true;
      try {
        const current = await readSchedule();
        if (scheduleDue(current)) {
          await tick();
          await advanceSchedule(current);
          nextRunAt = (await readSchedule()).next_run_at;
        }
      } catch (error) {
        console.error('Local scheduler:', error.message);
      } finally {
        processing = false;
      }
    }, 1000);
    timer.unref?.();
  }
  return { enabled: schedule.auto_run_enabled, minutes: schedule.interval_minutes };
}

/** Start the scheduler. `tick` is called on every interval (e.g. an /api/run). */
export async function startScheduler(tickFn) {
  tick = tickFn;
  return refreshSchedule();
}

export const scheduleState = () => ({
  timerRunning: Boolean(timer),
  nextRunAt,
});
