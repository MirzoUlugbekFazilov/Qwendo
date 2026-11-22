create table public.user_discovery_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 131072),
  onboarding_completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_discovery_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  step smallint not null check (step between 0 and 7),
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 131072),
  updated_at timestamptz not null default now()
);
create table public.user_notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alerts boolean not null default false,
  digest boolean not null default false,
  tickets boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.user_radar_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id, kind)
);
create index user_radar_alerts_event_idx on public.user_radar_alerts(event_id);
create index user_radar_alerts_recent_idx on public.user_radar_alerts(user_id,created_at desc);
alter table public.user_discovery_profiles enable row level security;
revoke all on public.user_discovery_profiles from public, anon, authenticated;
grant select,insert,update,delete on public.user_discovery_profiles to authenticated;
create policy own_rows on public.user_discovery_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter table public.user_discovery_drafts enable row level security;
revoke all on public.user_discovery_drafts from public, anon, authenticated;
grant select,insert,update,delete on public.user_discovery_drafts to authenticated;
create policy own_rows on public.user_discovery_drafts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter table public.user_notification_settings enable row level security;
revoke all on public.user_notification_settings from public, anon, authenticated;
grant select,insert,update,delete on public.user_notification_settings to authenticated;
create policy own_rows on public.user_notification_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter table public.user_radar_alerts enable row level security;
revoke all on public.user_radar_alerts from public, anon, authenticated;
grant select,insert,update,delete on public.user_radar_alerts to authenticated;
create policy own_rows on public.user_radar_alerts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- A single transaction publishes the reviewed profile and consent, then retires its draft.
create function public.confirm_discovery_profile(p_profile jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  consent jsonb := p_profile->'notifications';
begin
  if uid is null or coalesce(jsonb_typeof(p_profile->'interests'), '') <> 'array'
     or nullif(trim(p_profile->>'city'), '') is null then
    raise exception 'Incomplete discovery profile';
  end if;
  insert into public.user_discovery_profiles(user_id, profile) values(uid, p_profile - 'notifications')
    on conflict(user_id) do update set profile=excluded.profile, updated_at=now();
  insert into public.user_notification_settings(user_id,alerts,digest,tickets)
    values(uid,coalesce((consent->>'alerts')::boolean,false),coalesce((consent->>'digest')::boolean,false),coalesce((consent->>'tickets')::boolean,false))
    on conflict(user_id) do update set alerts=excluded.alerts,digest=excluded.digest,tickets=excluded.tickets,updated_at=now();
  insert into public.profiles(id,city,radius_km,include_online,onboarded,digest_opt_in,interest_text)
    values(uid,p_profile->>'city',round((p_profile->>'radius')::numeric*1.609344),
      (p_profile->>'online')::boolean,true,coalesce((consent->>'digest')::boolean,false),p_profile->>'text')
    on conflict(id) do update set city=excluded.city,radius_km=excluded.radius_km,include_online=excluded.include_online,
      onboarded=true,digest_opt_in=excluded.digest_opt_in,interest_text=excluded.interest_text,
      lat=case when lower(public.profiles.city)=lower(excluded.city) then public.profiles.lat end,
      lng=case when lower(public.profiles.city)=lower(excluded.city) then public.profiles.lng end;
  delete from public.user_discovery_drafts where user_id=uid;
end;
$$;
revoke all on function public.confirm_discovery_profile(jsonb) from public,anon;
grant execute on function public.confirm_discovery_profile(jsonb) to authenticated;
alter table public.profiles alter column digest_opt_in set default false;
