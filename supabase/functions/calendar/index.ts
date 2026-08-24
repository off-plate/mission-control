/* The calendar proxy.

   Google answers its ICS endpoints with 200 and no access-control-allow-origin,
   so a page on github.io is blocked before it reads a byte. Measured against a
   known public feed, not assumed. This function does the fetch instead.

   It also means the calendar's SECRET address lives in Supabase secrets and
   never in the repo, which is public. That is the whole reason it is a secret:
   anyone holding it can read every meeting title in the calendar. It is read
   from the environment here and is never returned to the caller, never logged,
   and never put in an error message.

   Deploy:
     supabase secrets set MC_CALENDAR_ICS="https://calendar.google.com/calendar/ical/.../private-xxxx/basic.ics"
     supabase functions deploy calendar

   The function returns raw iCalendar text. Parsing happens in the app, in
   src/ical.ts, so the rules live in one place with their tests beside them. */

const ALLOW = [
  'https://off-plate.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin && ALLOW.includes(origin) ? origin : ALLOW[0],
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
  'vary': 'origin',
})

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })

  const url = Deno.env.get('MC_CALENDAR_ICS')
  if (!url) {
    /* Says what is missing and nothing about what it would have contained. */
    return new Response('No calendar configured.', { status: 503, headers: { ...cors(origin), 'content-type': 'text/plain' } })
  }

  try {
    const r = await fetch(url, { headers: { 'user-agent': 'mission-control/1' } })
    if (!r.ok) {
      /* Never echo the upstream body: a Google error page for a secret URL can
         carry the address back out with it. */
      return new Response(`Calendar feed answered ${r.status}.`, {
        status: 502,
        headers: { ...cors(origin), 'content-type': 'text/plain' },
      })
    }
    const text = await r.text()
    return new Response(text, {
      status: 200,
      headers: {
        ...cors(origin),
        'content-type': 'text/calendar; charset=utf-8',
        /* Five minutes. A work calendar does not change faster than that, and
           it keeps the free tier's invocation count where it belongs. */
        'cache-control': 'public, max-age=300',
      },
    })
  } catch {
    return new Response('Calendar feed could not be reached.', {
      status: 502,
      headers: { ...cors(origin), 'content-type': 'text/plain' },
    })
  }
})
