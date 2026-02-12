-- Migration: mark all late pauses as read

create or replace function public.mark_late_pauses_as_read(
  p_from timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_count int;
begin
  v_role := public.current_role();
  if v_role <> 'GERENTE' then
    raise exception 'not_allowed';
  end if;

  with late as (
    select p.id as pause_id
    from public.pauses p
    join public.profiles pr on pr.id = p.agent_id
    where p.atraso = true
      and p.ended_at is not null
      and (p_from is null or p.ended_at >= p_from)
      and (
        pr.manager_id = auth.uid()
        or (pr.team_id is not null and pr.team_id = public.current_team_id())
      )
  )
  insert into public.pause_notifications (pause_id, manager_id, read_at)
  select late.pause_id, auth.uid(), now()
  from late
  on conflict (pause_id, manager_id) do update
    set read_at = excluded.read_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;