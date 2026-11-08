import * as brightdata from './brightdata.js';
import * as apify from './apify.js';
import * as crawlee from './crawlee.js';

const PROVIDERS = {
  brightdata: { name: 'brightdata', label: 'Bright Data', envKey: 'BRIGHTDATA_API_KEY', settingsKey: 'apiKey', requiresApiKey: true, module: brightdata },
  apify: { name: 'apify', label: 'Apify', envKey: 'APIFY_TOKEN', settingsKey: 'apifyKey', requiresApiKey: true, module: apify },
  crawlee: { name: 'crawlee', label: 'Crawlee + Playwright', envKey: null, settingsKey: null, requiresApiKey: false, module: crawlee },
};

/**
 * SCRAPER_PROVIDER picks the data source ('brightdata', 'apify', or 'crawlee').
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
