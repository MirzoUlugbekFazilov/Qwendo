-- Preserve deployed homepage signatures while filtering for verified source evidence.
-- The FastAPI public routes invoke these functions with the anonymous database role.
alter table public.events add column if not exists featured_eligible boolean not null default true;

create index if not exists discovery_recent_candidates_idx
  on public.events(first_seen_at desc, starts_at, id)
  where verification_status = 'verified' and status = 'active' and canonical_event_id is null;

create index if not exists discovery_featured_popularity_idx
  on public.events(popularity desc, starts_at, id)
  where verification_status = 'verified' and status = 'active' and canonical_event_id is null
    and featured_eligible and image_url is not null;

create or replace function public.hero_events(p_city text default null, p_limit integer default 12)
returns setof public.events
language sql stable security invoker set search_path = public, pg_temp as $$
  select e.*
  from public.events e
  where e.verification_status = 'verified' and e.status = 'active' and e.canonical_event_id is null
    and e.starts_at > now() and e.last_verified_at <= now()
    and e.source <> 'demo' and e.raw->>'seeded' is distinct from 'true'
    and e.url like 'https://%' and e.featured_eligible and e.image_url is not null
    and e.starts_at <= now() + interval '60 days'
    and (p_city is null or lower(e.city) = lower(p_city))
  order by e.popularity desc, e.starts_at, e.id
  limit greatest(1, least(coalesce(p_limit, 12), 40))
$$;

create or replace function public.catalogue_stats()
returns json language sql stable security invoker set search_path = public, pg_temp as $$
  select json_build_object('events', count(*), 'cities', count(distinct lower(nullif(trim(city), ''))),
    'sources', count(distinct source), 'last_updated', max(last_verified_at),
    'interests', (select count(*) from public.interests where is_active))
  from public.events e
  where e.verification_status = 'verified' and e.status = 'active' and e.canonical_event_id is null
    and e.starts_at > now() and e.last_verified_at <= now() and e.url like 'https://%'
    and e.source <> 'demo' and e.raw->>'seeded' is distinct from 'true'
$$;

grant execute on function public.hero_events(text, integer), public.catalogue_stats()
  to anon, authenticated, service_role;

-- Keep the eligibility check atomic with writes made through the Data API.
-- Owner-only SELECT and DELETE policies continue to govern saved history.
create or replace function public.can_interact_with_event(p_event uuid)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.events e where e.id = p_event and e.verification_status = 'verified'
      and e.status = 'active' and e.canonical_event_id is null and e.starts_at > now()
      and e.last_verified_at <= now() and e.url like 'https://%' and e.source <> 'demo'
      and e.raw->>'seeded' is distinct from 'true'
  )
$$;

create policy "upcoming verified saves" on public.saved_events as restrictive
  for insert to authenticated with check (public.can_interact_with_event(event_id));
create policy "upcoming verified save changes" on public.saved_events as restrictive
  for update to authenticated with check (public.can_interact_with_event(event_id));
create policy "upcoming verified clicks" on public.event_clicks as restrictive
  for insert to anon, authenticated with check (public.can_interact_with_event(event_id));
