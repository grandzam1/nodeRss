import { timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

const production = () => process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

const eq = (a, b) => {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const bearer = (headers = {}) => String(headers.authorization ?? '').replace(/^Bearer\s+/i, '');

/**
 * Write endpoints (POST /api/profiles, DELETE /api/profiles/:id, PUT /api/settings,
 * POST /api/run) are open on localhost but locked down in production:
 * ADMIN_TOKEN unset fails closed (503), a wrong/missing token gets 401.
 * `internal` bypasses the check for in-process calls like the local scheduler.
 * POST /api/run also accepts CRON_SECRET so the cron caller keeps working.
 */
export function requireAdmin(headers, { internal = false, allowCron = false } = {}) {
  if (internal || !production()) return;
  if (!process.env.ADMIN_TOKEN) {
    throw new ApiError(503, 'ADMIN_TOKEN is not set — write access is disabled in production until it is configured and redeployed.');
  }
  const token = bearer(headers);
  if (eq(token, process.env.ADMIN_TOKEN)) return;
  if (allowCron && eq(token, process.env.CRON_SECRET)) return;
  throw new ApiError(401, 'Unauthorized.');
}
