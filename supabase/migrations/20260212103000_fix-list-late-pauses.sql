-- Migration: fix list_late_pauses return type

create or replace function public.list_late_pauses(
  p_from timestamptz default null,
  p_limit int default 5
)
returns table (
  pause_id uuid,
  agent_name text,
  pause_type_label text,
  ended_at timestamptz,
  duration_seconds int,
  total_unread int
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  v_role := public.current_role();
  if v_role <> 'GERENTE' then
    raise exception 'not_allowed';
  end if;

  return query
  select
    p.id as pause_id,
    pr.full_name as agent_name,
    pt.label as pause_type_label,
    p.ended_at,
    p.duration_seconds,
    count(*) over()::int as total_unread
  from public.pauses p
  join public.profiles pr on pr.id = p.agent_id
  join public.pause_types pt on pt.id = p.pause_type_id
  where p.atraso = true
    and p.ended_at is not null
    and (p_from is null or p.ended_at >= p_from)
    and (
      pr.manager_id = auth.uid()
      or (pr.team_id is not null and pr.team_id = public.current_team_id())
    )
    and not exists (
      select 1 from public.pause_notifications n
      where n.pause_id = p.id
        and n.manager_id = auth.uid()
        and n.read_at is not null
    )
  order by p.ended_at desc
  limit p_limit;
end;
$$;