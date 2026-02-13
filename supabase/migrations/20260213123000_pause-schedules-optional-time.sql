-- Migration: allow pause schedules without time (e.g. Banheiro)
alter table public.pause_schedules
  alter column scheduled_time drop not null;
