-- MyMind: everything he shares into Mission Control (2026-10-28).
-- Own table and private file bucket, like Bills; not inside the mc_state blob.
-- Writes come from the `mymind` edge function (service role) and from the signed-in app.

create table if not exists mc_mymind (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('link', 'image', 'text')),
  url         text,
  url_key     text,
  title       text not null default '',
  site        text not null default '',
  description text not null default '',
  body        text not null default '',
  note        text not null default '',
  image_path  text,
  via         text not null default '',
  created_at  timestamptz not null default now(),
  trashed_at  timestamptz
);

create unique index if not exists mc_mymind_owner_urlkey on mc_mymind (owner, url_key) where url_key is not null;
create index if not exists mc_mymind_owner_created on mc_mymind (owner, created_at desc);

alter table mc_mymind enable row level security;
drop policy if exists mc_mymind_own on mc_mymind;
create policy mc_mymind_own on mc_mymind for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

insert into storage.buckets (id, name, public) values ('mymind', 'mymind', false) on conflict (id) do nothing;
drop policy if exists mymind_files_read on storage.objects;
create policy mymind_files_read on storage.objects for select to authenticated
  using (bucket_id = 'mymind' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists mymind_files_delete on storage.objects;
create policy mymind_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'mymind' and (storage.foldername(name))[1] = auth.uid()::text);

-- Live updates for the MyMind page (2026-10-28): new saves from the phone appear without a refresh.
alter publication supabase_realtime add table mc_mymind;
