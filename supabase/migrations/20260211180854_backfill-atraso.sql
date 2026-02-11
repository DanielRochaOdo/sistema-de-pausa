-- Backfill atraso for existing pauses

update public.pauses p
set atraso = case
  when pt.limit_minutes is null or pt.limit_minutes <= 0 then false
  else (
    coalesce(p.duration_seconds, extract(epoch from (p.ended_at - p.started_at))::int) > (pt.limit_minutes * 60)
  )
end
from public.pause_types pt
where p.pause_type_id = pt.id
  and p.ended_at is not null;