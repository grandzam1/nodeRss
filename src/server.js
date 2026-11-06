import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { PUBLIC_DIR } from './config.js';
import { handleApi } from './api.js';
import { startScheduler, scheduleState } from './scheduler.js';
import { logEvent } from './logger.js';

// Static assets the UI needs (compiled CSS). Keep the allowlist tight — this server
// must never hand out arbitrary files.
const STATIC = {
  '/styles.css': 'text/css; charset=utf-8',
};

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1'; // local only: this UI can start scrapes and stores your API key

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const readJson = async (req) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

createServer(async (req, res) => {
  // Block DNS-rebinding / cross-site requests: only accept localhost Host headers.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')) return send(res, 403, { error: 'Forbidden' });
  try {
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(`${PUBLIC_DIR}index.html`));
    }
    if (req.method === 'GET' && STATIC[url.pathname]) {
      res.writeHead(200, { 'Content-Type': STATIC[url.pathname] });
      return res.end(readFileSync(`${PUBLIC_DIR}${url.pathname.slice(1)}`));
    }
    const body = req.method === 'GET' ? {} : await readJson(req);
    const { status, data } = await handleApi(req.method, url.pathname, body, { headers: req.headers });
    send(res, status, data);
  } catch (err) {
    const status = err.status ?? 500;
    logEvent('ERROR', 'api_error', { method: req.method, path: req.url, status, error: err.message });
    send(res, status, { error: err.message || 'Something went wrong on the server. Please try again.' });
  }
}).listen(PORT, HOST, () => console.log(`UI running at http://localhost:${PORT}`));

// Local timer: fires /api/run on the saved interval (enable it in Settings).
startScheduler(() => handleApi('POST', '/api/run', {}, { internal: true })).then((s) => {
  if (s.enabled) console.log(`Scheduler on: every ${s.minutes} min, next at ${scheduleState().nextRunAt}`);
});
