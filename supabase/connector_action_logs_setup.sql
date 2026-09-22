create table if not exists public.connector_action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  agent_name text,
  tool_name text not null,
  connector_name text,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists connector_action_logs_user_id_created_at_idx
  on public.connector_action_logs (user_id, created_at desc);

create index if not exists connector_action_logs_success_idx
  on public.connector_action_logs (success);

alter table public.connector_action_logs enable row level security;

drop policy if exists "Users read own connector action logs" on public.connector_action_logs;
create policy "Users read own connector action logs"
  on public.connector_action_logs for select
  using (auth.uid() = user_id);

-- Les écritures passent uniquement par le backend (clé service_role, qui
-- contourne RLS) : chaque appel d'outil réel est journalisé depuis
-- api/chat.js juste après son exécution, jamais depuis le navigateur.
-- La vue Admin "Santé des connecteurs" lira cette table avec le même accès
-- service_role, tous comptes confondus (à construire à l'étape 2).
