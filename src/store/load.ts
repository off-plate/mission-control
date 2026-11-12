/* Reading the saved state off this device, and every one-time repair and
   migration that runs on the way in. Moved out of store.tsx unchanged
   (2026-11-12). */
import { roll } from '../roll'
import { dayIndexOf, dayOfWeekKey, goalPeriodKey, goalPeriodRange, isoWeekKey, localDateKey, periodIsPast, periodKeyFor, type GoalTf } from '../util'
import { MOCK_GOALS, MOCK_HABITS, LATE_STEPS, MOCK_ROUTINES } from '../mock'
import { goalCurrent, isTimeFed, routineComplete } from '../types'
import { foldSpaces } from '../foldspaces'
import type { Goal, HabitTick, SpaceId } from '../types'
import { BACKUP_KEY, STORAGE_KEY, type PersistedState } from './state'

/* Saved state written by a NEWER build than this one. This build cannot read it,
   so it must not write either: seeding fresh and saving would replace whatever
   the newer device wrote with an empty start. The app runs, and says so. */
let futureBlob = false
export function isReadOnly(): boolean { return futureBlob }

export function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    /* Copy the raw blob aside before a single transform runs, and never touch it
       again. Everything below rewrites his saved state in place; if any of it is
       wrong, this is the copy that gets him back. */
    try {
      if (localStorage.getItem(BACKUP_KEY) !== raw) localStorage.setItem(BACKUP_KEY, raw)
    } catch { /* a full quota must not stop the app loading */ }

    const p = JSON.parse(raw) as PersistedState
    /* Refuse only a blob from a FUTURE version, which this build cannot
       understand. Refusing an older one returned null, which seeded the mock
       data and then wrote it straight over his real state on the first change.
       That was the most dangerous line in the file. */
    if ((p.version ?? 0) > 3) { futureBlob = true; return null }
    if (p.schema && p.schema !== STORAGE_KEY) return null
    p.version = 3
    p.removedSeeds = p.removedSeeds ?? []

    /* A plan is for a day. Yesterday's cannot be allowed to sit on this morning's
       list pretending it was chosen. Tomorrow's is a different matter: he put it
       there on purpose and it has not had its day yet, so only the past is
       swept. */
    {
      const today = localDateKey()
      p.routines = (p.routines ?? []).map((r) => (r.planned && r.planned.day < today ? { ...r, planned: undefined } : r))
    }

    /* Week rollover: when the saved state belongs to an earlier ISO week, each
       habit's checkmarks are archived into its 12-week history and cleared, so
       Monday always starts a fresh row instead of showing last week's ticks. */
    const wk = isoWeekKey()

    /* One-time migration to the dated habit log. Whatever is ticked in the week
       array right now becomes dated entries, so nothing he has logged is lost by
       moving to the durable record. history[] holds twelve undated weekly counts
       and stays exactly as it is: inventing dates for it would be fabrication,
       and the new log simply starts here and grows. */
    if (!p.habitLog) {
      const ticks: HabitTick[] = []
      // Ticks belong to the week the saved state was written in, not to this one.
      const base = p.weekKey === wk ? new Date() : null
      if (base) {
        for (const h of p.habits ?? []) {
          h.days.forEach((on, i) => { if (on) ticks.push({ habitId: h.id, day: dayOfWeekKey(i, base) }) })
        }
      }
      p.habitLog = ticks
    }
    /* The one date each quit habit was carrying becomes the first record in its
       slip history. Everything after it is appended rather than overwriting. */
    if (!p.slips) {
      p.slips = (p.habits ?? [])
        .filter((h) => h.kind === 'break' && h.lastSlip)
        .map((h) => ({ habitId: h.id, day: h.lastSlip as string }))
    }
    if (!p.stepLog) {
      /* What is in stepData belongs to the period it was recorded in, and the
         only date that period gives us for certain is a daily one. A weekly or
         monthly routine's current number has no day, so it starts the series
         from the next one he logs rather than inventing a date for it. */
      p.stepLog = (p.routines ?? []).flatMap((r) =>
        r.cadence === 'weekly' || r.cadence === 'monthly' || !r.periodKey
          ? []
          : Object.entries(r.stepData ?? {}).map(([stepId, value]) => ({ routineId: r.id, stepId, day: r.periodKey as string, value })),
      )
    }
    if (!p.routineLog) {
      // A routine that is currently complete carries the day it was completed.
      p.routineLog = (p.routines ?? [])
        .filter((r) => r.completedOn && routineComplete(r, periodKeyFor(r.cadence)))
        .map((r) => ({ routineId: r.id, day: r.completedOn as string, periodKey: r.periodKey ?? periodKeyFor(r.cadence) }))
    }

    /* A row written before spaces existed has no space, which used to mean it
       counted everywhere. Stamp it once, and record that it was a guess rather
       than something he chose, so the number is at least in one place only. */
    {
      let guessed = 0
      const stamp = <T extends { space?: SpaceId }>(rows: T[] | undefined) =>
        (rows ?? []).map((r) => (r.space ? r : (guessed++, { ...r, space: 'personal' as SpaceId })))
      p.ledger = stamp(p.ledger)
      p.coachSessions = stamp(p.coachSessions)
      p.focusSessions = stamp(p.focusSessions)
      if (guessed) p.spaceGuessed = (p.spaceGuessed ?? 0) + guessed
    }

    /* Everything that has to happen because time passed happens in one place,
       walking from the day it last ran. Each of these used to be its own "is the
       saved week this week?" test, each firing once no matter how long the gap. */
    roll(p)

    /* A goal whose period has ended stops counting and keeps the number it
       finished on. Nothing is deleted: it moves to the past, where he can look
       at how it went and set it again if he wants to. */
    const renewals: Goal[] = []
    p.goals = (p.goals ?? []).map((g) => {
      const tf = (g.timeframe ?? 'quarter') as GoalTf
      const key = g.periodKey ?? goalPeriodKey(tf)
      if (g.closed || !periodIsPast(tf, key)) return { ...g, periodKey: key }
      const range = goalPeriodRange(tf, key)
      const final = goalCurrent(g, p.habits ?? [], p.habitLog ?? [], range, p.slips ?? [], p.focusSessions ?? [])
      /* A goal that counts ITSELF renews itself: three hours of focus a week is
         a standing bar, not a one-off, and making him re-set it every Monday is
         how the bar quietly disappears. The closed one keeps its result; a
         fresh copy opens for the period we are in now. Hand-logged goals stay
         one-off, with "Set it again" for the ones he wants back. */
      if (g.habitId) {
        renewals.push({
          ...g, id: `${g.id}-r${goalPeriodKey(tf).replace(/[^0-9A-Za-z]/g, '')}`,
          current: 0, milestones: [], closed: undefined, periodKey: goalPeriodKey(tf),
        })
      }
      return { ...g, periodKey: key, closed: { on: range.to, final } }
    })
    for (const r of renewals) {
      const dupe = p.goals.some((g) => !g.closed && g.habitId === r.habitId && g.name === r.name
        && (g.timeframe ?? 'quarter') === (r.timeframe ?? 'quarter') && g.periodKey === r.periodKey)
      if (!dupe) p.goals.push(r)
    }

    /* A day that has not happened yet cannot have been kept. The week array has
       always been cleaned of future ticks; the log has to be cleaned the same way
       or the two disagree the moment a migration or a clock change writes one. */
    p.habitLog = (p.habitLog ?? []).filter((t) => t.day <= localDateKey())
    p.routineLog = (p.routineLog ?? []).filter((r) => r.day <= localDateKey())

    /* A start date that never got its days. The date field shipped one build
       before the filling did, so a habit he had been keeping since July sat at
       0/7 with the date sitting right there on its card. Every habit carrying a
       start it has not been filled for gets those days written now, up to
       yesterday. Marked by filledSince, so this runs once per date and a day he
       unticks afterwards stays unticked. Runs before the week cache below, which
       then picks it up for free. */
    {
      const today = localDateKey()
      const filled: HabitTick[] = []
      p.habits = (p.habits ?? []).map((h) => {
        if (h.kind === 'break' || !h.startedOn || h.filledSince) return h
        const have = new Set((p.habitLog ?? []).filter((t) => t.habitId === h.id).map((t) => t.day))
        const cursor = new Date(`${h.startedOn}T12:00:00`)
        const end = new Date(`${today}T12:00:00`)
        if (!Number.isNaN(cursor.getTime())) {
          while (cursor < end) {
            const key = localDateKey(cursor)
            if (!have.has(key)) filled.push({ habitId: h.id, day: key, src: 'since' })
            cursor.setDate(cursor.getDate() + 1)
          }
        }
        return { ...h, filledSince: h.startedOn }
      })
      if (filled.length) p.habitLog = [...(p.habitLog ?? []), ...filled]
    }

    /* The week array is a cache. Rebuilding it from the log on every load means
       the log is the one truth and the two can never drift apart. */
    {
      const thisWeek = new Set(
        (p.habitLog ?? [])
          .filter((t) => isoWeekKey(new Date(t.day)) === wk)
          .map((t) => `${t.habitId}|${t.day}`),
      )
      /* An amount habit's day is kept by its TOTAL, not by any one row: a
         glass of water is a log, 2.5 litres is the day. */
      const amountSum = new Map<string, number>()
      for (const t of p.habitLog ?? []) if (t.v != null && isoWeekKey(new Date(t.day)) === wk) amountSum.set(`${t.habitId}|${t.day}`, (amountSum.get(`${t.habitId}|${t.day}`) ?? 0) + t.v)
      p.habits = p.habits.map((h) => ({
        ...h,
        days: Array.from({ length: 7 }, (_, i) => h.measure === 'amount'
          ? (amountSum.get(`${h.id}|${dayOfWeekKey(i)}`) ?? 0) >= (h.targetAmount ?? 1)
          : thisWeek.has(`${h.id}|${dayOfWeekKey(i)}`)),
      }))
    }

    /* ROUTINES BECOME PARTS OF THE DAY (his call, 2026-10-26): every habit a
       routine holds takes that routine's part of the day, once, as he approved
       it: wake-up, morning preparation and both work routines in the Morning,
       night work and bed in the Evening, and the weekly, monthly and on-demand
       ones at Any time (they keep their own rhythm). After that the part is
       his: `partSet` stops this from ever putting one back. Nothing is removed;
       the routine rows still drive Today, Plan and the widgets. */
    {
      const PART: Record<string, import('../types').TimeSlot> = { 'r-wakeup': 'morning', 'r-morning': 'morning', 'r-prework': 'morning', 'r-workroutine': 'morning', 'r-nightwork': 'evening', 'r-evening': 'evening' }
      const routineOf = new Map((p.routines ?? []).map((r) => [r.id, r]))
      p.habits = p.habits.map((h) => {
        if (!h.folderId || h.partSet) return h
        const r = routineOf.get(h.folderId)
        const rare = !!r && (r.cadence === 'weekly' || r.cadence === 'monthly' || (!!r.repeatable && r.cadence === 'daily'))
        const mirror = r?.habitId ? p.habits.find((x) => x.id === r.habitId) : undefined
        const daypart = rare ? undefined : (PART[h.folderId] ?? mirror?.daypart ?? h.daypart)
        return { ...h, daypart, partSet: true }
      })
    }

    /* A rename of a SEEDED row has to reach state that already exists. Renaming
       it in the seed alone did nothing here: routines and habits are his once
       they exist, so the loader never touches their titles, and the new name
       only ever appeared on a fresh install. This renames the seeded row only
       while it still carries the exact old name, so anything he has renamed
       himself is left alone and running it twice changes nothing. */
    {
      const renames: [string, string, string][] = [['r-evening', 'Evening shutdown', 'Before bed routine'], ['r-weekly', 'Weekly reset', 'Weekly review'], ['r-morningwork', 'Morning work routine', 'Morning Big Time work routine'], ['r-morning', 'Morning routine', 'Morning Preparation'], ['r-prework', 'Before work', 'Before work routine']]
      for (const [id, was, now] of renames) {
        p.routines = (p.routines ?? []).map((r) => (r.id === id && r.title === was ? { ...r, title: now } : r))
        const hid = (p.routines ?? []).find((r) => r.id === id)?.habitId
        p.habits = (p.habits ?? []).map((h) => ((h.id === hid || h.id === id.replace(/^r-/, 'h-')) && h.name === was ? { ...h, name: now } : h))
      }
    }

    /* Forward-fill fields added after this state was saved, so an existing
       install picks up new wiring (habit frequencies, habit-linked goals)
       without losing anything he has logged. Only ever fills a blank. */
    const seedH = new Map(MOCK_HABITS.map((h) => [h.id, h]))
    p.habits = p.habits.map((h) => {
      const s = seedH.get(h.id)
      return s ? { ...h, frequency: h.frequency ?? s.frequency, targetPerWeek: h.targetPerWeek ?? s.targetPerWeek } : h
    })
    // A seeded habit added later is missing entirely; append it rather than reseed.
    const removed = new Set(p.removedSeeds ?? [])
    for (const s of MOCK_HABITS) if (!removed.has(s.id) && !p.habits.some((h) => h.id === s.id)) p.habits.push(s)
    /* Same for a seeded ROUTINE added after this state was saved. Routines are
       his once they exist, so the loader hands his own list straight back and a
       new seed would otherwise only ever appear on a fresh install, which is
       exactly how the renamed evening routine went missing. Appending one row
       adds nothing to what he has already written, and a routine he deleted is
       in removedSeeds, so this cannot resurrect it. */
    p.routines = p.routines ?? []
    for (const s of MOCK_ROUTINES) if (!removed.has(s.id) && !p.routines.some((r) => r.id === s.id)) p.routines.push(s)

    /* Asked for again. The loader is right never to resurrect a routine on its
       own, so a routine deleted months ago stays deleted, and one of these was
       missing from his own state for exactly that reason. But him naming it
       again is not the same as never having deleted it: these four he asked for
       by name on 2026-08-02, so each comes back once with its habit, its
       deletion mark cleared, and behaves like any other seeded row afterwards.
       A routine still present is not touched. */
    if (!p.removedSeeds?.includes('fix:asked-again-2026-08-02')) {
      p.removedSeeds = [...(p.removedSeeds ?? []), 'fix:asked-again-2026-08-02']
      for (const id of ['r-prework', 'r-morningwork', 'r-nightwork', 'r-invoicing']) {
        const seed = MOCK_ROUTINES.find((r) => r.id === id)
        if (!seed || p.routines.some((r) => r.id === id)) continue
        p.removedSeeds = p.removedSeeds.filter((m) => m !== id && m !== seed.habitId)
        p.routines.push(seed)
        const h = MOCK_HABITS.find((x) => x.id === seed.habitId)
        if (h && !p.habits.some((x) => x.id === h.id)) p.habits.push(h)
      }
    }

    /* A step added to a seeded routine after this state was saved has to reach
       it, and a whole-list seed cannot do that once the routine has any steps at
       all. So each seeded step is handed over ONCE, at the position it holds in
       the seed, and the fact that it was handed over is remembered. Delete it
       afterwards and it stays deleted, which is the whole point of the marker:
       the app fills gaps, it does not overrule him. */
    p.removedSeeds = p.removedSeeds ?? []
    for (const s of MOCK_ROUTINES) {
      if (!s.steps.length) continue
      const mine = p.routines.find((r) => r.id === s.id)
      if (!mine) continue
      const block = `${s.id}:steps`
      /* The whole list, once, and only while he has written none of his own. */
      if (mine.steps.length === 0 && !p.removedSeeds.includes(block)) {
        p.routines = p.routines.map((r) => (r.id === s.id ? { ...r, steps: s.steps } : r))
        p.removedSeeds.push(block, ...s.steps.map((st) => `${s.id}:step:${st.id}`))
        continue
      }
      /* Into a list he already has, only a step that was added after that list
         was delivered, at the position it holds in the seed. Everything else was
         handed over long ago, so its absence means he deleted it. */
      let steps = mine.steps
      s.steps.forEach((st, i) => {
        const mark = `${s.id}:step:${st.id}`
        if (!LATE_STEPS.has(st.id) || p.removedSeeds!.includes(mark) || steps.some((x) => x.id === st.id)) return
        steps = [...steps.slice(0, i), st, ...steps.slice(i)]
        p.removedSeeds!.push(mark)
      })
      if (steps !== mine.steps) p.routines = p.routines.map((r) => (r.id === s.id ? { ...r, steps } : r))
    }

    /* Wiring a step gained after his list was saved: a habit it keeps, or the
       fact that it is optional. Steps are his, so this fills a blank and never
       overwrites, reaching the rows he already has without touching a word of
       what they say. */
    for (const s of MOCK_ROUTINES) {
      const seeded = new Map(s.steps.map((st) => [st.id, st]))
      p.routines = p.routines.map((r) => (r.id !== s.id ? r : {
        ...r,
        steps: r.steps.map((st) => {
          const from = seeded.get(st.id)
          if (!from) return st
          return {
            ...st,
            habitId: st.habitId ?? from.habitId,
            optional: st.optional ?? from.optional,
          }
        }),
      }))
    }

    /* A seeded step that has since MOVED in the seed. Order is his the moment he
       touches it, so this runs once and then never again: the marker is what
       stops a step he has deliberately dragged elsewhere from being pulled back
       into place on every reload. */
    const moves: [string, string, number][] = [['r-brainrot', 'br-ice', 0]]
    for (const [rid, sid, to] of moves) {
      const mark = `${rid}:step:${sid}:at${to}`
      if (p.removedSeeds.includes(mark)) continue
      p.removedSeeds.push(mark)
      p.routines = p.routines.map((r) => {
        if (r.id !== rid) return r
        const step = r.steps.find((x) => x.id === sid)
        if (!step) return r
        const rest = r.steps.filter((x) => x.id !== sid)
        return { ...r, steps: [...rest.slice(0, to), step, ...rest.slice(to)] }
      })
    }

    /* A day that has not happened yet cannot be done. Future ticks were also
       unreachable, since those dots are disabled, so they could never be undone. */
    const todayIdx = (new Date().getDay() + 6) % 7
    p.habits = p.habits.map((h) => ({ ...h, days: h.days.map((d, i) => (i > todayIdx ? false : d)) }))

    /* A habit a routine drives is a read-out of that routine, and its dots are
       not clickable, so a wrong value there can never be corrected by hand. It
       is therefore re-derived on every load, from HIS routines. It used to read
       LATE_STEPS,
  MOCK_ROUTINES, which meant the moment he wrote his own steps the mock's
       list (empty, for four of them) decided the answer: the tick was wiped on
       the next reload, or asserted for a routine he had not finished. */
    const savedRoutines = p.routines ?? []
    const drivenNow = new Map(
      /* A step-less routine owns nothing yet: its habit is hand-ticked until
         steps exist, and this pass must not wipe those ticks on every load. */
      savedRoutines.filter((r) => r.habitId && !r.archivedAt && r.steps.length > 0).map((r) => {
        const complete = routineComplete(r, periodKeyFor(r.cadence))
        return [r.habitId as string, { complete, on: complete ? (r.completedOn ?? localDateKey()) : null }]
      }),
    )
    const seededPastCleared = p.fixes ?? 0
    const thisWeek = isoWeekKey()
    p.habits = p.habits.map((h) => {
      const d = drivenNow.get(h.id)
      if (!d) return h
      /* The tick belongs to the day it was earned, not to today. A weekly
         routine finished on Tuesday keeps Tuesday's dot for the rest of the
         week, and loses THAT dot when it is undone on Friday. */
      const idx = d.on && isoWeekKey(new Date(d.on)) === thisWeek ? dayIndexOf(d.on) : null
      const days = h.days.map((day, i) => {
        if (!d.complete) return seededPastCleared >= 1 && i !== todayIdx ? day : false
        /* The real completion day may not be in THIS week at all: a monthly
           routine finished early in the month stays complete for weeks after,
           and there is no day in a 7-slot week to honestly place that on.
           Forcing today's dot here used to be the fallback, which is why a
           monthly review read as "done today" on every day it was reopened.
           keptThisPeriod (types.ts) is what now tells weekly/monthly consumers
           it is kept; this array only ever states a real day. */
        return idx !== null ? i === idx : day
      })
      return { ...h, days }
    })
    p.fixes = 1

    /* A goal already linked to a time habit was filed in 'checkoffs' before
       hours existed. The unit follows what the habit actually measures. */
    p.goals = (p.goals ?? []).map((g) => {
      const h = g.habitId ? (p.habits ?? []).find((x) => x.id === g.habitId) : undefined
      return h && isTimeFed(h) && g.unit === 'checkoffs' ? { ...g, unit: 'hours' } : g
    })

    const seedG = new Map(MOCK_GOALS.map((g) => [g.id, g]))
    p.goals = p.goals.map((g) => {
      const s = seedG.get(g.id)
      return s?.habitId && !g.habitId ? { ...g, habitId: s.habitId, unit: s.unit } : g
    })


    /* Sleep before 1 AM, 2026-10-04: his one health habit had never been made,
       so the morning recap could not ask about it. Started yesterday so
       tonight's recap asks. Fixed id, so two devices make the same row. */
    if (!p.removedSeeds.includes('fix:sleep-habit')) {
      p.removedSeeds.push('fix:sleep-habit')
      if (!(p.habits ?? []).some((h) => h.id === 'h-sleep-1am' || h.name.trim().toLowerCase() === 'sleep before 1 am')) {
        const y = new Date(); y.setDate(y.getDate() - 1)
        const start = localDateKey(y)
        p.habits = [...(p.habits ?? []), {
          id: 'h-sleep-1am', space: 'personal', name: 'Sleep before 1 AM', daypart: 'evening', frequency: 'daily', kind: 'build',
          startedOn: start, filledSince: start, days: [false, false, false, false, false, false, false], paused: false,
        }]
      }
    }

    /* Two workspaces, 2026-10-02: Off-Plate and Michael's Corner are projects
       inside Personal now. Idempotent, so it also runs on states that arrive
       from a device still on the old bundle (see applyExternal). */
    foldSpaces(p as unknown as Record<string, unknown>, localDateKey())
    return p
  } catch {
    return null
  }
}
