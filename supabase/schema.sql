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

-- Outreach emails, read from his Gmail by a Google Apps Script
-- (tools/outreach-gmail.gs) through the outreach-ingest function. One row per
-- message to or from a prospect. The app turns unapplied rows into touches on
-- the matching prospect, then stamps applied_at. Only the function inserts
-- (service role); he can read and stamp his own rows.
create table if not exists mc_outreach_events (
  id          text primary key,          -- Gmail message id
  owner       uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('sent', 'reply')),
  via         text,                      -- 'offplate' alias or 'personal' address, sent only
  day         date not null,
  counterpart text not null,             -- the prospect's address, lower case
  subject     text,
  body        text,
  applied_at  timestamptz,
  created_at  timestamptz not null default now()
);
-- /eco-sync (Jarvis) reads the step from the subject and wording itself, and names the
-- business's domain so a freemail address still finds its card.
alter table mc_outreach_events add column if not exists step   text check (step in ('work', 'reminder', 'personal'));
alter table mc_outreach_events add column if not exists domain text;

alter table mc_outreach_events enable row level security;

drop policy if exists mc_outreach_events_read on mc_outreach_events;
create policy mc_outreach_events_read
  on mc_outreach_events for select to authenticated
  using (owner = auth.uid());

drop policy if exists mc_outreach_events_stamp on mc_outreach_events;
create policy mc_outreach_events_stamp
  on mc_outreach_events for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- The Off-Plate Prospects Sheet, every tab (2026-10-13). /eco-sync (Jarvis) sends
-- the whole Sheet through outreach-ingest, which keeps one snapshot per owner.
-- The app applies it to People > Business (prospectcalc applySheet) and stamps
-- applied_at; a new /eco-sync run clears the stamp. Only the function writes
-- rows (service role); he can read and stamp his own.
create table if not exists mc_prospect_sheet (
  owner      uuid primary key references auth.users (id) on delete cascade,
  rows       jsonb not null,
  synced_at  timestamptz not null default now(),
  applied_at timestamptz
);

alter table mc_prospect_sheet enable row level security;

drop policy if exists mc_prospect_sheet_read on mc_prospect_sheet;
create policy mc_prospect_sheet_read
  on mc_prospect_sheet for select to authenticated
  using (owner = auth.uid());

drop policy if exists mc_prospect_sheet_stamp on mc_prospect_sheet;
create policy mc_prospect_sheet_stamp
  on mc_prospect_sheet for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());
