/* OUTREACH FROM GMAIL. The door /eco-sync (Jarvis .claude/skills/eco-sync/sync.py)
   talks through; it replaced the Apps Script in tools/outreach-gmail.gs. /eco-sync
   sends the step it read from the subject and wording, and the business domain. Two calls, both POST, both carrying
   OUTREACH_SECRET as x-outreach-secret:

     { action: 'targets' }          -> which addresses and domains are prospects
     { action: 'events', events }   -> store what it found, once per message
     { action: 'sheet', rows }       -> the whole Off-Plate Prospects Sheet, every tab
                                    (2026-10-13), replacing the last snapshot

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
interface Incoming { id: string; kind: 'sent' | 'reply'; via?: string; step?: string; domain?: string; day: string; counterpart: string; subject?: string; body?: string }
const STEPS = new Set(['work', 'reminder', 'personal'])

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
    if (p.stage && ['won', 'lost', 'Acquired', 'Lost', 'Rejected', 'Dropped'].includes(p.stage)) continue
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
        step: e.kind === 'sent' && STEPS.has(e.step ?? '') ? e.step : null,
        domain: e.domain?.trim().toLowerCase() || null,
        day: e.day, counterpart: e.counterpart.trim().toLowerCase(),
        subject: (e.subject ?? '').slice(0, 300), body: (e.body ?? '').slice(0, 4000),
      }))
    if (!rows.length) return json({ stored: 0 })
    const { error } = await sb().from('mc_outreach_events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    return error ? json({ error: error.message }, 500) : json({ stored: rows.length })
  }

  /* The Sheet as text, bounded: one snapshot per owner, unapplied until the
     app turns it into cards (prospectcalc applySheet) and stamps it. */
  if (body.action === 'sheet') {
    const t = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '')
    const KEYS: [string, number][] = [['country', 60], ['num', 10], ['niche', 200], ['location', 200], ['rating', 10], ['reviews', 12], ['domain', 200], ['webProblem', 2000], ['socialProblem', 2000], ['date', 40], ['status', 80], ['notes', 2000], ['finance', 2000], ['financePriority', 80]]
    const rows = ((Array.isArray(body.rows) ? body.rows : []) as Record<string, unknown>[])
      .filter((r) => r && t(r.name, 200))
      .slice(0, 5000)
      .map((r, i) => ({ name: t(r.name, 200), row: i, ...Object.fromEntries(KEYS.map(([k, max]) => [k, t(r[k], max)]).filter(([, v]) => v)) }))
    if (!rows.length) return json({ error: 'no rows' }, 400)
    const { error } = await sb().from('mc_prospect_sheet').upsert({ owner, rows, synced_at: new Date().toISOString(), applied_at: null }, { onConflict: 'owner' })
    return error ? json({ error: error.message }, 500) : json({ stored: rows.length })
  }

  return json({ error: 'unknown action' }, 400)
})
