import { handleApi } from '../src/api.js';

export const config = { maxDuration: 300 };

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);

    // /api/run is meant for the scheduler; require a bearer secret for external callers so
    // strangers can't burn API quota. Same-origin browser requests (the UI's Run Now button)
    // are identified by Fetch Metadata/Origin headers instead — the secret can't ship to clients.
    if (url.pathname === '/api/run' && process.env.CRON_SECRET) {
      const bearerOk = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
      const site = req.headers['sec-fetch-site'];
      const origin = req.headers.origin ?? req.headers.referer ?? '';
      const sameOrigin =
        ['same-origin', 'same-site', 'none'].includes(site) ||
        (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
      if (!bearerOk && !sameOrigin) {
        return send(res, 401, { error: 'Unauthorized' });
      }
    }

    const body = req.method === 'GET' ? {} : await readBody(req);
    const { status, data } = await handleApi(req.method, url.pathname, body);
    send(res, status, data);
  } catch (err) {
    send(res, 400, { error: err.message });
  }
}
