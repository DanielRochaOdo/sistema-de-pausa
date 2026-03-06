-- Improve SIP status/call listing when webhook rows arrive without agent_id.

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
      and coalesce(ss.last_seen_at, ss.login_at) >= (now() - interval '90 seconds')
    order by ss.login_at desc
    limit 1
  ) sip on true
  left join lateral (
    select sc.started_at
    from public.sip_calls sc
    where sc.ended_at is null
      and (
        sc.agent_id = a.id
        or (
          sip.sip_extension is not null
          and sc.sip_extension = sip.sip_extension
        )
      )
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

create or replace function public.list_sip_calls(
  p_queue_id uuid default null,
  p_phone text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_agent_id uuid default null,
  p_limit int default 200
)
returns table (
  call_id text,
  agent_id uuid,
  agent_name text,
  queue_id uuid,
  queue_label text,
  sip_extension text,
  direction text,
  caller_number text,
  callee_number text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_agent_filter uuid;
  v_limit int;
  v_phone text;
  v_extension_filter text;
begin
  v_role := public.current_role();

  if v_role not in ('ADMIN', 'GESTOR_SIP', 'AGENTE_SIP') then
    raise exception 'not_allowed';
  end if;

  if v_role = 'AGENTE_SIP' then
    v_agent_filter := auth.uid();

    select ss.sip_extension
    into v_extension_filter
    from public.sip_sessions ss
    where ss.agent_id = auth.uid()
      and ss.logout_at is null
      and coalesce(ss.last_seen_at, ss.login_at) >= (now() - interval '90 seconds')
    order by ss.login_at desc
    limit 1;
  else
    v_agent_filter := p_agent_id;
    v_extension_filter := null;
  end if;

  v_limit := case when p_limit is null or p_limit <= 0 then 200 else least(p_limit, 1000) end;
  v_phone := trim(coalesce(p_phone, ''));

  return query
  select
    c.call_id,
    c.agent_id,
    pr.full_name as agent_name,
    c.queue_id,
    q.label as queue_label,
    c.sip_extension,
    c.direction,
    c.caller_number,
    c.callee_number,
    c.started_at,
    c.answered_at,
    c.ended_at,
    c.duration_seconds,
    c.status
  from public.sip_calls c
  left join public.profiles pr on pr.id = c.agent_id
  left join public.sip_queues q on q.id = c.queue_id
  where (p_queue_id is null or c.queue_id = p_queue_id)
    and (
      v_role <> 'AGENTE_SIP'
      and (v_agent_filter is null or c.agent_id = v_agent_filter)
      or (
        v_role = 'AGENTE_SIP'
        and (
          c.agent_id = auth.uid()
          or (v_extension_filter is not null and c.sip_extension = v_extension_filter)
        )
      )
    )
    and (
      v_phone = ''
      or coalesce(c.caller_number, '') ilike '%' || v_phone || '%'
      or coalesce(c.callee_number, '') ilike '%' || v_phone || '%'
    )
    and (p_from is null or coalesce(c.started_at, c.created_at) >= p_from)
    and (p_to is null or coalesce(c.started_at, c.created_at) <= p_to)
  order by coalesce(c.started_at, c.created_at) desc
  limit v_limit;
end;
$$;

grant execute on function public.list_sip_agent_statuses(uuid) to authenticated;
grant execute on function public.list_sip_calls(uuid, text, timestamptz, timestamptz, uuid, int) to authenticated;
