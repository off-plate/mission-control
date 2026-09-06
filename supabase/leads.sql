-- Sourced leads, synced. Run once; it is safe to re-run.
--
-- Leads do NOT go in mc_state. That table is one JSON row holding the whole app state, mirrored
-- into a ~5 MB localStorage quota, and 8 752 leads are 4.6 MB on their own: measured, two markets
-- filled it and a third import did not survive a reload. They get their own table so the state row
-- stays small and every device sees the same leads.
--
-- The anon key ships inside the page, so anything the anon role can read is public. Every policy
-- below is scoped to auth.uid(), the same rule mc_state already follows.

create table if not exists mc_leads (
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  place_key  text not null,
  name       text not null,
  phone      text,
  email      text,
  lead       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, place_key)
);

-- The offer catalogue: a dozen rows covering every market, held once rather than on every lead.
create table if not exists mc_lead_offers (
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        text not null,
  offer      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);

alter table mc_leads       enable row level security;
alter table mc_lead_offers enable row level security;

drop policy if exists mc_leads_own on mc_leads;
create policy mc_leads_own on mc_leads
  for all using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists mc_lead_offers_own on mc_lead_offers;
create policy mc_lead_offers_own on mc_lead_offers
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- The list is worked in score order, filtered by market and by whether there is a number to ring.
create index if not exists mc_leads_owner_score
  on mc_leads (owner, ((lead ->> 'score')::int) desc);
