/* The iPhone shortcuts' write door (2026-10-17).

   Two things only, both queued in mc_inbox for the app to apply with its own
   actions (never written into his state directly, so it cannot collide with a
   save):
     {op: "add",  title, space}           a task on the to-do list
     {op: "done", task_id, actual_min}    finish a task with the time it took

   Caller: Scriptable scripts run from Shortcuts, sending MC_SHORTCUT_SECRET as
   x-shortcut-secret. A separate key from the widget's read-only one, so the
   widget key stays read-only. Deployed with --no-verify-jwt; the secret is the
   gate. Rotate with `supabase secrets set MC_SHORTCUT_SECRET=...`. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWNER_EMAIL } from '../_shared/owner.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  const SECRET = Deno.env.get('MC_SHORTCUT_SECRET') ?? ''
  if (req.method !== 'POST' || !SECRET || !OWNER_EMAIL || !sameSecret(req.headers.get('x-shortcut-secret') ?? '', SECRET)) {
    return json({ ok: false, error: 'Not allowed' }, 401)
  }
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ ok: false, error: 'Send JSON' }, 400) }

  let row: Record<string, unknown>
  if (body.op === 'add') {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
    if (!title) return json({ ok: false, error: 'The task has no text' }, 400)
    row = { op: 'add', title, space: body.space === 'work' ? 'work' : 'personal' }
  } else if (body.op === 'done') {
    const task_id = typeof body.task_id === 'string' ? body.task_id.slice(0, 100) : ''
    const actual_min = Math.round(Number(body.actual_min))
    if (!task_id || !Number.isFinite(actual_min) || actual_min < 1 || actual_min > 1440) return json({ ok: false, error: 'Need a task and 1 to 1440 minutes' }, 400)
    row = { op: 'done', task_id, actual_min, title: typeof body.title === 'string' ? body.title.slice(0, 300) : null }
  } else return json({ ok: false, error: 'op must be add or done' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: users } = await sb.auth.admin.listUsers()
  const owner = users?.users.find((u) => u.email === OWNER_EMAIL)
  if (!owner) return json({ ok: false, error: 'No account' }, 500)
  const { error } = await sb.from('mc_inbox').insert({ id: crypto.randomUUID(), owner: owner.id, ...row })
  if (error) return json({ ok: false, error: 'Could not queue it' }, 500)
  return json({ ok: true })
})
