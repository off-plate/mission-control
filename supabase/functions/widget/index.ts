/* The home-screen widget's read (2026-10-15).

   Scriptable on his iPhone asks this for a handful of numbers and nothing
   else: today's plan (done of total, next task), the waiting pool and where it
   sits, today's habits (kept of due) and the next calendar event. It never
   writes. Since 2026-10-16 it also returns the next 14 days of bills (his
   pick, the Bills widget), so a leaked key would show those amounts too:
   rotate it if the phone is ever lost.

   Caller: Scriptable only, sending MC_WIDGET_SECRET as x-widget-secret (kept in
   the iPhone Keychain, never in the script file or this repo). Deployed with
   --no-verify-jwt because the widget has no session; the secret is the gate.
   Rotate it with `supabase secrets set MC_WIDGET_SECRET=...` and the old one
   stops working at once. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWNER_EMAIL } from '../_shared/owner.ts'
import { parseIcs } from '../_shared/ical.ts'
// The app's own pure modules, imported rather than copied so Bills and name days can never disagree with the app.
import { activeCycleKey, addMonthsToKey, cycleForKey, cycleChecklist } from '../../../src/compassCalc.ts'
import { NAME_DAYS } from '../../../src/namedays-data.ts'

type Task = { title: string; carried?: number; space?: string; at?: string; slot?: string; done: boolean; list: 'today' | 'backlog'; plannedOn?: string; projectId?: string; estimateMin?: number; subtasks?: { estimateMin: number }[] }
type Project = { id: string; name: string }
type Habit = { id: string; name?: string; daypart?: string; folderOrder?: number; kind?: string; frequency?: string; paused?: boolean; archivedAt?: string; folderId?: string; optional?: boolean }
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
function habitsToday(habits: Habit[], routines: { id: string; title?: string; habitId?: string }[], log: Tick[], now: ReturnType<typeof pragueNow>) {
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
  const weekDays = Array.from({ length: 7 }, (_, i) => iso(new Date(Date.UTC(now.y, now.m - 1, now.d - now.weekday + i))))
  const ticked = new Set(log.map((t) => `${t.habitId}|${t.day}`))
  const keptOn = (hs: Habit[]) => weekDays.map((day) => day <= now.day && hs.every((h) => ticked.has(`${h.id}|${day}`)))
  const folderHabitIds = new Set(routines.map((r) => r.habitId).filter(Boolean))
  // A folder (routine) is ONE item with its own done/total; a loose habit is one item.
  const folders = [...new Set(due.map((h) => h.folderId).filter(Boolean))]
    .map((id) => ({ id, need: due.filter((h) => h.folderId === id && !h.optional) }))
    .filter((f) => f.need.length > 0)
  const loose = due.filter((h) => !h.folderId && !folderHabitIds.has(h.id))
  // Routines in the order he keeps them, then loose habits by part of the day.
  const DAYPART = ['morning', 'noon', 'afternoon', 'evening']
  const part = (p?: string) => { const i = DAYPART.indexOf(p ?? ''); return i < 0 ? 9 : i }
  const items = [
    ...folders.map((f) => {
      const done = f.need.filter((h) => doneToday.has(h.id)).length
      const r = routines.findIndex((x) => x.id === f.id)
      return { name: routines[r]?.title ?? 'Routine', kept: done === f.need.length, done, total: f.need.length, week: keptOn(f.need), order: r < 0 ? 900 : r }
    }),
    ...loose.map((h) => ({ name: h.name ?? 'Habit', kept: doneToday.has(h.id), done: doneToday.has(h.id) ? 1 : 0, total: 1, week: keptOn([h]), order: 1000 + part(h.daypart) })),
  ].sort((a, b) => a.order - b.order).map(({ order: _o, ...i }) => i)
  return { due: items.length, kept: items.filter((i) => i.kept).length, items }
}

// Today's and tomorrow's timed events from the same feed and parser the Calendar page uses.
// A dead feed just means no events.
async function calendar(now: ReturnType<typeof pragueNow>) {
  const none = { next: null, today: [], tomorrowFirst: null }
  const url = Deno.env.get('MC_CALENDAR_ICS')
  if (!url) return none
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'mission-control/1' } })
    if (!r.ok) return none
    const from = new Date(); from.setUTCHours(0, 0, 0, 0); from.setUTCDate(from.getUTCDate() - 1)
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 3)
    const tomorrow = iso(new Date(Date.UTC(now.y, now.m - 1, now.d + 1)))
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const timed = parseIcs(await r.text(), from, to, Deno.env.get('MC_CALENDAR_EMAIL') ?? undefined)
      .filter((e) => !e.allDay && e.start !== null)
      .sort((a, b) => a.day.localeCompare(b.day) || a.start! - b.start!)
    const ev = timed.find((e) => e.day > now.day || (e.day === now.day && (e.end ?? e.start!) > now.min))
    const tf = timed.find((e) => e.day === tomorrow)
    return {
      next: ev ? { title: ev.title, at: hhmm(ev.start!), today: ev.day === now.day, now: ev.day === now.day && ev.start! <= now.min } : null,
      today: timed.filter((e) => e.day === now.day).slice(0, 6).map((e) => ({ title: e.title, at: hhmm(e.start!) })),
      tomorrowFirst: tf ? { title: tf.title, at: hhmm(tf.start!) } : null,
    }
  } catch { return none }
}

// Bills due in the next 14 days (and anything overdue), with the Bills page's own checklist maths.
// The cycle runs 14th to 14th, so the window can reach into the next cycle too.
async function bills(sb: ReturnType<typeof createClient>, uid: string, now: ReturnType<typeof pragueNow>) {
  const rows = async (t: string) => ((await sb.from(t).select('*').eq('user_id', uid)).data ?? []) as any[]
  const [profile, debts, recurring, tx, planned] = await Promise.all(['compass_profile', 'compass_debts', 'compass_recurring', 'compass_transactions', 'compass_planned'].map(rows))
  const settings = (profile[0]?.settings ?? {}) as { skips?: Record<string, string[]> }
  const allSkips = settings.skips ?? {}
  const dismissed = new Set(Object.values(allSkips).flat())
  const key = activeCycleKey(profile[0] ?? null)
  const until = iso(new Date(Date.UTC(now.y, now.m - 1, now.d + 14)))
  const seen = new Set<string>()
  const out: { name: string; amount: number; due: string | null; paid: boolean; overdue: boolean; debt: boolean }[] = []
  for (const k of [key, addMonthsToKey(key, 1)]) {
    const chk = cycleChecklist(recurring, planned, debts, tx, cycleForKey(k), undefined, dismissed)
    for (const i of chk.items) {
      if ((allSkips[k] ?? []).includes(i.id) || seen.has(`${i.id}|${i.dueOn}`)) continue
      const soon = i.dueOn && i.dueOn >= now.day && i.dueOn <= until
      const late = !i.paid && (i.overdue || (i.dueOn && i.dueOn < now.day))
      if (!soon && !late) continue
      seen.add(`${i.id}|${i.dueOn}`)
      out.push({ name: i.name, amount: i.amount, due: i.dueOn, paid: i.paid, overdue: !!late, debt: i.kind === 'debt_payment' })
    }
  }
  out.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
  const open = out.filter((b) => !b.paid)
  return { items: out.slice(0, 6), dueCount: open.length, dueTotal: open.reduce((a, b) => a + b.amount, 0) }
}

// Prague, fixed: free, no key. Current temperature, today's range, and when rain starts.
async function weather() {
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.08&longitude=14.43&current=temperature_2m,weather_code&hourly=precipitation_probability&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FPrague&forecast_days=1')
    const w = await r.json()
    const CODES: [number, string][] = [[0, 'Clear'], [3, 'Cloudy'], [48, 'Fog'], [57, 'Drizzle'], [67, 'Rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Storm']]
    const code = w.current.weather_code as number
    const hour = Number(String(w.current.time).slice(11, 13))
    const rainAt = (w.hourly.precipitation_probability as number[]).findIndex((p, h) => h >= hour && p >= 50)
    return {
      temp: Math.round(w.current.temperature_2m), max: Math.round(w.daily.temperature_2m_max[0]), min: Math.round(w.daily.temperature_2m_min[0]),
      sky: (CODES.find(([c]) => code <= c) ?? [0, 'Cloudy'])[1], rainFrom: rainAt >= 0 ? `${String(rainAt).padStart(2, '0')}:00` : null,
    }
  } catch { return null }
}

// The two morning headlines the GitHub Action already writes for the Morning routine.
async function news() {
  try {
    const r = await fetch('https://off-plate.github.io/mission-control/data/morning.json')
    const m = await r.json()
    return [m.cs?.text, m.en?.text].filter(Boolean) as string[]
  } catch { return [] }
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
  const cal = calendar(now), wx = weather(), headlines = news() // run while the state is read

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
    habits: habitsToday(arr<Habit>(s.habits), arr<{ id: string; title?: string; habitId?: string }>(s.routines), arr<Tick>(s.habitLog), now),
    event: (await cal).next,
    events: (await cal).today,
    tomorrowFirst: (await cal).tomorrowFirst,
    todayItems: [...today].sort((a, b) => Number(a.done) - Number(b.done) || rank(a).localeCompare(rank(b))).slice(0, 7)
      .map((t) => ({ title: t.title, done: t.done, min: minutes(t), space: t.space ?? null, at: t.at ?? null })),
    stuck: (() => {
      const t = tasks.filter((x) => !x.done && (x.carried ?? 0) >= 2).sort((a, b) => (b.carried ?? 0) - (a.carried ?? 0))[0]
      return t ? { title: t.title, carried: t.carried } : null
    })(),
    focus: (() => {
      const fs = arr<{ day: string; minutes: number; label?: string }>(s.focusSessions).filter((f) => f.day === now.day)
      const fh = arr<Habit & { source?: string; auto?: { minutes?: number }; dailyTargetMin?: number }>(s.habits)
        .find((h) => !h.archivedAt && (h.source === 'focus' || h.auto))
      const last = fs[fs.length - 1]
      return { min: fs.reduce((a, f) => a + (f.minutes ?? 0), 0), target: fh?.dailyTargetMin ?? fh?.auto?.minutes ?? 60, last: last ? { label: last.label ?? null, min: last.minutes } : null }
    })(),
    sleep: await (async () => {
      const { data } = await sb.from('zepp_wellness').select('day,sleep_secs,steps').eq('user_id', owner.id).order('day', { ascending: false }).limit(1)
      const w = data?.[0]
      return w?.sleep_secs ? { min: Math.round(w.sleep_secs / 60), day: w.day } : null
    })(),
    bills: await bills(sb, owner.id, now).catch(() => null),
    nameDay: NAME_DAYS[now.day.slice(5)] ?? [],
    weather: await wx,
    news: await headlines,
    syncedAt: row.updated_at,
  })
})
