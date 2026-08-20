/* The morning nudge.

   Runs next to the data rather than on his laptop, because the week he most
   needs telling is the week the laptop is shut. Reads the same mc_state blob
   the app syncs, works out what last night actually asked of him and did not
   get, and sends one plain email. Sends NOTHING when there is nothing to say:
   a mail that arrives every morning regardless is a mail he stops opening,
   and then the one that matters goes unread with it.

   No secret is in this file. Everything comes from the function's environment,
   which is why this can live in a public repo. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { compose, dayKey, type Blob } from './digest.ts'

const need = (k: string): string => {
  const v = Deno.env.get(k)
  if (!v) throw new Error(`${k} is not set on the function`)
  return v
}

Deno.serve(async (req) => {
  /* pg_cron calls this with a shared secret, so a public function URL is not
     an open mailer for anyone who finds it. */
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${need('NUDGE_SECRET')}`) {
    return new Response('no', { status: 401 })
  }

  const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'))
  const { data, error } = await db.from('mc_state').select('data').limit(1).maybeSingle()
  if (error) return new Response(`read failed: ${error.message}`, { status: 500 })
  if (!data?.data) return new Response('no state yet', { status: 200 })

  const state: Blob = typeof data.data === 'string' ? JSON.parse(data.data) : data.data

  /* His clock, not the server's. The server runs UTC and "last night" two
     hours after Prague midnight is a different night there. */
  const today = dayKey(new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' })))
  const mail = compose(state, today)
  if (!mail) return new Response('nothing worth sending', { status: 200 })

  // A dry run to read what it WOULD say, without it landing anywhere.
  if (new URL(req.url).searchParams.get('dry') === '1') {
    return new Response(`${mail.subject}\n\n${mail.body}`, { headers: { 'content-type': 'text/plain' } })
  }

  const smtp = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: need('GMAIL_USER'), password: need('GMAIL_APP_PASSWORD') },
    },
  })
  await smtp.send({
    from: need('GMAIL_USER'),
    to: need('GMAIL_USER'),
    subject: mail.subject,
    content: mail.body,
  })
  await smtp.close()
  return new Response('sent', { status: 200 })
})
