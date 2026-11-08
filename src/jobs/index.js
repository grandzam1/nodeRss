/**
 * JOB_RUNNER picks how scrape jobs are executed:
 *   'local'   — in-process (dev, self-hosted). Default.
 *   'inngest' — send an event to Inngest; the scrape-posts function (served at /api/inngest) runs it.
 *   'github-actions' — dispatch the Crawlee worker to a configured GitHub Actions workflow.
 *   'trigger' — DEPRECATED, replaced by 'inngest'. Submit to Trigger.dev; a deployed task calls executeScrapeJob().
 */
async function getRunner() {
  const production = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const name = (process.env.JOB_RUNNER ?? (production ? 'inngest' : 'local')).trim().toLowerCase();
  if (production && !['inngest', 'github-actions'].includes(name)) {
    throw new Error('Production requires JOB_RUNNER=inngest or JOB_RUNNER=github-actions.');
  }
  if (name === 'local') return { name, module: await import('./local.js') };
  if (name === 'inngest') return { name, module: await import('./inngest.js') };
  if (name === 'github-actions') {
    const [{ provider }, { storageName }] = await Promise.all([
      import('../provider.js'),
      import('../db.js'),
    ]);
    if (provider.name !== 'crawlee') throw new Error('JOB_RUNNER=github-actions requires SCRAPER_PROVIDER=crawlee.');
    if (!['supabase', 'watch'].includes(storageName)) {
      throw new Error('JOB_RUNNER=github-actions requires STORAGE=supabase or STORAGE=watch.');
    }
    return { name, module: await import('./github-actions.js') };
  }
  if (name === 'trigger') return { name, module: await import('./trigger.js') };
  throw new Error(`Unknown JOB_RUNNER "${name}".`);
}

const { name: runnerName, module: runner } = await getRunner();
export { runnerName };

export const submitRun = runner.submitRun;
export const getRun = runner.getRun;
export const isBusy = runner.isBusy ?? (() => false);
