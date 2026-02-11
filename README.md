# Sistema de Pausas

Sistema completo de "Controle de Pausas de Agentes" com Vite + React + Tailwind + Supabase.

## Stack
- Front-end: Vite + React + React Router
- UI: Tailwind
- Auth/DB: Supabase (Postgres + RLS)
- Exportacao: CSV

## Setup rapido (Supabase Cloud)
1. Instale dependencias
```
npm install
```

2. Configure env
```
cp .env.example .env
```
Edite `.env` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

3. Crie o schema no Supabase
- Abra o SQL Editor do Supabase.
- Execute `supabase/schema.sql`.

4. Crie o primeiro usuario ADMIN
- Crie um usuario no Supabase Auth (dashboard).
- Insira o profile:
```
insert into public.profiles (id, full_name, role)
values ('<uuid-do-usuario>', 'Admin Principal', 'ADMIN');
```

5. (Opcional, recomendado) Deploy da Edge Function de criacao de usuarios
- A tela `/admin` usa a Edge Function `admin-create-user` para criar usuarios com senha.
- Configure as secrets:
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```
- Deploy:
```
supabase functions deploy admin-create-user
supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
```

6. Rode o projeto
```
npm run dev
```

## Setup com Supabase CLI (local)
1. Ajuste `supabase/config.toml`
- Defina `project_id` (ref do projeto).
- Revise `auth.site_url` e `additional_redirect_urls`.

2. Configure as variaveis das Edge Functions
```
cp supabase/.env.example supabase/.env
```

3. Suba o stack local
```
supabase start
```

4. Execute migrations
```
supabase db reset
```

## Rotas
- `/login` (publica)
- `/agent` (AGENTE)
- `/manager` (GERENTE, ADMIN)
- `/admin` (ADMIN)
- `/reports` (GERENTE, ADMIN)
- `/unauthorized`

## Observacoes
- O banco garante **apenas 1 pausa ativa** por agente com indice parcial.
- O contador do agente eh reconstruido a partir da pausa ativa armazenada no banco.
- O dashboard usa RPC `list_dashboard` com filtros de periodo.
- Exportacao CSV disponivel em `/reports`.