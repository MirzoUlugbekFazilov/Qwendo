alter table public.events
  add column verification_status text not null default 'pending_review'
    check (verification_status in ('verified','pending_review','rejected','cancelled')),
  add column last_verified_at timestamptz,
  add column source_published_at timestamptz,
  add column official_url text,
  add column canonical_event_id uuid references public.events(id),
  add check (canonical_event_id <> id),
  add check (verification_status <> 'verified' or last_verified_at is not null);

create index events_discovery_eligible_idx on public.events(starts_at, id)
  where verification_status = 'verified' and status = 'active' and canonical_event_id is null;
create index events_discovery_fresh_idx on public.events(last_verified_at, id)
  where verification_status = 'verified' and canonical_event_id is null;
create index events_canonical_idx on public.events(canonical_event_id) where canonical_event_id is not null;
create index events_official_lookup_idx on public.events(official_url) where canonical_event_id is null;
create index events_occurrence_lookup_idx on public.events(lower(btrim(title)), starts_at)
  where canonical_event_id is null;

create table public.discovery_sources (
  slug text primary key check (btrim(slug) <> ''),
  kind text not null check (kind in ('ticketmaster','jsonld','rss','ical','search')),
  enabled boolean not null default false,
  permission text not null default '',
  url text not null,
  allowed_hosts text[] not null default '{}',
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  interval_minutes integer not null default 60 check (interval_minutes > 0),
  last_success_at timestamptz,
  check (not enabled or (btrim(permission) <> '' and cardinality(allowed_hosts) > 0))
);

create table public.discovery_jobs (
  id uuid primary key default gen_random_uuid(),
  source_slug text not null references public.discovery_sources(slug),
  kind text not null check (btrim(kind) <> ''),
  dedupe_key text not null check (btrim(dedupe_key) <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in ('queued','leased','done','failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check ((lease_token is not null) = (status = 'leased')),
  check ((lease_until is not null) = (status = 'leased'))
);
create unique index discovery_job_active_idx on public.discovery_jobs(source_slug,kind,dedupe_key)
  where status in ('queued','leased');
create index discovery_jobs_ready_idx on public.discovery_jobs(available_at,id) where status = 'queued';
create index discovery_jobs_expiry_idx on public.discovery_jobs(lease_until,id) where status = 'leased';

create table public.event_source_listings (
  source_slug text not null references public.discovery_sources(slug),
  external_id text not null,
  event_id uuid not null references public.events(id),
  url text not null,
  original_url text not null,
  source_published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  evidence jsonb not null,
  last_verified_at timestamptz,
  verified_evidence jsonb,
  listing jsonb not null,
  primary key(source_slug,external_id)
);
create index event_source_listings_event_idx on public.event_source_listings(event_id);
create index event_source_listings_url_idx on public.event_source_listings(url);

create table public.discovery_reviews (
  id uuid primary key default gen_random_uuid(),
  source_slug text not null references public.discovery_sources(slug),
  external_id text not null,
  event_id uuid references public.events(id),
  reason text not null,
  listing jsonb not null,
  evidence jsonb not null,
  status text not null default 'pending' check (status in ('pending','resolved','rejected')),
  candidate_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index discovery_review_open_idx on public.discovery_reviews(source_slug,external_id,reason)
  where status = 'pending';
create index discovery_reviews_event_idx on public.discovery_reviews(event_id);
create index discovery_reviews_candidates_idx on public.discovery_reviews using gin(candidate_ids)
  where status='pending';

create function public.discovery_enqueue(p_source text,p_kind text,p_key text,p_payload jsonb)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare job_id uuid;
begin
  perform 1 from discovery_sources where slug=p_source and enabled for share;
  if not found then raise exception 'Source disabled or unknown'; end if;
  insert into discovery_jobs(source_slug,kind,dedupe_key,payload) values(p_source,p_kind,p_key,p_payload)
  on conflict (source_slug,kind,dedupe_key) where status in ('queued','leased')
  do update set dedupe_key=excluded.dedupe_key returning id into job_id;
  return job_id;
end $$;

create function public.discovery_lease(p_limit integer,p_lease_seconds integer)
returns setof public.discovery_jobs language plpgsql set search_path = public, pg_temp as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 or
     p_lease_seconds is null or p_lease_seconds not between 1 and 86400 then
    raise exception 'Invalid lease bounds';
  end if;
  update discovery_jobs set status='failed',lease_token=null,lease_until=null,last_error='Lease expired'
    where status='leased' and lease_until <= statement_timestamp() and attempts >= max_attempts;
  return query
    with candidates as (
      select j.id from discovery_jobs j join discovery_sources s on s.slug=j.source_slug
      where s.enabled and ((j.status='queued' and j.available_at <= statement_timestamp())
        or (j.status='leased' and j.lease_until <= statement_timestamp()))
      order by j.available_at,j.created_at,j.id limit p_limit for update of j skip locked
    )
    update discovery_jobs j set status='leased',attempts=j.attempts+1,
      lease_token=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds)
      from candidates c where j.id=c.id returning j.*;
end $$;

create function public.discovery_ack(p_id uuid,p_token uuid)
returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  update discovery_jobs set status='done',lease_until=null,lease_token=null
    where id=p_id and lease_token=p_token and lease_until>clock_timestamp();
  return found;
end $$;

create function public.discovery_fail(p_id uuid,p_token uuid,p_error text,p_retry_seconds integer)
returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  update discovery_jobs set status=case when attempts>=max_attempts or p_retry_seconds<0 then 'failed' else 'queued' end,
    available_at=clock_timestamp()+make_interval(secs=>greatest(0,p_retry_seconds)),
    last_error=left(p_error,2000),lease_until=null,lease_token=null
    where id=p_id and lease_token=p_token and lease_until>clock_timestamp();
  return found;
end $$;

create function public.discovery_persist(p_source text,p_event jsonb,p_evidence jsonb,
  p_job_id uuid default null,p_token uuid default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  incoming public.events;
  target public.events;
  ids uuid[];
  seen timestamptz;
  decision text := coalesce(p_evidence->>'verification_status','pending_review');
  conflict_reason text;
  authoritative boolean;
  timestamp_proven boolean;
  listing_only boolean;
  public_metadata jsonb;
  availability text;
  sale_time timestamptz;
begin
  select config @> '{"listing_only":true}' into listing_only
    from discovery_sources where slug=p_source and enabled for share;
  if not found then raise exception 'Source disabled or unknown'; end if;
  if p_job_id is not null or p_token is not null then
    perform 1 from discovery_jobs where id=p_job_id and source_slug=p_source and lease_token=p_token
      and lease_until>clock_timestamp() for update;
    if not found then raise exception 'Lost discovery lease'; end if;
  end if;

  -- Accept only provider fields. Identity, discovery times and decisions belong to the database.
  timestamp_proven := coalesce(p_event->>'starts_at','') ~*
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})$';
  if not timestamp_proven then conflict_reason := 'unknown_start_or_timezone'; end if;
  select * into incoming from jsonb_populate_record(null::public.events,
    (case when timestamp_proven then p_event else p_event - 'starts_at' end)
    - array['id','first_seen_at','last_seen_at','last_verified_at','canonical_event_id',
      'embedding','embedded_at','search_tsv','verification_status','created_at','updated_at']);
  if listing_only and incoming.official_url=incoming.url then incoming.official_url := null; end if;
  availability := lower(replace(regexp_replace(incoming.raw->>'availability',
    '^https?://schema[.]org/', '', 'i'),'-','_'));
  if availability not in ('available','unavailable','limited','sold_out','soldout','in_stock','instock',
      'out_of_stock','outofstock','limitedavailability','onsale','offsale','on_sale','off_sale',
      'presale','preorder','pre_order','waitlist') then availability := null; end if;
  if incoming.raw->>'onsale' ~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    begin
      sale_time := (incoming.raw->>'onsale')::timestamptz;
    exception when data_exception then sale_time := null;
    end;
  end if;
  public_metadata := jsonb_strip_nulls(jsonb_build_object('availability',availability,
    'onsale',sale_time,'seeded',case when incoming.raw @> '{"seeded":true}' then true end));
  if nullif(btrim(incoming.external_id),'') is null or nullif(btrim(incoming.title),'') is null
     or coalesce(incoming.url,'') !~ '^https?://[^/[:space:]]+'
     or (incoming.official_url is not null and incoming.official_url !~ '^https?://[^/[:space:]]+')
     or coalesce(jsonb_typeof(p_evidence),'') <> 'object'
     or decision not in ('verified','pending_review','rejected','cancelled') then
    raise exception 'Invalid normalized event or decision';
  end if;
  if conflict_reason is null and not coalesce(incoming.is_online,false)
    and not exists (select from unnest(array[incoming.venue_name,incoming.address,incoming.city]) loc
      where btrim(loc) <> '' and lower(btrim(loc)) not in ('tba','tbd','unknown','n/a','to be announced','to be confirmed'))
    and not coalesce(incoming.lat between -90 and 90 and incoming.lng between -180 and 180,false) then
    conflict_reason := 'unknown_location';
  end if;
  if decision <> 'pending_review' and (nullif(btrim(p_evidence->>'reason'),'') is null or
     coalesce(p_evidence->>'url','') !~ '^https?://[^/[:space:]]+') then
    raise exception 'Verification decision requires evidence URL and reason';
  end if;
  -- Serialize the identity decision across provider IDs, official URLs and occurrence keys,
  -- including the first insertion when none of those rows exists yet.
  perform pg_advisory_xact_lock(1464091981,1);
  seen := clock_timestamp();
  select array_agg(distinct candidate order by candidate) into ids from (
    select event_id as candidate from event_source_listings
      where source_slug=p_source and external_id=incoming.external_id
    union all
    select l.event_id from event_source_listings l join events e on e.id=l.event_id
      where l.url in (incoming.url,incoming.official_url) and e.starts_at=incoming.starts_at
    union all
    select coalesce(e.canonical_event_id,e.id) from events e
      where (e.source=p_source and e.external_id=incoming.external_id)
      or (e.canonical_event_id is null and e.starts_at=incoming.starts_at and (
        e.official_url=incoming.official_url or
        (lower(btrim(e.title))=lower(btrim(incoming.title))
         and nullif(lower(btrim(e.city)),'')=lower(btrim(incoming.city))
         and nullif(lower(btrim(e.venue_name)),'')=lower(btrim(incoming.venue_name)))))
  ) matches;
  if cardinality(ids)>1 then
    conflict_reason := 'ambiguous_identity';
  elsif ids is not null then
    select * into strict target from events where id=ids[1] for update;
    authoritative := target.source=p_source and target.external_id=incoming.external_id and decision<>'pending_review';
    if not authoritative and (target.starts_at<>incoming.starts_at or lower(btrim(target.title))<>lower(btrim(incoming.title))
      or (lower(btrim(target.city))<>lower(btrim(incoming.city)))
      or (lower(btrim(target.venue_name))<>lower(btrim(incoming.venue_name)))
      or (target.is_online is distinct from coalesce(incoming.is_online,target.is_online))
      or lower(btrim(target.country))<>lower(btrim(incoming.country))
      or lower(btrim(target.address))<>lower(btrim(incoming.address))) then
      conflict_reason := 'conflicting_identity';
    elsif (target.verification_status in ('rejected','cancelled') and decision<>target.verification_status)
      or (not authoritative and decision in ('cancelled','rejected')
          and decision<>target.verification_status) then
      conflict_reason := 'conflicting_decision';
    end if;
  end if;
  if conflict_reason is null and exists(select from discovery_reviews
      where status='pending' and candidate_ids @> array[target.id] and reason<>'awaiting_verification') then
    return jsonb_build_object('event_id',target.id,'outcome','quarantined');
  end if;
  if conflict_reason is null then
    if target.id is null then
      insert into events(source,external_id,url,title,starts_at,ends_at,description,summary,image_url,
        timezone,is_online,venue_name,address,city,region,country,lat,lng,price_min,price_max,
        currency,is_free,organizer,categories,tags,status,verification_status,official_url,
        source_published_at,first_seen_at,last_seen_at,last_verified_at,raw)
      values(p_source,incoming.external_id,incoming.url,incoming.title,incoming.starts_at,incoming.ends_at,
        incoming.description,incoming.summary,incoming.image_url,incoming.timezone,coalesce(incoming.is_online,false),
        incoming.venue_name,incoming.address,incoming.city,incoming.region,incoming.country,incoming.lat,
        incoming.lng,incoming.price_min,incoming.price_max,incoming.currency,coalesce(incoming.is_free,false),
        incoming.organizer,coalesce(incoming.categories,'{}'),coalesce(incoming.tags,'{}'),
        case when decision='cancelled' then 'cancelled' else coalesce(incoming.status,'active') end,
        decision,incoming.official_url,incoming.source_published_at,seen,seen,
        case when decision<>'pending_review' then seen end,public_metadata) returning * into target;
    elsif decision='pending_review' and target.verification_status='verified' then
      update events set last_seen_at=seen where id=target.id;
    else
      update events set last_seen_at=seen,
        title=case when authoritative then incoming.title else title end,
        starts_at=case when authoritative then incoming.starts_at else starts_at end,
        timezone=case when authoritative then incoming.timezone else timezone end,
        address=case when authoritative then incoming.address else address end,
        country=case when authoritative then incoming.country else country end,
        region=case when authoritative then incoming.region else region end,
        lat=case when authoritative then incoming.lat else lat end,
        lng=case when authoritative then incoming.lng else lng end,
        is_online=case when authoritative then coalesce(incoming.is_online,false) else is_online end,
        last_verified_at=case when decision<>'pending_review' then seen else last_verified_at end,
        verification_status=case when decision='pending_review' then verification_status else decision end,
        status=case when decision='cancelled' then 'cancelled'
          when source=p_source and decision='verified' then coalesce(incoming.status,status) else status end,
        url=case when authoritative then incoming.url else url end,
        official_url=case when authoritative and listing_only and incoming.official_url is null
          then (select l.listing->>'official_url' from event_source_listings l
            where l.event_id=target.id and l.source_slug<>p_source and l.verified_evidence->>'verification_status'='verified'
            and l.evidence=l.verified_evidence and l.listing->>'official_url'=target.official_url
            order by l.source_slug,l.external_id limit 1)
          when authoritative or (decision='verified' and verification_status='pending_review') then incoming.official_url
          when decision='verified' then coalesce(official_url,incoming.official_url) else official_url end,
        raw=case when authoritative then public_metadata ||
          (case when raw @> '{"seeded":true}' then '{"seeded":true}'::jsonb else '{}'::jsonb end)
          else raw end,
        source_published_at=case when source=p_source then coalesce(incoming.source_published_at,source_published_at)
          else source_published_at end,
        description=case when source=p_source then coalesce(incoming.description,description) else description end,
        ends_at=case when authoritative then incoming.ends_at else ends_at end,
        price_min=case when source=p_source then coalesce(incoming.price_min,price_min) else price_min end,
        price_max=case when source=p_source then coalesce(incoming.price_max,price_max) else price_max end,
        currency=case when source=p_source then coalesce(incoming.currency,currency) else currency end,
        is_free=case when source=p_source then coalesce(incoming.is_free,is_free) else is_free end,
        image_url=case when source=p_source then coalesce(incoming.image_url,image_url) else image_url end,
        venue_name=case when authoritative then incoming.venue_name else coalesce(venue_name,incoming.venue_name) end,
        city=case when authoritative then incoming.city else coalesce(city,incoming.city) end,
        tags=case when source=p_source then coalesce(incoming.tags,tags) else tags end,
        categories=case when source=p_source then coalesce(incoming.categories,categories) else categories end
        where id=target.id returning * into target;
    end if;
    insert into event_source_listings(source_slug,external_id,event_id,url,original_url,source_published_at,
        first_seen_at,last_seen_at,evidence,listing,last_verified_at,verified_evidence)
      values(p_source,incoming.external_id,target.id,incoming.url,incoming.url,incoming.source_published_at,
        seen,seen,p_evidence,p_event,case when decision<>'pending_review' then seen end,
        case when decision<>'pending_review' then p_evidence end)
      on conflict (source_slug,external_id) do update set url=excluded.url,
        source_published_at=coalesce(excluded.source_published_at,event_source_listings.source_published_at),
        last_seen_at=excluded.last_seen_at,evidence=excluded.evidence,listing=excluded.listing,
        last_verified_at=coalesce(excluded.last_verified_at,event_source_listings.last_verified_at),
        verified_evidence=coalesce(excluded.verified_evidence,event_source_listings.verified_evidence);
  end if;
  if conflict_reason is not null or target.verification_status='pending_review' then
    if conflict_reason is not null then
      update events set verification_status='pending_review' where id=any(ids) and verification_status='verified';
    end if;
    insert into discovery_reviews(source_slug,external_id,event_id,reason,listing,evidence,candidate_ids)
      values(p_source,incoming.external_id,target.id,coalesce(conflict_reason,'awaiting_verification'),p_event,p_evidence,coalesce(ids,'{}'))
      on conflict(source_slug,external_id,reason) where status='pending'
      do update set listing=excluded.listing,evidence=excluded.evidence,event_id=excluded.event_id,
        candidate_ids=array(select distinct unnest(discovery_reviews.candidate_ids || excluded.candidate_ids));
  elsif decision<>'pending_review' then
    update discovery_reviews set status='resolved' where source_slug=p_source and external_id=incoming.external_id
      and reason='awaiting_verification' and status='pending';
  end if;
  return jsonb_build_object('event_id',target.id,'outcome',
    case when conflict_reason is null then 'stored' else 'quarantined' end);
end $$;

create function public.discovery_quarantine(p_source text,p_reviews jsonb,p_job_id uuid,p_token uuid)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare written integer;
begin
  perform 1 from discovery_sources where slug=p_source and enabled for share;
  if not found then raise exception 'Source disabled or unknown'; end if;
  perform 1 from discovery_jobs where id=p_job_id and source_slug=p_source and status='leased'
    and lease_token=p_token and lease_until>clock_timestamp() for update;
  if not found then raise exception 'Lost discovery lease'; end if;

  if jsonb_typeof(p_reviews) is distinct from 'array' then
    raise exception 'Expected connector review array';
  end if;
  if jsonb_array_length(p_reviews)>200 or exists (
    select from jsonb_array_elements(p_reviews) r
    where jsonb_typeof(r->'external_id') is distinct from 'string' or btrim(r->>'external_id')=''
       or jsonb_typeof(r->'reason') is distinct from 'string' or btrim(r->>'reason')=''
       or jsonb_typeof(r->'listing') is distinct from 'object'
       or jsonb_typeof(r->'evidence') is distinct from 'object'
       or (r ? 'source_slug' and (r->>'source_slug') is distinct from p_source)
  ) then raise exception 'Invalid connector review batch'; end if;

  insert into discovery_reviews(source_slug,external_id,reason,listing,evidence)
    select distinct on (r->>'external_id',r->>'reason')
      p_source,r->>'external_id',r->>'reason',r->'listing',r->'evidence'
    from jsonb_array_elements(p_reviews) with ordinality observations(r,position_in_batch)
    order by r->>'external_id',r->>'reason',position_in_batch desc
    on conflict(source_slug,external_id,reason) where status='pending'
    do update set listing=excluded.listing,evidence=excluded.evidence;
  get diagnostics written = row_count;
  return written;
end $$;

create function public.discovery_monitor() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'job_counts',coalesce((select jsonb_object_agg(status,n) from
      (select status,count(*) n from discovery_jobs group by status) j),'{}'),
    'review_counts',coalesce((select jsonb_object_agg(status,n) from
      (select status,count(*) n from discovery_reviews group by status) r),'{}'))
$$;

do $$
declare obj text;
begin
  foreach obj in array array['discovery_sources','discovery_jobs','event_source_listings','discovery_reviews'] loop
    execute format('alter table public.%I enable row level security',obj);
    execute format('revoke all on public.%I from public,anon,authenticated',obj);
    execute format('grant select,insert,update,delete on public.%I to service_role',obj);
  end loop;
  foreach obj in array array['discovery_enqueue(text,text,text,jsonb)','discovery_lease(integer,integer)',
    'discovery_ack(uuid,uuid)','discovery_fail(uuid,uuid,text,integer)',
    'discovery_persist(text,jsonb,jsonb,uuid,uuid)','discovery_quarantine(text,jsonb,uuid,uuid)',
    'discovery_monitor()'] loop
    execute 'revoke all on function public.'||obj||' from public,anon,authenticated';
    execute 'grant execute on function public.'||obj||' to service_role';
  end loop;
end $$;

-- Saved associations retain their independent owner-only SELECT and DELETE policies.
-- Owners can still join verified historical records even after their start time.
alter policy "events are publicly readable" on public.events using (
  verification_status='verified' and canonical_event_id is null and last_verified_at is not null
  and url like 'https://%' and (raw->>'seeded') is distinct from 'true'
  and source<>'demo' and status='active' and starts_at>now()
);
create policy "verified saved event history" on public.events for select to authenticated using (
  verification_status='verified' and canonical_event_id is null and source<>'demo'
  and (raw->>'seeded') is distinct from 'true' and url like 'https://%'
  and exists(select from public.saved_events s where s.event_id=events.id and s.user_id=(select auth.uid()))
);
-- The deterministic API has no caller for the legacy vector matcher.
revoke execute on function public.match_events from public, anon, authenticated, service_role;
alter function public.match_events security invoker;

create or replace function public.search_events(
  p_query text,p_city text default null,p_from timestamptz default null,p_to timestamptz default null,
  p_categories text[] default null,p_limit integer default 40,p_offset integer default 0
) returns table (
  id uuid,source text,url text,title text,summary text,image_url text,starts_at timestamptz,
  is_online boolean,venue_name text,city text,country text,price_min numeric,currency text,
  is_free boolean,organizer text,categories text[],tags text[],rank real
) language sql stable security invoker set search_path=public,pg_temp as $$
  select e.id,e.source,e.url,e.title,e.summary,e.image_url,e.starts_at,e.is_online,e.venue_name,
    e.city,e.country,e.price_min,e.currency,e.is_free,e.organizer,e.categories,e.tags,
    ts_rank(e.search_tsv,websearch_to_tsquery('english',coalesce(p_query,''))) as rank
  from events e
  where e.verification_status='verified' and e.canonical_event_id is null and e.status='active'
    and e.starts_at>now() and e.last_verified_at is not null and e.url like 'https://%' and e.source<>'demo'
    and (e.raw->>'seeded') is distinct from 'true'
    and (p_from is null or e.starts_at>=p_from) and (p_to is null or e.starts_at<=p_to)
    and (p_categories is null or e.categories && p_categories)
    and (p_city is null or e.is_online or lower(e.city)=lower(p_city))
    and (coalesce(p_query,'')='' or e.search_tsv @@ websearch_to_tsquery('english',p_query)
         or e.title ilike '%' || p_query || '%')
  order by rank desc,e.starts_at,e.id limit greatest(1,least(coalesce(p_limit,40),100))
  offset greatest(0,coalesce(p_offset,0))
$$;

create or replace function public.trending_events(p_city text default null,p_limit integer default 24)
returns setof public.events language sql stable security invoker set search_path=public,pg_temp as $$
  select e.* from events e
  left join lateral (
    select count(*) clicks from event_clicks c where c.event_id=e.id and c.created_at>now()-interval '14 days'
  ) c on true
  where e.verification_status='verified' and e.canonical_event_id is null and e.status='active'
    and e.starts_at>now() and e.last_verified_at is not null and e.url like 'https://%' and e.source<>'demo'
    and (e.raw->>'seeded') is distinct from 'true'
    and (p_city is null or e.is_online or lower(e.city)=lower(p_city))
  order by (e.popularity/100.0+c.clicks*0.5) desc,e.starts_at,e.id
  limit greatest(1,least(coalesce(p_limit,24),100))
$$;
