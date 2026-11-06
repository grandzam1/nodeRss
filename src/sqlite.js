import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadSeedProfiles } from './config.js';
import { normalizePlatform } from './provider.js';
import { normalize } from './normalize.js';
import { ApiError } from './errors.js';

const DB_PATH = fileURLToPath(new URL('../data/posts.sqlite3', import.meta.url));

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    post_url TEXT UNIQUE,
    caption TEXT,
    media_url TEXT,
    posted_at TEXT,
    scraped_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    UNIQUE (platform, username)
  )`);
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return db;
}

/** Insert new posts in one transaction. Returns { saved, duplicates, skipped }. */
export async function savePosts(db, records, platform, username) {
  const insert = db.prepare(`INSERT OR IGNORE INTO posts
    (id, platform, username, post_url, caption, media_url, posted_at, scraped_at)
    VALUES (:id, :platform, :username, :post_url, :caption, :media_url, :posted_at, :scraped_at)`);
  const result = { saved: 0, duplicates: 0, skipped: 0 };

  db.exec('BEGIN');
  try {
    for (const record of records) {
      const post = normalize(record, platform, username);
      if (!post) {
        result.skipped++;
        continue;
      }
      if (insert.run(post).changes === 1) result.saved++;
      else result.duplicates++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return result;
}

// ---- profiles & settings ----

/** On first run, import profiles.json into the (empty) profiles table. */
export async function seedProfiles(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n > 0) return;
  for (const p of loadSeedProfiles()) {
    try {
      await addProfile(db, p.platform, p.username);
    } catch {}
  }
}

export const listProfiles = async (db) => db.prepare('SELECT * FROM profiles ORDER BY id').all();

export async function addProfile(db, platform, username) {
  platform = normalizePlatform(platform);
  username = String(username ?? '').trim().replace(/^@/, '');
  if (!platform || !username) throw new ApiError(400, 'Platform and username are required.');
  const r = db
    .prepare('INSERT OR IGNORE INTO profiles (platform, username) VALUES (?, ?)')
    .run(platform, username);
  if (r.changes === 0) throw new ApiError(409, 'That profile already exists.');
}

export const deleteProfile = async (db, id) => db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0;

export async function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export const setSetting = async (db, key, value) =>
  db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));

export const listPosts = async (db, limit = 100) =>
  db
    .prepare('SELECT platform, username, post_url, caption, posted_at, scraped_at FROM posts ORDER BY scraped_at DESC LIMIT ?')
    .all(limit);
