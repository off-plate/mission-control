-- Claude brain mailbox (2026-11-07).
-- Mission Control cannot reach his Mac from a browser or a phone, so a long
-- dictation is dropped here, the daemon on the Mac (tools/claude-brain.mjs)
-- picks it up, asks `claude -p`, and writes the answer back. The app deletes
-- the row once it has read the answer; the daemon prunes anything left behind.
--
-- Own table, mc_ prefix (the Supabase project is shared with other apps).
-- Every row is owned and scoped to auth.uid(), same rule as mc_state and
-- mc_mymind: nothing here is readable without his session. The daemon signs in
-- as him with the emailed code, so there is no service key anywhere.
-- Idempotent: safe to run twice.

create table if not exists mc_brain (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  -- 'ask' is a request. 'beat' is the single heartbeat row the daemon touches
  -- every 30 seconds, so the app can tell whether the Mac is awake.
  kind        text not null default 'ask' check (kind in ('ask', 'beat')),
  status      text not null default 'queued' check (status in ('queued', 'working', 'done', 'error')),
  model       text not null default 'claude-haiku-5-5',
  request     jsonb,
  reply       text,
  error       text,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  finished_at timestamptz,
  beat_at     timestamptz
);

create unique index if not exists mc_brain_beat_one on mc_brain (owner) where kind = 'beat';
create index if not exists mc_brain_queue on mc_brain (owner, status, created_at) where kind = 'ask';

alter table mc_brain enable row level security;
drop policy if exists mc_brain_own on mc_brain;
create policy mc_brain_own on mc_brain for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
