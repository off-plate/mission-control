/* One REAL round trip through the mailbox: live Supabase, his session, the
   daemon on this Mac, a real `claude -p`. `node tools/claude-brain-live-test.mjs`
   Needs the daemon running (`node tools/claude-brain.mjs --status`).

   Uses the daemon's saved session READ-ONLY and never refreshes it: a Supabase
   refresh token rotates, so a second process refreshing would lock the daemon
   out. The request is a ping; the row is deleted either way. */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const URL_ = 'https://fhfempisopwsdkmvywbt.supabase.co'
const KEY = 'sb_publishable_MDxQPm0SzLHFTnDqg-eyyQ_0yposnES'
const saved = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.mc-brain/session.json'), 'utf8'))
const c = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const { data: s, error: e0 } = await c.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
if (e0 || !s.session) { console.log('FAIL not signed in:', e0?.message); process.exit(1) }
const uid = s.session.user.id

const { data: beat } = await c.from('mc_brain').select('beat_at').eq('owner', uid).eq('kind', 'beat').maybeSingle()
const age = beat?.beat_at ? (Date.now() - Date.parse(beat.beat_at)) / 1000 : null
console.log('heartbeat age:', age == null ? 'none' : age.toFixed(0) + 's')
if (age == null || age > 90) { console.log('FAIL the daemon is not running'); process.exit(1) }

const t0 = Date.now()
const { data: row, error } = await c.from('mc_brain').insert({
  owner: uid, kind: 'ask', model: 'claude-haiku-5-5',
  request: { system: 'Reply with exactly one JSON object {"say":"pong"} and nothing else.', turns: [{ role: 'user', content: 'ping' }] },
}).select('id').single()
if (error) { console.log('FAIL insert:', error.message); process.exit(1) }
let out = null
while (Date.now() - t0 < 90_000) {
  await new Promise((r) => setTimeout(r, 1000))
  const { data } = await c.from('mc_brain').select('status, reply, error').eq('id', row.id).maybeSingle()
  if (data && (data.status === 'done' || data.status === 'error')) { out = data; break }
}
await c.from('mc_brain').delete().eq('id', row.id)
const { data: left } = await c.from('mc_brain').select('id').eq('id', row.id)
console.log(`status: ${out?.status ?? 'timeout'}  reply: ${out?.reply ?? out?.error ?? '-'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
console.log('row deleted:', left?.length === 0)
process.exit(out?.status === 'done' && /pong/.test(out.reply) && left?.length === 0 ? 0 : 1)
