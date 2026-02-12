-- Migration: notify late pauses on end

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
  v_manager_id uuid;
  v_team_id uuid;
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

  if v_is_late then
    select manager_id, team_id into v_manager_id, v_team_id
    from public.profiles
    where id = auth.uid();

    if v_manager_id is not null then
      insert into public.pause_notifications (pause_id, manager_id)
      values (v_pause_id, v_manager_id)
      on conflict (pause_id, manager_id) do nothing;
    elsif v_team_id is not null then
      insert into public.pause_notifications (pause_id, manager_id)
      select v_pause_id, pr.id
      from public.profiles pr
      where pr.role = 'GERENTE'
        and pr.team_id = v_team_id
      on conflict (pause_id, manager_id) do nothing;
    end if;
  end if;

  return v_pause_id;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pause_notifications'
  ) then
    alter publication supabase_realtime add table public.pause_notifications;
  end if;
end $$;
