import { platformList, provider } from './provider.js';
import { openDb, listProfiles, addProfile, deleteProfile, listPosts, setSetting, getSetting } from './db.js';
import { getApiKey, getPostsPerProfile } from './scrape.js';
import { refreshSchedule, scheduleState, DEFAULT_INTERVAL_MINUTES } from './scheduler.js';
import { submitRun, getRun, runnerName, isBusy } from './jobs/index.js';

const state = async (db) => ({
  platforms: platformList(),
  profiles: await listProfiles(db),
  settings: {
    postsPerProfile: await getPostsPerProfile(db),
    apiKeySet: Boolean(await getApiKey(db)),
    apiKeyFromEnv: Boolean(process.env[provider.envKey]),
    provider: provider.name,
    scheduleEnabled: String(await getSetting(db, 'scheduleEnabled', 'false')) === 'true',
    intervalMinutes: Number(await getSetting(db, 'intervalMinutes', DEFAULT_INTERVAL_MINUTES)) || DEFAULT_INTERVAL_MINUTES,
    nextRunAt: scheduleState().nextRunAt,
    runner: runnerName,
  },
  running: isBusy(),
});

/** Shared handler for every /api/* route. Returns { status, data }. */
export async function handleApi(method, pathname, body = {}) {
  const db = openDb();

  if (method === 'GET' && pathname === '/api/state') return { status: 200, data: await state(db) };
  if (method === 'GET' && pathname === '/api/posts') return { status: 200, data: await listPosts(db, 200) };

  if (method === 'POST' && pathname === '/api/profiles') {
    await addProfile(db, body.platform, body.username);
    return { status: 200, data: await state(db) };
  }

  const match = pathname.match(/^\/api\/profiles\/(\d+)$/);
  if (method === 'DELETE' && match) {
    await deleteProfile(db, Number(match[1]));
    return { status: 200, data: await state(db) };
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    const { postsPerProfile, apiKey, scheduleEnabled, intervalMinutes } = body;
    if (postsPerProfile !== undefined) {
      const n = Number(postsPerProfile);
      if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('Posts per profile must be 1-50.');
      await setSetting(db, 'postsPerProfile', n);
    }
    if (intervalMinutes !== undefined) {
      const m = Number(intervalMinutes);
      if (!Number.isInteger(m) || m < 1 || m > 1440) throw new Error('Interval must be 1-1440 minutes.');
      await setSetting(db, 'intervalMinutes', m);
    }
    if (scheduleEnabled !== undefined) await setSetting(db, 'scheduleEnabled', scheduleEnabled ? 'true' : 'false');
    if (typeof apiKey === 'string' && apiKey.trim()) await setSetting(db, provider.settingsKey, apiKey.trim());
    await refreshSchedule();
    return { status: 200, data: await state(db) };
  }

  // Submit a scrape job — returns a job ID; execution is the job runner's business.
  if (method === 'POST' && pathname === '/api/run') {
    const { jobId } = await submitRun();
    return { status: 202, data: { jobId, runner: runnerName } };
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)$/);
  if (method === 'GET' && jobMatch) {
    const job = await getRun(jobMatch[1]);
    if (!job) return { status: 404, data: { error: 'Job not found' } };
    return { status: 200, data: job };
  }

  return { status: 404, data: { error: 'Not found' } };
}
