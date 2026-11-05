/** In-memory job records for the local runner. { id, status, totals, logs, error, createdAt } */
const jobs = new Map();
let seq = 0;

export const createJob = () => {
  const id = `local-${Date.now()}-${++seq}`;
  jobs.set(id, { id, status: 'RUNNING', createdAt: new Date().toISOString() });
  return id;
};

export const finishJob = (id, patch) => jobs.set(id, { ...jobs.get(id), ...patch });

export const getJob = (id) => jobs.get(id) ?? null;
