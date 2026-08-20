# The morning nudge, end to end

One email, sent only when there is something to say: what last night asked of
you and did not get, focus over the last seven days, and the week before.
It runs in Supabase rather than on the Mac, so the week you are away is still
a week it can reach you.

Nothing here costs anything. Free-tier Edge Functions and pg_cron, and Gmail's
own SMTP. No secret is in the repo; all four live in the function's env.

## 1. A Gmail app password

Google account needs 2-Step Verification on, then:
https://myaccount.google.com/apppasswords -> create one, name it "Mission
Control". Copy the 16 characters. This is not your Google password and it can
be revoked on its own.

## 2. Set the secrets

```bash
cd "Claude Helpers/Mission Control"
supabase login
supabase link --project-ref <your-project-ref>

supabase secrets set GMAIL_USER=mihael.florian@gmail.com
supabase secrets set GMAIL_APP_PASSWORD='the 16 characters'
supabase secrets set NUDGE_SECRET="$(openssl rand -hex 24)"   # keep the output
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function
automatically. The service role is what lets it read the state row without
being signed in as you.

## 3. Deploy

```bash
supabase functions deploy nudge
```

## 4. Read what it WOULD say, before it can send anything

```bash
curl -H "Authorization: Bearer <the NUDGE_SECRET you kept>" \
  "https://<project-ref>.supabase.co/functions/v1/nudge?dry=1"
```

That prints the exact email and sends nothing. Do this first.

## 5. Schedule it

Run `nudge-schedule.sql` in the SQL editor, with the two placeholders filled
in. It enables pg_cron and pg_net and books the job for 07:00 Prague.

## Turning it off

```sql
select cron.unschedule('mc-morning-nudge');
```

## Changing what it says

Everything the email is allowed to say is in `functions/nudge/digest.ts`, which
is pure and has no mailbox anywhere near it. Change it there, then re-run the
dry call above to read the result.
