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
