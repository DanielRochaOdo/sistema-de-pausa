-- Migration: pause schedules

create table if not exists public.pause_schedules (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  pause_type_id uuid not null references public.pause_types(id) on delete cascade,
  scheduled_time time not null,
  duration_minutes int null,
  created_at timestamptz default now()
);

create unique index if not exists pause_schedules_agent_type_unique
  on public.pause_schedules(agent_id, pause_type_id);

create index if not exists pause_schedules_agent_idx
  on public.pause_schedules(agent_id);

create index if not exists pause_schedules_type_idx
  on public.pause_schedules(pause_type_id);

create or replace function public.end_pause(p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_pause_id uuid;
  v_started timestamptz;
  v_duration int;
  v_limit_minutes int;
  v_is_late boolean;
begin
  v_role := public.current_role();
  if v_role <> 'AGENTE' then
    raise exception 'not_allowed';
  end if;

  select id, started_at into v_pause_id, v_started
  from public.pauses
  where agent_id = auth.uid() and ended_at is null
  order by started_at desc
  limit 1;

  if v_pause_id is null then
    raise exception 'no_active_pause';
  end if;

  v_duration := extract(epoch from (now() - v_started))::int;

  select coalesce(ps.duration_minutes, pt.limit_minutes) into v_limit_minutes
  from public.pauses p
  join public.pause_types pt on pt.id = p.pause_type_id
  left join public.pause_schedules ps
    on ps.agent_id = p.agent_id
   and ps.pause_type_id = p.pause_type_id
  where p.id = v_pause_id;

  v_is_late := false;
  if v_limit_minutes is not null and v_limit_minutes > 0 then
    v_is_late := v_duration > (v_limit_minutes * 60);
  end if;

  update public.pauses
  set ended_at = now(),
      duration_seconds = v_duration,
      notes = coalesce(p_notes, notes),
      atraso = v_is_late
  where id = v_pause_id;

  return v_pause_id;
end;
$$;

alter table public.pause_schedules enable row level security;

-- Pause schedules policies

drop policy if exists "Pause schedules: select admin/manager" on public.pause_schedules;
drop policy if exists "Pause schedules: insert admin/manager" on public.pause_schedules;
drop policy if exists "Pause schedules: update admin/manager" on public.pause_schedules;
drop policy if exists "Pause schedules: delete admin/manager" on public.pause_schedules;

create policy "Pause schedules: select admin/manager"
  on public.pause_schedules for select
  using (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and pr.team_id = public.current_team_id())
          )
      )
    )
  );

create policy "Pause schedules: insert admin/manager"
  on public.pause_schedules for insert
  with check (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and pr.team_id = public.current_team_id())
          )
      )
    )
  );

create policy "Pause schedules: update admin/manager"
  on public.pause_schedules for update
  using (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and pr.team_id = public.current_team_id())
          )
      )
    )
  )
  with check (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and pr.team_id = public.current_team_id())
          )
      )
    )
  );

create policy "Pause schedules: delete admin/manager"
  on public.pause_schedules for delete
  using (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and pr.team_id = public.current_team_id())
          )
      )
    )
  );