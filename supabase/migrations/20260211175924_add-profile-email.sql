-- Migration: add email to profiles and backfill

alter table public.profiles
  add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and (p.email is null or p.email = '');

create unique index if not exists profiles_email_lower_unique
  on public.profiles (lower(email));

create index if not exists profiles_full_name_lower_idx
  on public.profiles (lower(full_name));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Novo usuario'),
    case
      when new.raw_app_meta_data->>'role' in ('ADMIN', 'GERENTE', 'AGENTE')
        then new.raw_app_meta_data->>'role'
      else 'AGENTE'
    end,
    new.email
  )
  on conflict (id) do update set
    email = excluded.email;
  return new;
end;
$$;