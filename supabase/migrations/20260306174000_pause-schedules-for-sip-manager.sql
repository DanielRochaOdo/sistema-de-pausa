-- Migration: allow GESTOR_SIP to manage pause schedules for AGENTE_SIP

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
    or (
      public.current_role() = 'GESTOR_SIP'
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and pr.role = 'AGENTE_SIP'
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
    or (
      public.current_role() = 'GESTOR_SIP'
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and pr.role = 'AGENTE_SIP'
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
    or (
      public.current_role() = 'GESTOR_SIP'
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and pr.role = 'AGENTE_SIP'
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
    or (
      public.current_role() = 'GESTOR_SIP'
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and pr.role = 'AGENTE_SIP'
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
    or (
      public.current_role() = 'GESTOR_SIP'
      and exists (
        select 1
        from public.profiles pr
        where pr.id = pause_schedules.agent_id
          and pr.role = 'AGENTE_SIP'
      )
    )
  );
