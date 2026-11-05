import * as brightdata from './brightdata.js';
import * as apify from './apify.js';

const PROVIDERS = {
  brightdata: { name: 'brightdata', label: 'Bright Data', envKey: 'BRIGHTDATA_API_KEY', settingsKey: 'apiKey', module: brightdata },
  apify: { name: 'apify', label: 'Apify', envKey: 'APIFY_TOKEN', settingsKey: 'apifyKey', module: apify },
};

/**
 * SCRAPER_PROVIDER picks the backend ('brightdata' or 'apify').
 * If unset, it falls back to whichever env key is present, then Bright Data.
 */
function getProvider() {
  const wanted = (process.env.SCRAPER_PROVIDER ?? '').trim().toLowerCase();
  if (wanted) {
    if (!PROVIDERS[wanted]) throw new Error(`Unknown SCRAPER_PROVIDER "${wanted}".`);
    return PROVIDERS[wanted];
  }
  if (process.env.APIFY_TOKEN && !process.env.BRIGHTDATA_API_KEY) return PROVIDERS.apify;
  return PROVIDERS.brightdata;
}

export const provider = getProvider();
export const fetchPosts = provider.module.fetchPosts;
export const platformList = provider.module.platformList;
export const normalizePlatform = provider.module.normalizePlatform;
export const { AuthError, NotFoundError, QuotaError } = provider.module;
