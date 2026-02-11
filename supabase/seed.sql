-- Seed: 2 managers with 3 agents each
-- Password for all users: 131045

insert into public.sectors (id, code, label, is_active)
values
  ('30000000-0000-0000-0000-000000000001', 'SETOR1', 'Setor 1', true),
  ('30000000-0000-0000-0000-000000000002', 'SETOR2', 'Setor 2', true)
on conflict (id) do nothing;

do $$
declare
  v_instance_id uuid := (select id from auth.instances limit 1);
begin
  if v_instance_id is null then
    raise exception 'auth.instances is empty';
  end if;

  -- Managers
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, created_at, updated_at
  ) values
    (
      '10000000-0000-0000-0000-000000000001',
      v_instance_id,
      'authenticated',
      'authenticated',
      'gerente1@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'gerente1'),
      jsonb_build_object('role', 'GERENTE'),
      now(),
      now()
    ),
    (
      '20000000-0000-0000-0000-000000000002',
      v_instance_id,
      'authenticated',
      'authenticated',
      'gerente2@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'gerente2'),
      jsonb_build_object('role', 'GERENTE'),
      now(),
      now()
    )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values
    (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      jsonb_build_object('sub', '10000000-0000-0000-0000-000000000001', 'email', 'gerente1@seed.local'),
      'email',
      now(),
      now(),
      now()
    ),
    (
      '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000002',
      jsonb_build_object('sub', '20000000-0000-0000-0000-000000000002', 'email', 'gerente2@seed.local'),
      'email',
      now(),
      now(),
      now()
    )
  on conflict (id) do nothing;

  -- Agents under gerente1
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, created_at, updated_at
  ) values
    (
      '10000000-0000-0000-0000-000000000101',
      v_instance_id,
      'authenticated',
      'authenticated',
      'ag_gerente1_g1@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'ag_gerente1'),
      jsonb_build_object('role', 'AGENTE'),
      now(),
      now()
    ),
    (
      '10000000-0000-0000-0000-000000000102',
      v_instance_id,
      'authenticated',
      'authenticated',
      'ag_gerente2_g1@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'ag_gerente2'),
      jsonb_build_object('role', 'AGENTE'),
      now(),
      now()
    ),
    (
      '10000000-0000-0000-0000-000000000103',
      v_instance_id,
      'authenticated',
      'authenticated',
      'ag_gerente3_g1@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'ag_gerente3'),
      jsonb_build_object('role', 'AGENTE'),
      now(),
      now()
    )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values
    (
      '10000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000101',
      jsonb_build_object('sub', '10000000-0000-0000-0000-000000000101', 'email', 'ag_gerente1_g1@seed.local'),
      'email',
      now(),
      now(),
      now()
    ),
    (
      '10000000-0000-0000-0000-000000000102',
      '10000000-0000-0000-0000-000000000102',
      jsonb_build_object('sub', '10000000-0000-0000-0000-000000000102', 'email', 'ag_gerente2_g1@seed.local'),
      'email',
      now(),
      now(),
      now()
    ),
    (
      '10000000-0000-0000-0000-000000000103',
      '10000000-0000-0000-0000-000000000103',
      jsonb_build_object('sub', '10000000-0000-0000-0000-000000000103', 'email', 'ag_gerente3_g1@seed.local'),
      'email',
      now(),
      now(),
      now()
    )
  on conflict (id) do nothing;

  -- Agents under gerente2
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, created_at, updated_at
  ) values
    (
      '20000000-0000-0000-0000-000000000101',
      v_instance_id,
      'authenticated',
      'authenticated',
      'ag_gerente1_g2@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'ag_gerente1'),
      jsonb_build_object('role', 'AGENTE'),
      now(),
      now()
    ),
    (
      '20000000-0000-0000-0000-000000000102',
      v_instance_id,
      'authenticated',
      'authenticated',
      'ag_gerente2_g2@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'ag_gerente2'),
      jsonb_build_object('role', 'AGENTE'),
      now(),
      now()
    ),
    (
      '20000000-0000-0000-0000-000000000103',
      v_instance_id,
      'authenticated',
      'authenticated',
      'ag_gerente3_g2@seed.local',
      crypt('131045', gen_salt('bf')),
      now(),
      jsonb_build_object('full_name', 'ag_gerente3'),
      jsonb_build_object('role', 'AGENTE'),
      now(),
      now()
    )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values
    (
      '20000000-0000-0000-0000-000000000101',
      '20000000-0000-0000-0000-000000000101',
      jsonb_build_object('sub', '20000000-0000-0000-0000-000000000101', 'email', 'ag_gerente1_g2@seed.local'),
      'email',
      now(),
      now(),
      now()
    ),
    (
      '20000000-0000-0000-0000-000000000102',
      '20000000-0000-0000-0000-000000000102',
      jsonb_build_object('sub', '20000000-0000-0000-0000-000000000102', 'email', 'ag_gerente2_g2@seed.local'),
      'email',
      now(),
      now(),
      now()
    ),
    (
      '20000000-0000-0000-0000-000000000103',
      '20000000-0000-0000-0000-000000000103',
      jsonb_build_object('sub', '20000000-0000-0000-0000-000000000103', 'email', 'ag_gerente3_g2@seed.local'),
      'email',
      now(),
      now(),
      now()
    )
  on conflict (id) do nothing;
end $$;

-- Link agents to their managers
update public.profiles
set manager_id = '10000000-0000-0000-0000-000000000001'
where id in (
  '10000000-0000-0000-0000-000000000101',
  '10000000-0000-0000-0000-000000000102',
  '10000000-0000-0000-0000-000000000103'
);

update public.profiles
set manager_id = '20000000-0000-0000-0000-000000000002'
where id in (
  '20000000-0000-0000-0000-000000000101',
  '20000000-0000-0000-0000-000000000102',
  '20000000-0000-0000-0000-000000000103'
);

-- Link managers and agents to their sectors
update public.profiles
set team_id = '30000000-0000-0000-0000-000000000001'
where id in (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000101',
  '10000000-0000-0000-0000-000000000102',
  '10000000-0000-0000-0000-000000000103'
);

update public.profiles
set team_id = '30000000-0000-0000-0000-000000000002'
where id in (
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000101',
  '20000000-0000-0000-0000-000000000102',
  '20000000-0000-0000-0000-000000000103'
);
