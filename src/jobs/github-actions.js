import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const workflow = () => process.env.GITHUB_ACTIONS_WORKFLOW || 'crawlee-worker.yml';
const repository = () => process.env.GITHUB_ACTIONS_REPOSITORY || process.env.GITHUB_REPOSITORY;
const ref = () => process.env.GITHUB_ACTIONS_REF;

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('GitHub Actions runner requires SUPABASE_URL and a Supabase server-side key.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function requiredDispatchConfig() {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const repo = repository();
  const targetRef = ref();
  if (!token) throw new Error('GITHUB_ACTIONS_TOKEN is not set.');
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) throw new Error('GITHUB_ACTIONS_REPOSITORY must be owner/repository.');
  if (!targetRef) throw new Error('GITHUB_ACTIONS_REF must name a branch containing the Crawlee worker code.');
  return { token, repo, targetRef };
}

async function finish(db, jobId, { status, totals = null, logs = [], error = null }) {
  const { error: updateError } = await db.rpc('finish_scraper_job', {
    p_job_id: jobId,
    p_status: status,
    p_totals: totals,
    p_logs: logs,
    p_error: error,
  });
  if (updateError) throw new Error(`Supabase job history update failed: ${updateError.message}`);
}

export async function submitRun() {
  const db = supabase();
  const { token, repo, targetRef } = requiredDispatchConfig();
  const jobId = randomUUID();
  const { error: startError } = await db.rpc('start_scraper_job', { p_job_id: jobId });
  if (startError) {
    if (/already in progress|active scraper job/i.test(startError.message)) throw new Error('A run is already in progress.');
    throw new Error(`Supabase could not create the scrape job: ${startError.message}`);
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow())}/dispatches`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: targetRef, inputs: { job_id: jobId } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).replaceAll(token, '[REDACTED]').slice(0, 300);
      throw new Error(`GitHub workflow dispatch failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`);
    }
  } catch (error) {
    await finish(db, jobId, { status: 'FAILED', error: error.message });
    throw error;
  }
  return { jobId };
}

export async function getRun(jobId) {
  const db = supabase();
  const { data, error } = await db.from('scraper_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw new Error(`Supabase job history lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    totals: data.totals ?? null,
    logs: data.logs ?? [],
    error: data.error ?? null,
  };
}

export async function isBusy() {
  const db = supabase();
  const { data, error } = await db.from('scraper_jobs').select('id').in('status', ['QUEUED', 'RUNNING']).limit(1);
  if (error) throw new Error(`Supabase job status check failed: ${error.message}`);
  return data.length > 0;
}
