-- psql -v ON_ERROR_STOP=1 -f tests/deterministic_discovery.sql against a local migrated DB.
begin;
set local plpgsql.check_asserts = on;
set local role service_role;
-- Keep fixture leases isolated from other configured sources for this transaction.
update public.discovery_sources set enabled=false where enabled;
insert into public.discovery_sources(slug,kind,url,permission,enabled,allowed_hosts) values
  ('__db_fixture_a','jsonld','https://fixture.example/a','fixture',true,'{fixture.example}'),
  ('__db_fixture_b','ical','https://fixture.example/b','fixture',true,'{fixture.example}');

do $$
declare
  job uuid;
  first_lease public.discovery_jobs;
  next_lease public.discovery_jobs;
  e jsonb := '{"external_id":"one","url":"https://fixture.example/a/1","title":"Fixture concert",
    "starts_at":"2037-01-01T10:00:00Z","city":"Bath","venue_name":"Fixture Hall",
    "official_url":"https://fixture.example/a/1","source_published_at":"2020-01-01T00:00:00Z",
    "first_seen_at":"2000-01-01T00:00:00Z"}';
  verified jsonb := '{"verification_status":"verified","reason":"publisher detail","url":"https://fixture.example/a/1"}';
  result jsonb;
  canonical uuid;
  discovered timestamptz;
  review_batch jsonb := '[{"external_id":"partial","reason":"missing_start","listing":{},"evidence":{}},
    {"external_id":"partial","reason":"missing_start","listing":{"title":"Latest"},"evidence":{"url":"https://fixture.example/a"}}]';
begin
  assert not has_function_privilege('anon','public.discovery_quarantine(text,jsonb,uuid,uuid)','execute');
  assert not has_function_privilege('authenticated','public.discovery_quarantine(text,jsonb,uuid,uuid)','execute');
  assert not has_function_privilege('anon','public.discovery_persist(text,jsonb,jsonb,uuid,uuid)','execute');
  assert not has_table_privilege('authenticated','public.discovery_reviews','select');
  job := discovery_enqueue('__db_fixture_a','refresh','run','{}');
  assert discovery_enqueue('__db_fixture_a','refresh','run','{}')=job;
  select * into strict first_lease from discovery_lease(1,60);
  assert first_lease.id=job and first_lease.attempts=1;
  assert not exists(select from discovery_lease(1,60));
  update discovery_jobs set lease_until=now()-interval '1 second' where id=job;
  begin
    perform discovery_quarantine('__db_fixture_a',review_batch,job,first_lease.lease_token);
    raise exception 'accepted expired lease';
  exception when raise_exception then
    if sqlerrm <> 'Lost discovery lease' then raise; end if;
  end;
  select * into strict next_lease from discovery_lease(1,60);
  assert next_lease.lease_token<>first_lease.lease_token and next_lease.attempts=2;
  begin
    perform discovery_quarantine('__db_fixture_b',review_batch,job,next_lease.lease_token);
    raise exception 'accepted wrong source';
  exception when raise_exception then
    if sqlerrm <> 'Lost discovery lease' then raise; end if;
  end;
  begin
    perform discovery_quarantine('__db_fixture_a',review_batch,job,first_lease.lease_token);
    raise exception 'accepted replaced lease';
  exception when raise_exception then
    if sqlerrm <> 'Lost discovery lease' then raise; end if;
  end;
  assert discovery_quarantine('__db_fixture_a','[]',job,next_lease.lease_token)=0;
  assert discovery_quarantine('__db_fixture_a',review_batch,job,next_lease.lease_token)=1;
  assert discovery_quarantine('__db_fixture_a',review_batch,job,next_lease.lease_token)=1;
  assert (select count(*)=1 and bool_and(listing->>'title'='Latest' and event_id is null)
    from discovery_reviews where source_slug='__db_fixture_a' and external_id='partial' and status='pending');
  update discovery_reviews set status='resolved' where source_slug='__db_fixture_a' and external_id='partial';
  assert discovery_quarantine('__db_fixture_a',review_batch,job,next_lease.lease_token)=1;
  assert (select count(*)=2 from discovery_reviews where source_slug='__db_fixture_a' and external_id='partial');
  assert not exists(select from events where source='__db_fixture_a' and external_id='partial');
  assert not exists(select from event_source_listings where source_slug='__db_fixture_a' and external_id='partial');
  assert not discovery_ack(job,first_lease.lease_token);
  assert not discovery_fail(job,first_lease.lease_token,'stale',10);
  begin
    perform discovery_persist('__db_fixture_a',e,verified,job,first_lease.lease_token);
    raise exception 'accepted stale lease';
  exception when raise_exception then
    if sqlerrm <> 'Lost discovery lease' then raise; end if;
  end;

  result := discovery_persist('__db_fixture_a',e,'{}',job,next_lease.lease_token);
  canonical := (result->>'event_id')::uuid;
  assert result->>'outcome'='stored';
  select first_seen_at into strict discovered from events where id=canonical and verification_status='pending_review'
    and last_verified_at is null and first_seen_at>=now() and source_published_at<'2021-01-01';
  assert exists(select from discovery_reviews where event_id=canonical and status='pending');
  begin
    perform discovery_persist('__db_fixture_a',e,'{"verification_status":"verified"}');
    raise exception 'accepted empty evidence';
  exception when raise_exception then
    if sqlerrm <> 'Verification decision requires evidence URL and reason' then raise; end if;
  end;
  perform discovery_persist('__db_fixture_a',e,verified,job,next_lease.lease_token);
  assert exists(select from discovery_reviews where event_id=canonical and status='resolved');
  assert discovery_ack(job,next_lease.lease_token);
  assert not discovery_ack(job,next_lease.lease_token);

  e := e || '{"url":"https://fixture.example/b/99","official_url":"https://fixture.example/b/99","external_id":"99"}';
  result := discovery_persist('__db_fixture_b',e,verified);
  assert (result->>'event_id')::uuid=canonical and result->>'outcome'='stored';
  perform discovery_persist('__db_fixture_b',e,'{}');
  assert (select count(*)=2 from event_source_listings where event_id=canonical);
  assert exists(select from event_source_listings where event_id=canonical and source_slug='__db_fixture_b'
    and original_url='https://fixture.example/b/99' and verified_evidence=verified);
  result := discovery_persist('__db_fixture_b',e || '{"starts_at":"2037-01-02T10:00:00Z"}',verified);
  assert result->>'outcome'='quarantined';
  assert exists(select from discovery_reviews where event_id=canonical and reason='conflicting_identity');
  assert exists(select from events where id=canonical and starts_at='2037-01-01T10:00:00Z'
    and first_seen_at=discovered and last_verified_at>=discovered and verification_status='pending_review');
  assert discovery_persist('__db_fixture_b',e,verified)->>'outcome'='quarantined';
  assert not exists(select from search_events('Fixture concert') where id=canonical);
  assert not exists(select from trending_events() where id=canonical);

  -- A second session can use the same booking URL and a distinct provider ID.
  e := e || '{"external_id":"second","starts_at":"2037-01-03T10:00:00Z"}';
  result := discovery_persist('__db_fixture_b',e,verified);
  assert result->>'outcome'='stored' and (result->>'event_id')::uuid<>canonical;
  canonical := (result->>'event_id')::uuid;
  e := e || '{"starts_at":"2037-02-01T10:00:00Z","venue_name":"New Hall","city":"York"}';
  result := discovery_persist('__db_fixture_b',e,verified);
  assert (result->>'event_id')::uuid=canonical and result->>'outcome'='stored';
  assert exists(select from events where id=canonical and starts_at='2037-02-01T10:00:00Z'
    and venue_name='New Hall' and city='York' and verification_status='verified');
  result := discovery_persist('__db_fixture_b',e || '{"external_id":"naive","starts_at":"2038-01-01T12:00:00"}',verified);
  assert result->>'outcome'='quarantined' and result->>'event_id' is null;
  result := discovery_persist('__db_fixture_b',(e - 'venue_name' - 'city') ||
    '{"external_id":"unknown","starts_at":"2038-01-01T12:00:00Z","venue_name":"TBA"}',verified);
  assert result->>'outcome'='quarantined' and result->>'event_id' is null;

  job := discovery_enqueue('__db_fixture_a','refresh','run','{}');
  select * into strict next_lease from discovery_lease(1,60);
  assert discovery_fail(job,next_lease.lease_token,'temporary',20);
  assert not exists(select from discovery_lease(1,60));
  update discovery_jobs set available_at=now()-interval '1 minute',max_attempts=2 where id=job;
  select * into strict next_lease from discovery_lease(1,60);
  update discovery_jobs set lease_until=now()-interval '1 second' where id=job;
  assert not exists(select from discovery_lease(1,60));
  assert exists(select from discovery_jobs where id=job and status='failed' and lease_token is null);

  update discovery_sources set config='{"listing_only":true}' where slug='__db_fixture_b';
  e := e || '{"external_id":"attributed","title":"Syndicated fixture","starts_at":"2037-06-01T12:00:00Z",
    "url":"https://fixture.example/b/attribution","official_url":"https://fixture.example/b/attribution",
    "raw":{"availability":"https://schema.org/InStock","onsale":"2037-05-01T09:00:00Z","secret":"discard"}}';
  result := discovery_persist('__db_fixture_b',e,verified);
  canonical := (result->>'event_id')::uuid;
  assert exists(select from events where id=canonical and official_url is null and url=e->>'url'
    and raw->>'availability'='instock' and (raw->>'onsale')::timestamptz='2037-05-01T09:00:00Z'
    and not (raw ? 'secret'));
  perform discovery_persist('__db_fixture_b',e || '{"raw":{"availability":"arbitrary text","onsale":"invalid"}}',verified);
  assert exists(select from events where id=canonical and official_url is null and raw='{}');
end $$;
insert into events(source,external_id,url,title,starts_at)
values('__db_fixture_a','legacy','https://fixture.example/legacy','Legacy fixture',now()+interval '2 days');
set local role anon;
do $$
begin
  assert not exists(select from public.events where source='__db_fixture_a');
  assert exists(select from public.events where source='__db_fixture_b' and external_id='second');
  assert exists(select from public.events where external_id='attributed' and official_url is null);
  assert exists(select from public.search_events('Syndicated fixture') where url='https://fixture.example/b/attribution');
  assert exists(select from public.trending_events('York') where external_id='attributed' and official_url is null);
  assert not exists(select from public.search_events('Legacy fixture') where source='__db_fixture_a');
  assert not exists(select from public.trending_events() where source='__db_fixture_a');
  assert not exists(select from pg_proc p where p.pronamespace='public'::regnamespace and
    p.proname='match_events' and has_function_privilege(current_user,p.oid,'execute'));
end $$;
rollback;
