-- SociaLens Android-compatible video processing pipeline.
-- Apply this migration before deploying the upload route or starting the worker.

create table if not exists public.video_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('posts')),
  original_path text not null,
  playback_path text,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  last_error text,
  source_bytes bigint,
  output_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint video_processing_jobs_source_unique unique (bucket, original_path)
);

create index if not exists video_processing_jobs_claim_idx
  on public.video_processing_jobs (status, available_at, created_at)
  where status in ('queued', 'processing');

create index if not exists video_processing_jobs_owner_idx
  on public.video_processing_jobs (owner_id, created_at desc);

-- Queue existing Supabase-hosted post/reel videos as well, so the known
-- failing upload is eligible for conversion after this migration is applied.
insert into public.video_processing_jobs (owner_id, bucket, original_path, status)
select
  p.user_id,
  'posts',
  regexp_replace(p.media_url, '^.*/storage/v1/object/public/posts/', ''),
  'queued'
from public.posts as p
where p.media_type = 'video'
  and p.media_url like '%/storage/v1/object/public/posts/%'
  and regexp_replace(p.media_url, '^.*/storage/v1/object/public/posts/', '') <> ''
on conflict (bucket, original_path) do nothing;

alter table public.video_processing_jobs enable row level security;

drop policy if exists "Authenticated users can read video processing status" on public.video_processing_jobs;

-- Internal queue: clients cannot enumerate jobs or inspect worker errors.
-- The authenticated playback API reads status using the server-only service-role client.
revoke all on public.video_processing_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.video_processing_jobs to service_role;

create or replace function public.claim_video_processing_jobs(p_limit integer default 2)
returns setof public.video_processing_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A worker may be killed without running its error handler. Once its lease
  -- expires, make exhausted jobs terminal instead of leaving them stuck.
  update public.video_processing_jobs
  set status = 'failed',
      locked_until = null,
      lease_token = null,
      updated_at = now(),
      last_error = coalesce(last_error, 'Worker lease expired after maximum attempts')
  where status = 'processing'
    and locked_until < now()
    and attempts >= max_attempts;

  return query
  with candidates as (
    select id
    from public.video_processing_jobs
    where attempts < max_attempts
      and available_at <= now()
      and (
        status = 'queued'
        or (status = 'processing' and locked_until < now())
      )
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 2), 10))
  )
  update public.video_processing_jobs as jobs
  set status = 'processing',
      attempts = jobs.attempts + 1,
      locked_until = now() + interval '10 minutes',
      lease_token = pg_catalog.gen_random_uuid(),
      updated_at = now(),
      last_error = null
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_video_processing_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_video_processing_jobs(integer) to service_role;

comment on table public.video_processing_jobs is
  'Durable queue and rendition status for Android-compatible MP4 playback copies. Original uploads are never overwritten.';
