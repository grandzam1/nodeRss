import { platformList, provider } from './provider.js';
import { openDb, listProfiles, addProfile, deleteProfile, listPosts, setSetting, getSetting } from './db.js';
import { runScrape, getApiKey, getPostsPerProfile } from './scrape.js';
import { createLogger } from './logger.js';

let running = false;

const state = async (db) => ({
  platforms: platformList(),
  profiles: await listProfiles(db),
  settings: {
    postsPerProfile: await getPostsPerProfile(db),
    apiKeySet: Boolean(await getApiKey(db)),
    apiKeyFromEnv: Boolean(process.env[provider.envKey]),
    provider: provider.name,
  },
  running,
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
    const { postsPerProfile, apiKey } = body;
    if (postsPerProfile !== undefined) {
      const n = Number(postsPerProfile);
      if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('Posts per profile must be 1-50.');
      await setSetting(db, 'postsPerProfile', n);
    }
    if (typeof apiKey === 'string' && apiKey.trim()) await setSetting(db, provider.settingsKey, apiKey.trim());
    return { status: 200, data: await state(db) };
  }

  if (method === 'POST' && pathname === '/api/run') {
    if (running) throw new Error('A run is already in progress.');
    running = true;
    const logs = [];
    try {
      const totals = await runScrape(db, createLogger((line) => logs.push(line)));
      return { status: 200, data: { totals, logs } };
    } finally {
      running = false;
    }
  }

  return { status: 404, data: { error: 'Not found' } };
}
