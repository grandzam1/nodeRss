import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

export const LOG_PATH = fileURLToPath(new URL('data/scrape.log', root));
export const PUBLIC_DIR = fileURLToPath(new URL('public/', root));
export const DEFAULT_POSTS_PER_PROFILE = 5;

/** profiles.json is only used to seed an empty database. */
export function loadSeedProfiles() {
  try {
    const list = JSON.parse(readFileSync(new URL('profiles.json', root), 'utf8'));
    return Array.isArray(list) ? list.filter((p) => p?.platform && p?.username?.trim()) : [];
  } catch {
    return [];
  }
}
