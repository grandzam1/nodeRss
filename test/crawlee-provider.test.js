import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SCRAPER_PROVIDER = 'crawlee';
delete process.env.APIFY_TOKEN;
delete process.env.BRIGHTDATA_API_KEY;

const { provider, platformList, normalizePlatform } = await import('../src/provider.js');

test('Crawlee provider selection is explicit, keyless, and retains the supported platform contract', () => {
  assert.equal(provider.name, 'crawlee');
  assert.equal(provider.requiresApiKey, false);
  assert.equal(provider.envKey, null);
  assert.deepEqual(platformList(), [
    { value: 'tiktok', label: 'TikTok' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'x', label: 'X' },
  ]);
  assert.equal(normalizePlatform('twitter'), 'x');
});
