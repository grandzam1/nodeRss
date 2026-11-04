import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { loadSeedProfiles } from './config.js';
import { normalizePlatform } from './provider.js';
import { normalize, pick, firstOf } from './normalize.js';

const PROFILE_URLS = {
  tiktok: (u) => `https://www.tiktok.com/@${u}`,
  instagram: (u) => `https://www.instagram.com/${u}/`,
  x: (u) => `https://x.com/${u}`,
};

/** Supabase client mapped onto the existing watch_* schema. */
export function openDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).');
  return createClient(url, key, { auth: { persistSession: false } });
}

const fail = (error) => {
  throw new Error(`Supabase: ${error.message}`);
};

async function profileIdFor(db, platform, username) {
  const { data, error } = await db
    .from('watch_profiles')
    .select('id')
    .eq('platform', platform)
    .eq('handle', username)
    .maybeSingle();
  if (error) fail(error);
  return data?.id ?? null;
}

/** Insert new posts into watch_posts. Returns { saved, duplicates, skipped }. */
export async function savePosts(db, records, platform, username) {
  const profile_id = await profileIdFor(db, platform, username);
  const rows = [];
  const result = { saved: 0, duplicates: 0, skipped: 0 };

  for (const record of records) {
    const post = normalize(record, platform, username);
    if (!post) {
      result.skipped++;
      continue;
    }
    // post.id is "platform:postId" or "platform:url:<sha>" — keep the part after "platform:"
    const post_id = post.id.slice(platform.length + 1);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    rows.push({
      platform,
      profile_id,
      post_id,
      url: post.post_url,
      text: post.caption,
      posted_at: post.posted_at,
      likes: num(pick(record, 'likes', 'like_count', 'digg_count', 'num_likes')),
      comments: num(pick(record, 'comments', 'comment_count', 'num_comments')),
      raw: record,
    });
  }
  if (!rows.length) return result;

  const { data: existing, error } = await db
    .from('watch_posts')
    .select('post_id')
    .eq('platform', platform)
    .in('post_id', rows.map((r) => r.post_id));
  if (error) fail(error);
  const seen = new Set(existing.map((r) => r.post_id));

  const fresh = rows.filter((r) => !seen.has(r.post_id));
  result.duplicates = rows.length - fresh.length;
  if (fresh.length) {
    const { error: insErr } = await db.from('watch_posts').insert(fresh);
    if (insErr) fail(insErr);
    result.saved = fresh.length;
  }
  return result;
}

// ---- profiles & settings ----

/** On first run, import profiles.json into the (empty) watch_profiles table. */
export async function seedProfiles(db) {
  const { count, error } = await db.from('watch_profiles').select('id', { count: 'exact', head: true });
  if (error) fail(error);
  if (count > 0) return;
  for (const p of loadSeedProfiles()) {
    try {
      await addProfile(db, p.platform, p.username);
    } catch {}
  }
}

export async function listProfiles(db) {
  const { data, error } = await db.from('watch_profiles').select('*').eq('active', true).order('id');
  if (error) fail(error);
  return data.map((p) => ({ ...p, username: p.handle }));
}

export async function addProfile(db, platform, username) {
  platform = normalizePlatform(platform);
  username = String(username ?? '').trim().replace(/^@/, '');
  if (!platform || !username) throw new Error('Platform and username are required.');
  const url = PROFILE_URLS[platform]?.(username) ?? null;
  const { error } = await db
    .from('watch_profiles')
    .insert({ platform, handle: username, url, active: true, baselined: false });
  if (error?.code === '23505') throw new Error('That profile already exists.');
  if (error) fail(error);
}

export async function deleteProfile(db, id) {
  const { error } = await db.from('watch_profiles').update({ active: false }).eq('id', id);
  if (error) fail(error);
}

export async function getSetting(db, key, fallback = null) {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) {
    if (error.code === 'PGRST205' || /settings/.test(error.message)) return fallback; // table optional
    fail(error);
  }
  return data ? data.value : fallback;
}

export async function setSetting(db, key, value) {
  const { error } = await db.from('settings').upsert({ key, value: String(value) });
  if (error) fail(error);
}

export async function listPosts(db, limit = 100) {
  // watch_posts.profile_id isn't a declared FK, so join handles in code.
  const { data, error } = await db
    .from('watch_posts')
    .select('platform, profile_id, url, text, posted_at, likes, comments')
    .order('id', { ascending: false })
    .limit(limit);
  if (error) fail(error);
  const ids = [...new Set(data.map((p) => p.profile_id).filter(Boolean))];
  const handles = new Map();
  if (ids.length) {
    const { data: profs, error: pErr } = await db.from('watch_profiles').select('id, handle').in('id', ids);
    if (pErr) fail(pErr);
    for (const p of profs) handles.set(p.id, p.handle);
  }
  return data.map((p) => ({
    platform: p.platform,
    username: handles.get(p.profile_id) ?? null,
    post_url: p.url,
    caption: p.text,
    posted_at: p.posted_at,
    likes: p.likes,
    comments: p.comments,
    scraped_at: null,
  }));
}
