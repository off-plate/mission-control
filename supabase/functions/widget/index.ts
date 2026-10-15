/* The home-screen widget's read (2026-10-15).

   Scriptable on his iPhone asks this for a handful of numbers and nothing
   else: today's plan (done of total), the waiting pool, and which projects the
   waiting work sits in. It never returns a task list beyond the next title,
   never writes, and never sees money, so a leaked secret leaks what the widget
   already shows on his home screen.

   Caller: Scriptable only, sending MC_WIDGET_SECRET as x-widget-secret (kept in
   the iPhone Keychain, never in the script file or this repo). Deployed with
   --no-verify-jwt because the widget has no session; the secret is the gate.
   Rotate it with `supabase secrets set MC_WIDGET_SECRET=...` and the old one
   stops working at once. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWNER_EMAIL } from '../_shared/owner.ts'

type Task = { title: string; done: boolean; list: 'today' | 'backlog'; plannedOn?: string; projectId?: string; estimateMin?: number; subtasks?: { estimateMin: number }[] }
type Project = { id: string; name: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

// Same rule as util.ts taskMinutes: steps win over the task's own number.
const minutes = (t: Task) => t.subtasks?.length ? t.subtasks.reduce((a, s) => a + (s.estimateMin ?? 0), 0) : (t.estimateMin ?? 0)

// His day, not the server's: the function runs in UTC, Plan runs in Prague.
const pragueDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date())

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  const SECRET = Deno.env.get('MC_WIDGET_SECRET') ?? ''
  if (!SECRET || !OWNER_EMAIL || !sameSecret(req.headers.get('x-widget-secret') ?? '', SECRET)) {
    return json({ ok: false, error: 'Not allowed' }, 401)
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // Looked up by email, the same way zepp-sync finds him.
  const { data: users, error: uErr } = await sb.auth.admin.listUsers()
  const owner = users?.users.find((u) => u.email === OWNER_EMAIL)
  if (uErr || !owner) return json({ ok: false, error: 'No account' }, 500)
  const { data: row, error } = await sb.from('mc_state').select('data, updated_at').eq('id', owner.id).maybeSingle()
  if (error || !row?.data) return json({ ok: false, error: 'No state' }, 500)

  const tasks: Task[] = Array.isArray(row.data.tasks) ? row.data.tasks : []
  const projects: Project[] = Array.isArray(row.data.projects) ? row.data.projects : []
  const day = pragueDay()

  // Plan's own definitions (plan.tsx): onDay and backlogOpen, in the All view.
  const today = tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
  const open = today.filter((t) => !t.done)
  const waiting = tasks.filter((t) => !t.done && t.list === 'backlog')

  const perProject = new Map<string, number>()
  for (const t of waiting) perProject.set(t.projectId ?? '', (perProject.get(t.projectId ?? '') ?? 0) + 1)
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Unsorted'

  return json({
    ok: true,
    day,
    today: { done: today.length - open.length, total: today.length, openMin: open.reduce((a, t) => a + minutes(t), 0), next: open[0]?.title ?? null },
    waiting: { count: waiting.length, min: waiting.reduce((a, t) => a + minutes(t), 0) },
    projects: [...perProject].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => ({ name: name(id), waiting: n })),
    syncedAt: row.updated_at,
  })
})
