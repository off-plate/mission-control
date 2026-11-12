/* Health and the gym, shaped for Claude. Pure: rows and Hevy pages in, answers out; the network
   calls live in tools-body.ts. Ports, with the app's file named beside each:
   - parseHevy        src/hevy.ts fetchHevyWorkoutDays (days, stair days, per-day minutes and volume,
                      per-exercise best set by Epley e1RM, PR flags), with Prague's calendar day
   - gymGoalsLive     src/gymcalc.ts currentFor + pctFor (sessions = distinct Hevy days ever)
   - hevyHabitTicks   src/hevy.ts syncHevy: Workout / Gym / Fitness gets every Hevy day, Bike / Run /
                      Stairs gets the stair-machine days; ONLY turns days on, never off (his rule)
   - healthReport     src/health.ts lastReading: every reading carries the day it was taken */
import { McError, arr, dateKey, type Blob, type Row } from './ops.ts'
import { markDayOn } from './ops-growth.ts'

const pragueDay = (iso: string): string => dateKey(new Date(iso))
const epley = (w: number, reps: number) => w * (1 + reps / 30)
const r1 = (n: number) => Math.round(n * 10) / 10

export const TARGET_HABIT_NAME = 'workout / gym / fitness' // src/hevy.ts
export const CARDIO_HABIT_NAME = 'bike / run / stairs'     // src/cardio.ts

export interface HevyParsed {
  days: string[]; stairDays: string[]
  stats: Record<string, { minutes: number; volumeKg: number }>
  history: Record<string, { day: string; e1rm: number; weight: number; reps: number; repTotal: number; isPR: boolean }[]>
  workouts: Row[]
}

/** src/hevy.ts fetchHevyWorkoutDays, over the pages already fetched. */
export function parseHevy(workouts: Row[]): HevyParsed {
  const days = new Set<string>(); const stairDays = new Set<string>()
  const stats: HevyParsed['stats'] = {}
  const best: Record<string, Record<string, { weight: number; reps: number; e1rm: number; repTotal: number }>> = {}
  const kept: Row[] = []
  for (const w of workouts) {
    if (!w?.start_time || Number.isNaN(Date.parse(w.start_time))) continue
    const day = pragueDay(w.start_time)
    days.add(day)
    const minutes = w.end_time && !Number.isNaN(Date.parse(w.end_time)) ? Math.max(0, Math.round((Date.parse(w.end_time) - Date.parse(w.start_time)) / 60000)) : 0
    const volumeKg = (w.exercises ?? []).reduce((ea: number, ex: Row) => ea + (ex.sets ?? []).reduce((sa: number, s: Row) => sa + (typeof s.weight_kg === 'number' && typeof s.reps === 'number' ? s.weight_kg * s.reps : 0), 0), 0)
    const prev = stats[day]
    stats[day] = { minutes: (prev?.minutes ?? 0) + minutes, volumeKg: (prev?.volumeKg ?? 0) + volumeKg }
    const exs: Row[] = []
    for (const ex of w.exercises ?? []) {
      if (!ex?.title) continue
      if (/stair|step ?mill/i.test(ex.title)) stairDays.add(day)
      const sets = (ex.sets ?? []).filter((s: Row) => typeof s.reps === 'number').map((s: Row) => ({ weight_kg: typeof s.weight_kg === 'number' ? s.weight_kg : 0, reps: s.reps as number }))
      const timed = (ex.sets ?? []).filter((s: Row) => typeof s.duration_seconds === 'number').reduce((a: number, s: Row) => a + s.duration_seconds, 0)
      if (!sets.length) { exs.push({ name: ex.title, sets: (ex.sets ?? []).length, ...(timed ? { minutes: Math.round(timed / 60) } : {}) }); continue }
      const repTotal = sets.reduce((a: number, s: { reps: number }) => a + s.reps, 0)
      let top = sets[0]; let topE = epley(top.weight_kg, top.reps)
      for (const s of sets.slice(1)) { const e = epley(s.weight_kg, s.reps); if (e > topE) { top = s; topE = e } }
      const byDay = (best[ex.title] ??= {}); const p = byDay[day]
      byDay[day] = {
        weight: !p || topE > p.e1rm ? top.weight_kg : p.weight, reps: !p || topE > p.e1rm ? top.reps : p.reps,
        e1rm: Math.max(p?.e1rm ?? 0, topE), repTotal: (p?.repTotal ?? 0) + repTotal,
      }
      exs.push({ name: ex.title, sets: sets.length, bestSet: `${top.weight_kg} kg x ${top.reps}`, e1rm: r1(topE), reps: repTotal })
    }
    kept.push({ day, title: typeof w.title === 'string' ? w.title.slice(0, 80) : null, minutes, volumeKg: Math.round(volumeKg), exercises: exs })
  }
  const history: HevyParsed['history'] = {}
  for (const [name, byDay] of Object.entries(best)) {
    let max = 0
    history[name] = Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day))
      .map((x) => { const isPR = x.e1rm > max; if (isPR) max = x.e1rm; return { ...x, isPR } })
  }
  return { days: [...days], stairDays: [...stairDays], stats, history, workouts: kept.sort((a, b) => String(b.day).localeCompare(String(a.day))) }
}

/** src/gymcalc.ts currentFor + pctFor. */
export function gymGoalsLive(b: Blob, h: HevyParsed): Row[] {
  const sessions = Object.keys(h.stats).length
  return arr(b, 'gymGoals').map((g) => {
    const rows = g.exerciseName ? h.history[g.exerciseName] : undefined
    const current: number | null = g.metric === 'e1rm' ? (rows?.length ? rows.reduce((m, x) => Math.max(m, x.e1rm), 0) : null)
      : g.metric === 'repTotal' ? (rows?.length ? rows.reduce((m, x) => Math.max(m, x.repTotal), 0) : null)
      : g.metric === 'sessions' ? sessions : (g.current ?? null)
    let pct = 0
    if (current != null && g.goal > 0) {
      if (g.lowerIsBetter) { const start = g.current ?? current; pct = start <= g.goal ? 1 : Math.max(0, Math.min(1, (start - current) / (start - g.goal))) }
      else pct = Math.max(0, Math.min(1, current / g.goal))
    }
    return {
      id: g.id, name: g.name, metric: g.metric, ...(g.exerciseName ? { exercise: g.exerciseName } : {}),
      current: current == null ? null : r1(current), goal: g.goal, unit: g.unit, pct: Math.round(pct * 100),
      ...(g.lowerIsBetter ? { lowerIsBetter: true } : {}),
      ...(current == null ? { status: g.exerciseName ? `never logged in Hevy as "${g.exerciseName}"` : 'no number yet' } : {}),
      ...(g.metric === 'manual' ? { source: 'kept by hand (edit_gym_goal)' } : { source: 'live from Hevy' }),
    }
  })
}

export function gymReport(b: Blob, h: HevyParsed, i: { from: string; to: string }): Row {
  const ws = h.workouts.filter((w) => w.day >= i.from && w.day <= i.to)
  const prs = Object.entries(h.history).flatMap(([name, rows]) => rows.filter((x) => x.isPR && x.day >= i.from && x.day <= i.to).map((x) => ({ day: x.day, exercise: name, e1rm: r1(x.e1rm), set: `${x.weight} kg x ${x.reps}` })))
    .sort((a, c) => c.day.localeCompare(a.day))
  const lastDay = h.days.slice().sort().at(-1) ?? null
  return {
    from: i.from, to: i.to,
    sessions: ws.length, minutes: ws.reduce((a, w) => a + w.minutes, 0), volumeKg: ws.reduce((a, w) => a + w.volumeKg, 0),
    lastSession: lastDay, daysSinceLastSession: lastDay ? Math.round((Date.parse(`${dateKey()}T12:00:00Z`) - Date.parse(`${lastDay}T12:00:00Z`)) / 86400000) : null,
    sessionsOnRecord: Object.keys(h.stats).length,
    goals: gymGoalsLive(b, h),
    prs,
    workouts: ws,
    note: 'Read live from Hevy. Volume counts weight x reps sets only; a timed set (plank, stairs) has no volume. A PR is a new all-time best e1RM (Epley) for that exercise.',
  }
}

/** src/hevy.ts syncHevy: tick the habits Hevy proves, only days not already kept, only ON. */
export function hevyHabitTicks(b: Blob, h: HevyParsed, from: string): { text: string; added: number } {
  const today = dateKey()
  const live = arr(b, 'habits').filter((x) => !x.archivedAt)
  const workout = live.filter((x) => String(x.name ?? '').trim().toLowerCase() === TARGET_HABIT_NAME)
  const cardio = live.filter((x) => String(x.name ?? '').trim().toLowerCase() === CARDIO_HABIT_NAME)
  if (!workout.length) throw new McError('There is no habit named "Workout / Gym / Fitness", which is the one Hevy ticks (matched by name, as in the app). Nothing was changed.')
  const kept = (id: string, day: string) => arr(b, 'habitLog').some((t) => t.habitId === id && t.day === day)
  const said: string[] = []; let added = 0
  const tick = (habits: Row[], days: string[]) => {
    for (const hb of habits) {
      const fresh = days.filter((d) => d >= from && d <= today && !kept(hb.id, d)).sort()
      for (const d of fresh) markDayOn(b, hb.id, d, true)
      added += fresh.length
      said.push(fresh.length ? `"${hb.name}": ticked ${fresh.join(', ')}` : `"${hb.name}": already up to date`)
    }
  }
  tick(workout, h.days)
  if (h.stairDays.length) tick(cardio, h.stairDays)
  return { added, text: `Hevy since ${from}: ${said.join('; ')}. Days are only turned on, never off, as in the app.` }
}

/* ---- health ---- */
const METRICS = ['steps', 'sleep_secs', 'sleep_score', 'resting_hr', 'weight', 'ctl', 'atl'] as const
const ago = (day: string) => Math.round((Date.parse(`${dateKey()}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000)

export function healthReport(wellness: Row[], sessions: Row[], run: Row | null, i: { from: string; to: string }): Row {
  const days = wellness.slice().sort((a, c) => String(a.day).localeCompare(String(c.day)))
  const latest: Row = {}
  for (const k of METRICS) {
    for (let x = days.length - 1; x >= 0; x--) {
      const v = days[x][k]
      if (v != null) { latest[k] = { value: k === 'sleep_secs' ? `${Math.floor(v / 3600)}h ${String(Math.round((v % 3600) / 60)).padStart(2, '0')}m` : v, day: days[x].day, daysOld: ago(days[x].day) }; break }
    }
    if (!latest[k]) latest[k] = null
  }
  const sDay = (s: Row) => String(s.start_date_local ?? s.start_date ?? '').slice(0, 10)
  const inRange = sessions.filter((s) => sDay(s) >= i.from && sDay(s) <= i.to).sort((a, c) => sDay(c).localeCompare(sDay(a)))
  return {
    from: i.from, to: i.to,
    latestReadings: latest,
    days: days.filter((d) => d.day >= i.from && d.day <= i.to).reverse().map((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v != null))),
    sessions: inRange.map((s) => ({
      day: sDay(s), type: s.type ?? null, name: s.name ? String(s.name).slice(0, 80) : null,
      minutes: s.moving_time != null ? Math.round(s.moving_time / 60) : null, avgHr: s.average_heartrate ?? null, maxHr: s.max_heartrate ?? null,
      calories: s.calories ?? null, load: s.icu_training_load ?? null, km: s.distance != null ? Math.round(s.distance / 100) / 10 : null,
    })),
    lastSync: run ? { at: run.ran_at, ok: run.ok, ...(run.error ? { error: String(run.error).slice(0, 200) } : {}) } : null,
    note: 'Watch -> Zepp -> Intervals.icu -> these tables (zepp-sync, every two hours). Every reading says the day it was actually taken: a metric whose stream went quiet shows its old day, never today. Never present an old reading as current.',
  }
}
