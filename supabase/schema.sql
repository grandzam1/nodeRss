-- Run once in the Supabase SQL editor.

create table if not exists posts (
  id text primary key,
  platform text not null,
  username text not null,
  post_url text unique,
  caption text,
  media_url text,
  posted_at text,
  scraped_at text not null
);

create table if not exists profiles (
  id bigint generated always as identity primary key,
  platform text not null,
  username text not null,
  unique (platform, username)
);

create table if not exists settings (
  key text primary key,
  value text not null
);

-- If using the existing watch_* schema instead (STORAGE=watch), only this
-- settings table is needed; watch_profiles/watch_posts are used as-is.

-- Scheduler: change '*/15' to '*/30' etc. via cron.alter_job — no redeploy needed.
-- Requires the pg_cron and pg_net extensions (enable in Database > Extensions).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'social-post-scraper',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/run',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
  );
  $$
);
