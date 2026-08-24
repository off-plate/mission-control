# Connecting the work calendar

The app draws the calendar itself. It does not embed one.

## Why there is a function in the middle

Google answers its ICS endpoints with `200` and **no** `access-control-allow-origin`
header. Measured against a known public feed, not assumed. So a page served from
github.io is blocked by the browser before it reads a single byte, and no amount
of client-side cleverness gets around it.

The Edge Function does the fetch instead. That also keeps the feed's secret
address out of this repo, which is public.

## The address you need

Not the embed link, and not `/public/basic.ics` (that answers 404 for this
calendar, because it is not shared publicly).

Google Calendar, on the left, hover the calendar, three dots, **Settings and
sharing**, scroll to **Integrate calendar**, copy **Secret address in iCal
format**. It ends in `/private-<long hash>/basic.ics`.

**Treat it as a password.** Anyone holding it can read every meeting title in
that calendar. It goes in Supabase secrets and nowhere else. Not in this repo,
not in a chat, not in the bundle.

## Deploy

```bash
cd "Claude Helpers/Mission Control"
supabase login                       # once
supabase link --project-ref fhfempisopwsdkmvywbt
supabase secrets set MC_CALENDAR_ICS="https://calendar.google.com/calendar/ical/.../private-xxxx/basic.ics"
supabase functions deploy calendar
```

The function verifies the caller's JWT, so only a signed-in session can pull
the calendar through it. A function anyone may call is the same as publishing
the secret address.

## Rotating it

If the address ever leaks, Google Calendar has a **Reset** button next to it.
Reset there, then `supabase secrets set MC_CALENDAR_ICS=` the new one. Nothing
in the app needs redeploying.
