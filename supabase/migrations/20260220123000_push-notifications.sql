-- Migration: push notifications for late pauses

create extension if not exists "pg_net";

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text null,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Push subscriptions: select own" on public.push_subscriptions;
drop policy if exists "Push subscriptions: insert own" on public.push_subscriptions;
drop policy if exists "Push subscriptions: update own" on public.push_subscriptions;
drop policy if exists "Push subscriptions: delete own" on public.push_subscriptions;

create policy "Push subscriptions: select own"
  on public.push_subscriptions for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy "Push subscriptions: insert own"
  on public.push_subscriptions for insert
  with check (user_id = auth.uid());

create policy "Push subscriptions: update own"
  on public.push_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Push subscriptions: delete own"
  on public.push_subscriptions for delete
  using (user_id = auth.uid());

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
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_role := current_setting('app.settings.service_role_key', true);

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
