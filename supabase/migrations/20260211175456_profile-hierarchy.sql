-- Migration: enforce profile hierarchy and backfill

-- Ensure default sector exists
insert into public.sectors (code, label, is_active)
select 'GERAL', 'Geral', true
where not exists (select 1 from public.sectors where code = 'GERAL');

-- Admins have no manager nor sector
update public.profiles
set manager_id = null,
    team_id = null
where role = 'ADMIN';

-- Managers have no manager
update public.profiles
set manager_id = null
where role = 'GERENTE' and manager_id is not null;

-- Managers must have sector: assign default when missing
update public.profiles
set team_id = (select id from public.sectors where code = 'GERAL' limit 1)
where role = 'GERENTE' and team_id is null;

-- Agents inherit sector from manager when missing
update public.profiles as agent
set team_id = manager.team_id
from public.profiles as manager
where agent.role = 'AGENTE'
  and agent.manager_id is not null
  and agent.team_id is null
  and manager.id = agent.manager_id;

-- If there is only one manager, assign to agents missing manager
with managers as (
  select id, team_id from public.profiles where role = 'GERENTE'
),
manager_count as (
  select count(*)::int as cnt from managers
),
one_manager as (
  select id, team_id from managers limit 1
)
update public.profiles
set manager_id = (select id from one_manager),
    team_id = coalesce(team_id, (select team_id from one_manager))
where role = 'AGENTE'
  and manager_id is null
  and (select cnt from manager_count) = 1;

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