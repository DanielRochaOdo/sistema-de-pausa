-- Supabase schema for Controle de Pausas

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text null,
  role text not null check (role in ('ADMIN', 'GERENTE', 'AGENTE')),
  team_id uuid null,
  manager_id uuid null,
  created_at timestamptz default now()
);

alter table public.profiles drop constraint if exists profiles_manager_fk;

alter table public.profiles
  add constraint profiles_manager_fk
  foreign key (manager_id) references public.profiles(id) on delete set null;

create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table public.profiles drop constraint if exists profiles_team_fk;
alter table public.profiles
  add constraint profiles_team_fk
  foreign key (team_id) references public.sectors(id) on delete set null;

create table if not exists public.manager_sectors (
  manager_id uuid not null references public.profiles(id) on delete cascade,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (manager_id, sector_id)
);

create table if not exists public.pause_types (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text not null,
  is_active boolean default true,
  limit_minutes int null
);

create table if not exists public.pauses (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  pause_type_id uuid not null references public.pause_types(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  duration_seconds int null,
  atraso boolean default false,
  notes text null,
  created_at timestamptz default now()
);

create table if not exists public.pause_notifications (
  id uuid primary key default gen_random_uuid(),
  pause_id uuid not null references public.pauses(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz null,
  created_at timestamptz default now(),
  unique (pause_id, manager_id)
);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  login_at timestamptz not null default now(),
  logout_at timestamptz null,
  session_token uuid not null default gen_random_uuid(),
  device_type text not null check (device_type in ('mobile', 'desktop')),
  user_agent text null,
  created_at timestamptz default now()
);

create table if not exists public.pause_schedules (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  pause_type_id uuid not null references public.pause_types(id) on delete cascade,
  scheduled_time time not null,
  duration_minutes int null,
  created_at timestamptz default now()
);

create unique index if not exists pauses_one_active_per_agent
  on public.pauses(agent_id)
  where ended_at is null;

create index if not exists pauses_agent_started_at_idx
  on public.pauses(agent_id, started_at desc);

create index if not exists pauses_type_idx
  on public.pauses(pause_type_id);

create index if not exists pause_types_code_idx
  on public.pause_types(code);

create index if not exists pause_schedules_agent_idx
  on public.pause_schedules(agent_id);

create index if not exists pause_schedules_type_idx
  on public.pause_schedules(pause_type_id);

create index if not exists user_sessions_user_login_idx
  on public.user_sessions(user_id, login_at desc);

create unique index if not exists user_sessions_token_unique
  on public.user_sessions(session_token);

create index if not exists manager_sectors_sector_idx
  on public.manager_sectors(sector_id);

create unique index if not exists profiles_email_lower_unique
  on public.profiles (lower(email));

create index if not exists profiles_full_name_lower_idx
  on public.profiles (lower(full_name));

create or replace view public.daily_pause_summary as
select
  date_trunc('day', p.started_at)::date as day,
  p.agent_id,
  pr.full_name as agent_name,
  pt.code as pause_type_code,
  pt.label as pause_type_label,
  count(*)::int as total_pauses,
  coalesce(sum(p.duration_seconds), 0)::int as total_duration_seconds
from public.pauses p
join public.profiles pr on pr.id = p.agent_id
join public.pause_types pt on pt.id = p.pause_type_id
where p.ended_at is not null
group by 1, 2, 3, 4, 5;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    auth.jwt()->'app_metadata'->>'role',
    'AGENTE'
  );
$$;

create or replace function public.is_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles where id = p_uid and role = 'ADMIN'
  );
$$;

create or replace function public.is_manager(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles where id = p_uid and role = 'GERENTE'
  );
$$;

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_manager_sector(p_sector_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.manager_sectors ms
    where ms.manager_id = auth.uid()
      and ms.sector_id = p_sector_id
  );
$$;

create or replace function public.sync_manager_primary_sector()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.role = 'GERENTE' and new.team_id is not null then
    insert into public.manager_sectors (manager_id, sector_id)
    values (new.id, new.team_id)
    on conflict do nothing;
  end if;

  if new.role <> 'GERENTE' then
    delete from public.manager_sectors where manager_id = new.id;
  end if;

  return new;
end;
$$;

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
      when new.raw_app_meta_data->>'role' in ('ADMIN', 'GERENTE', 'AGENTE')
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.current_role() = 'ADMIN' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.manager_id is distinct from old.manager_id
     or new.team_id is distinct from old.team_id then
    raise exception 'not_allowed';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_update_guard on public.profiles;
create trigger profiles_update_guard
  before update on public.profiles
  for each row execute procedure public.guard_profile_update();

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

  if new.role = 'ADMIN' then
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
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_hierarchy_guard on public.profiles;
create trigger profiles_hierarchy_guard
  before insert or update on public.profiles
  for each row execute procedure public.enforce_profile_hierarchy();

drop trigger if exists profiles_sync_manager_sectors on public.profiles;
create trigger profiles_sync_manager_sectors
  after insert or update of role, team_id on public.profiles
  for each row execute procedure public.sync_manager_primary_sector();

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

  if public.current_role() = 'ADMIN' then
    return new;
  end if;

  if public.current_role() <> 'AGENTE' then
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

drop trigger if exists pauses_update_guard on public.pauses;
create trigger pauses_update_guard
  before update on public.pauses
  for each row execute procedure public.guard_pause_update();

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
begin
  v_role := public.current_role();
  if v_role <> 'AGENTE' then
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

  insert into public.pauses(agent_id, pause_type_id)
  values (auth.uid(), v_pause_type_id)
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
  left join public.pause_schedules ps
    on ps.agent_id = p.agent_id
   and ps.pause_type_id = p.pause_type_id
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

drop function if exists public.list_dashboard(date, date, uuid, uuid);
drop function if exists public.list_dashboard(date, date, uuid, uuid, uuid);

create or replace function public.list_dashboard(
  p_from date,
  p_to date,
  p_agent_id uuid default null,
  p_pause_type_id uuid default null,
  p_team_id uuid default null
)
returns table (
  agent_id uuid,
  agent_name text,
  pause_type_id uuid,
  pause_type_code text,
  pause_type_label text,
  total_pauses int,
  total_duration_seconds int
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  v_role := public.current_role();
  if v_role not in ('ADMIN', 'GERENTE') then
    raise exception 'not_allowed';
  end if;

  return query
  select
    p.agent_id,
    pr.full_name as agent_name,
    pt.id as pause_type_id,
    pt.code as pause_type_code,
    pt.label as pause_type_label,
    count(*)::int as total_pauses,
    coalesce(sum(p.duration_seconds), 0)::int as total_duration_seconds
  from public.pauses p
  join public.profiles pr on pr.id = p.agent_id
  join public.pause_types pt on pt.id = p.pause_type_id
  where p.ended_at is not null
    and p.started_at::date between p_from and p_to
    and (p_agent_id is null or p.agent_id = p_agent_id)
    and (p_pause_type_id is null or p.pause_type_id = p_pause_type_id)
    and (p_team_id is null or pr.team_id = p_team_id)
    and (
      v_role = 'ADMIN'
      or (
        v_role = 'GERENTE'
        and (pr.manager_id = auth.uid() or (pr.team_id is not null and public.is_manager_sector(pr.team_id)))
      )
    )
  group by p.agent_id, pr.full_name, pt.id, pt.code, pt.label
  order by pr.full_name, pt.label;
end;
$$;

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
      or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
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
        or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
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
          or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
        )
      )
    )
  order by pr.full_name;
end;
$$;

create or replace function public.list_agent_login_history(
  p_agent_id uuid,
  p_limit int default 30,
  p_offset int default 0
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
          or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
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
  order by us.login_at desc
  offset greatest(p_offset, 0)
  limit case when p_limit is null or p_limit <= 0 then 30 else p_limit end;
end;
$$;

alter table public.profiles enable row level security;
alter table public.sectors enable row level security;
alter table public.pause_types enable row level security;
alter table public.pauses enable row level security;
alter table public.pause_notifications enable row level security;
alter table public.pause_schedules enable row level security;
alter table public.user_sessions enable row level security;
alter table public.manager_sectors enable row level security;

-- Profiles policies
drop policy if exists "Profiles: select own or manager/admin" on public.profiles;
drop policy if exists "Profiles: update own or admin" on public.profiles;
drop policy if exists "Profiles: admin insert" on public.profiles;
drop policy if exists "Profiles: admin delete" on public.profiles;

create policy "Profiles: select own or manager/admin"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and role = 'AGENTE'
      and (
        manager_id = auth.uid()
        or (team_id is not null and public.is_manager_sector(team_id))
      )
    )
  );

create policy "Profiles: update own or admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_admin(auth.uid()))
  with check (id = auth.uid() or public.is_admin(auth.uid()));

create policy "Profiles: admin insert"
  on public.profiles for insert
  with check (public.is_admin(auth.uid()));

create policy "Profiles: admin delete"
  on public.profiles for delete
  using (public.is_admin(auth.uid()));

-- Pause types policies
drop policy if exists "Pause types: select authenticated" on public.pause_types;
drop policy if exists "Pause types: admin write" on public.pause_types;
drop policy if exists "Pause types: admin update" on public.pause_types;
drop policy if exists "Pause types: admin delete" on public.pause_types;

create policy "Pause types: select authenticated"
  on public.pause_types for select
  using (auth.role() = 'authenticated');

create policy "Pause types: admin write"
  on public.pause_types for insert
  with check (public.is_admin(auth.uid()));

create policy "Pause types: admin update"
  on public.pause_types for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Pause types: admin delete"
  on public.pause_types for delete
  using (public.is_admin(auth.uid()));

-- Sectors policies
drop policy if exists "Sectors: select authenticated" on public.sectors;
drop policy if exists "Sectors: admin write" on public.sectors;
drop policy if exists "Sectors: admin update" on public.sectors;
drop policy if exists "Sectors: admin delete" on public.sectors;

create policy "Sectors: select authenticated"
  on public.sectors for select
  using (auth.role() = 'authenticated');

create policy "Sectors: admin write"
  on public.sectors for insert
  with check (public.is_admin(auth.uid()));

create policy "Sectors: admin update"
  on public.sectors for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Sectors: admin delete"
  on public.sectors for delete
  using (public.is_admin(auth.uid()));

-- Manager sectors policies
drop policy if exists "Manager sectors: select own/admin" on public.manager_sectors;
drop policy if exists "Manager sectors: admin write" on public.manager_sectors;
drop policy if exists "Manager sectors: admin update" on public.manager_sectors;
drop policy if exists "Manager sectors: admin delete" on public.manager_sectors;

create policy "Manager sectors: select own/admin"
  on public.manager_sectors for select
  using (
    public.is_admin(auth.uid())
    or manager_id = auth.uid()
  );

create policy "Manager sectors: admin write"
  on public.manager_sectors for insert
  with check (public.is_admin(auth.uid()));

create policy "Manager sectors: admin update"
  on public.manager_sectors for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Manager sectors: admin delete"
  on public.manager_sectors for delete
  using (public.is_admin(auth.uid()));

-- Pauses policies
drop policy if exists "Pauses: agent insert" on public.pauses;
drop policy if exists "Pauses: select by role" on public.pauses;
drop policy if exists "Pauses: agent end own active" on public.pauses;

create policy "Pauses: agent insert"
  on public.pauses for insert
  with check (
    (public.current_role() = 'AGENTE' and agent_id = auth.uid())
    or public.is_admin(auth.uid())
  );

create policy "Pauses: select by role"
  on public.pauses for select
  using (
    public.is_admin(auth.uid())
    or (public.is_manager(auth.uid()) and exists (
      select 1 from public.profiles pr
      where pr.id = pauses.agent_id
        and (pr.manager_id = auth.uid() or (pr.team_id is not null and public.is_manager_sector(pr.team_id)))
    ))
    or (public.current_role() = 'AGENTE' and agent_id = auth.uid())
  );

create policy "Pauses: agent end own active"
  on public.pauses for update
  using (
    (public.current_role() = 'AGENTE' and agent_id = auth.uid() and ended_at is null)
    or public.is_admin(auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or agent_id = auth.uid()
  );

-- Pause notifications policies
drop policy if exists "Pause notifications: manager select" on public.pause_notifications;
drop policy if exists "Pause notifications: manager insert" on public.pause_notifications;
drop policy if exists "Pause notifications: manager update" on public.pause_notifications;

create policy "Pause notifications: manager select"
  on public.pause_notifications for select
  using (
    public.is_manager(auth.uid())
    and manager_id = auth.uid()
  );

create policy "Pause notifications: manager insert"
  on public.pause_notifications for insert
  with check (
    public.is_manager(auth.uid())
    and manager_id = auth.uid()
    and exists (
      select 1
      from public.pauses p
      join public.profiles pr on pr.id = p.agent_id
      where p.id = pause_id
        and (
          pr.manager_id = auth.uid()
          or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
        )
    )
  );

-- Pause schedules policies
drop policy if exists "Pause schedules: select admin/manager" on public.pause_schedules;
drop policy if exists "Pause schedules: insert admin/manager" on public.pause_schedules;
drop policy if exists "Pause schedules: update admin/manager" on public.pause_schedules;
drop policy if exists "Pause schedules: delete admin/manager" on public.pause_schedules;

create policy "Pause schedules: select admin/manager"
  on public.pause_schedules for select
  using (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
          )
      )
    )
  );

create policy "Pause schedules: select own agent"
  on public.pause_schedules for select
  using (
    public.current_role() = 'AGENTE'
    and agent_id = auth.uid()
  );

create policy "Pause schedules: insert admin/manager"
  on public.pause_schedules for insert
  with check (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
          )
      )
    )
  );

create policy "Pause schedules: update admin/manager"
  on public.pause_schedules for update
  using (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
          )
      )
    )
  )
  with check (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
          )
      )
    )
  );

create policy "Pause schedules: delete admin/manager"
  on public.pause_schedules for delete
  using (
    public.is_admin(auth.uid())
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
          )
      )
    )
  );

create policy "Pause notifications: manager update"
  on public.pause_notifications for update
  using (
    public.is_manager(auth.uid())
    and manager_id = auth.uid()
  )
  with check (
    public.is_manager(auth.uid())
    and manager_id = auth.uid()
    and exists (
      select 1
      from public.pauses p
      join public.profiles pr on pr.id = p.agent_id
      where p.id = pause_id
        and (
          pr.manager_id = auth.uid()
          or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
        )
    )
  );

-- User sessions policies
drop policy if exists "User sessions: select own/admin/manager" on public.user_sessions;
drop policy if exists "User sessions: insert own" on public.user_sessions;
drop policy if exists "User sessions: update own/admin" on public.user_sessions;

create policy "User sessions: select own/admin/manager"
  on public.user_sessions for select
  using (
    public.is_admin(auth.uid())
    or user_id = auth.uid()
    or (
      public.is_manager(auth.uid())
      and exists (
        select 1
        from public.profiles pr
        where pr.id = user_sessions.user_id
          and (
            pr.manager_id = auth.uid()
            or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
          )
      )
    )
  );

create policy "User sessions: insert own"
  on public.user_sessions for insert
  with check (user_id = auth.uid());

create policy "User sessions: update own/admin"
  on public.user_sessions for update
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

grant execute on function public.start_pause(text) to authenticated;
grant execute on function public.end_pause(text) to authenticated;
grant execute on function public.list_dashboard(date, date, uuid, uuid, uuid) to authenticated;
grant execute on function public.list_late_pauses(timestamptz, int) to authenticated;
grant execute on function public.mark_late_pauses_as_read(timestamptz) to authenticated;
grant execute on function public.list_agent_logins() to authenticated;
grant execute on function public.list_agent_login_history(uuid, int, int) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_sessions'
  ) then
    alter publication supabase_realtime add table public.user_sessions;
  end if;
end $$;

insert into public.pause_types (code, label)
values
  ('LANCHE', 'Lanche'),
  ('ALMOCO', 'Almoco'),
  ('BANHEIRO', 'Banheiro')
on conflict (code) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pause_notifications'
  ) then
    alter publication supabase_realtime add table public.pause_notifications;
  end if;
end $$;

