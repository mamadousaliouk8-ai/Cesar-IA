create table if not exists public.calendar_events (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null default 'chronos',
  day text not null,
  time text not null,
  platform text not null,
  content text not null,
  status text not null default 'draft',
  media_url text,
  media_type text,
  created_at timestamptz not null default now()
);

alter table public.calendar_events enable row level security;

drop policy if exists "Users manage own calendar events" on public.calendar_events;
create policy "Users manage own calendar events"
  on public.calendar_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
