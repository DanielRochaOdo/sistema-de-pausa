-- Fix SIP status calculation and close stale open SIP sessions.

update public.sip_sessions ss
set logout_at = now()
where ss.logout_at is null
  and not exists (
    select 1
    from public.user_sessions us
    where us.user_id = ss.agent_id
      and us.logout_at is null
      and us.login_at >= ss.login_at
  );

create or replace function public.list_sip_agent_statuses(
  p_queue_id uuid default null
)
returns table (
  agent_id uuid,
  agent_name text,
  queue_names text,
  sip_extension text,
  login_at timestamptz,
  call_started_at timestamptz,
  pause_started_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  v_role := public.current_role();
  if v_role not in ('ADMIN', 'GESTOR_SIP') then
    raise exception 'not_allowed';
  end if;

  return query
  with scoped_agents as (
    select
      p.id,
      p.full_name,
      string_agg(distinct q.label, ', ' order by q.label) as queue_names
    from public.profiles p
    join public.sip_queue_agents qa on qa.agent_id = p.id
    join public.sip_queues q on q.id = qa.queue_id
    where p.role = 'AGENTE_SIP'
      and q.is_active = true
      and (p_queue_id is null or qa.queue_id = p_queue_id)
    group by p.id, p.full_name
  )
  select
    a.id as agent_id,
    a.full_name as agent_name,
    a.queue_names,
    case
      when web.login_at is null then null
      when sip.login_at is null then null
      when sip.login_at < web.login_at then null
      else sip.sip_extension
    end as sip_extension,
    case
      when web.login_at is null then null
      when sip.login_at is null then null
      when sip.login_at < web.login_at then null
      else sip.login_at
    end as login_at,
    case
      when web.login_at is null then null
      when sip.login_at is null then null
      when sip.login_at < web.login_at then null
      else c.started_at
    end as call_started_at,
    case
      when web.login_at is null then null
      when sip.login_at is null then null
      when sip.login_at < web.login_at then null
      else pz.started_at
    end as pause_started_at,
    case
      when web.login_at is null then 'NAO_LOGADO'
      when sip.login_at is null then 'NAO_LOGADO'
      when sip.login_at < web.login_at then 'NAO_LOGADO'
      when c.started_at is not null then 'OCUPADO'
      when pz.started_at is not null then 'PAUSA'
      else 'LIVRE'
    end as status
  from scoped_agents a
  left join lateral (
    select us.login_at
    from public.user_sessions us
    where us.user_id = a.id
      and us.logout_at is null
    order by us.login_at desc
    limit 1
  ) web on true
  left join lateral (
    select ss.sip_extension, ss.login_at
    from public.sip_sessions ss
    where ss.agent_id = a.id
      and ss.logout_at is null
    order by ss.login_at desc
    limit 1
  ) sip on true
  left join lateral (
    select sc.started_at
    from public.sip_calls sc
    where sc.agent_id = a.id
      and sc.ended_at is null
    order by sc.started_at desc nulls last
    limit 1
  ) c on true
  left join lateral (
    select p.started_at
    from public.pauses p
    where p.agent_id = a.id
      and p.ended_at is null
    order by p.started_at desc
    limit 1
  ) pz on true
  order by a.full_name;
end;
$$;
