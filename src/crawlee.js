import { PlaywrightCrawler } from 'crawlee';
import { AuthError, NotFoundError, QuotaError } from './brightdata.js';
import { ApiError } from './errors.js';

export { AuthError, NotFoundError, QuotaError };

const PLATFORMS = {
  tiktok: {
    profileUrl: (username) => `https://www.tiktok.com/@${encodeURIComponent(username)}`,
    postHref: /\/video\/(\d+)/,
    postSelector: 'a[href*="/video/"]',
  },
  instagram: {
    profileUrl: (username) => `https://www.instagram.com/${encodeURIComponent(username)}/`,
    postHref: /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/,
    postSelector: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
  },
  x: {
    profileUrl: (username) => `https://x.com/${encodeURIComponent(username)}`,
    postHref: /\/status\/(\d+)/,
    postSelector: 'a[href*="/status/"]',
  },
};
PLATFORMS.twitter = PLATFORMS.x;

export const platformList = () => [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'x', label: 'X' },
];

export const normalizePlatform = (name) => {
  const key = String(name ?? '').trim().toLowerCase();
  if (!PLATFORMS[key]) throw new ApiError(400, `Unsupported platform "${name}".`);
  return key === 'twitter' ? 'x' : key;
};

const platformFor = (name) => {
  const key = normalizePlatform(name);
  return { key, config: PLATFORMS[key] };
};

const unavailable = /this account is private|account is private|user not found|profile not found|page isn't available|page isn’t available|account doesn.t exist|account doesn't exist|suspended/i;
const challenge = /verify you are human|captcha|unusual traffic|automated requests|rate limit|temporarily blocked|something went wrong/i;

/**
 * Fetch up to N public posts with a real Chromium browser. This adapter intentionally has no
 * account/session or proxy support; it feeds records into the existing common normalizer,
 * retries, profile tracking, and database save path.
 */
export async function fetchPosts(_unused, { platform, username, url }, postsPerProfile = 5) {
  const { key, config } = platformFor(platform);
  const target = url || config.profileUrl(username);
  const limit = Math.max(1, Math.min(50, Number(postsPerProfile) || 5));
  let records = [];
  let crawlError = null;

  const crawler = new PlaywrightCrawler({
    headless: true,
    maxConcurrency: 1,
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 0, // runScrape() owns the common transient retry policy
    requestHandlerTimeoutSecs: 60,
    launchContext: {
      launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox'] },
    },
    async requestHandler({ page, request }) {
      const response = await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (response && response.status() === 404) throw new NotFoundError('Profile is unavailable (HTTP 404).');
      if (response && [401, 403].includes(response.status())) {
        throw new NotFoundError(`Profile is unavailable to public browsing (HTTP ${response.status()}).`);
      }
      const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
      if (unavailable.test(bodyText)) throw new NotFoundError('Profile is private or unavailable.');
      if (challenge.test(bodyText)) throw new Error('The platform returned a login, bot-check, or rate-limit page.');
      await page.waitForSelector(config.postSelector, { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(1_500);

      records = await page.evaluate(({ postPattern, platformKey, limit: max }) => {
        const candidates = platformKey === 'tiktok'
          ? [...document.querySelectorAll('a[href*="/video/"]')]
          : platformKey === 'instagram'
            ? [...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]')]
            : [...document.querySelectorAll('a[href*="/status/"]')];
        const found = new Map();
        for (const anchor of candidates) {
          const href = anchor.href;
          const match = href.match(postPattern);
          if (!match || found.has(match[1])) continue;
          const card = anchor.closest('article') || anchor.closest('[data-e2e="user-post-item"]') || anchor;
          const captionNode = platformKey === 'x'
            ? card.querySelector('[data-testid="tweetText"]')
            : platformKey === 'tiktok'
              ? card.querySelector('[data-e2e="video-desc"], [data-e2e="user-post-item-desc"]')
              : null;
          const caption = (captionNode?.innerText || card.innerText || anchor.innerText || '').trim().slice(0, 4000);
          const media = card.querySelector('video')?.currentSrc || card.querySelector('video')?.src ||
            card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || null;
          const time = card.querySelector('time')?.dateTime || null;
          found.set(match[1], {
            post_id: match[1],
            url: href.split('?')[0],
            description: caption || null,
            video_url: media,
            create_time: time,
          });
          if (found.size >= max) break;
        }
        return [...found.values()];
      }, { postPattern: config.postHref.source, platformKey: key, limit });

      // The result is ordered as the platform rendered the profile and capped at the shared setting.
      records = records.slice(0, limit);
      if (!records.length) {
        const settledText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        if (challenge.test(settledText)) throw new Error('The platform returned a login, bot-check, or rate-limit page.');
      }
    },
    async failedRequestHandler({ request }, error) {
      crawlError = error || new Error(request.errorMessages?.join('; ') || 'Crawlee request failed.');
    },
  });

  try {
    await crawler.run([{ url: target }]);
  } catch (error) {
    crawlError = error;
  }
  if (crawlError) throw crawlError;
  return records;
}
