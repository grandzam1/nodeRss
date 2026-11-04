import { createClient } from '@supabase/supabase-js';
import { loadSeedProfiles } from './config.js';
import { normalizePlatform } from './provider.js';
import { normalize } from './normalize.js';

/** Returns a Supabase client. Requires SUPABASE_URL + a secret key (service_role or sb_secret). */
export function openDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Insert new posts. Returns { saved, duplicates, skipped }. */
export async function savePosts(db, records, platform, username) {
  const posts = [];
  const result = { saved: 0, duplicates: 0, skipped: 0 };
  for (const record of records) {
    const post = normalize(record, platform, username);
    if (post) posts.push(post);
    else result.skipped++;
  }
  if (!posts.length) return result;

  const ids = posts.map((p) => p.id);
  const { data: existing, error } = await db.from('posts').select('id').in('id', ids);
  if (error) throw new Error(`Supabase: ${error.message}`);
  const seen = new Set(existing.map((r) => r.id));

  const fresh = posts.filter((p) => !seen.has(p.id));
  result.duplicates = posts.length - fresh.length;
  if (fresh.length) {
    const { error: insErr } = await db.from('posts').insert(fresh);
    if (insErr) throw new Error(`Supabase: ${insErr.message}`);
    result.saved = fresh.length;
  }
  return result;
}

// ---- profiles & settings ----

/** On first run, import profiles.json into the (empty) profiles table. */
export async function seedProfiles(db) {
  const { count, error } = await db.from('profiles').select('id', { count: 'exact', head: true });
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (count > 0) return;
  for (const p of loadSeedProfiles()) {
    try {
      await addProfile(db, p.platform, p.username);
    } catch {}
  }
}

export async function listProfiles(db) {
  const { data, error } = await db.from('profiles').select('*').order('id');
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

export async function addProfile(db, platform, username) {
  platform = normalizePlatform(platform);
  username = String(username ?? '').trim().replace(/^@/, '');
  if (!platform || !username) throw new Error('Platform and username are required.');
  const { error } = await db.from('profiles').insert({ platform, username });
  if (error?.code === '23505') throw new Error('That profile already exists.');
  if (error) throw new Error(`Supabase: ${error.message}`);
}

export async function deleteProfile(db, id) {
  const { error } = await db.from('profiles').delete().eq('id', id);
  if (error) throw new Error(`Supabase: ${error.message}`);
}

export async function getSetting(db, key, fallback = null) {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data ? data.value : fallback;
}

export async function setSetting(db, key, value) {
  const { error } = await db.from('settings').upsert({ key, value: String(value) });
  if (error) throw new Error(`Supabase: ${error.message}`);
}

export async function listPosts(db, limit = 100) {
  const { data, error } = await db
    .from('posts')
    .select('platform, username, post_url, caption, posted_at, scraped_at')
    .order('scraped_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}
