-- Comptes d'organisation : un compte parent (owner) achète les agents et
-- invite des collaborateurs (member) qui partagent la mémoire/l'historique
-- de l'organisation. L'étanchéité se fait à la frontière de l'organisation
-- (org_id), jamais entre un owner et ses propres members.
--
-- Idempotent : peut être rejoué sans erreur sur une base déjà migrée.

-- =================================================================
-- 1. organizations
-- =================================================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mon organisation',
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

drop policy if exists "Org owner updates their organization" on public.organizations;
create policy "Org owner updates their organization"
  on public.organizations for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- =================================================================
-- 2. profiles : org_id / role / status
-- =================================================================
alter table public.profiles add column if not exists org_id uuid references public.organizations(id);
alter table public.profiles add column if not exists role text not null default 'owner';
alter table public.profiles add column if not exists status text not null default 'active';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'member'));

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active', 'invited', 'disabled'));

-- Backfill : chaque compte existant devient owner de sa propre organisation
-- individuelle (aucun cas particulier "compte individuel" ailleurs dans le code).
insert into public.organizations (id, name, owner_user_id, created_at)
select gen_random_uuid(), coalesce(p.email, 'Compte') || ' — Organisation', p.id, p.created_at
from public.profiles p
where p.org_id is null;

update public.profiles p
set org_id = o.id
from public.organizations o
where p.org_id is null and o.owner_user_id = p.id;

-- =================================================================
-- 3. current_org_id() : brique commune pour toutes les policies RLS,
--    security definer pour éviter la récursion RLS sur profiles.
-- =================================================================
create or replace function public.current_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_org_id() to authenticated;

-- organizations : lecture ouverte à toute l'organisation (nécessite
-- current_org_id(), défini juste au-dessus — d'où cette policy ici plutôt
-- que dans la section 1).
drop policy if exists "Org members read their organization" on public.organizations;
create policy "Org members read their organization"
  on public.organizations for select
  using (id = public.current_org_id());

-- profiles : lecture ouverte à toute l'organisation (liste d'équipe, attribution
-- des messages) ; pas de policy d'écriture client (le trigger + les endpoints
-- serveur avec la clé service_role suffisent, comme pour is_admin aujourd'hui).
drop policy if exists "Org members read profiles in their org" on public.profiles;
create policy "Org members read profiles in their org"
  on public.profiles for select
  using (org_id = public.current_org_id());

-- =================================================================
-- 4. org_invitations : jamais accédée depuis le client (service_role only).
-- =================================================================
create table if not exists public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('member')),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists org_invitations_email_status_idx
  on public.org_invitations (email, status);

alter table public.org_invitations enable row level security;
-- Aucune policy pour anon/authenticated : accès exclusivement via service_role.

-- =================================================================
-- 5. agent_assignments : quels collaborateurs peuvent ouvrir quel agent
--    déjà acheté par l'organisation. Le owner a toujours accès à tout,
--    sans ligne nécessaire (vérifié côté application).
-- =================================================================
create table if not exists public.agent_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id text not null,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (org_id, agent_id, member_user_id)
);

alter table public.agent_assignments enable row level security;

drop policy if exists "Org members read agent assignments in their org" on public.agent_assignments;
create policy "Org members read agent assignments in their org"
  on public.agent_assignments for select
  using (org_id = public.current_org_id());
-- Écriture réservée aux endpoints serveur (owner only, vérifié en application).

-- =================================================================
-- 6. chat_messages, adopted_agents, connectors, account_memory :
--    ajout de org_id, RLS repassée de user_id à org_id.
-- =================================================================
alter table public.chat_messages add column if not exists org_id uuid references public.organizations(id);
alter table public.adopted_agents add column if not exists org_id uuid references public.organizations(id);
alter table public.connectors add column if not exists org_id uuid references public.organizations(id);
alter table public.account_memory add column if not exists org_id uuid references public.organizations(id);

-- Backfill des lignes existantes à partir de l'org du user_id propriétaire.
update public.chat_messages t set org_id = p.org_id from public.profiles p where t.user_id = p.id and t.org_id is null;
update public.adopted_agents t set org_id = p.org_id from public.profiles p where t.user_id = p.id and t.org_id is null;
update public.connectors t set org_id = p.org_id from public.profiles p where t.user_id = p.id and t.org_id is null;
update public.account_memory t set org_id = p.org_id from public.profiles p where t.user_id = p.id and t.org_id is null;

-- L'entitlement (adopted_agents) et l'identifiant de connecteur (connectors)
-- deviennent uniques par ORGANISATION + agent (partagés entre collaborateurs)
-- au lieu de par utilisateur individuel. On retire l'ancienne contrainte
-- par utilisateur si elle existe (nom par défaut généré par Postgres) et on
-- ajoute la nouvelle contrainte par organisation. Comme plusieurs comptes
-- individuels pré-existants pointent vers des organisations distinctes créées
-- au backfill ci-dessus, il ne peut pas déjà exister de doublon (org_id, agent_id)
-- ou (org_id, agent_id, connector_name) à ce stade.
alter table public.adopted_agents drop constraint if exists adopted_agents_user_id_agent_id_key;
alter table public.adopted_agents add constraint adopted_agents_org_id_agent_id_key unique (org_id, agent_id);

alter table public.connectors drop constraint if exists connectors_user_id_agent_id_connector_name_key;
alter table public.connectors add constraint connectors_org_id_agent_id_connector_name_key unique (org_id, agent_id, connector_name);

-- chat_messages
alter table public.chat_messages enable row level security;
drop policy if exists "Users read own chat messages" on public.chat_messages;
drop policy if exists "Org members read org chat messages" on public.chat_messages;
create policy "Org members read org chat messages"
  on public.chat_messages for select
  using (org_id = public.current_org_id());

drop policy if exists "Org members write own chat messages" on public.chat_messages;
create policy "Org members write own chat messages"
  on public.chat_messages for insert
  with check (org_id = public.current_org_id() and user_id = auth.uid());

drop policy if exists "Org members update own chat messages" on public.chat_messages;
create policy "Org members update own chat messages"
  on public.chat_messages for update
  using (org_id = public.current_org_id() and user_id = auth.uid())
  with check (org_id = public.current_org_id() and user_id = auth.uid());

-- adopted_agents (écriture normalement réservée au webhook Stripe / service_role ;
-- on conserve une policy d'insert permissive à l'échelle de l'org pour ne pas
-- casser le chemin d'auto-adoption admin existant côté client).
alter table public.adopted_agents enable row level security;
drop policy if exists "Org members read org adopted agents" on public.adopted_agents;
create policy "Org members read org adopted agents"
  on public.adopted_agents for select
  using (org_id = public.current_org_id());

drop policy if exists "Org members insert org adopted agents" on public.adopted_agents;
create policy "Org members insert org adopted agents"
  on public.adopted_agents for insert
  with check (org_id = public.current_org_id());

-- connectors : partagés à l'échelle de l'organisation (un agent partagé doit
-- garder la même connexion Slack/Notion/... pour tous les collaborateurs).
alter table public.connectors enable row level security;
drop policy if exists "Org members read org connectors" on public.connectors;
create policy "Org members read org connectors"
  on public.connectors for select
  using (org_id = public.current_org_id());

drop policy if exists "Org members write org connectors" on public.connectors;
create policy "Org members write org connectors"
  on public.connectors for insert
  with check (org_id = public.current_org_id());

drop policy if exists "Org members update org connectors" on public.connectors;
create policy "Org members update org connectors"
  on public.connectors for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "Org members delete org connectors" on public.connectors;
create policy "Org members delete org connectors"
  on public.connectors for delete
  using (org_id = public.current_org_id());

-- account_memory : lecture partagée à l'org, écriture toujours réservée au
-- backend (service_role, qui contourne RLS) — inchangé sur ce point.
drop policy if exists "Users read own account memory" on public.account_memory;
drop policy if exists "Org members read org account memory" on public.account_memory;
create policy "Org members read org account memory"
  on public.account_memory for select
  using (org_id = public.current_org_id());

-- invoices : la facturation reste pilotée par le owner (seul à acheter),
-- mais reste lisible par toute l'organisation comme le reste de l'activité.
alter table public.invoices add column if not exists org_id uuid references public.organizations(id);
update public.invoices t set org_id = p.org_id from public.profiles p where t.user_id = p.id and t.org_id is null;

alter table public.invoices enable row level security;
drop policy if exists "Org members read org invoices" on public.invoices;
create policy "Org members read org invoices"
  on public.invoices for select
  using (org_id = public.current_org_id());

-- =================================================================
-- 7. Trigger de création de compte (handle_new_user)
-- =================================================================
-- Le trigger existant sur auth.users appelle public.handle_new_user() par son
-- nom : remplacer le corps de cette fonction (CREATE OR REPLACE) suffit, pas
-- besoin de recréer le trigger lui-même. Comportement d'origine préservé à
-- l'identique (insert profiles avec id/email/is_admin=false), on ajoute
-- uniquement la résolution de l'organisation :
--   - une invitation "pending" existe pour cet email -> le nouveau compte
--     rejoint cette organisation en tant que "member" ;
--   - sinon -> une nouvelle organisation individuelle est créée pour lui,
--     avec le rôle "owner".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_invitation record;
  v_org_id uuid;
  v_role text;
begin
  select * into v_invitation
    from public.org_invitations
    where email = new.email and status = 'pending'
    order by created_at desc
    limit 1;

  if v_invitation.id is not null then
    v_org_id := v_invitation.org_id;
    v_role := 'member';
    update public.org_invitations
      set status = 'accepted', accepted_at = now()
      where id = v_invitation.id;
  else
    insert into public.organizations (owner_user_id, name)
    values (new.id, coalesce(new.email, 'Compte') || ' — Organisation')
    returning id into v_org_id;
    v_role := 'owner';
  end if;

  insert into public.profiles (id, email, is_admin, org_id, role, status)
  values (new.id, new.email, false, v_org_id, v_role, 'active');

  return new;
end;
$function$;
