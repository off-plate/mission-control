/* OUTREACH FROM GMAIL. The door the Apps Script in his Gmail talks through
   (tools/outreach-gmail.gs). Two calls, both POST, both carrying
   OUTREACH_SECRET as x-outreach-secret:

     { action: 'targets' }          -> which addresses and domains are prospects
     { action: 'events', events }   -> store what it found, once per message

   The script asks for targets first, so it only ever reads mail to or from a
   prospect, never the rest of his inbox. Events are stored, not applied: the
   app turns them into touches through its own store, so they sync and merge
   like anything he logs by hand.

   Deploy:
     supabase secrets set OUTREACH_SECRET="..."
     supabase functions deploy outreach-ingest --no-verify-jwt
   The secret also goes into the script's properties, never into this repo. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWNER_EMAIL } from '../_shared/owner.ts'

const SECRET = Deno.env.get('OUTREACH_SECRET') ?? ''
const sb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

/* A prospect on gmail.com must not turn every gmail.com sender into a reply. */
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'seznam.cz', 'email.cz', 'post.cz', 'centrum.cz', 'volny.cz', 'atlas.cz', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com', 'tiscali.cz', 'quick.cz'])

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Person { email?: string }
interface Prospect { stage?: string; domain?: string; people?: Person[] }
interface Incoming { id: string; kind: 'sent' | 'reply'; via?: string; day: string; counterpart: string; subject?: string; body?: string }

async function ownerId(): Promise<string | null> {
  const { data } = await sb().auth.admin.listUsers({ perPage: 1000 })
  return data?.users.find((u) => u.email === OWNER_EMAIL)?.id ?? null
}

async function targets(owner: string) {
  const { data } = await sb().from('mc_state').select('data').eq('owner', owner).limit(1).maybeSingle()
  const prospects: Prospect[] = (data?.data as { prospects?: Prospect[] } | null)?.prospects ?? []
  const emails = new Set<string>()
  const domains = new Set<string>()
  for (const p of prospects) {
    if (p.stage === 'won' || p.stage === 'lost') continue
    for (const x of p.people ?? []) if (x.email?.includes('@')) emails.add(x.email.trim().toLowerCase())
    const d = p.domain?.trim().toLowerCase()
    if (d && !FREEMAIL.has(d)) domains.add(d)
  }
  return { emails: [...emails], domains: [...domains] }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!SECRET || req.headers.get('x-outreach-secret') !== SECRET) return json({ error: 'unauthorized' }, 401)
  const owner = await ownerId()
  if (!owner) return json({ error: 'owner not found' }, 500)
  const body = await req.json().catch(() => ({}))

  if (body.action === 'targets') return json(await targets(owner))

  if (body.action === 'events') {
    const rows = ((body.events ?? []) as Incoming[])
      .filter((e) => e && typeof e.id === 'string' && (e.kind === 'sent' || e.kind === 'reply') && DAY.test(e.day) && typeof e.counterpart === 'string')
      .slice(0, 500)
      .map((e) => ({
        id: e.id, owner, kind: e.kind, via: e.via === 'personal' ? 'personal' : e.kind === 'sent' ? 'offplate' : null,
        day: e.day, counterpart: e.counterpart.trim().toLowerCase(),
        subject: (e.subject ?? '').slice(0, 300), body: (e.body ?? '').slice(0, 4000),
      }))
    if (!rows.length) return json({ stored: 0 })
    const { error } = await sb().from('mc_outreach_events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    return error ? json({ error: error.message }, 500) : json({ stored: rows.length })
  }

  return json({ error: 'unknown action' }, 400)
})
