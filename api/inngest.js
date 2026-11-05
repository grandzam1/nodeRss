import { serve } from 'inngest/node';
import { inngest } from '../src/inngest/client.js';
import { functions } from '../src/inngest/functions.js';

// Inngest calls this endpoint to run each step; every step is one profile, so 300s is plenty.
// (A specific file beats the api/[...path].js catch-all, so the existing /api/* routes are untouched.)
export const config = { maxDuration: 300 };

export default serve({ client: inngest, functions });
