-- Mission Control database schema.
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- Single-user for now, no login. The entire app state lives as one JSON row.
-- Access is open (anon) on purpose, as agreed, so it "just works" without auth.
-- Before anything sensitive or shared lives here, add login and replace the open
-- policy below with auth-scoped policies. Do NOT put real financial numbers here yet.

create table if not exists mc_state (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table mc_state enable row level security;

-- Open access for the anon key (no auth yet). Replace when you add login.
drop policy if exists mc_state_anon_all on mc_state;
create policy mc_state_anon_all
  on mc_state
  for all
  to anon
  using (true)
  with check (true);
