-- Run against a disposable migrated Supabase database as postgres.
begin;
insert into public.events(source,external_id,url,official_url,title,starts_at,timezone,city,
  verification_status,last_verified_at)
values ('rls_fixture','ownership','https://events.example.org/ownership','https://events.example.org/ownership',
  'Ownership fixture',now()+interval '1 day','UTC','London','verified',now());
insert into auth.users(id) values ('cafed00d-0000-4000-8000-000000000001'),('cafed00d-0000-4000-8000-000000000002');
update public.events set venue_name='New official venue',last_verified_at=now()
  where source='rls_fixture';
set local role authenticated;
select set_config('request.jwt.claim.sub','cafed00d-0000-4000-8000-000000000001',true);
insert into public.user_discovery_drafts(user_id,step,profile) values(auth.uid(),2,'{}');
select public.confirm_discovery_profile('{"interests":[],"categories":["tech"],"city":"London","radius":25,"online":true,"notifications":{"digest":true}}');
do $$ begin
 if not exists(select from public.user_discovery_profiles where user_id=auth.uid())
 or exists(select from public.user_discovery_drafts where user_id=auth.uid())
 or not exists(select from public.user_notification_settings where digest and not alerts and not tickets)
 then raise exception 'Atomic confirmation failed'; end if;
end $$;
insert into public.saved_events(user_id,event_id,state)
  select auth.uid(),id,'dismissed' from public.events limit 1;
insert into public.event_clicks(user_id,event_id,surface)
  select auth.uid(),id,'picks' from public.events limit 1;
insert into public.user_radar_alerts(user_id,event_id,kind) select auth.uid(),id,'great_match' from public.events limit 1;
insert into public.user_radar_alerts(user_id,event_id,kind) select auth.uid(),id,'weekly_digest:2026-W47' from public.events limit 1;
do $$ begin
 if exists(select from public.user_radar_alerts where kind='great_match')
 or not exists(select from public.user_radar_alerts where kind='weekly_digest:2026-W47') then raise exception 'Consent guard failed'; end if;
end $$;
update public.user_notification_settings set alerts=true where user_id=auth.uid();
insert into public.user_radar_alerts(user_id,event_id,kind)
  select auth.uid(),id,'event_update:'||to_char(meaningful_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'+00:00'
  from public.events where source='rls_fixture';
do $$ begin
  assert exists(select from public.user_radar_alerts where kind like 'event_update:%');
end $$;
select set_config('request.jwt.claim.sub','cafed00d-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select from public.user_discovery_profiles) or exists(select from public.user_notification_settings)
 or exists(select from public.saved_events) or exists(select from public.event_clicks)
 then raise exception 'Cross-account disclosure'; end if;
 begin
  insert into public.user_discovery_drafts(user_id,step,profile) values('cafed00d-0000-4000-8000-000000000001',2,'{}');
  raise exception 'Cross-account write succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
