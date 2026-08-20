-- Book the morning nudge. Fill in both placeholders before running.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 07:00 Prague. cron.schedule is UTC, and Prague is UTC+2 in summer and +1 in
-- winter, so this is booked at 05:00 UTC and lands at 07:00 for the summer and
-- 06:00 in the winter. An hour of drift twice a year is not worth a second job.
select cron.schedule(
  'mc-morning-nudge',
  '0 5 * * *',
  $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/nudge',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <the NUDGE_SECRET>'
    )
  );
  $$
);

-- Check it is booked, and see the last few runs:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
