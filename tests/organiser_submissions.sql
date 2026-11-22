-- Run against a migrated disposable database.
begin;
insert into auth.users (id) values ('cd10c373-1213-46e8-b889-9aa3b38a40f2');
set local role service_role;
do $$
declare
  account uuid := 'cd10c373-1213-46e8-b889-9aa3b38a40f2';
  original uuid;
begin
  original := public.submit_organiser_url(account,'https://events.example.org/e','Title',null);
  if original is null or original <> public.submit_organiser_url(account,'https://events.example.org/e',null,null)
    then raise exception 'duplicate submissions must share one review'; end if;
  for n in 2..10 loop
    if public.submit_organiser_url(account,'https://events.example.org/'||n,null,null) is null
      then raise exception 'unexpected quota'; end if;
  end loop;
  if public.submit_organiser_url(account,'https://events.example.org/extra',null,null) is not null
    then raise exception 'daily quota exceeded'; end if;
  if has_table_privilege('anon','public.organiser_submissions','select') or
     has_function_privilege('authenticated','public.submit_organiser_url(uuid,text,text,text)','execute')
    then raise exception 'unexpected privileges'; end if;
end $$;
insert into public.discovery_sources(slug,kind,enabled,permission,url,allowed_hosts)
 values('studio','jsonld',true,'published permission','https://events.example.org/calendar',array['events.example.org']);
do $$ declare sub uuid; begin
 sub:=public.submit_organiser_url('cd10c373-1213-46e8-b889-9aa3b38a40f2','https://events.example.org/e','Fixture',null);
 if public.review_organiser_submission(sub,'wrong','queue') is not null then raise exception 'Wrong source'; end if;
 if public.review_organiser_submission(sub,'studio','queue') is distinct from 'queued' then raise exception 'Failed queue'; end if;
 if public.review_organiser_submission(sub,'studio','queue') is distinct from 'queued' then raise exception 'Failed repeat'; end if;
 if (select count(*) from public.discovery_jobs where kind='verify_url')<>1 then raise exception 'Duplicate job'; end if;
end $$;
insert into public.discovery_sources(slug,kind,enabled,permission,url,allowed_hosts) values
  ('search_fixture','search',true,'approved','https://search.example.org',array['search.example.org']);
reset role;
insert into public.user_discovery_profiles(user_id,profile) values
  ('cd10c373-1213-46e8-b889-9aa3b38a40f2','{"city":"London","interests":[]}');
update public.user_discovery_profiles set profile='{"city":"London","interests":[{"name":"Jazz"}]}'
  where user_id='cd10c373-1213-46e8-b889-9aa3b38a40f2';
do $$ begin
  assert (select count(*)=1 from public.discovery_jobs where kind='gap_scan' and source_slug='search_fixture' and payload='{}');
end $$;
select public.discovery_operator_metrics();
rollback;
