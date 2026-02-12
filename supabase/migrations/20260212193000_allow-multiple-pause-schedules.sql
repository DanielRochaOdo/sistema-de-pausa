-- Migration: allow multiple pause schedules per agent and type

drop index if exists pause_schedules_agent_type_unique;
