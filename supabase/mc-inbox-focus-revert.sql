-- Undoes supabase/mc-inbox-focus.sql (2026-11-07). The focus timer is now written straight into the
-- synced state (activeFocus), so the inbox no longer carries focus commands and nothing may insert
-- into mc_inbox as him. Idempotent: safe to run twice.
drop policy if exists mc_inbox_focus_insert on mc_inbox;
delete from mc_inbox where op in ('focus', 'focusStop');
alter table mc_inbox drop constraint if exists mc_inbox_op_check;
alter table mc_inbox add constraint mc_inbox_op_check check (op in ('add', 'done'));
