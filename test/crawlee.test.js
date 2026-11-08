import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { fetchPosts } from '../src/crawlee.js';
import { savePosts } from '../src/sqlite.js';

const fixture = `<!doctype html>
<html><body>
  <main data-e2e="user-post-item">
    <article><a href="/@fixture/video/1001"><span>first video caption</span><img src="/media-1.jpg"><time datetime="2026-11-01T12:00:00Z"></time></a></article>
    <article><a href="/@fixture/video/1002"><span>second video caption</span><img src="/media-2.jpg"><time datetime="2026-11-02T12:00:00Z"></time></a></article>
    <article><a href="/@fixture/video/1003"><span>third video caption</span></a></article>
  </main>
</body></html>`;

test('Crawlee + Chromium extracts public post records and shared SQLite storage de-duplicates reruns', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixture);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/@fixture`;
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE posts (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL, username TEXT NOT NULL,
    post_url TEXT UNIQUE, caption TEXT, media_url TEXT, posted_at TEXT, scraped_at TEXT NOT NULL
  )`);

  try {
    const records = await fetchPosts('', { platform: 'tiktok', username: 'fixture', url }, 2);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((p) => p.post_id), ['1001', '1002']);
    assert.equal(records[0].description, 'first video caption');
    assert.equal(records[0].create_time, '2026-11-01T12:00:00Z');

    const first = await savePosts(db, records, 'tiktok', 'fixture');
    const second = await savePosts(db, records, 'tiktok', 'fixture');
    assert.equal(first.saved, 2);
    assert.equal(first.duplicates, 0);
    assert.equal(second.saved, 0);
    assert.equal(second.duplicates, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 2);
    const stored = db.prepare('SELECT id, platform, username, post_url, caption, media_url, posted_at FROM posts WHERE id = ?').get('tiktok:1001');
    assert.deepEqual({ ...stored }, {
      id: 'tiktok:1001',
      platform: 'tiktok',
      username: 'fixture',
      post_url: 'http://127.0.0.1:' + new URL(url).port + '/@fixture/video/1001',
      caption: 'first video caption',
      media_url: 'http://127.0.0.1:' + new URL(url).port + '/media-1.jpg',
      posted_at: '2026-11-01T12:00:00Z',
    });
  } finally {
    db.close();
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Crawlee surfaces a platform bot-check page as a transient error for common retries', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>Verify you are human before continuing</body></html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/@fixture`;
  try {
    await assert.rejects(() => fetchPosts('', { platform: 'tiktok', username: 'fixture', url }, 5), /human|bot-check|rate-limit/i);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
