-- Migration: add session_token and realtime to user_sessions

alter table public.user_sessions
  add column if not exists session_token uuid;

update public.user_sessions
  set session_token = gen_random_uuid()
  where session_token is null;

alter table public.user_sessions
  alter column session_token set not null;

create unique index if not exists user_sessions_token_unique
  on public.user_sessions(session_token);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_sessions'
  ) then
    alter publication supabase_realtime add table public.user_sessions;
  end if;
end $$;