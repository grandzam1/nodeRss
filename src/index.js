import { openDb } from './db.js';
import { runScrape } from './scrape.js';
import { createLogger } from './logger.js';

const log = createLogger();

const db = openDb();
try {
  const t = await runScrape(db, log);
  log(t.failed ? 'ERROR' : 'INFO', `Done: profiles=${t.profiles}, new=${t.saved}, duplicates=${t.duplicates}, failed=${t.failed}.`);
  process.exitCode = t.failed ? 1 : 0;
} catch (err) {
  log('ERROR', err.message);
  process.exitCode = 2;
}
