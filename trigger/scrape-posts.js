// Trigger.dev task wrapping the shared worker entry point.
// Setup: npm install @trigger.dev/sdk, `npx trigger.dev init`, deploy with
// `npx trigger.dev deploy`. Env needed there: SUPABASE_URL, SUPABASE_SECRET_KEY,
// SCRAPER_PROVIDER, APIFY_TOKEN. Then set JOB_RUNNER=trigger, TRIGGER_SECRET_KEY
// and TRIGGER_TASK_ID=scrape-posts in the Vercel project.
import { task } from '@trigger.dev/sdk/v3';
import { executeScrapeJob } from '../src/jobs/runner.js';

export const scrapePosts = task({
  id: 'scrape-posts',
  maxDuration: 600, // Trigger.dev handles the timeout, retries and queueing
  run: async () => executeScrapeJob(),
});
