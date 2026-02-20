-- Migration: app settings for push trigger

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  created_at timestamptz default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "App settings: admin select" on public.app_settings;
drop policy if exists "App settings: admin insert" on public.app_settings;
drop policy if exists "App settings: admin update" on public.app_settings;
drop policy if exists "App settings: admin delete" on public.app_settings;

create policy "App settings: admin select"
  on public.app_settings for select
  using (public.is_admin(auth.uid()));

create policy "App settings: admin insert"
  on public.app_settings for insert
  with check (public.is_admin(auth.uid()));

create policy "App settings: admin update"
  on public.app_settings for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "App settings: admin delete"
  on public.app_settings for delete
  using (public.is_admin(auth.uid()));

create or replace function public.notify_late_pause_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supabase_url text;
  v_service_role text;
  v_url text;
  v_payload jsonb;
begin
  select value into v_supabase_url
  from public.app_settings
  where key = 'supabase_url'
  limit 1;

  select value into v_service_role
  from public.app_settings
  where key = 'service_role_key'
  limit 1;

  if v_supabase_url is null or v_supabase_url = '' then
    return new;
  end if;
  if v_service_role is null or v_service_role = '' then
    return new;
  end if;

  v_url := v_supabase_url || '/functions/v1/push-late';
  v_payload := jsonb_build_object(
    'pause_id', new.pause_id,
    'manager_id', new.manager_id
  );

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role
    ),
    body := v_payload
  );

  return new;
end;
$$;

drop trigger if exists pause_notifications_push on public.pause_notifications;
create trigger pause_notifications_push
  after insert on public.pause_notifications
  for each row execute procedure public.notify_late_pause_push();
