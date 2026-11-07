/* REVOLUT INGEST (2026-11-07). The one door his Revolut statement goes in through.
   The /revolut-sync skill exports the CZK statement from Revolut in his own Chrome,
   parses the CSV on his Mac and POSTs the rows here. Every call carries
   REVOLUT_SECRET as x-revolut-secret. The secret lives in his Keychain and in
   Supabase secrets, never in this repo.

   It can only WRITE Revolut rows. It reads nothing back, touches no other table,
   and never deletes: a row is inserted, or updated in place when the same
   transaction comes round again (pending turns into completed).

     { action: 'ingest', rows: [...], final?: { range_from, current_displayed, changed } }
     { action: 'rules',  rules: [{ pattern, category, internal, prio }] }   replaces his rules
     { action: 'recategorize' }                                              re-applies the rules to every row

   Deploy:
     supabase secrets set REVOLUT_SECRET="..."
     supabase functions deploy revolut-ingest --no-verify-jwt */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWNER_EMAIL } from '../_shared/owner.ts'

const SECRET = Deno.env.get('REVOLUT_SECRET') ?? ''
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface InRow { product?: string; type?: string; started?: string; completed?: string; description?: string; amount?: string | number; fee?: string | number; currency?: string; state?: string; balance?: string | number }
interface Rule { pattern: string; category: string; internal?: boolean; prio?: number }

const STAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const stamp = (s: string) => s.replace(' ', 'T')

async function ownerId(): Promise<string | null> {
  const { data } = await sb.auth.admin.listUsers({ perPage: 1000 })
  return data?.users.find((u) => u.email === OWNER_EMAIL)?.id ?? null
}

async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* Rules are first-match by prio. A bad regex in his table must not stop an import, so it is skipped. */
function compile(rules: { pattern: string; category: string; internal: boolean; prio: number; id?: number }[]) {
  const out: { re: RegExp; category: string; internal: boolean }[] = []
  for (const r of [...rules].sort((a, b) => a.prio - b.prio || (a.id ?? 0) - (b.id ?? 0))) {
    try { out.push({ re: new RegExp(r.pattern, 'i'), category: r.category, internal: r.internal }) } catch { /* skip */ }
  }
  return out
}

const BY_TYPE: Record<string, string> = { Interest: 'interest', ATM: 'cash', Charge: 'fees', Exchange: 'exchange', 'Card Refund': 'refund', Transfer: 'transfers', Deposit: 'transfers' }

function categorise(compiled: ReturnType<typeof compile>, description: string, type: string) {
  for (const r of compiled) if (r.re.test(description)) return { category: r.category, internal: r.internal }
  return { category: BY_TYPE[type] ?? 'uncategorised', internal: false }
}

async function loadRules(owner: string) {
  const { data } = await sb.from('mc_revolut_rules').select('id, pattern, category, internal, prio').eq('owner', owner)
  return compile((data ?? []) as { pattern: string; category: string; internal: boolean; prio: number; id: number }[])
}

async function countRows(owner: string): Promise<number> {
  const { count } = await sb.from('mc_revolut_tx').select('id', { count: 'exact', head: true }).eq('owner', owner)
  return count ?? 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!SECRET || req.headers.get('x-revolut-secret') !== SECRET) return json({ error: 'unauthorized' }, 401)
  const owner = await ownerId()
  if (!owner) return json({ error: 'owner not found' }, 500)
  const body = await req.json().catch(() => ({}))

  if (body.action === 'rules') {
    const rules = ((body.rules ?? []) as Rule[]).filter((r) => r && typeof r.pattern === 'string' && typeof r.category === 'string').slice(0, 500)
    for (const r of rules) { try { new RegExp(r.pattern, 'i') } catch { return json({ error: `bad pattern: ${r.pattern}` }, 400) } }
    if (!rules.length) return json({ error: 'no rules, refusing to clear them' }, 400)
    const del = await sb.from('mc_revolut_rules').delete().eq('owner', owner)
    if (del.error) return json({ error: del.error.message }, 500)
    const ins = await sb.from('mc_revolut_rules').insert(rules.map((r) => ({ owner, pattern: r.pattern.slice(0, 200), category: clean(r.category, 40), internal: !!r.internal, prio: Number.isInteger(r.prio) ? r.prio : 100 })))
    return ins.error ? json({ error: ins.error.message }, 500) : json({ rules: rules.length })
  }

  if (body.action === 'recategorize') {
    const compiled = await loadRules(owner)
    const groups = new Map<string, string[]>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('mc_revolut_tx').select('id, description, type, category, internal').eq('owner', owner).order('id').range(from, from + 999)
      if (error) return json({ error: error.message }, 500)
      if (!data?.length) break
      for (const row of data) {
        const c = categorise(compiled, row.description, row.type)
        if (c.category === row.category && c.internal === row.internal) continue
        const key = `${c.category}\u0000${c.internal}`
        const ids = groups.get(key) ?? []
        ids.push(row.id)
        groups.set(key, ids)
      }
      if (data.length < 1000) break
    }
    let changed = 0
    for (const [key, ids] of groups) {
      const [category, internal] = key.split('\u0000')
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100)
        const { error } = await sb.from('mc_revolut_tx').update({ category, internal: internal === 'true', updated_at: new Date().toISOString() }).eq('owner', owner).in('id', part)
        if (error) return json({ error: error.message }, 500)
        changed += part.length
      }
    }
    return json({ recategorized: changed })
  }

  if (body.action === 'ingest') {
    const rows = (body.rows ?? []) as InRow[]
    if (!Array.isArray(rows) || !rows.length) return json({ error: 'no rows' }, 400)
    if (rows.length > 2500) return json({ error: 'at most 2500 rows per call' }, 400)
    const compiled = await loadRules(owner)
    const before = await countRows(owner)
    const seen = new Map<string, number>()
    const out: Record<string, unknown>[] = []
    let skipped = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const started = clean(r.started, 19)
      const amount = num(r.amount)
      const product = clean(r.product, 30)
      if (!STAMP.test(started) || amount === null || !product) { skipped++; continue }
      const type = clean(r.type, 30)
      const description = clean(r.description, 200)
      const base = [product, started, description, amount.toFixed(2), type].join('|')
      const nth = (seen.get(base) ?? 0) + 1
      seen.set(base, nth)
      const c = categorise(compiled, description, type)
      const completed = clean(r.completed, 19)
      out.push({
        id: await sha1(`${base}#${nth}`), owner, product, type, started: stamp(started),
        completed: STAMP.test(completed) ? stamp(completed) : null,
        description, amount, fee: num(r.fee) ?? 0, currency: clean(r.currency, 3) || 'CZK',
        state: clean(r.state, 20).toUpperCase(), balance: num(r.balance),
        seq: Number.isInteger(Number(body.seq_offset)) ? Number(body.seq_offset) + i : i,
        category: c.category, internal: c.internal, updated_at: new Date().toISOString(),
      })
    }
    for (let i = 0; i < out.length; i += 500) {
      const { error } = await sb.from('mc_revolut_tx').upsert(out.slice(i, i + 500), { onConflict: 'id' })
      if (error) return json({ error: error.message, at: i }, 500)
    }
    const after = await countRows(owner)
    const fin = body.final as { range_from?: string; current_displayed?: number | string; changed?: number } | undefined
    if (fin) {
      const { data: last } = await sb.from('mc_revolut_tx').select('day').eq('owner', owner).order('started', { ascending: false }).limit(1)
      const { error } = await sb.from('mc_revolut_sync').upsert({
        owner, synced_at: new Date().toISOString(), rows_total: after,
        rows_changed: Number.isFinite(Number(fin.changed)) ? Number(fin.changed) : after - before,
        range_from: /^\d{4}-\d{2}-\d{2}$/.test(fin.range_from ?? '') ? fin.range_from : null,
        range_to: last?.[0]?.day ?? null, current_displayed: num(fin.current_displayed),
      }, { onConflict: 'owner' })
      if (error) return json({ error: error.message }, 500)
    }
    return json({ received: rows.length, accepted: out.length, skipped, new: after - before, total: after })
  }

  return json({ error: 'unknown action' }, 400)
})
