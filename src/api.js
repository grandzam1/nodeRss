import { platformList, provider } from './provider.js';
import { openDb, listProfiles, addProfile, deleteProfile, listPosts, setSetting } from './db.js';
import { getApiKey, getPostsPerProfile } from './scrape.js';
import { refreshSchedule } from './scheduler.js';
import { readSchedule, saveSchedule, validateSchedule } from './schedule-store.js';
import { submitRun, getRun, runnerName, isBusy } from './jobs/index.js';
import { ApiError } from './errors.js';
import { requireAdmin } from './auth.js';
import { storageName } from './db.js';

const state = async (db) => {
  const schedule = await readSchedule(db);
  return {
    platforms: platformList(),
    profiles: await listProfiles(db),
    settings: {
      postsPerProfile: await getPostsPerProfile(db),
      apiKeySet: Boolean(await getApiKey(db)),
      apiKeyFromEnv: Boolean(process.env[provider.envKey]),
      provider: provider.name,
      scheduleEnabled: schedule.auto_run_enabled,
      intervalMinutes: schedule.interval_minutes,
      nextRunAt: schedule.next_run_at,
      runner: runnerName,
    },
    running: await isBusy(),
  };
};

/** Shared handler for every /api/* route. Returns { status, data }. */
export async function handleApi(method, pathname, body = {}, ctx = {}) {
  const db = openDb();

  if (method === 'GET' && pathname === '/api/state') return { status: 200, data: await state(db) };
  if (method === 'GET' && pathname === '/api/posts') return { status: 200, data: await listPosts(db, 200) };

  // Liveness/readiness probe: storage is pinged so a broken DB shows up here, not at scrape time.
  if (method === 'GET' && pathname === '/api/health') {
    let database = 'ok';
    try {
      await listProfiles(db);
    } catch (err) {
      database = `error: ${err.message}`;
    }
    const schedule = await readSchedule(db).catch(() => null);
    return {
      status: database === 'ok' ? 200 : 503,
      data: { ok: database === 'ok', database, storage: storageName, runner: runnerName, schedule, time: new Date().toISOString() },
    };
  }

  if (method === 'POST' && pathname === '/api/profiles') {
    requireAdmin(ctx.headers, { internal: ctx.internal });
    await addProfile(db, body.platform, body.username);
    return { status: 200, data: await state(db) };
  }

  const match = pathname.match(/^\/api\/profiles\/(\d+)$/);
  if (method === 'DELETE' && match) {
    requireAdmin(ctx.headers, { internal: ctx.internal });
    if (!(await deleteProfile(db, Number(match[1])))) {
      throw new ApiError(404, 'Profile not found.');
    }
    return { status: 200, data: await state(db) };
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    requireAdmin(ctx.headers, { internal: ctx.internal });
    const { postsPerProfile, apiKey, scheduleEnabled, intervalMinutes } = body;
    validateSchedule({ scheduleEnabled, intervalMinutes });
    if (postsPerProfile !== undefined) {
      const n = Number(postsPerProfile);
      if (!Number.isInteger(n) || n < 1 || n > 50) throw new ApiError(400, 'Posts per profile must be 1-50.');
      await setSetting(db, 'postsPerProfile', n);
    }
    if (scheduleEnabled !== undefined || intervalMinutes !== undefined) await saveSchedule({ scheduleEnabled, intervalMinutes }, db);
    if (provider.requiresApiKey !== false && typeof apiKey === 'string' && apiKey.trim()) {
      await setSetting(db, provider.settingsKey, apiKey.trim());
    }
    await refreshSchedule();
    return { status: 200, data: await state(db) };
  }

  // Submit a scrape job — returns a job ID; execution is the job runner's business.
  if (method === 'POST' && pathname === '/api/run') {
    requireAdmin(ctx.headers, { internal: ctx.internal, allowCron: true });
    const { jobId } = await submitRun().catch((err) => {
      throw new ApiError(/already in progress/i.test(err.message) ? 409 : 502, err.message);
    });
    return { status: 202, data: { jobId, runner: runnerName } };
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)$/);
  if (method === 'GET' && jobMatch) {
    const job = await getRun(jobMatch[1]).catch((err) => {
      throw new ApiError(502, `Could not check the run's status (${err.message}). Try again in a moment.`);
    });
    if (!job) {
      throw new ApiError(404, runnerName === 'local'
        ? 'Job not found. Local run history is cleared when the app restarts — start a new run.'
        : 'Job not found. The run may still be registering with the job service — wait a few seconds and try again.');
    }
    return { status: 200, data: job };
  }

  throw new ApiError(404, 'Not found');
}
