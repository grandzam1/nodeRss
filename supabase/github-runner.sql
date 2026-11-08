-- Development/optional GitHub Actions runner job history.
-- Apply only to the intended development Supabase project before enabling JOB_RUNNER=github-actions.

create table if not exists public.scraper_jobs (
  id uuid primary key,
  status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  totals jsonb,
  logs jsonb not null default '[]'::jsonb,
  error text
);

create index if not exists scraper_jobs_status_created_idx
  on public.scraper_jobs (status, created_at desc);

alter table public.scraper_jobs enable row level security;
revoke all on public.scraper_jobs from anon, authenticated;
grant all on public.scraper_jobs to service_role;

-- Start is serialized in the database so concurrent Vercel requests cannot enqueue overlapping runs.
create or replace function public.start_scraper_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_job public.scraper_jobs%rowtype;
begin
  perform pg_advisory_xact_lock(74426011, 1);

  select * into active_job
    from public.scraper_jobs
    where status in ('QUEUED', 'RUNNING')
    order by created_at desc
    limit 1
    for update;

  if active_job.id is not null then
    if active_job.created_at < now() - interval '2 hours' then
      update public.scraper_jobs
        set status = 'FAILED', finished_at = now(), error = 'Worker did not complete within the two-hour safety window.'
        where id = active_job.id;
    else
      raise exception 'A scraper job is already in progress.';
    end if;
  end if;

  insert into public.scraper_jobs (id, status) values (p_job_id, 'QUEUED');
  return p_job_id;
end;
$$;

create or replace function public.finish_scraper_job(
  p_job_id uuid,
  p_status text,
  p_totals jsonb default null,
  p_logs jsonb default '[]'::jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('COMPLETED', 'FAILED') then
    raise exception 'Invalid terminal scraper job status: %', p_status;
  end if;

  update public.scraper_jobs
    set status = p_status,
        finished_at = now(),
        totals = p_totals,
        logs = coalesce(p_logs, '[]'::jsonb),
        error = p_error
    where id = p_job_id;

  if not found then
    raise exception 'Scraper job % does not exist.', p_job_id;
  end if;
end;
$$;

revoke all on function public.start_scraper_job(uuid) from public, anon, authenticated;
revoke all on function public.finish_scraper_job(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.start_scraper_job(uuid) to service_role;
grant execute on function public.finish_scraper_job(uuid, text, jsonb, jsonb, text) to service_role;
