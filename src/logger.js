import { appendFileSync } from 'node:fs';
import { LOG_PATH } from './config.js';

/** Formats a log line like `2026-11-05T12:00:00.000Z INFO  [tiktok/user] msg`. */
export const formatLine = (level, msg, p) =>
  `${new Date().toISOString()} ${level.padEnd(5)} ${p ? `[${p.platform}/${p.username}] ` : ''}${msg}`;

/** Appends a line to the scrape log file; failures are ignored so logging never breaks a run. */
export const writeLogFile = (line) => {
  try {
    appendFileSync(LOG_PATH, line + '\n');
  } catch {}
};

/** Returns a log(level, msg, profile?) that writes to the log file and forwards to `sink`. */
export const createLogger = (sink = console.log) => (level, msg, p) => {
  const line = formatLine(level, msg, p);
  writeLogFile(line);
  sink(line);
};

/**
 * Structured event log for server-side diagnostics (API errors, job failures).
 * Writes one JSON line to the log file and console. Never include secrets in `fields`.
 */
export const logEvent = (level, event, fields = {}) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  writeLogFile(line);
  (level === 'ERROR' ? console.error : console.log)(line);
};
