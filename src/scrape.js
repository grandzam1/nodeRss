import { DEFAULT_POSTS_PER_PROFILE } from './config.js';
import { listProfiles, savePosts, getSetting, seedProfiles, markProfileFailed, markProfileOk } from './db.js';
import { fetchPosts, AuthError, NotFoundError, QuotaError, provider } from './provider.js';

const RETRY_DELAYS_MS = [2000, 4000, 8000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Auth failures, missing/private profiles and exhausted quotas never get better on retry.
const isPermanent = (err) => err instanceof AuthError || err instanceof NotFoundError || err instanceof QuotaError;

/** The env var wins over a key saved from the UI. */
export const getApiKey = async (db) =>
  provider.requiresApiKey === false
    ? ''
    : (process.env[provider.envKey] || (await getSetting(db, provider.settingsKey)) || '').trim();

export const getPostsPerProfile = async (db) =>
  Number(await getSetting(db, 'postsPerProfile', DEFAULT_POSTS_PER_PROFILE)) || DEFAULT_POSTS_PER_PROFILE;

/**
 * Scrape one profile, with retries for transient errors. Scrape failures are returned, not thrown
 * (only unexpected storage errors throw), so a job runner can run this as one retryable unit.
 * Returns { saved, duplicates, failed, fatal }:
 *   failed — counts toward totals.failed (NotFoundError is only a skip, so false)
 *   fatal  — auth/quota problem: every other profile would fail the same way, so stop the run.
 */
export async function scrapeProfile(db, profile, { apiKey, postsPerProfile, log = () => {} }) {
  const result = { saved: 0, duplicates: 0, failed: false, fatal: false };
  let failure = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const records = await fetchPosts(apiKey, profile, postsPerProfile);
      const { saved, duplicates, skipped } = await savePosts(db, records, profile.platform, profile.username);
      result.saved += saved;
      result.duplicates += duplicates;
      log('INFO', `${saved} new, ${duplicates} duplicate${skipped ? `, ${skipped} skipped` : ''}.`, profile);
      await markProfileOk(db, profile);
      failure = null;
      break;
    } catch (err) {
      failure = err;
      if (isPermanent(err) || attempt === RETRY_DELAYS_MS.length) break;
      const which = attempt === 0 ? 'Initial attempt' : `Retry ${attempt}/${RETRY_DELAYS_MS.length}`;
      log('WARN', `${which} failed (${err.message}); retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s.`, profile);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  if (failure) {
    await markProfileFailed(db, profile);
    if (failure instanceof NotFoundError) {
      log('WARN', `Skipped: ${failure.message}`, profile);
    } else {
      log('ERROR', failure.message, profile);
      result.failed = true;
      result.fatal = failure instanceof AuthError || failure instanceof QuotaError;
    }
  }
  return result;
}

/** Scrape every saved profile. `log(level, message, profile?)` receives progress. */
export async function runScrape(db, log = () => {}) {
  const apiKey = await getApiKey(db);
  if (provider.requiresApiKey !== false && !apiKey) throw new Error(`No ${provider.label} API key set.`);

  await seedProfiles(db);
  const profiles = await listProfiles(db);
  const postsPerProfile = await getPostsPerProfile(db);
  const totals = { profiles: profiles.length, saved: 0, duplicates: 0, failed: 0 };

  for (const profile of profiles) {
    const r = await scrapeProfile(db, profile, { apiKey, postsPerProfile, log });
    totals.saved += r.saved;
    totals.duplicates += r.duplicates;
    if (r.failed) totals.failed++;
    if (r.fatal) break;
  }
  return totals;
}
