-- ═══════════════════════════════════════════════════════════════
-- Qwendo — complete initial schema
-- Applied to Supabase project hfpnbzadymxttjnilkkz (Qwendo) on 2026-11-21
-- as three migrations: qwendo_init_core_schema,
-- qwendo_rls_and_recommendation_rpcs, qwendo_seed_interest_taxonomy.
-- Kept here as a single file so the database can be rebuilt from scratch.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ───────────────────────────────────────────────────────────────
-- profiles
-- ───────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  city text,
  country text,
  lat double precision,
  lng double precision,
  radius_km integer not null default 40 check (radius_km between 1 and 500),
  include_online boolean not null default true,
  interest_text text,
  embedding extensions.vector(1536),
  embedded_at timestamptz,
  onboarded boolean not null default false,
  digest_opt_in boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'User profile, location preferences and taste embedding used for recommendations.';

-- ───────────────────────────────────────────────────────────────
-- interests
-- ───────────────────────────────────────────────────────────────
create table if not exists public.interests (
  slug text primary key,
  label text not null,
  category text not null,
  keywords text[] not null default '{}',
  sort_order integer not null default 100,
  is_active boolean not null default true
);

create table if not exists public.user_interests (
  user_id uuid not null references auth.users(id) on delete cascade,
  interest_slug text not null references public.interests(slug) on delete cascade,
  weight real not null default 1.0 check (weight between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, interest_slug)
);
create index if not exists user_interests_user_idx on public.user_interests (user_id);

-- ───────────────────────────────────────────────────────────────
-- events
-- ───────────────────────────────────────────────────────────────
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  url text not null,
  title text not null,
  description text,
  summary text,
  image_url text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text,
  is_online boolean not null default false,
  venue_name text,
  address text,
  city text,
  region text,
  country text,
  lat double precision,
  lng double precision,
  price_min numeric(10,2),
  price_max numeric(10,2),
  currency text,
  is_free boolean not null default false,
  organizer text,
  categories text[] not null default '{}',
  tags text[] not null default '{}',
  popularity real not null default 0,
  status text not null default 'active'
    check (status in ('active','cancelled','postponed','sold_out','expired')),
  content_hash text,
  raw jsonb,
  embedding extensions.vector(1536),
  embedded_at timestamptz,
  search_tsv tsvector,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_source_external_id_key unique (source, external_id)
);
comment on table public.events is 'Normalized events ingested from Ticketmaster, Eventbrite, Luma and other sources.';

create index if not exists events_starts_at_idx on public.events (starts_at) where status = 'active';
create index if not exists events_city_starts_idx on public.events (lower(city), starts_at);
create index if not exists events_source_idx on public.events (source);
create index if not exists events_categories_idx on public.events using gin (categories);
create index if not exists events_tags_idx on public.events using gin (tags);
create index if not exists events_search_idx on public.events using gin (search_tsv);
create index if not exists events_title_trgm_idx on public.events using gin (title extensions.gin_trgm_ops);
create index if not exists events_embedding_idx on public.events
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);

-- ───────────────────────────────────────────────────────────────
-- engagement
-- ───────────────────────────────────────────────────────────────
create table if not exists public.saved_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  state text not null default 'saved' check (state in ('saved','going','dismissed')),
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index if not exists saved_events_user_idx on public.saved_events (user_id, created_at desc);

create table if not exists public.event_clicks (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_id uuid not null references public.events(id) on delete cascade,
  surface text,
  created_at timestamptz not null default now()
);
create index if not exists event_clicks_event_idx on public.event_clicks (event_id, created_at desc);
create index if not exists event_clicks_user_idx on public.event_clicks (user_id, created_at desc);

-- ───────────────────────────────────────────────────────────────
-- ingestion observability
-- ───────────────────────────────────────────────────────────────
create table if not exists public.ingestion_runs (
  id bigint generated always as identity primary key,
  source text not null,
  query text,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  found integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  errors integer not null default 0,
  error_text text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ingestion_runs_source_idx on public.ingestion_runs (source, started_at desc);

-- ───────────────────────────────────────────────────────────────
-- triggers
-- ───────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- full-text vector maintained by trigger (array_to_string is only STABLE,
-- so a generated column is not possible here)
create or replace function public.events_build_tsv()
returns trigger language plpgsql set search_path = public as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english',
      coalesce(new.organizer, '') || ' ' ||
      coalesce(new.venue_name, '') || ' ' ||
      coalesce(new.city, '') || ' ' ||
      array_to_string(new.tags, ' ') || ' ' ||
      array_to_string(new.categories, ' ')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(new.description, ''), 6000)), 'C');
  return new;
end;
$$;

drop trigger if exists events_tsv_trigger on public.events;
create trigger events_tsv_trigger before insert or update of
  title, description, organizer, venue_name, city, tags, categories
  on public.events
  for each row execute function public.events_build_tsv();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════════════════════════
alter table public.profiles       enable row level security;
alter table public.interests      enable row level security;
alter table public.user_interests enable row level security;
alter table public.events         enable row level security;
alter table public.saved_events   enable row level security;
alter table public.event_clicks   enable row level security;
alter table public.ingestion_runs enable row level security;

drop policy if exists "events are publicly readable" on public.events;
create policy "events are publicly readable" on public.events
  for select to anon, authenticated using (status <> 'expired');

drop policy if exists "interests are publicly readable" on public.interests;
create policy "interests are publicly readable" on public.interests
  for select to anon, authenticated using (is_active);

drop policy if exists "own profile select" on public.profiles;
create policy "own profile select" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "own interests select" on public.user_interests;
create policy "own interests select" on public.user_interests
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own interests insert" on public.user_interests;
create policy "own interests insert" on public.user_interests
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "own interests delete" on public.user_interests;
create policy "own interests delete" on public.user_interests
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own saved select" on public.saved_events;
create policy "own saved select" on public.saved_events
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own saved insert" on public.saved_events;
create policy "own saved insert" on public.saved_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "own saved update" on public.saved_events;
create policy "own saved update" on public.saved_events
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own saved delete" on public.saved_events;
create policy "own saved delete" on public.saved_events
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "log own clicks" on public.event_clicks;
create policy "log own clicks" on public.event_clicks
  for insert to anon, authenticated with check (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "read own clicks" on public.event_clicks;
create policy "read own clicks" on public.event_clicks
  for select to authenticated using ((select auth.uid()) = user_id);

-- ingestion_runs intentionally has no policies: service role only.

-- ═══════════════════════════════════════════════════════════════
-- Functions
-- ═══════════════════════════════════════════════════════════════
create or replace function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable parallel safe set search_path = public as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  end;
$$;

-- Hybrid ranking:
--   0.62 semantic similarity (pgvector cosine)
--   0.16 "happening soon" decay
--   0.14 proximity to the user
--   0.08 popularity
create or replace function public.match_events(
  query_embedding extensions.vector(1536),
  p_user_id uuid default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km integer default null,
  p_city text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_categories text[] default null,
  p_sources text[] default null,
  p_include_online boolean default true,
  p_free_only boolean default false,
  p_max_price numeric default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  id uuid, source text, external_id text, url text, title text, summary text,
  description text, image_url text, starts_at timestamptz, ends_at timestamptz,
  timezone text, is_online boolean, venue_name text, address text, city text,
  country text, lat double precision, lng double precision, price_min numeric,
  price_max numeric, currency text, is_free boolean, organizer text,
  categories text[], tags text[], popularity real, distance_km double precision,
  similarity double precision, score double precision
)
language sql stable set search_path = public, extensions as $$
  with scoped as (
    select
      e.*,
      public.haversine_km(p_lat, p_lng, e.lat, e.lng) as dist_km,
      case
        when query_embedding is null or e.embedding is null then 0.35
        else 1 - (e.embedding <=> query_embedding)
      end as sim
    from public.events e
    where e.status in ('active', 'sold_out', 'postponed')
      and e.starts_at >= coalesce(p_from, now())
      and (p_to is null or e.starts_at <= p_to)
      and (p_categories is null or e.categories && p_categories)
      and (p_sources is null or e.source = any(p_sources))
      and (not p_free_only or e.is_free)
      and (p_max_price is null or e.price_min is null or e.price_min <= p_max_price)
      and (p_city is null or e.is_online or lower(e.city) = lower(p_city))
      and (p_include_online or not e.is_online)
      and (
        p_user_id is null
        or not exists (
          select 1 from public.saved_events s
          where s.user_id = p_user_id and s.event_id = e.id and s.state = 'dismissed'
        )
      )
  ),
  filtered as (
    select * from scoped
    where p_radius_km is null or p_lat is null or is_online
       or dist_km is null or dist_km <= p_radius_km
  )
  select
    f.id, f.source, f.external_id, f.url, f.title, f.summary, f.description, f.image_url,
    f.starts_at, f.ends_at, f.timezone, f.is_online, f.venue_name, f.address, f.city, f.country,
    f.lat, f.lng, f.price_min, f.price_max, f.currency, f.is_free, f.organizer,
    f.categories, f.tags, f.popularity,
    f.dist_km as distance_km,
    f.sim as similarity,
    (
      0.62 * f.sim
      + 0.16 * exp(-greatest(extract(epoch from (f.starts_at - now())) / 86400.0, 0) / 45.0)
      + 0.14 * case
                 when f.is_online then 0.55
                 when f.dist_km is null or p_lat is null then 0.5
                 else greatest(0, 1 - (f.dist_km / greatest(coalesce(p_radius_km, 40), 1)))
               end
      + 0.08 * least(1.0, f.popularity / 100.0)
    )::double precision as score
  from filtered f
  order by score desc, f.starts_at asc
  limit greatest(least(coalesce(p_limit, 40), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.match_events is 'Hybrid event ranking: pgvector cosine similarity blended with recency, proximity and popularity.';

create or replace function public.search_events(
  p_query text,
  p_city text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_categories text[] default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  id uuid, source text, url text, title text, summary text, image_url text,
  starts_at timestamptz, is_online boolean, venue_name text, city text, country text,
  price_min numeric, currency text, is_free boolean, organizer text,
  categories text[], tags text[], rank real
)
language sql stable set search_path = public, extensions as $$
  select
    e.id, e.source, e.url, e.title, e.summary, e.image_url, e.starts_at, e.is_online,
    e.venue_name, e.city, e.country, e.price_min, e.currency, e.is_free, e.organizer,
    e.categories, e.tags,
    case
      when coalesce(p_query, '') = '' then 0::real
      else ts_rank(e.search_tsv, websearch_to_tsquery('english', p_query))
    end as rank
  from public.events e
  where e.status <> 'expired'
    and e.starts_at >= coalesce(p_from, now())
    and (p_to is null or e.starts_at <= p_to)
    and (p_city is null or e.is_online or lower(e.city) = lower(p_city))
    and (p_categories is null or e.categories && p_categories)
    and (
      coalesce(p_query, '') = ''
      or e.search_tsv @@ websearch_to_tsquery('english', p_query)
      or e.title ilike '%' || p_query || '%'
    )
  order by rank desc, e.starts_at asc
  limit greatest(least(coalesce(p_limit, 40), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.trending_events(
  p_city text default null,
  p_limit integer default 24
)
returns setof public.events
language sql stable set search_path = public as $$
  select e.*
  from public.events e
  left join lateral (
    select count(*)::int as clicks
    from public.event_clicks c
    where c.event_id = e.id and c.created_at > now() - interval '14 days'
  ) c on true
  where e.status = 'active'
    and e.starts_at >= now()
    and (p_city is null or e.is_online or lower(e.city) = lower(p_city))
  order by (e.popularity / 100.0 + c.clicks * 0.5) desc, e.starts_at asc
  limit greatest(least(coalesce(p_limit, 24), 100), 1);
$$;

grant execute on function public.match_events to anon, authenticated, service_role;
grant execute on function public.search_events to anon, authenticated, service_role;
grant execute on function public.trending_events to anon, authenticated, service_role;
grant execute on function public.haversine_km to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- Seed: interest taxonomy
-- (full list lives in the applied migration qwendo_seed_interest_taxonomy;
--  regenerate with: select * from public.interests order by sort_order)
-- ═══════════════════════════════════════════════════════════════
insert into public.interests (slug, label, category, keywords, sort_order) values
  ('tech-startups','Startups & Founders','tech','{startup,founders,entrepreneurship,pitch night,demo day,venture capital,accelerator}',10),
  ('tech-ai','AI & Machine Learning','tech','{artificial intelligence,machine learning,LLM,deep learning,AI meetup,data science}',11),
  ('tech-hackathons','Hackathons','tech','{hackathon,build weekend,coding competition,game jam,CTF}',12),
  ('tech-software','Software Engineering','tech','{software engineering,developers,programming,devops,open source,web development}',13),
  ('tech-web3','Web3 & Crypto','tech','{crypto,blockchain,web3,ethereum,defi,NFT}',14),
  ('tech-product','Product & Design','tech','{product management,UX,UI design,design systems,figma,product design}',15),
  ('tech-cyber','Cybersecurity','tech','{cybersecurity,infosec,hacking,privacy,security conference}',16),
  ('biz-networking','Professional Networking','business','{networking,mixer,professionals,career,connections,meet and greet}',20),
  ('biz-investing','Investing & Finance','business','{investing,finance,fintech,trading,wealth,angel investing}',21),
  ('biz-marketing','Marketing & Growth','business','{marketing,growth,SEO,social media,branding,content}',22),
  ('biz-career','Career & Jobs','business','{career fair,job fair,recruiting,interview,CV,graduate scheme}',23),
  ('biz-leadership','Leadership & Public Speaking','business','{leadership,public speaking,management,executive,coaching}',24),
  ('music-live','Live Music & Concerts','music','{concert,live music,gig,tour,band,arena show}',30),
  ('music-electronic','Electronic & DJ Sets','music','{electronic,techno,house,DJ,rave,club night,EDM}',31),
  ('music-hiphop','Hip-Hop & R&B','music','{hip hop,rap,R&B,grime,drill,urban}',32),
  ('music-rock','Rock & Indie','music','{rock,indie,alternative,metal,punk,live band}',33),
  ('music-classical','Classical & Opera','music','{classical,orchestra,symphony,opera,recital,chamber music}',34),
  ('music-jazz','Jazz & Soul','music','{jazz,soul,blues,funk,live jazz,jam session}',35),
  ('music-festivals','Festivals','music','{festival,multi-day,lineup,outdoor festival,camping}',36),
  ('film-cinema','Film & Cinema','film','{film screening,cinema,premiere,film festival,indie film,documentary}',40),
  ('film-fandom','Film & TV Fandom','film','{fan meet,fan convention,cast panel,autograph session,screening party}',41),
  ('comics-superheroes','Comics & Superheroes','film','{comic con,marvel,DC,superhero,spiderman,batman,cosplay,comics}',42),
  ('anime-manga','Anime & Manga','film','{anime,manga,cosplay,japan expo,anime convention,otaku}',43),
  ('gaming-esports','Gaming & Esports','gaming','{gaming,esports,tournament,LAN party,video games,console}',44),
  ('gaming-tabletop','Board & Tabletop Games','gaming','{board games,tabletop,dungeons and dragons,chess,card games}',45),
  ('arts-theatre','Theatre & Musicals','arts','{theatre,musical,west end,broadway,play,stage}',50),
  ('arts-galleries','Art & Exhibitions','arts','{art exhibition,gallery,museum,installation,private view,contemporary art}',51),
  ('arts-photography','Photography','arts','{photography,photo walk,camera,darkroom,exhibition}',52),
  ('arts-workshops','Creative Workshops','arts','{workshop,pottery,painting,craft,life drawing,ceramics}',53),
  ('arts-dance','Dance & Ballet','arts','{dance,ballet,contemporary dance,salsa,dance class}',54),
  ('comedy-standup','Comedy & Stand-up','comedy','{comedy,stand up,improv,open mic,comedy club,sketch}',55),
  ('sports-football','Football','sports','{football,soccer,premier league,match,stadium,fixture}',60),
  ('sports-basketball','Basketball','sports','{basketball,NBA,hoops,game}',61),
  ('sports-combat','Boxing & MMA','sports','{boxing,MMA,UFC,fight night,wrestling}',62),
  ('sports-running','Running & Marathons','sports','{running,marathon,5k,10k,parkrun,race}',63),
  ('sports-cycling','Cycling','sports','{cycling,bike ride,sportive,velodrome}',64),
  ('sports-motor','Motorsport','sports','{formula 1,motorsport,racing,grand prix,motogp}',65),
  ('sports-tennis','Tennis','sports','{tennis,ATP,WTA,wimbledon,open}',66),
  ('food-tasting','Food & Drink Tastings','food','{food festival,tasting,street food,supper club,pop up restaurant}',70),
  ('food-wine','Wine, Beer & Cocktails','food','{wine tasting,beer festival,brewery,cocktail masterclass,whisky}',71),
  ('food-cooking','Cooking Classes','food','{cooking class,culinary,chef,baking,masterclass}',72),
  ('well-fitness','Fitness & Training','wellness','{fitness,bootcamp,HIIT,gym,training,crossfit}',75),
  ('well-yoga','Yoga & Meditation','wellness','{yoga,meditation,mindfulness,breathwork,sound bath}',76),
  ('well-mental','Mental Health & Self-Development','wellness','{mental health,therapy,self development,wellbeing,journaling}',77),
  ('well-outdoors','Outdoors & Hiking','wellness','{hiking,walk,outdoors,nature,climbing,adventure}',78),
  ('comm-volunteering','Volunteering & Causes','community','{volunteering,charity,fundraiser,community,sustainability,climate}',80),
  ('comm-language','Language Exchange','community','{language exchange,conversation club,english practice,polyglot}',81),
  ('comm-books','Books & Writing','community','{book club,author talk,poetry,writing workshop,literature,spoken word}',82),
  ('comm-students','Student & Uni Life','community','{student,university,society,campus,freshers}',83),
  ('comm-family','Family & Kids','community','{family,kids,children,family friendly,half term}',84),
  ('night-parties','Nightlife & Parties','nightlife','{nightlife,party,club,afterparty,rooftop,bar crawl}',85),
  ('edu-talks','Talks & Conferences','education','{conference,talk,lecture,summit,panel,seminar,keynote}',90),
  ('edu-courses','Courses & Bootcamps','education','{course,bootcamp,training,certification,short course}',91)
on conflict (slug) do update set
  label = excluded.label,
  category = excluded.category,
  keywords = excluded.keywords,
  sort_order = excluded.sort_order;
