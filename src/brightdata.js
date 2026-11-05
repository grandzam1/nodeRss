const BASE = 'https://api.brightdata.com/datasets/v3';
const RETRY_DELAYS_MS = [2000, 4000, 8000];
const POLL_EVERY_MS = 5000;
const POLL_MAX_MS = 5 * 60_000;

export class AuthError extends Error {}
export class NotFoundError extends Error {}
export class QuotaError extends Error {}

/**
 * One entry per supported platform. To add a platform, add an entry here
 * (dataset ID + how to build its profile URL and request input).
 */
const PLATFORMS = {
  tiktok: {
    label: 'TikTok',
    datasetId: 'gd_m7n5v2gq296pex2f5m', // Posts by Profile (Fast API)
    query: {},
    profileUrl: (u) => `https://www.tiktok.com/@${u}`,
    input: (url, n) => ({ url, num_of_posts: n }),
  },
  instagram: {
    label: 'Instagram',
    datasetId: 'gd_lk5ns7kz21pck8jpis', // Posts, discover by profile URL
    query: { type: 'discover_new', discover_by: 'url' },
    profileUrl: (u) => `https://www.instagram.com/${u}/`,
    input: (url, n) => ({ url, num_of_posts: n }),
  },
  x: {
    label: 'X',
    datasetId: 'gd_lwxkxvnf1cynvib9co', // Posts, discover by profile URL
    query: { type: 'discover_new', discover_by: 'profile_url' },
    profileUrl: (u) => `https://x.com/${u}`,
    input: (url) => ({ url }), // no post-count option; trimmed after the response
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
  const text = ['error', 'message', 'status', 'reason', 'error_code']
    .map((k) => record?.[k] ?? '')
    .join(' ')
    .toLowerCase();
  return /private|not found|does not exist|no_posts|dead_page/.test(text);
}

function toRecords(payload) {
  if (!payload) return [];
  let list = Array.isArray(payload)
    ? payload
    : (payload.data ?? payload.results ?? payload.posts ?? payload.items ?? [payload]);
  if (!Array.isArray(list)) throw new Error('Unrecognized response from Bright Data.');
  if (list.some(looksUnavailable)) throw new NotFoundError('Profile is private or unavailable.');
  // Some datasets wrap posts inside a profile object: { posts: [...] }
  list = list.flatMap((r) => (Array.isArray(r?.posts) ? r.posts : [r]));
  return list.filter((r) => r && typeof r === 'object' && Object.keys(r).length);
}

async function request(apiKey, url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error(`Network error: ${err.message}`);
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (res.status === 401) throw new AuthError('HTTP 401: check your Bright Data API key.');
    if (res.status === 402) throw new QuotaError('HTTP 402: Bright Data quota/credits exhausted.');
    if (res.status === 403) throw new Error('HTTP 403: access denied.');
    if (res.status === 404) throw new NotFoundError('HTTP 404: profile or dataset not found.');
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      const detail = (await res.text()).replaceAll(apiKey, '[REDACTED]').slice(0, 300);
      throw new Error(`HTTP ${res.status}. ${detail}`.trim());
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

/** Bright Data answers 202 + snapshot_id when a job takes a while. Wait for it. */
async function waitForSnapshot(apiKey, snapshotId) {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    const { status } = await (await request(apiKey, `${BASE}/progress/${snapshotId}`)).json();
    if (status === 'failed') throw new Error('Bright Data job failed.');
    if (status === 'ready') {
      const res = await request(apiKey, `${BASE}/snapshot/${snapshotId}?format=json`);
      return res.json();
    }
  }
  throw new Error('Timed out waiting for Bright Data job.');
}

/** Fetch the latest posts for one profile. */
export async function fetchPosts(apiKey, { platform, username }, postsPerProfile = 5) {
  const p = PLATFORMS[platform];
  if (!p) throw new Error(`Unsupported platform "${platform}".`);

  const params = new URLSearchParams({ dataset_id: p.datasetId, format: 'json', ...p.query });
  const body = JSON.stringify({ input: [p.input(p.profileUrl(username), postsPerProfile)] });
  const res = await request(apiKey, `${BASE}/scrape?${params}`, { method: 'POST', body });

  let payload = await res.json();
  if (res.status === 202 && payload?.snapshot_id) payload = await waitForSnapshot(apiKey, payload.snapshot_id);
  else if (res.status === 202) throw new Error('Bright Data returned HTTP 202 without a snapshot ID.');

  return toRecords(payload).slice(0, postsPerProfile);
}
