/**
 * JOB_RUNNER picks how scrape jobs are executed:
 *   'local'   — in-process (dev, self-hosted). Default.
 *   'trigger' — submit to Trigger.dev; a deployed task calls executeScrapeJob().
 */
async function getRunner() {
  const name = (process.env.JOB_RUNNER ?? 'local').trim().toLowerCase();
  if (name === 'local') return { name, module: await import('./local.js') };
  if (name === 'trigger') return { name, module: await import('./trigger.js') };
  throw new Error(`Unknown JOB_RUNNER "${name}".`);
}

const { name: runnerName, module: runner } = await getRunner();
export { runnerName };

export const submitRun = runner.submitRun;
export const getRun = runner.getRun;
export const isBusy = runner.isBusy ?? (() => false);
