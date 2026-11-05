const BASE = 'https://api.trigger.dev';

/**
 * Trigger.dev runner — submits via the REST API, no SDK needed.
 * Env: TRIGGER_SECRET_KEY (your project's secret key), TRIGGER_TASK_ID
 * (e.g. 'scrape-posts'). The task itself wraps executeScrapeJob().
 */
const env = () => {
  const key = process.env.TRIGGER_SECRET_KEY;
  const task = process.env.TRIGGER_TASK_ID;
  if (!key || !task) throw new Error('Set TRIGGER_SECRET_KEY and TRIGGER_TASK_ID.');
  return { key, task };
};

export async function submitRun(payload = {}) {
  const { key, task } = env();
  const res = await fetch(`${BASE}/api/v1/tasks/${task}/trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) throw new Error(`Trigger.dev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { id } = await res.json();
  return { jobId: id };
}

const STATUS_MAP = {
  COMPLETED_SUCCESSFULLY: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELED: 'FAILED',
  CRASHED: 'FAILED',
  SYSTEM_FAILURE: 'FAILED',
};

export async function getRun(jobId) {
  const { key } = env();
  const res = await fetch(`${BASE}/api/v1/runs/${jobId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Trigger.dev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const run = await res.json();
  const status = STATUS_MAP[run.status] ?? 'RUNNING';
  return {
    id: jobId,
    status,
    totals: run.output?.totals ?? null,
    logs: run.output?.logs ?? [],
    error: run.error?.message ?? null,
  };
}

export const isBusy = () => false; // concurrency is Trigger.dev's problem
