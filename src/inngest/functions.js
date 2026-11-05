import { NonRetriableError } from 'inngest';
import { inngest, SCRAPE_EVENT } from './client.js';
import { openDb, listProfiles, seedProfiles } from '../db.js';
import { getApiKey, getPostsPerProfile, scrapeProfile } from '../scrape.js';
import { provider } from '../provider.js';
import { createLogger } from '../logger.js';
import { readSchedule, advanceSchedule, scheduleDue, scheduleEventId, scheduledRunAllowed } from '../schedule-store.js';

/**
 * Inngest version of the old Trigger.dev `scrape-posts` task.
 * Same work as runScrape(), but each profile is its own step: a slow Instagram/X profile
 * can't hit the serverless time limit for the whole run, and a crash only redoes that profile.
 * Returns { totals, logs } — the same shape the UI reads from a finished job.
 */
export const scrapePosts = inngest.createFunction(
  {
    id: 'scrape-posts',
    triggers: [{ event: SCRAPE_EVENT }],
    concurrency: 1, // one scrape at a time, like the local runner's "already in progress" guard
    retries: 2,
  },
  async ({ step, event }) => {
    if (event.data?.scheduled) {
      const allowed = await step.run('validate-schedule', async () => scheduledRunAllowed(await readSchedule(), event.data));
      if (!allowed) return { totals: { profiles: 0, saved: 0, duplicates: 0, failed: 0 }, logs: ['Scheduled run invalidated by settings change.'] };
    }
    const { profiles, postsPerProfile } = await step.run('load-profiles', async () => {
      const db = openDb();
      if (!(await getApiKey(db))) throw new NonRetriableError(`No ${provider.label} API key set.`);
      await seedProfiles(db);
      return { profiles: await listProfiles(db), postsPerProfile: await getPostsPerProfile(db) };
    });

    const totals = { profiles: profiles.length, saved: 0, duplicates: 0, failed: 0 };
    const logs = [];

    for (const profile of profiles) {
      const r = await step.run(`scrape ${profile.platform}/${profile.username}`, async () => {
        const db = openDb();
        const apiKey = await getApiKey(db); // read here so the key never lands in step history
        if (!apiKey) throw new NonRetriableError(`No ${provider.label} API key set.`);
        const stepLogs = [];
        const result = await scrapeProfile(db, profile, {
          apiKey,
          postsPerProfile,
          log: createLogger((line) => stepLogs.push(line)),
        });
        return { ...result, logs: stepLogs };
      });

      totals.saved += r.saved;
      totals.duplicates += r.duplicates;
      if (r.failed) totals.failed++;
      logs.push(...r.logs);
      if (r.fatal) break; // auth/quota problem: no point trying the remaining profiles
    }

    return { totals, logs };
  },
);

export async function dispatchSchedule({ step }) {
  const schedule = await step.run('read-due-schedule', async () => {
    const current = await readSchedule();
    return scheduleDue(current) ? current : null;
  });
  if (!schedule) return { dispatched: false };
  await step.sendEvent('dispatch-scheduled-scrape', {
    id: scheduleEventId(schedule),
    name: SCRAPE_EVENT,
    data: { scheduled: true, revision: schedule.revision, dueAt: schedule.next_run_at },
  });
  await step.run('advance-schedule', () => advanceSchedule(schedule));
  return { dispatched: true };
}

export const scheduleDispatcher = inngest.createFunction(
  { id: 'scrape-schedule-dispatcher', triggers: [{ cron: '* * * * *' }], concurrency: 1, retries: 5 },
  dispatchSchedule,
);

export const functions = [scrapePosts, scheduleDispatcher];
