import { DEFAULT_POSTS_PER_PROFILE } from './config.js';
import { listProfiles, savePosts, getSetting, seedProfiles } from './db.js';
import { fetchPosts, AuthError, NotFoundError, provider } from './provider.js';

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
    try {
      const records = await fetchPosts(apiKey, profile, postsPerProfile);
      const { saved, duplicates, skipped } = await savePosts(db, records, profile.platform, profile.username);
      totals.saved += saved;
      totals.duplicates += duplicates;
      log('INFO', `${saved} new, ${duplicates} duplicate${skipped ? `, ${skipped} skipped` : ''}.`, profile);
    } catch (err) {
      if (err instanceof NotFoundError) {
        log('WARN', `Skipped: ${err.message}`, profile);
      } else {
        log('ERROR', err.message, profile);
        totals.failed++;
        if (err instanceof AuthError) break;
      }
    }
  }
  return totals;
}
