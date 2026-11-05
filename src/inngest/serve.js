// Standalone server for the Inngest functions — for local development and self-hosting.
// On Vercel this isn't used; api/inngest.js serves the same functions.
//   npm run inngest:serve
//   npx inngest-cli@latest dev -u http://localhost:3001/api/inngest
import { createServer } from 'node:http';
import { serve } from 'inngest/node';
import { inngest } from './client.js';
import { functions } from './functions.js';

const PORT = Number(process.env.INNGEST_PORT) || 3001;

createServer(serve({ client: inngest, functions })).listen(PORT, () =>
  console.log(`Inngest functions served at http://localhost:${PORT}/api/inngest`),
);
