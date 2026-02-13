-- Migration: add tolerance columns to pause types
alter table public.pause_types
  add column if not exists tolerance_start_minutes int null,
  add column if not exists tolerance_end_minutes int null;
