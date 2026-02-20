-- Migration: store machine IP on pauses

alter table public.pauses
  add column if not exists machine_ip text null;

create or replace function public.start_pause(pause_code text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_pause_type_id uuid;
  v_existing uuid;
  v_pause_id uuid;
  v_headers json;
  v_forwarded text;
  v_ip text;
begin
  v_role := public.current_role();
  if v_role <> 'AGENTE' then
    raise exception 'not_allowed';
  end if;

  select id into v_pause_type_id
  from public.pause_types
  where code = pause_code and is_active = true;

  if v_pause_type_id is null then
    raise exception 'invalid_pause_type';
  end if;

  select id into v_existing
  from public.pauses
  where agent_id = auth.uid() and ended_at is null;

  if v_existing is not null then
    raise exception 'pause_already_active';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      v_headers := null;
  end;
  if v_headers is not null then
    v_forwarded := trim(both ' ' from split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1));
    if v_forwarded <> '' then
      v_ip := v_forwarded;
    end if;
    if v_ip is null or v_ip = '' then
      v_ip := nullif(coalesce(v_headers->>'x-real-ip', ''), '');
    end if;
    if v_ip is null or v_ip = '' then
      v_ip := nullif(coalesce(v_headers->>'cf-connecting-ip', ''), '');
    end if;
  end if;

  if v_ip is null or v_ip = '' then
    v_ip := inet_client_addr()::text;
  end if;

  insert into public.pauses(agent_id, pause_type_id, machine_ip)
  values (auth.uid(), v_pause_type_id, v_ip)
  returning id into v_pause_id;

  return v_pause_id;
end;
$$;
