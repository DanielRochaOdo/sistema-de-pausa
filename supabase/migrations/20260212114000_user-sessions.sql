-- Migration: user sessions and agent login list

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  login_at timestamptz not null default now(),
  logout_at timestamptz null,
  device_type text not null check (device_type in ('mobile', 'desktop')),
  user_agent text null,
  created_at timestamptz default now()
);

create index if not exists user_sessions_user_login_idx
  on public.user_sessions(user_id, login_at desc);

alter table public.user_sessions enable row level security;

-- User sessions policies

drop policy if exists "User sessions: select own/admin/manager" on public.user_sessions;
drop policy if exists "User sessions: insert own" on public.user_sessions;
drop policy if exists "User sessions: update own/admin" on public.user_sessions;

create policy "User sessions: select own/admin/manager"
  on public.user_sessions for select
  using (
    public.is_admin(auth.uid())
    or user_id = auth.uid()
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = user_sessions.user_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and pr.team_id = public.current_team_id())
          )
      )
    )
  );

create policy "User sessions: insert own"
  on public.user_sessions for insert
  with check (user_id = auth.uid());

create policy "User sessions: update own/admin"
  on public.user_sessions for update
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

create or replace function public.list_agent_logins()
returns table (
  agent_id uuid,
  agent_name text,
  login_at timestamptz,
  logout_at timestamptz,
  device_type text,
  user_agent text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  v_role := public.current_role();
  if v_role not in ('ADMIN', 'GERENTE') then
    raise exception 'not_allowed';
  end if;

  return query
  select
    pr.id as agent_id,
    pr.full_name as agent_name,
    s.login_at,
    s.logout_at,
    s.device_type,
    s.user_agent
  from public.profiles pr
  left join lateral (
    select us.login_at, us.logout_at, us.device_type, us.user_agent
    from public.user_sessions us
    where us.user_id = pr.id
    order by us.login_at desc
    limit 1
  ) s on true
  where pr.role = 'AGENTE'
    and (
      v_role = 'ADMIN'
      or (
        v_role = 'GERENTE'
        and (
          pr.manager_id = auth.uid()
          or (pr.team_id is not null and pr.team_id = public.current_team_id())
        )
      )
    )
  order by pr.full_name;
end;
$$;

grant execute on function public.list_agent_logins() to authenticated;