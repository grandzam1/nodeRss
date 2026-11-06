import { handleApi } from '../src/api.js';
import { logEvent } from '../src/logger.js';

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
    const body = req.method === 'GET' ? {} : await readBody(req);
    const { status, data } = await handleApi(req.method, url.pathname, body, { headers: req.headers });
    send(res, status, data);
  } catch (err) {
    const status = err.status ?? 500;
    logEvent('ERROR', 'api_error', { method: req.method, path: req.url, status, error: err.message });
    send(res, status, { error: err.message || 'Something went wrong on the server. Please try again.' });
  }
}
