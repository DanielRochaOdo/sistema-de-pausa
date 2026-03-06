-- Migration: SIP module (roles, queues, sessions and call tracking)

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ADMIN', 'GERENTE', 'AGENTE', 'GESTOR_SIP', 'AGENTE_SIP'));

alter table public.profiles
  add column if not exists sip_default_extension text null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Novo usuario'),
    case
      when new.raw_app_meta_data->>'role' in ('ADMIN', 'GERENTE', 'AGENTE', 'GESTOR_SIP', 'AGENTE_SIP')
        then new.raw_app_meta_data->>'role'
      else 'AGENTE'
    end,
    new.email
  )
  on conflict (id) do update set
    email = excluded.email;
  return new;
end;
$$;

create or replace function public.enforce_profile_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_manager_role text;
  v_manager_team uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role in ('ADMIN', 'GESTOR_SIP') then
    new.manager_id := null;
    new.team_id := null;
    return new;
  end if;

  if new.role = 'GERENTE' then
    new.manager_id := null;
    if new.team_id is null then
      raise exception 'manager_requires_sector';
    end if;
    return new;
  end if;

  if new.role = 'AGENTE' then
    if new.manager_id is null then
      raise exception 'agent_requires_manager';
    end if;

    select role, team_id into v_manager_role, v_manager_team
    from public.profiles
    where id = new.manager_id;

    if v_manager_role is distinct from 'GERENTE' then
      raise exception 'invalid_manager_role';
    end if;

    if new.team_id is null then
      new.team_id := v_manager_team;
    end if;

    return new;
  end if;

  if new.role = 'AGENTE_SIP' then
    new.manager_id := null;
    new.team_id := null;
    return new;
  end if;

  return new;
end;
$$;

create or replace function public.guard_pause_update()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin(auth.uid()) then
    return new;
  end if;

  if public.current_role() not in ('AGENTE', 'AGENTE_SIP') then
    raise exception 'not_allowed';
  end if;

  if old.agent_id <> new.agent_id
     or old.pause_type_id <> new.pause_type_id
     or old.started_at <> new.started_at then
    raise exception 'not_allowed';
  end if;

  if old.ended_at is not null then
    raise exception 'pause_already_closed';
  end if;

  if new.ended_at is null then
    raise exception 'must_close_pause';
  end if;

  return new;
end;
$$;

create or replace function public.start_pause(pause_code text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_pause_type_id uuid;
  v_existing uuid;
  v_pause_id uuid;
  v_headers json;
  v_forwarded text;
  v_ip text;
begin
  v_role := public.current_role();
  if v_role not in ('AGENTE', 'AGENTE_SIP') then
    raise exception 'not_allowed';
  end if;

  select id into v_pause_type_id
  from public.pause_types
  where code = pause_code and is_active = true;

  if v_pause_type_id is null then
    raise exception 'invalid_pause_type';
  end if;

  select id into v_existing
  from public.pauses
  where agent_id = auth.uid() and ended_at is null;

  if v_existing is not null then
    raise exception 'pause_already_active';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      v_headers := null;
  end;

  if v_headers is not null then
    v_forwarded := trim(both ' ' from split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1));
    if v_forwarded <> '' then
      v_ip := v_forwarded;
    end if;
    if v_ip is null or v_ip = '' then
      v_ip := nullif(coalesce(v_headers->>'x-real-ip', ''), '');
    end if;
    if v_ip is null or v_ip = '' then
      v_ip := nullif(coalesce(v_headers->>'cf-connecting-ip', ''), '');
    end if;
  end if;

  if v_ip is null or v_ip = '' then
    v_ip := inet_client_addr()::text;
  end if;

  insert into public.pauses(agent_id, pause_type_id, machine_ip)
  values (auth.uid(), v_pause_type_id, v_ip)
  returning id into v_pause_id;

  return v_pause_id;
end;
$$;

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
  if v_role not in ('AGENTE', 'AGENTE_SIP') then
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

-- Update policies to allow AGENTE_SIP to use pause module.
drop policy if exists "Pauses: agent insert" on public.pauses;
create policy "Pauses: agent insert"
  on public.pauses for insert
  with check (
    (public.current_role() in ('AGENTE', 'AGENTE_SIP') and agent_id = auth.uid())
    or public.is_admin(auth.uid())
  );

drop policy if exists "Pauses: select by role" on public.pauses;
create policy "Pauses: select by role"
  on public.pauses for select
  using (
    public.is_admin(auth.uid())
    or (public.is_manager(auth.uid()) and exists (
      select 1 from public.profiles pr
      where pr.id = pauses.agent_id
        and (pr.manager_id = auth.uid() or (pr.team_id is not null and public.is_manager_sector(pr.team_id)))
    ))
    or (public.current_role() in ('AGENTE', 'AGENTE_SIP') and agent_id = auth.uid())
  );

drop policy if exists "Pauses: agent end own active" on public.pauses;
create policy "Pauses: agent end own active"
  on public.pauses for update
  using (
    (public.current_role() in ('AGENTE', 'AGENTE_SIP') and agent_id = auth.uid() and ended_at is null)
    or public.is_admin(auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or agent_id = auth.uid()
  );

drop policy if exists "Pause schedules: select own agent" on public.pause_schedules;
create policy "Pause schedules: select own agent"
  on public.pause_schedules for select
  using (
    public.current_role() in ('AGENTE', 'AGENTE_SIP')
    and agent_id = auth.uid()
  );

create table if not exists public.sip_queues (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text not null,
  is_active boolean default true,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.sip_queue_agents (
  queue_id uuid not null references public.sip_queues(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (queue_id, agent_id)
);

create table if not exists public.sip_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  sip_extension text not null,
  device_info text null,
  machine_ip text null,
  login_at timestamptz not null default now(),
  logout_at timestamptz null,
  created_at timestamptz default now()
);

create table if not exists public.sip_calls (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique,
  agent_id uuid null references public.profiles(id) on delete set null,
  queue_id uuid null references public.sip_queues(id) on delete set null,
  sip_extension text null,
  direction text null check (direction in ('INBOUND', 'OUTBOUND') or direction is null),
  caller_number text null,
  callee_number text null,
  started_at timestamptz null,
  answered_at timestamptz null,
  ended_at timestamptz null,
  duration_seconds int null,
  status text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists sip_queues_label_idx
  on public.sip_queues(label);

create index if not exists sip_queue_agents_agent_idx
  on public.sip_queue_agents(agent_id);

create index if not exists sip_sessions_agent_login_idx
  on public.sip_sessions(agent_id, login_at desc);

create unique index if not exists sip_one_active_session_per_agent_idx
  on public.sip_sessions(agent_id)
  where logout_at is null;

create index if not exists sip_calls_agent_started_idx
  on public.sip_calls(agent_id, started_at desc);

create index if not exists sip_calls_queue_started_idx
  on public.sip_calls(queue_id, started_at desc);

create index if not exists sip_calls_caller_idx
  on public.sip_calls(caller_number);

create index if not exists sip_calls_callee_idx
  on public.sip_calls(callee_number);

create or replace function public.is_sip_manager(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_uid
      and role = 'GESTOR_SIP'
  );
$$;

create or replace function public.sip_start_session(
  p_extension text,
  p_device_info text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_extension text;
  v_headers json;
  v_forwarded text;
  v_ip text;
  v_session_id uuid;
  v_has_queue boolean;
begin
  v_role := public.current_role();
  if v_role <> 'AGENTE_SIP' then
    raise exception 'not_allowed';
  end if;

  v_extension := trim(coalesce(p_extension, ''));
  if v_extension = '' then
    raise exception 'missing_extension';
  end if;

  select exists (
    select 1
    from public.sip_queue_agents qa
    join public.sip_queues q on q.id = qa.queue_id
    where qa.agent_id = auth.uid()
      and q.is_active = true
  ) into v_has_queue;

  if not coalesce(v_has_queue, false) then
    raise exception 'agent_without_queue';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      v_headers := null;
  end;

  if v_headers is not null then
    v_forwarded := trim(both ' ' from split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1));
    if v_forwarded <> '' then
      v_ip := v_forwarded;
    end if;
    if v_ip is null or v_ip = '' then
      v_ip := nullif(coalesce(v_headers->>'x-real-ip', ''), '');
    end if;
    if v_ip is null or v_ip = '' then
      v_ip := nullif(coalesce(v_headers->>'cf-connecting-ip', ''), '');
    end if;
  end if;

  if v_ip is null or v_ip = '' then
    v_ip := inet_client_addr()::text;
  end if;

  update public.sip_sessions
  set logout_at = now()
  where agent_id = auth.uid()
    and logout_at is null;

  update public.profiles
  set sip_default_extension = v_extension
  where id = auth.uid();

  insert into public.sip_sessions (agent_id, sip_extension, device_info, machine_ip)
  values (auth.uid(), v_extension, p_device_info, v_ip)
  returning id into v_session_id;

  return v_session_id;
end;
$$;

create or replace function public.sip_end_session()
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
  if v_role <> 'AGENTE_SIP' then
    raise exception 'not_allowed';
  end if;

  update public.sip_sessions
  set logout_at = now()
  where agent_id = auth.uid()
    and logout_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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
    s.sip_extension,
    s.login_at,
    c.started_at as call_started_at,
    pz.started_at as pause_started_at,
    case
      when s.login_at is null then 'NAO_LOGADO'
      when c.started_at is not null then 'OCUPADO'
      when pz.started_at is not null then 'PAUSA'
      else 'LIVRE'
    end as status
  from scoped_agents a
  left join lateral (
    select ss.sip_extension, ss.login_at
    from public.sip_sessions ss
    where ss.agent_id = a.id
      and ss.logout_at is null
    order by ss.login_at desc
    limit 1
  ) s on true
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
begin
  v_role := public.current_role();

  if v_role not in ('ADMIN', 'GESTOR_SIP', 'AGENTE_SIP') then
    raise exception 'not_allowed';
  end if;

  if v_role = 'AGENTE_SIP' then
    v_agent_filter := auth.uid();
  else
    v_agent_filter := p_agent_id;
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
    and (v_agent_filter is null or c.agent_id = v_agent_filter)
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

alter table public.sip_queues enable row level security;
alter table public.sip_queue_agents enable row level security;
alter table public.sip_sessions enable row level security;
alter table public.sip_calls enable row level security;

create policy "Profiles: sip manager select"
  on public.profiles for select
  using (
    public.current_role() = 'GESTOR_SIP'
    and role in ('AGENTE_SIP', 'GESTOR_SIP')
  );

create policy "SIP queues: select"
  on public.sip_queues for select
  using (
    public.is_admin(auth.uid())
    or public.current_role() = 'GESTOR_SIP'
    or (
      public.current_role() = 'AGENTE_SIP'
      and exists (
        select 1
        from public.sip_queue_agents qa
        where qa.queue_id = sip_queues.id
          and qa.agent_id = auth.uid()
      )
    )
  );

create policy "SIP queues: write"
  on public.sip_queues for all
  using (public.is_admin(auth.uid()) or public.current_role() = 'GESTOR_SIP')
  with check (public.is_admin(auth.uid()) or public.current_role() = 'GESTOR_SIP');

create policy "SIP queue agents: select"
  on public.sip_queue_agents for select
  using (
    public.is_admin(auth.uid())
    or public.current_role() = 'GESTOR_SIP'
    or agent_id = auth.uid()
  );

create policy "SIP queue agents: write"
  on public.sip_queue_agents for all
  using (public.is_admin(auth.uid()) or public.current_role() = 'GESTOR_SIP')
  with check (public.is_admin(auth.uid()) or public.current_role() = 'GESTOR_SIP');

create policy "SIP sessions: select"
  on public.sip_sessions for select
  using (
    public.is_admin(auth.uid())
    or public.current_role() = 'GESTOR_SIP'
    or agent_id = auth.uid()
  );

create policy "SIP sessions: insert"
  on public.sip_sessions for insert
  with check (
    (public.current_role() = 'AGENTE_SIP' and agent_id = auth.uid())
    or public.is_admin(auth.uid())
    or public.current_role() = 'GESTOR_SIP'
  );

create policy "SIP sessions: update"
  on public.sip_sessions for update
  using (
    (public.current_role() = 'AGENTE_SIP' and agent_id = auth.uid())
    or public.is_admin(auth.uid())
    or public.current_role() = 'GESTOR_SIP'
  )
  with check (
    (public.current_role() = 'AGENTE_SIP' and agent_id = auth.uid())
    or public.is_admin(auth.uid())
    or public.current_role() = 'GESTOR_SIP'
  );

create policy "SIP calls: select"
  on public.sip_calls for select
  using (
    public.is_admin(auth.uid())
    or public.current_role() = 'GESTOR_SIP'
    or (public.current_role() = 'AGENTE_SIP' and agent_id = auth.uid())
  );

create policy "SIP calls: write"
  on public.sip_calls for all
  using (public.is_admin(auth.uid()) or public.current_role() = 'GESTOR_SIP')
  with check (public.is_admin(auth.uid()) or public.current_role() = 'GESTOR_SIP');

grant execute on function public.sip_start_session(text, text) to authenticated;
grant execute on function public.sip_end_session() to authenticated;
grant execute on function public.list_sip_agent_statuses(uuid) to authenticated;
grant execute on function public.list_sip_calls(uuid, text, timestamptz, timestamptz, uuid, int) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sip_sessions'
  ) then
    alter publication supabase_realtime add table public.sip_sessions;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sip_calls'
  ) then
    alter publication supabase_realtime add table public.sip_calls;
  end if;
end $$;
