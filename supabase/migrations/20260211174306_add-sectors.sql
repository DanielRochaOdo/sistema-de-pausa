-- Migration: add sectors and pause limits + atraso

drop function if exists public.list_dashboard(date, date, uuid, uuid);

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

alter table public.pause_types
  add column if not exists limit_minutes int null;

alter table public.pauses
  add column if not exists atraso boolean default false;

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

  select pt.limit_minutes into v_limit_minutes
  from public.pauses p
  join public.pause_types pt on pt.id = p.pause_type_id
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

  return v_pause_id;
end;
$$;

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
        and (pr.manager_id = auth.uid() or (pr.team_id is not null and pr.team_id = public.current_team_id()))
      )
    )
  group by p.agent_id, pr.full_name, pt.id, pt.code, pt.label
  order by pr.full_name, pt.label;
end;
$$;

alter table public.sectors enable row level security;

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