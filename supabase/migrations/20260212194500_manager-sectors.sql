-- Migration: allow managers to have multiple sectors

create table if not exists public.manager_sectors (
  manager_id uuid not null references public.profiles(id) on delete cascade,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (manager_id, sector_id)
);

create index if not exists manager_sectors_sector_idx
  on public.manager_sectors(sector_id);

alter table public.manager_sectors enable row level security;

drop policy if exists "Manager sectors: select own/admin" on public.manager_sectors;
drop policy if exists "Manager sectors: admin write" on public.manager_sectors;

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

insert into public.manager_sectors (manager_id, sector_id)
select id, team_id
from public.profiles
where role = 'GERENTE'
  and team_id is not null
on conflict do nothing;

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

drop trigger if exists profiles_sync_manager_sectors on public.profiles;
create trigger profiles_sync_manager_sectors
  after insert or update of role, team_id on public.profiles
  for each row execute procedure public.sync_manager_primary_sector();

-- Update profiles select policy for multi-sector managers
drop policy if exists "Profiles: select own or manager/admin" on public.profiles;
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

-- Update pauses select policy
drop policy if exists "Pauses: select by role" on public.pauses;
create policy "Pauses: select by role"
  on public.pauses for select
  using (
    public.is_admin(auth.uid())
    or (public.is_manager(auth.uid()) and exists (
      select 1 from public.profiles pr
      where pr.id = pauses.agent_id
        and (
          pr.manager_id = auth.uid()
          or (pr.team_id is not null and public.is_manager_sector(pr.team_id))
        )
    ))
    or (public.current_role() = 'AGENTE' and agent_id = auth.uid())
  );

-- Update pause notifications policies
drop policy if exists "Pause notifications: manager insert" on public.pause_notifications;
drop policy if exists "Pause notifications: manager update" on public.pause_notifications;

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

-- Update pause schedules policies
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

-- Update user sessions policy
drop policy if exists "User sessions: select own/admin/manager" on public.user_sessions;
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

-- Replace end_pause to notify managers by manager_sectors
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

-- Replace list_dashboard for multi-sector managers
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

-- Replace list_late_pauses for multi-sector managers
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

-- Replace mark_late_pauses_as_read for multi-sector managers
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

-- Replace list_agent_logins for multi-sector managers
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

-- Replace list_agent_login_history for multi-sector managers
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
