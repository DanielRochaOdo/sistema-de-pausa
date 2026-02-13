-- Migration: list active late pauses for managers
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
    select max(duration_minutes) as duration_minutes
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

grant execute on function public.list_active_late_pauses(timestamptz, int) to authenticated;
