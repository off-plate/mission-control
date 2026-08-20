/* What the morning email is allowed to say.

   Pure, and separate from the function that sends it, so every sentence in
   here can be tested against a fabricated state without a mailbox anywhere
   near it. The same law the app runs on applies: every number is counted from
   a dated record he wrote by living. Nothing is estimated, nothing is
   encouraging on no evidence, and a quiet day is described as quiet.

   It reads the SAME state blob the app syncs, so there is no second source of
   truth to drift and no change to the app to make this work. */

export interface Blob {
  habits?: any[]; habitLog?: any[]; tasks?: any[]; focusSessions?: any[]
  ledger?: any[]; routineLog?: any[]; stepTicks?: any[]; stepLog?: any[]
  slips?: any[]; notes?: any[]; review?: any
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const shift = (key: string, by: number) => {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + by))
}
/** Monday = 0, matching the app. */
const dowOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

/** The last day he did ANYTHING. Opening the app is not doing anything. */
export function lastActivity(s: Blob): string | null {
  const days: string[] = []
  const push = (v: unknown) => { if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) days.push(v.slice(0, 10)) }
  for (const t of s.habitLog ?? []) push(t.day)
  for (const f of s.focusSessions ?? []) push(f.day)
  for (const l of s.ledger ?? []) push(l.when)
  for (const r of s.routineLog ?? []) push(r.day)
  for (const t of s.stepTicks ?? []) push(t.day)
  for (const e of s.stepLog ?? []) push(e.day)
  for (const p of s.slips ?? []) push(p.day)
  for (const t of s.tasks ?? []) if (t.done && t.doneAt) push(String(t.doneAt).slice(0, 10))
  for (const r of s.review?.reflections ?? []) push(r.to)
  for (const n of s.notes ?? []) if (n.updatedAt) push(dayKey(new Date(n.updatedAt)))
  days.sort()
  return days.length ? days[days.length - 1] : null
}

export function silentDays(s: Blob, today: string): number | null {
  const last = lastActivity(s)
  if (!last) return null
  const ms = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
  return Math.max(0, Math.round((ms(today) - ms(last)) / 86400000))
}

/** Did this habit ask anything of that day? Weekly and monthly ones ask for a
 *  PERIOD, so they cannot have missed a single night and are never named. */
function askedOn(h: any, day: string): boolean {
  if (h.paused || h.archivedAt) return false
  if (h.startedOn && day < h.startedOn) return false
  if (h.kind === 'break') return false          // a quit is not missed, it is slipped
  if (h.auto || h.kind === 'measured') return false  // the clock keeps these, not him
  const f = h.frequency ?? 'daily'
  if (f === 'daily') return true
  if (f === 'weekdays') return dowOf(day) < 5
  return false
}

/** What he was asked for last night and did not do. Folders, not raw habits,
 *  because a folder is one thing to do the way the routine it came from was:
 *  the same rule the app's own headline counts by. */
export function missed(s: Blob, day: string): { habits: string[]; tasks: string[] } {
  const kept = new Set((s.habitLog ?? []).filter((t: any) => t.day === day).map((t: any) => t.habitId))
  const due = (s.habits ?? []).filter((h: any) => askedOn(h, day))
  const byFolder = new Map<string, { name: string; total: number; done: number }>()
  const loose: string[] = []
  const folderName = (id: string) => (s.habits ?? []).find((h: any) => h.id === id)?.name
  /* A folder's OWN habit is the routine's streak, so it is the folder and not
     a row beside it. Without this it is named twice in the same list, once as
     "Morning Preparation, 1 of 2" and once bare, which reads as two different
     things he missed. */
  const heads = new Set((s.habits ?? []).map((h: any) => h.folderId).filter(Boolean) as string[])
  for (const h of due) {
    if (h.optional || heads.has(h.id)) continue
    if (h.folderId) {
      const f = byFolder.get(h.folderId) ?? { name: folderName(h.folderId) ?? 'A routine', total: 0, done: 0 }
      f.total += 1; if (kept.has(h.id)) f.done += 1
      byFolder.set(h.folderId, f)
    } else if (!kept.has(h.id)) loose.push(h.name)
  }
  const habits: string[] = []
  for (const [, f] of byFolder) {
    if (f.done >= f.total) continue
    habits.push(f.done === 0 ? f.name : `${f.name}, ${f.done} of ${f.total}`)
  }
  habits.push(...loose)
  /* Planned for that day and not finished. Read off plannedOn rather than the
     list, because by the time this runs the rollover has already swept them
     back to the backlog and none of them say "today" any more. */
  const tasks = (s.tasks ?? [])
    .filter((t: any) => !t.done && t.plannedOn === day)
    .map((t: any) => t.title)
  return { habits, tasks }
}

/** Minutes focused on each of the last n days, most recent last. */
export function focusRun(s: Blob, today: string, n = 7): { day: string; min: number }[] {
  const out: { day: string; min: number }[] = []
  for (let i = n; i >= 1; i--) {
    const d = shift(today, -i)
    out.push({ day: d, min: (s.focusSessions ?? []).filter((f: any) => f.day === d).reduce((a: number, f: any) => a + (f.minutes ?? 0), 0) })
  }
  return out
}

/** Monday to Sunday of the week before the one `today` sits in. */
export function lastWeek(s: Blob, today: string) {
  const mondayThis = shift(today, -dowOf(today))
  const from = shift(mondayThis, -7)
  const to = shift(mondayThis, -1)
  const inRange = (d: string) => d >= from && d <= to
  const focusMin = (s.focusSessions ?? []).filter((f: any) => inRange(f.day)).reduce((a: number, f: any) => a + (f.minutes ?? 0), 0)
  const keptDays = new Set((s.habitLog ?? []).filter((t: any) => inRange(t.day)).map((t: any) => `${t.habitId}|${t.day}`)).size
  const finishedTimed = (s.ledger ?? []).filter((e: any) => inRange(e.when)).length
  const finishedUntimed = (s.tasks ?? []).filter((t: any) => t.done && t.actualMin === undefined && t.doneAt && inRange(String(t.doneAt).slice(0, 10))).length
  const routines = (s.routineLog ?? []).filter((r: any) => inRange(r.day)).length
  return { from, to, focusMin, keptDays, finished: finishedTimed + finishedUntimed, routines }
}

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
const nice = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The whole email, as plain text. Null when there is genuinely nothing to
 *  say, because an email that arrives every morning saying "all good" is an
 *  email he stops opening, and then the one that matters is unread too. */
export function compose(s: Blob, today: string): { subject: string; body: string } | null {
  const y = shift(today, -1)
  const m = missed(s, y)
  const silent = silentDays(s, today)
  const run = focusRun(s, today)
  const w = lastWeek(s, today)
  const nothingMissed = m.habits.length === 0 && m.tasks.length === 0
  if (nothingMissed && (silent === null || silent < 1)) return null

  const L: string[] = []
  if (silent !== null && silent >= 2) {
    L.push(`Nothing has been logged for ${silent} days. Last thing on the record is ${nice(lastActivity(s)!)}.`)
    L.push('')
  }
  L.push(`MISSED ${nice(y).toUpperCase()}`)
  if (nothingMissed) {
    L.push('  Nothing. Everything that was asked of it was done.')
  } else {
    for (const h of m.habits) L.push(`  ${h}`)
    for (const t of m.tasks) L.push(`  ${t}  (planned, not done)`)
  }
  L.push('')
  L.push('FOCUS, LAST 7 DAYS')
  const total = run.reduce((a, r) => a + r.min, 0)
  if (total === 0) {
    L.push('  No blocks in seven days.')
  } else {
    for (const r of run) L.push(`  ${nice(r.day).padEnd(12)} ${r.min ? hm(r.min) : '.'}`)
    L.push(`  ${'total'.padEnd(12)} ${hm(total)}`)
  }
  L.push('')
  L.push(`LAST WEEK, ${nice(w.from)} to ${nice(w.to)}`)
  L.push(`  ${hm(w.focusMin)} focused`)
  L.push(`  ${w.keptDays} habit ${w.keptDays === 1 ? 'day' : 'days'} kept`)
  L.push(`  ${w.finished} finished`)
  L.push(`  ${w.routines} ${w.routines === 1 ? 'routine' : 'routines'} closed`)
  L.push('')
  L.push('https://off-plate.github.io/mission-control/')

  const subject = silent !== null && silent >= 2
    ? `${silent} days without a single entry`
    : nothingMissed ? 'Mission Control' : `Missed ${nice(y)}: ${m.habits.length + m.tasks.length} open`
  return { subject, body: L.join('\n') }
}
