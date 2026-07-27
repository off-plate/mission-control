-- Mission Control database schema.
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- Single user, but behind a real login. The whole app state is one JSON row per
-- account, and that row is readable only by the account that owns it. The anon
-- key ships inside the page, so anything the anon role can read is public: that
-- is why the anon policy is gone and every policy below is scoped to auth.uid().

create table if not exists mc_state (
  id         text primary key,
  owner      uuid references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table mc_state add column if not exists owner uuid references auth.users (id) on delete cascade;

alter table mc_state enable row level security;

-- The open policy this table used to run under. Anyone holding the key in the
-- page could read the lot; dropping it is the point of this migration.
drop policy if exists mc_state_anon_all on mc_state;

drop policy if exists mc_state_own on mc_state;
create policy mc_state_own
  on mc_state
  for all
  to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- The old unowned row from before login existed. Nobody can read it now, and
-- every device still holds the same state locally, so it is dead weight.
delete from mc_state where owner is null;

-- One last thing, in the dashboard rather than here: Authentication ->
-- Providers -> Email is what sends the sign-in link, and once you are in,
-- Authentication -> Sign In / Up -> "Allow new users to sign up" can go off.
-- A stranger who signed up would only ever see their own empty row, but there
-- is no reason to leave the door open.
