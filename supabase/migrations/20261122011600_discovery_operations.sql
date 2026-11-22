-- Service-only operations used by the authenticated operator API.
create function public.review_organiser_submission(p_id uuid,p_source text,p_decision text)
returns text language plpgsql security invoker set search_path='' as $$
declare submission public.organiser_submissions; source public.discovery_sources; host text;
begin
  select * into submission from public.organiser_submissions where id=p_id for update;
  if not found then return null; end if;
  if submission.status<>'pending_review' then return submission.status; end if;
  if p_decision='reject' then
    update public.organiser_submissions set status='rejected' where id=p_id;
    return 'rejected';
  end if;
  if p_decision<>'queue' then return null; end if;
  select * into source from public.discovery_sources where slug=p_source and enabled and kind='jsonld'
    and btrim(permission)<>'' for share;
  if not found then return null; end if;
  host := substring(submission.url from '^https://([a-z0-9.-]+)/');
  if host is null or not (host=any(source.allowed_hosts)) then return null; end if;
  perform public.discovery_enqueue(p_source,'verify_url',submission.url,jsonb_build_object('url',submission.url));
  update public.organiser_submissions set status='queued' where id=p_id;
  return 'queued';
end $$;

create table public.discovery_usage (
  job_id uuid not null references public.discovery_jobs(id) on delete cascade,
  attempt integer not null check(attempt>0),
  source_slug text not null references public.discovery_sources(slug),
  requests integer not null check(requests>=0),
  billable_requests integer not null check(billable_requests between 0 and requests),
  estimated_cost_gbp numeric check(estimated_cost_gbp>=0),
  primary key(job_id,attempt)
);
create index discovery_usage_source_idx on public.discovery_usage(source_slug);
alter table public.discovery_usage enable row level security;
revoke all on public.discovery_usage from public,anon,authenticated;
grant select,insert,update on public.discovery_usage to service_role;

create function public.discovery_operator_metrics() returns jsonb
language sql stable security invoker set search_path='' as $$
  with listings as (
    select source_slug, count(*) listings,count(distinct event_id) canonical
    from public.event_source_listings group by source_slug
  ), reviews as (
    select source_slug,count(*) failures,count(*) filter(where status='pending') pending
    from public.discovery_reviews group by source_slug
  ), canonical as (
    select source,count(*) total from public.events where canonical_event_id is null and
      verification_status='verified' group by source
  ), usage as (
    select source_slug,sum(requests) requests,sum(billable_requests) api_requests,
      case when count(*) filter(where billable_requests>0 and estimated_cost_gbp is null)=0
        then sum(coalesce(estimated_cost_gbp,0)) end estimated_cost_gbp
    from public.discovery_usage group by source_slug
  ), stats as (
    select s.slug source, s.last_success_at, u.requests, u.api_requests, u.estimated_cost_gbp, coalesce(l.listings,0) source_listings,
      coalesce(c.total,0) unique_events, coalesce(r.failures,0) verification_failures,
      coalesce(r.pending,0) pending_review,
      (select count(*) from public.event_source_listings x join public.events e on e.id=x.event_id
       where x.source_slug=s.slug and (e.source,e.external_id)<>(x.source_slug,x.external_id)) duplicate_listings
    from public.discovery_sources s left join listings l on l.source_slug=s.slug
    left join usage u on u.source_slug=s.slug left join canonical c on c.source=s.slug left join reviews r on r.source_slug=s.slug
  ), grouped as (
    select coalesce(e.city,case when e.is_online then 'Online' else 'Unknown' end) location,
      topic,count(*) upcoming from public.events e cross join lateral unnest(e.tags) tags(topic)
    where e.verification_status='verified' and e.status='active' and e.starts_at>now()
      and e.canonical_event_id is null group by 1,2 order by 3 desc,1,2 limit 500
  )
  select jsonb_build_object('metrics',coalesce((select jsonb_agg(to_jsonb(stats)) from stats),'[]'::jsonb),
    'coverage',coalesce((select jsonb_agg(to_jsonb(grouped)) from grouped),'[]'::jsonb))
$$;
revoke all on function public.discovery_operator_metrics(),public.review_organiser_submission(uuid,text,text) from public,anon,authenticated;
grant execute on function public.discovery_operator_metrics(),public.review_organiser_submission(uuid,text,text) to service_role;

-- The job contains no personal data. Shared scans send only reviewed vocabulary.
create function public.schedule_discovery_profile_scan()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.profile->'interests',new.profile->'categories',new.profile->'city')
      is not distinct from (old.profile->'interests',old.profile->'categories',old.profile->'city') then
    return new;
  end if;
  insert into public.discovery_jobs(source_slug,kind,dedupe_key,payload)
    select slug,'gap_scan','profile_change','{}'::jsonb from public.discovery_sources
    where enabled and kind in ('search','ticketmaster')
  on conflict (source_slug,kind,dedupe_key) where status in ('queued','leased') do nothing;
  return new;
end $$;
revoke all on function public.schedule_discovery_profile_scan() from public,anon,authenticated;
create trigger schedule_discovery_profile_scan after insert or update of profile on public.user_discovery_profiles
for each row execute function public.schedule_discovery_profile_scan();

-- Public syndication offered by both publishers. The Swiss feed links to its
-- own attribution pages. Only the ticketing publisher supplies a booking page.
insert into public.discovery_sources(slug,kind,enabled,permission,url,allowed_hosts,config,interval_minutes) values
  ('tickts-london','ical',true,'https://tickts.co.uk/for-editors/london',
   'https://tickts.co.uk/feed/whats-on/london.ics',array['tickts.co.uk'],'{"city":"London"}',360),
  ('swiss-zurich','ical',true,'https://swissdataevents.ch/data/',
   'https://swissdataevents.ch/calendar/zurich.ics',array['swissdataevents.ch'],'{"city":"Zurich","listing_only":true}',1440)
on conflict (slug) do nothing;

alter table public.events add column meaningful_updated_at timestamptz;
create function public.record_material_event_change()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.verification_status='verified' and
    (old.starts_at,old.ends_at,old.venue_name,old.address,old.city,old.is_online,old.status,
     old.price_min,old.price_max,old.currency,old.is_free,old.raw->'availability') is distinct from
    (new.starts_at,new.ends_at,new.venue_name,new.address,new.city,new.is_online,new.status,
     new.price_min,new.price_max,new.currency,new.is_free,new.raw->'availability') then
    new.meaningful_updated_at:=new.last_verified_at;
  end if;
  return new;
end $$;
revoke all on function public.record_material_event_change() from public,anon,authenticated;
create trigger record_material_event_change before update on public.events
for each row execute function public.record_material_event_change();

create or replace function public.check_radar_consent() returns trigger
language plpgsql security invoker set search_path='' as $$
declare allowed boolean; changed timestamptz;
begin
  select meaningful_updated_at into changed from public.events
    where id=new.event_id and status='active' and verification_status='verified'
      and canonical_event_id is null and starts_at>now() and official_url like 'https://%'
      and last_verified_at between now()-interval '7 days' and clock_timestamp();
  if not found then return null; end if;
  select case
    when new.kind='great_match' then alerts
    when new.kind like 'event_update:%' and changed is not null then
      alerts and substring(new.kind from 14)=to_char(changed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'+00:00'
    when new.kind='ticket_reminder' then tickets
    when new.kind ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$' then digest
    else false end into allowed
  from public.user_notification_settings where user_id=new.user_id for share;
  if allowed is true then return new; end if;
  return null;
end $$;
