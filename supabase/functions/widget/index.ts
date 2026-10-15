/* The home-screen widget's read (2026-10-15).

   Scriptable on his iPhone asks this for a handful of numbers and nothing
   else: today's plan (done of total, next task), the waiting pool and where it
   sits, today's habits (kept of due) and the next calendar event. It never
   writes and never sees money, so a leaked secret leaks what the widget
   already shows on his home screen.

   Caller: Scriptable only, sending MC_WIDGET_SECRET as x-widget-secret (kept in
   the iPhone Keychain, never in the script file or this repo). Deployed with
   --no-verify-jwt because the widget has no session; the secret is the gate.
   Rotate it with `supabase secrets set MC_WIDGET_SECRET=...` and the old one
   stops working at once. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWNER_EMAIL } from '../_shared/owner.ts'
import { parseIcs } from '../_shared/ical.ts'

type Task = { title: string; at?: string; slot?: string; done: boolean; list: 'today' | 'backlog'; plannedOn?: string; projectId?: string; estimateMin?: number; subtasks?: { estimateMin: number }[] }
type Project = { id: string; name: string }
type Habit = { id: string; kind?: string; frequency?: string; paused?: boolean; archivedAt?: string; folderId?: string; optional?: boolean }
type Tick = { habitId: string; day: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

// Same rule as util.ts taskMinutes: steps win over the task's own number.
const minutes = (t: Task) => t.subtasks?.length ? t.subtasks.reduce((a, s) => a + (s.estimateMin ?? 0), 0) : (t.estimateMin ?? 0)

// His clock, not the server's: the function runs in UTC, the app in Prague.
function pragueNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]))
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    min: (Number(p.hour) % 24) * 60 + Number(p.minute),
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), // 0 = Monday, like the app
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
  }
}
const iso = (dt: Date) => dt.toISOString().slice(0, 10)

/* habitsDueToday from src/types/habits.ts, ported: folders count once, optional
   habits never hold a folder open, a routine's own habit is not a row.
   ponytail: "kept today" reads the dated log, not the app's 7-slot days cache,
   which only rolls when the app is opened. Same answer whenever the app is current. */
function habitsToday(habits: Habit[], routines: { habitId?: string }[], log: Tick[], now: ReturnType<typeof pragueNow>) {
  const monday = new Date(Date.UTC(now.y, now.m - 1, now.d - now.weekday))
  const sunday = new Date(Date.UTC(now.y, now.m - 1, now.d - now.weekday + 6))
  const monthFrom = `${now.day.slice(0, 7)}-01`, monthTo = `${now.day.slice(0, 7)}-31`
  const keptPeriod = (h: Habit) => {
    const [from, to] = h.frequency === 'monthly' ? [monthFrom, monthTo] : [iso(monday), iso(sunday)]
    return log.some((t) => t.habitId === h.id && t.day >= from && t.day <= to)
  }
  const due = habits.filter((h) => !h.archivedAt && !h.paused && h.kind !== 'break'
    && !(h.frequency === 'weekdays' && now.weekday >= 5)
    && !((h.frequency === 'weekly' || h.frequency === 'monthly') && keptPeriod(h)))
  const doneToday = new Set(log.filter((t) => t.day === now.day).map((t) => t.habitId))
  const folderHabitIds = new Set(routines.map((r) => r.habitId).filter(Boolean))
  const folders = [...new Set(due.map((h) => h.folderId).filter(Boolean))]
    .map((id) => due.filter((h) => h.folderId === id && !h.optional))
    .filter((need) => need.length > 0)
  const loose = due.filter((h) => !h.folderId && !folderHabitIds.has(h.id))
  return {
    due: folders.length + loose.length,
    kept: folders.filter((need) => need.every((h) => doneToday.has(h.id))).length + loose.filter((h) => doneToday.has(h.id)).length,
  }
}

// The next timed event from now, today or tomorrow. A dead feed just means no event.
async function nextEvent(now: ReturnType<typeof pragueNow>) {
  const url = Deno.env.get('MC_CALENDAR_ICS')
  if (!url) return null
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'mission-control/1' } })
    if (!r.ok) return null
    const from = new Date(); from.setUTCHours(0, 0, 0, 0); from.setUTCDate(from.getUTCDate() - 1)
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 3)
    const ev = parseIcs(await r.text(), from, to, Deno.env.get('MC_CALENDAR_EMAIL') ?? undefined)
      .filter((e) => !e.allDay && e.start !== null && (e.day > now.day || (e.day === now.day && (e.end ?? e.start!) > now.min)))
      .sort((a, b) => a.day.localeCompare(b.day) || a.start! - b.start!)[0]
    if (!ev) return null
    const hhmm = `${String(Math.floor(ev.start! / 60)).padStart(2, '0')}:${String(ev.start! % 60).padStart(2, '0')}`
    return { title: ev.title, at: hhmm, today: ev.day === now.day, now: ev.day === now.day && ev.start! <= now.min }
  } catch { return null }
}

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

  const now = pragueNow()
  const event = nextEvent(now) // runs while the state is read

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // Looked up by email, the same way zepp-sync finds him.
  const { data: users, error: uErr } = await sb.auth.admin.listUsers()
  const owner = users?.users.find((u) => u.email === OWNER_EMAIL)
  if (uErr || !owner) return json({ ok: false, error: 'No account' }, 500)
  const { data: row, error } = await sb.from('mc_state').select('data, updated_at').eq('id', owner.id).maybeSingle()
  if (error || !row?.data) return json({ ok: false, error: 'No state' }, 500)

  const s = row.data
  const arr = <T>(v: unknown) => (Array.isArray(v) ? v : []) as T[]
  const tasks = arr<Task>(s.tasks), projects = arr<Project>(s.projects)

  // Plan's own definitions (plan.tsx): onDay and backlogOpen, in the All view.
  const today = tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? now.day) === now.day)
  // Next = pinned clock time first, then the day's slots in order, unplaced last.
  const SLOT = ['morning', 'noon', 'afternoon', 'evening']
  const rank = (t: Task) => t.at ? `0${t.at}` : `1${SLOT.indexOf(t.slot ?? '') < 0 ? 9 : SLOT.indexOf(t.slot!)}`
  const open = today.filter((t) => !t.done).sort((a, b) => rank(a).localeCompare(rank(b)))
  const waiting = tasks.filter((t) => !t.done && t.list === 'backlog')

  const perProject = new Map<string, number>()
  for (const t of waiting) perProject.set(t.projectId ?? '', (perProject.get(t.projectId ?? '') ?? 0) + 1)
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Unsorted'

  return json({
    ok: true,
    day: now.day,
    today: { done: today.length - open.length, total: today.length, openMin: open.reduce((a, t) => a + minutes(t), 0), next: open[0]?.title ?? null, nextMin: open[0] ? minutes(open[0]) : 0 },
    waiting: { count: waiting.length, min: waiting.reduce((a, t) => a + minutes(t), 0) },
    projects: [...perProject].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => ({ name: name(id), waiting: n })),
    habits: habitsToday(arr<Habit>(s.habits), arr<{ habitId?: string }>(s.routines), arr<Tick>(s.habitLog), now),
    event: await event,
    syncedAt: row.updated_at,
  })
})
