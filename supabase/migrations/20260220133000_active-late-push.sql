-- Migration: list active late pauses for push

create or replace function public.list_active_late_pauses_for_push()
returns table (
  pause_id uuid,
  manager_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with active as (
    select
      p.id,
      pr.manager_id,
      pr.team_id,
      coalesce(ps.duration_minutes, pt.limit_minutes) as limit_minutes,
      p.started_at
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
      and extract(epoch from (now() - p.started_at)) > (coalesce(ps.duration_minutes, pt.limit_minutes) * 60)
  )
  select a.id as pause_id, a.manager_id
  from active a
  where a.manager_id is not null
  union all
  select a.id as pause_id, ms.manager_id
  from active a
  join public.manager_sectors ms on ms.sector_id = a.team_id
  join public.profiles pr on pr.id = ms.manager_id and pr.role = 'GERENTE'
  where a.manager_id is null
    and a.team_id is not null;
end;
$$;
