-- Migration: align late pause limit calc for any pause type
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
  left join lateral (
    select min(duration_minutes) as duration_minutes
    from public.pause_schedules
    where agent_id = p.agent_id
      and pause_type_id = p.pause_type_id
  ) ps on true
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
      select v_pause_id, ms.manager_id
      from public.manager_sectors ms
      join public.profiles pr on pr.id = ms.manager_id
      where pr.role = 'GERENTE'
        and ms.sector_id = v_team_id
      on conflict (pause_id, manager_id) do nothing;
    end if;
  end if;

  return v_pause_id;
end;
$$;

create or replace function public.list_active_late_pauses(
  p_now timestamptz default null,
  p_limit int default 20
)
returns table (
  pause_id uuid,
  agent_name text,
  pause_type_label text,
  started_at timestamptz,
  elapsed_seconds int,
  limit_seconds int
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_now timestamptz;
begin
  v_role := public.current_role();
  if v_role <> 'GERENTE' then
    raise exception 'not_allowed';
  end if;

  v_now := coalesce(p_now, now());

  return query
  select
    p.id as pause_id,
    pr.full_name as agent_name,
    pt.label as pause_type_label,
    p.started_at,
    extract(epoch from (v_now - p.started_at))::int as elapsed_seconds,
    (coalesce(ps.duration_minutes, pt.limit_minutes) * 60)::int as limit_seconds
  from public.pauses p
  join public.profiles pr on pr.id = p.agent_id
  join public.pause_types pt on pt.id = p.pause_type_id
  left join lateral (
    select min(duration_minutes) as duration_minutes
    from public.pause_schedules
    where agent_id = p.agent_id
      and pause_type_id = p.pause_type_id
  ) ps on true
  where p.ended_at is null
    and coalesce(ps.duration_minutes, pt.limit_minutes) is not null
    and coalesce(ps.duration_minutes, pt.limit_minutes) > 0
    and extract(epoch from (v_now - p.started_at)) > (coalesce(ps.duration_minutes, pt.limit_minutes) * 60)
    and (
      pr.manager_id = auth.uid()
      or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
    )
  order by p.started_at desc
  limit p_limit;
end;
$$;
