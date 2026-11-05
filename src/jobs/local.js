import { executeScrapeJob } from './runner.js';
import { createJob, finishJob, getJob } from './jobStore.js';

let running = false;

/** Runs the scrape in-process (dev / self-hosted). Status lives in memory. */
export async function submitRun() {
  if (running) throw new Error('A run is already in progress.');
  running = true;
  const id = createJob();
  executeScrapeJob()
    .then(({ totals, logs }) => finishJob(id, { status: 'COMPLETED', totals, logs }))
    .catch((err) => finishJob(id, { status: 'FAILED', error: err.message }))
    .finally(() => { running = false; });
  return { jobId: id };
}

export async function getRun(jobId) {
  const job = getJob(jobId);
  if (!job) return null;
  return job;
}

export const isBusy = () => running;
