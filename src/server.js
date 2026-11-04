import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { PUBLIC_DIR } from './config.js';
import { handleApi } from './api.js';

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
    const body = req.method === 'GET' ? {} : await readJson(req);
    const { status, data } = await handleApi(req.method, url.pathname, body);
    send(res, status, data);
  } catch (err) {
    send(res, 400, { error: err.message });
  }
}).listen(PORT, HOST, () => console.log(`UI running at http://localhost:${PORT}`));
