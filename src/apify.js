import { AuthError, NotFoundError, QuotaError } from './brightdata.js';

export { AuthError, NotFoundError, QuotaError };

const BASE = 'https://api.apify.com/v2';
const RETRY_DELAYS_MS = [2000, 4000, 8000];
const RUN_TIMEOUT_S = 300;

/**
 * One entry per supported platform. To add a platform, add an entry here
 * (Apify actor ID + how to build its profile URL and request input).
 */
const PLATFORMS = {
  tiktok: {
    label: 'TikTok',
    actorId: 'clockworks~tiktok-scraper',
    profileUrl: (u) => `https://www.tiktok.com/@${u}`,
    input: (url, n) => ({ profiles: [url], resultsPerPage: n }),
  },
  instagram: {
    label: 'Instagram',
    actorId: 'apify~instagram-scraper',
    profileUrl: (u) => `https://www.instagram.com/${u}/`,
    input: (url, n) => ({ directUrls: [url], resultsType: 'posts', resultsLimit: n }),
  },
  x: {
    label: 'X',
    actorId: 'apidojo~tweet-scraper',
    profileUrl: (u) => `https://x.com/${u}`,
    input: (_url, n, u) => ({ twitterHandles: [u], maxItems: n }),
  },
};
PLATFORMS.twitter = PLATFORMS.x; // alias

export const platformList = () =>
  Object.entries(PLATFORMS)
    .filter(([key]) => key !== 'twitter')
    .map(([value, p]) => ({ value, label: p.label }));

export const normalizePlatform = (name) => {
  const key = String(name ?? '').trim().toLowerCase();
  if (!PLATFORMS[key]) throw new Error(`Unsupported platform "${name}".`);
  return key === 'twitter' ? 'x' : key;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function looksUnavailable(record) {
  const text = ['error', 'errorMessage', 'message', 'status', 'reason']
    .map((k) => record?.[k] ?? '')
    .join(' ')
    .toLowerCase();
  return /private|not found|does not exist|no_posts|dead_page|suspended/.test(text);
}

function toRecords(payload) {
  if (!payload) return [];
  let list = Array.isArray(payload)
    ? payload
    : (payload.items ?? payload.results ?? payload.posts ?? [payload]);
  if (!Array.isArray(list)) throw new Error('Unrecognized response from Apify.');
  if (list.some(looksUnavailable)) throw new NotFoundError('Profile is private or unavailable.');
  // Some actors wrap posts inside a profile object: { posts: [...] }
  list = list.flatMap((r) => (Array.isArray(r?.posts) ? r.posts : [r]));
  // Actors emit placeholder records like { noResults: true } when they find nothing.
  return list.filter((r) => r && typeof r === 'object' && Object.keys(r).length && !r.noResults);
}

async function request(token, url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(RUN_TIMEOUT_S * 1000 + 30_000),
      });
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error(`Network error: ${err.message}`);
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (res.status === 401) throw new AuthError('HTTP 401: check your Apify token.');
    if (res.status === 402) throw new QuotaError('HTTP 402: Apify quota/credits exhausted.');
    if (res.status === 403) throw new Error('HTTP 403: access denied.');
    if (res.status === 404) throw new NotFoundError('HTTP 404: profile or actor not found.');
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      const detail = (await res.text()).replaceAll(token, '[REDACTED]').slice(0, 300);
      throw new Error(`HTTP ${res.status}. ${detail}`.trim());
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

/** Fetch the latest posts for one profile. */
export async function fetchPosts(token, { platform, username }, postsPerProfile = 5) {
  const p = PLATFORMS[platform];
  if (!p) throw new Error(`Unsupported platform "${platform}".`);

  const params = new URLSearchParams({ token, timeout: String(RUN_TIMEOUT_S) });
  const url = `${BASE}/acts/${p.actorId}/run-sync-get-dataset-items?${params}`;
  const body = JSON.stringify(p.input(p.profileUrl(username), postsPerProfile, username));

  const res = await request(token, url, { method: 'POST', body });
  return toRecords(await res.json()).slice(0, postsPerProfile);
}
