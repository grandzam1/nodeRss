import { Inngest } from 'inngest';

/**
 * Shared Inngest client. Reads INNGEST_EVENT_KEY (to send events) and INNGEST_SIGNING_KEY
 * (to verify requests from Inngest) from the environment. Set INNGEST_DEV=1 to talk to a
 * local Inngest dev server instead of Inngest Cloud.
 */
export const inngest = new Inngest({ id: 'social-post-scraper' });

/** Sending this event starts one scrape of every saved profile. */
export const SCRAPE_EVENT = 'scrape/requested';
