/**
 * JOB_RUNNER picks how scrape jobs are executed:
 *   'local'   — in-process (dev, self-hosted). Default.
 *   'inngest' — send an event to Inngest; the scrape-posts function (served at /api/inngest) runs it.
 *   'trigger' — DEPRECATED, replaced by 'inngest'. Submit to Trigger.dev; a deployed task calls executeScrapeJob().
 */
async function getRunner() {
  const name = (process.env.JOB_RUNNER ?? 'local').trim().toLowerCase();
  if (name === 'local') return { name, module: await import('./local.js') };
  if (name === 'inngest') return { name, module: await import('./inngest.js') };
  if (name === 'trigger') return { name, module: await import('./trigger.js') };
  throw new Error(`Unknown JOB_RUNNER "${name}".`);
}

const { name: runnerName, module: runner } = await getRunner();
export { runnerName };

export const submitRun = runner.submitRun;
export const getRun = runner.getRun;
export const isBusy = runner.isBusy ?? (() => false);
