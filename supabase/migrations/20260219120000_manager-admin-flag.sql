-- Migration: allow managers to be admins

alter table public.profiles
  add column if not exists is_admin boolean default false;

create or replace function public.is_admin(p_uid uuid)
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
      and (role = 'ADMIN' or is_admin = true)
  );
$$;

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

  if public.is_admin(auth.uid()) then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.manager_id is distinct from old.manager_id
     or new.team_id is distinct from old.team_id
     or new.is_admin is distinct from old.is_admin then
    raise exception 'not_allowed';
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
