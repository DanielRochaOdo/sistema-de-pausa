-- Supabase schema for Controle de Pausas

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('ADMIN', 'GERENTE', 'AGENTE')),
  team_id uuid null,
  manager_id uuid null,
  created_at timestamptz default now()
);

alter table public.profiles drop constraint if exists profiles_manager_fk;

alter table public.profiles
  add constraint profiles_manager_fk
  foreign key (manager_id) references public.profiles(id) on delete set null;

create table if not exists public.pause_types (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text not null,
  is_active boolean default true
);

create table if not exists public.pauses (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  pause_type_id uuid not null references public.pause_types(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  duration_seconds int null,
  notes text null,
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
  select coalesce(auth.jwt()->'app_metadata'->>'role', 'AGENTE');
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Novo usuario'),
    case
      when new.raw_app_meta_data->>'role' in ('ADMIN', 'GERENTE', 'AGENTE')
        then new.raw_app_meta_data->>'role'
      else 'AGENTE'
    end
  )
  on conflict (id) do nothing;
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

  update public.pauses
  set ended_at = now(),
      duration_seconds = v_duration,
      notes = coalesce(p_notes, notes)
  where id = v_pause_id;

  return v_pause_id;
end;
$$;

drop function if exists public.list_dashboard(date, date, uuid, uuid);

create or replace function public.list_dashboard(
  p_from date,
  p_to date,
  p_agent_id uuid default null,
  p_pause_type_id uuid default null
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
    and (
      v_role = 'ADMIN'
      or (
        v_role = 'GERENTE'
        and (pr.manager_id = auth.uid() or (pr.team_id is not null and pr.team_id = public.current_team_id()))
      )
    )
  group by p.agent_id, pr.full_name, pt.id, pt.code, pt.label
  order by pr.full_name, pt.label;
end;
$$;

alter table public.profiles enable row level security;
alter table public.pause_types enable row level security;
alter table public.pauses enable row level security;

-- Profiles policies
drop policy if exists "Profiles: select own or manager/admin" on public.profiles;
drop policy if exists "Profiles: update own or admin" on public.profiles;
drop policy if exists "Profiles: admin insert" on public.profiles;
drop policy if exists "Profiles: admin delete" on public.profiles;

create policy "Profiles: select own or manager/admin"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.current_role() = 'ADMIN'
    or (
      public.current_role() = 'GERENTE'
      and role = 'AGENTE'
      and (
        manager_id = auth.uid()
        or (team_id is not null and team_id = public.current_team_id())
      )
    )
  );

create policy "Profiles: update own or admin"
  on public.profiles for update
  using (id = auth.uid() or public.current_role() = 'ADMIN')
  with check (id = auth.uid() or public.current_role() = 'ADMIN');

create policy "Profiles: admin insert"
  on public.profiles for insert
  with check (public.current_role() = 'ADMIN');

create policy "Profiles: admin delete"
  on public.profiles for delete
  using (public.current_role() = 'ADMIN');

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
  with check (public.current_role() = 'ADMIN');

create policy "Pause types: admin update"
  on public.pause_types for update
  using (public.current_role() = 'ADMIN')
  with check (public.current_role() = 'ADMIN');

create policy "Pause types: admin delete"
  on public.pause_types for delete
  using (public.current_role() = 'ADMIN');

-- Pauses policies
drop policy if exists "Pauses: agent insert" on public.pauses;
drop policy if exists "Pauses: select by role" on public.pauses;
drop policy if exists "Pauses: agent end own active" on public.pauses;

create policy "Pauses: agent insert"
  on public.pauses for insert
  with check (agent_id = auth.uid() and public.current_role() = 'AGENTE');

create policy "Pauses: select by role"
  on public.pauses for select
  using (
    public.current_role() = 'ADMIN'
    or (public.current_role() = 'GERENTE' and exists (
      select 1 from public.profiles pr
      where pr.id = pauses.agent_id
        and (pr.manager_id = auth.uid() or (pr.team_id is not null and pr.team_id = public.current_team_id()))
    ))
    or (public.current_role() = 'AGENTE' and agent_id = auth.uid())
  );

create policy "Pauses: agent end own active"
  on public.pauses for update
  using (
    (public.current_role() = 'AGENTE' and agent_id = auth.uid() and ended_at is null)
    or public.current_role() = 'ADMIN'
  )
  with check (
    public.current_role() = 'ADMIN'
    or agent_id = auth.uid()
  );

grant execute on function public.start_pause(text) to authenticated;
grant execute on function public.end_pause(text) to authenticated;
grant execute on function public.list_dashboard(date, date, uuid, uuid) to authenticated;

insert into public.pause_types (code, label)
values
  ('LANCHE', 'Lanche'),
  ('ALMOCO', 'Almoco'),
  ('BANHEIRO', 'Banheiro')
on conflict (code) do nothing;
