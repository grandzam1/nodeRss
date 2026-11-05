import { openDb } from '../db.js';
import { runScrape } from '../scrape.js';
import { createLogger } from '../logger.js';

/**
 * The worker entry point — provider-agnostic.
 * Call this from Trigger.dev, an in-process runner, or any future runner.
 * Returns { totals, logs }.
 */
export async function executeScrapeJob() {
  const db = openDb();
  const logs = [];
  const totals = await runScrape(db, createLogger((line) => logs.push(line)));
  return { totals, logs };
}
