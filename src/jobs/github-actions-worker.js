import { createClient } from '@supabase/supabase-js';
import { executeScrapeJob } from './runner.js';
import { logEvent } from '../logger.js';

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the development worker.');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function updateJob(db, jobId, values) {
  const { error } = await db.rpc('finish_scraper_job', {
    p_job_id: jobId,
    p_status: values.status,
    p_totals: values.totals ?? null,
    p_logs: values.logs ?? [],
    p_error: values.error ?? null,
  });
  if (error) throw new Error(`Supabase job history update failed: ${error.message}`);
}

const jobId = process.env.GITHUB_JOB_ID;
if (!jobId || !/^[\w-]{1,100}$/.test(jobId)) {
  console.error('GITHUB_JOB_ID is missing or invalid.');
  process.exitCode = 2;
} else {
  const db = supabase();
  try {
    const { data, error } = await db
      .from('scraper_jobs')
      .update({ status: 'RUNNING', started_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'QUEUED')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Supabase could not start the job: ${error.message}`);
    if (!data) throw new Error('No queued Supabase job record matches this GitHub Actions dispatch; refusing to scrape.');

    const { totals, logs } = await executeScrapeJob();
    await updateJob(db, jobId, { status: 'COMPLETED', totals, logs });
    console.log(`Scrape finished: profiles=${totals.profiles}, new=${totals.saved}, duplicates=${totals.duplicates}, failed=${totals.failed}.`);
    if (totals.failed > 0) process.exitCode = 1;
  } catch (error) {
    await updateJob(db, jobId, { status: 'FAILED', error: error.message }).catch((updateError) => {
      console.error(updateError.message);
    });
    logEvent('ERROR', 'github_actions_scrape_failed', { jobId, error: error.message });
    console.error(error.message);
    process.exitCode = 1;
  }
}
