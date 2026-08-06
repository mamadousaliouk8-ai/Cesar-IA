create table if not exists public.account_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  agent_name text,
  fact text not null,
  created_at timestamptz not null default now()
);

create index if not exists account_memory_user_id_created_at_idx
  on public.account_memory (user_id, created_at desc);

alter table public.account_memory enable row level security;

drop policy if exists "Users read own account memory" on public.account_memory;
create policy "Users read own account memory"
  on public.account_memory for select
  using (auth.uid() = user_id);

-- Les écritures passent uniquement par le backend (clé service_role, qui
-- contourne RLS) : l'extraction de faits se fait après chaque échange côté
-- api/chat.js, jamais directement depuis le navigateur.
