-- Recheck consent at insertion time, including service-role worker writes.
create function public.check_radar_consent() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  allowed boolean;
begin
  select case
    when new.kind = 'great_match' then alerts
    when new.kind = 'ticket_reminder' then tickets
    when new.kind ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$' then digest
    else false end into allowed
  from public.user_notification_settings where user_id = new.user_id for share;
  if allowed is true then return new; end if;
  return null;
end;
$$;
revoke all on function public.check_radar_consent() from public, anon, authenticated;
create trigger enforce_radar_consent before insert or update on public.user_radar_alerts
for each row execute function public.check_radar_consent();
grant select on public.user_discovery_profiles, public.user_notification_settings to service_role;
grant select,insert on public.user_radar_alerts to service_role;
