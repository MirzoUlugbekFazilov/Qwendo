create table public.organiser_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  url text not null check(length(url) between 9 and 2000),
  title text check(length(title)<=200),
  notes text check(length(notes)<=1500),
  status text not null default 'pending_review' check (status in ('pending_review','queued','rejected')),
  created_at timestamptz not null default now(),
  unique(submitted_by,url)
);
create index organiser_submissions_review_idx on public.organiser_submissions(status,created_at);
alter table public.organiser_submissions enable row level security;
revoke all on public.organiser_submissions from public,anon,authenticated;
grant select,insert,update on public.organiser_submissions to service_role;

-- Service-only RPC. The API derives p_user from a verified Supabase session.
create function public.submit_organiser_url(p_user uuid,p_url text,p_title text,p_notes text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare found_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select id into found_id from public.organiser_submissions where submitted_by=p_user and url=p_url;
  if found_id is not null then return found_id; end if;
  if (select count(*) from public.organiser_submissions where submitted_by=p_user
      and created_at>=now()-interval '1 day')>=10 then return null; end if;
  insert into public.organiser_submissions(submitted_by,url,title,notes)
  values(p_user,p_url,p_title,p_notes) returning id into found_id;
  return found_id;
end $$;
revoke all on function public.submit_organiser_url(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_organiser_url(uuid,text,text,text) to service_role;
