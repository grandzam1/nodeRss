/**
 * STORAGE picks the storage backend: 'sqlite', 'supabase' (generic tables),
 * or 'watch' (the existing watch_* schema in Supabase).
 * If unset, Supabase 'watch' is used when its env keys are present, else local SQLite.
 */
async function getAdapter() {
  const wanted = (process.env.STORAGE ?? '').trim().toLowerCase();
  const hasSupabaseKeys =
    process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  const name = wanted || (hasSupabaseKeys ? 'watch' : 'sqlite');
  const loaders = {
    sqlite: () => import('./sqlite.js'),
    supabase: () => import('./supadb.js'),
    watch: () => import('./watchdb.js'),
  };
  if (!loaders[name]) throw new Error(`Unknown STORAGE "${name}".`);
  return { name, module: await loaders[name]() };
}

const { name: storageName, module: adapter } = await getAdapter();
export { storageName };

export const openDb = adapter.openDb;
export const savePosts = adapter.savePosts;
export const seedProfiles = adapter.seedProfiles;
export const listProfiles = adapter.listProfiles;
export const addProfile = adapter.addProfile;
export const deleteProfile = adapter.deleteProfile;
export const getSetting = adapter.getSetting;
export const setSetting = adapter.setSetting;
export const listPosts = adapter.listPosts;
