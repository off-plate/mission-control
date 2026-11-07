-- Focus commands from the Claude connector (2026-11-07). Idempotent: safe to run twice.
-- The connector queues {op:'focus'|'focusStop'} rows with HIS token; his open app claims
-- them (claimInbox) and starts/stops the real timer. Reuses the existing columns:
-- task_id, title (the label) and actual_min (the block length in minutes).
alter table mc_inbox drop constraint if exists mc_inbox_op_check;
alter table mc_inbox add constraint mc_inbox_op_check check (op in ('add', 'done', 'focus', 'focusStop'));

-- Until now he could read and stamp his rows but never insert (only the service-role
-- shortcut function did). Insert is allowed for his own rows and ONLY for focus ops, so
-- a token can still not queue adds or dones.
drop policy if exists mc_inbox_focus_insert on mc_inbox;
create policy mc_inbox_focus_insert on mc_inbox for insert to authenticated
  with check (owner = auth.uid() and op in ('focus', 'focusStop'));
