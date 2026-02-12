-- Migration: grants for late pause functions

grant execute on function public.list_late_pauses(timestamptz, int) to authenticated;
grant execute on function public.mark_late_pauses_as_read(timestamptz) to authenticated;