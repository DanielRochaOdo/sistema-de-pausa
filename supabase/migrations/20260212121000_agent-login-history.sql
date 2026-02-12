-- Migration: list agent login history

create or replace function public.list_agent_login_history(
  p_agent_id uuid
)
returns table (
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
  v_allowed boolean;
begin
  if p_agent_id is null then
    raise exception 'missing_agent';
  end if;

  v_role := public.current_role();

  if v_role = 'ADMIN' then
    v_allowed := true;
  elsif v_role = 'GERENTE' then
    v_allowed := exists (
      select 1
      from public.profiles pr
      where pr.id = p_agent_id
        and (
          pr.manager_id = auth.uid()
          or (pr.team_id is not null and pr.team_id = public.current_team_id())
        )
    );
  else
    v_allowed := false;
  end if;

  if not v_allowed then
    raise exception 'not_allowed';
  end if;

  return query
  select us.login_at, us.logout_at, us.device_type, us.user_agent
  from public.user_sessions us
  where us.user_id = p_agent_id
  order by us.login_at desc;
end;
$$;

grant execute on function public.list_agent_login_history(uuid) to authenticated;