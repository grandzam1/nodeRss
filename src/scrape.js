import { DEFAULT_POSTS_PER_PROFILE } from './config.js';
import { listProfiles, savePosts, getSetting, seedProfiles, markProfileFailed, markProfileOk } from './db.js';
import { fetchPosts, AuthError, NotFoundError, QuotaError, provider } from './provider.js';

const RETRY_DELAYS_MS = [2000, 4000, 8000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Auth failures, missing/private profiles and exhausted quotas never get better on retry.
const isPermanent = (err) => err instanceof AuthError || err instanceof NotFoundError || err instanceof QuotaError;

/** The env var wins over a key saved from the UI. */
export const getApiKey = async (db) =>
  (process.env[provider.envKey] || (await getSetting(db, provider.settingsKey)) || '').trim();

export const getPostsPerProfile = async (db) =>
  Number(await getSetting(db, 'postsPerProfile', DEFAULT_POSTS_PER_PROFILE)) || DEFAULT_POSTS_PER_PROFILE;

/** Scrape every saved profile. `log(level, message, profile?)` receives progress. */
export async function runScrape(db, log = () => {}) {
  const apiKey = await getApiKey(db);
  if (!apiKey) throw new Error(`No ${provider.label} API key set.`);

  await seedProfiles(db);
  const profiles = await listProfiles(db);
  const postsPerProfile = await getPostsPerProfile(db);
  const totals = { profiles: profiles.length, saved: 0, duplicates: 0, failed: 0 };

  for (const profile of profiles) {
    let failure = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const records = await fetchPosts(apiKey, profile, postsPerProfile);
        const { saved, duplicates, skipped } = await savePosts(db, records, profile.platform, profile.username);
        totals.saved += saved;
        totals.duplicates += duplicates;
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
        totals.failed++;
        if (failure instanceof AuthError || failure instanceof QuotaError) break;
      }
    }
  }
  return totals;
}
