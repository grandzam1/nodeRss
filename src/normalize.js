import { createHash } from 'node:crypto';

export const pick = (record, ...keys) => {
  for (const k of keys) if (record[k] != null && record[k] !== '') return record[k];
  return null;
};

export const firstOf = (v) => (Array.isArray(v) ? (v[0] ?? null) : v);

const FALLBACK_URLS = {
  tiktok: (u, id) => `https://www.tiktok.com/@${u}/video/${id}`,
  x: (u, id) => `https://x.com/${u}/status/${id}`,
};

export function normalize(record, platform, username) {
  const postId = pick(record, 'post_id', 'id', 'aweme_id');
  let postUrl = pick(record, 'url', 'post_url', 'web_url', 'share_url');
  if (!postUrl && postId && FALLBACK_URLS[platform]) postUrl = FALLBACK_URLS[platform](username, postId);
  if (!postId && !postUrl) return null;

  const id = postId
    ? `${platform}:${postId}`
    : `${platform}:url:${createHash('sha256').update(String(postUrl)).digest('hex')}`;

  const text = (v) => (v == null ? null : String(v));
  return {
    id,
    platform,
    username,
    post_url: text(postUrl),
    caption: text(pick(record, 'description', 'caption', 'text')),
    media_url: text(
      pick(record, 'video_url', 'media_url', 'cdn_url', 'cdn_link', 'image_url', 'thumbnail') ??
        firstOf(record.videos) ?? firstOf(record.photos),
    ),
    posted_at: text(pick(record, 'create_time', 'createTimeISO', 'posted_at', 'created_at', 'createdAt', 'date_posted', 'datetime')),
    scraped_at: new Date().toISOString(),
  };
}
