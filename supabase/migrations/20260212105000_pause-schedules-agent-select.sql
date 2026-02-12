-- Migration: allow agent to view own pause schedules

drop policy if exists "Pause schedules: select own agent" on public.pause_schedules;

create policy "Pause schedules: select own agent"
  on public.pause_schedules for select
  using (
    public.current_role() = 'AGENTE'
    and agent_id = auth.uid()
  );