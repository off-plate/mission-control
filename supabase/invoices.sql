-- Invoices (2026-11-01): Fakturoid rebuilt in Mission Control.
-- Four owner-only tables. The app keeps its offline copy in the state blob and
-- mirrors every row here (src/invoicecloud.ts): newer updated_at wins, a delete
-- is a deleted_at stamp so another device cannot bring the row back.
-- Idempotent: safe to run again on the shared project.

create table if not exists mc_invoice_contacts (
  id          text primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default '',
  ico         text, dic text, street text, city text, zip text, country text,
  email       text, phone text, web text,
  due_days    int,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists mc_invoice_accounts (
  id          text primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label       text not null default '',
  account     text, iban text, swift text,
  currency    text check (currency in ('CZK', 'EUR', 'USD')),
  is_default  boolean not null default false,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- His supplier details, one row per owner: name, IČO, address, VAT, numbering, footer.
create table if not exists mc_invoice_settings (
  owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  profile     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists mc_invoices (
  id          text primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  number      text not null,
  status      text not null check (status in ('open', 'sent', 'paid', 'cancelled')),
  client_id   text,
  client      jsonb not null default '{}'::jsonb,   -- the customer as printed, frozen on the invoice
  supplier    jsonb not null default '{}'::jsonb,   -- his details and the bank account as printed
  account_id  text,
  issued      date not null,
  taxable     date,
  due         date not null,
  sent_on     date,
  paid_on     date,
  method      text not null default 'bank' check (method in ('bank', 'cash', 'card', 'cod')),
  currency    text not null default 'CZK' check (currency in ('CZK', 'EUR', 'USD')),
  lang        text not null default 'cs' check (lang in ('cs', 'en')),
  vs          text,
  order_no    text,
  lines       jsonb not null default '[]'::jsonb,
  note_before text, note_after text, footer text,
  total       numeric(14, 2) not null default 0,    -- with VAT, for queries and Jarvis; the lines stay the truth
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists mc_invoices_owner_number on mc_invoices (owner, number) where deleted_at is null;
create index if not exists mc_invoices_owner_issued on mc_invoices (owner, issued desc);
create index if not exists mc_invoices_owner_status on mc_invoices (owner, status, due);

do $$
declare t text;
begin
  foreach t in array array['mc_invoices', 'mc_invoice_contacts', 'mc_invoice_accounts', 'mc_invoice_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format('create policy %I on %I for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid())', t || '_own', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
