-- Migration: extend agent login list with last logout and daily total

create or replace function public.list_agent_logins()
returns table (
  agent_id uuid,
  agent_name text,
  login_at timestamptz,
  logout_at timestamptz,
  device_type text,
  user_agent text,
  last_logout_at timestamptz,
  total_today_seconds int
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  v_role := public.current_role();
  if v_role not in ('ADMIN', 'GERENTE') then
    raise exception 'not_allowed';
  end if;

  v_day_start := date_trunc('day', now());
  v_day_end := v_day_start + interval '1 day';

  return query
  select
    pr.id as agent_id,
    pr.full_name as agent_name,
    s.login_at,
    s.logout_at,
    s.device_type,
    s.user_agent,
    last_logout.last_logout_at,
    coalesce(total_today.total_today_seconds, 0)::int as total_today_seconds
  from public.profiles pr
  left join lateral (
    select us.login_at, us.logout_at, us.device_type, us.user_agent
    from public.user_sessions us
    where us.user_id = pr.id
    order by us.login_at desc
    limit 1
  ) s on true
  left join lateral (
    select max(us.logout_at) as last_logout_at
    from public.user_sessions us
    where us.user_id = pr.id
      and us.logout_at is not null
  ) last_logout on true
  left join lateral (
    select sum(
      greatest(
        0,
        extract(epoch from (least(coalesce(us.logout_at, now()), v_day_end) - greatest(us.login_at, v_day_start)))
      )
    ) as total_today_seconds
    from public.user_sessions us
    where us.user_id = pr.id
      and coalesce(us.logout_at, now()) > v_day_start
      and us.login_at < v_day_end
  ) total_today on true
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