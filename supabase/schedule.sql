create table if not exists public.scraper_schedule (
  id integer primary key check (id = 1),
  auto_run_enabled boolean not null default false,
  interval_minutes integer not null default 15 check (interval_minutes between 5 and 1440),
  next_run_at timestamptz,
  revision integer not null default 0,
  check (auto_run_enabled = (next_run_at is not null))
);

insert into public.scraper_schedule (id, auto_run_enabled, interval_minutes, next_run_at)
select 1, enabled, minutes, case when enabled then now() + make_interval(mins => minutes) else null end
from (
  select coalesce((select value = 'true' from public.settings where key = 'scheduleEnabled'), false) as enabled,
    greatest(5, least(1440, coalesce((select case when value ~ '^[0-9]{1,4}$' then value::integer end from public.settings where key = 'intervalMinutes'), 15))) as minutes
) legacy
on conflict (id) do nothing;

alter table public.scraper_schedule enable row level security;
revoke all on public.scraper_schedule from anon, authenticated;
grant all on public.scraper_schedule to service_role;

create or replace function public.update_scraper_schedule(enabled boolean default null, minutes integer default null)
returns public.scraper_schedule
language plpgsql set search_path = public as $$
declare
  current_schedule public.scraper_schedule;
  new_enabled boolean;
  new_minutes integer;
begin
  select * into strict current_schedule from public.scraper_schedule where id = 1 for update;
  new_enabled := coalesce(enabled, current_schedule.auto_run_enabled);
  new_minutes := coalesce(minutes, current_schedule.interval_minutes);
  if new_minutes < 5 or new_minutes > 1440 then
    raise exception 'Interval must be 5-1440 minutes';
  end if;
  if new_enabled = current_schedule.auto_run_enabled and new_minutes = current_schedule.interval_minutes then
    return current_schedule;
  end if;
  update public.scraper_schedule set auto_run_enabled = new_enabled, interval_minutes = new_minutes,
    revision = revision + 1,
    next_run_at = case when new_enabled then now() + make_interval(mins => new_minutes) else null end
    where id = 1 returning * into current_schedule;
  return current_schedule;
end;
$$;

create or replace function public.advance_scraper_schedule(expected_revision integer, expected_due timestamptz)
returns void language sql set search_path = public as $$
  update public.scraper_schedule set next_run_at = now() + make_interval(mins => interval_minutes)
  where id = 1 and auto_run_enabled and revision = expected_revision and next_run_at = expected_due;
$$;

revoke all on function public.update_scraper_schedule(boolean, integer) from public, anon, authenticated;
revoke all on function public.advance_scraper_schedule(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.update_scraper_schedule(boolean, integer) to service_role;
grant execute on function public.advance_scraper_schedule(integer, timestamptz) to service_role;

do $$
declare legacy_job record;
begin
  if to_regclass('cron.job') is not null then
    for legacy_job in execute 'select jobid from cron.job where jobname = ''social-post-scraper''' loop
      perform cron.unschedule(legacy_job.jobid);
    end loop;
  end if;
end;
$$;
