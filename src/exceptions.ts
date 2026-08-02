import { MOCK_MONEY } from './mock'
import type { Routine, SpaceId, Task } from './types'
import { goalPeriodRange, localDateKey, periodIsPast, type GoalTf } from './util'

export { SPACE_LABELS, MOCK_AGENDA } from './mock'

/* The other half of the ledger. The app is quick to tell him what is wrong, so
   this collects what is actually going right, from real events only. No score,
   no streak-shaming, no emoji: receipts he earned. */
export function momentum(ctx: {
  tasks: Task[]
  routines: Routine[]
  habits: { id: string; name: string; days: boolean[]; history?: number[]; space: SpaceId }[]
  coachSessions: { didIt?: boolean; felt?: string; status: string }[]
}): string[] {
  const out: string[] = []

  const paid = ctx.tasks.filter((t) => t.done && /^Send: /.test(t.title)).length
  if (paid > 0) out.push(`${paid} ${paid === 1 ? 'payment' : 'payments'} sent from here.`)

  const faced = ctx.coachSessions.filter((s) => s.didIt).length
  const easier = ctx.coachSessions.filter((s) => s.didIt && s.felt === 'easier').length
  if (faced > 0) {
    out.push(easier > 0
      ? `${faced} ${faced === 1 ? 'thing' : 'things'} faced in Avoidance, ${easier} ${easier === 1 ? 'was' : 'were'} easier than you feared.`
      : `${faced} ${faced === 1 ? 'thing' : 'things'} faced instead of avoided.`)
  }

  // Longest run of weeks a habit was kept at least four days, from its history.
  const best = ctx.habits
    .map((h) => {
      let run = 0
      for (let i = (h.history ?? []).length - 1; i >= 0; i--) {
        if ((h.history ?? [])[i] >= 4) run++
        else break
      }
      return { name: h.name, run }
    })
    .sort((a, b) => b.run - a.run)[0]
  if (best && best.run >= 2) out.push(`${best.name}, kept ${best.run} weeks running.`)

  const doneToday = ctx.tasks.filter((t) => t.done && t.list === 'today').length
  if (doneToday >= 3) out.push(`${doneToday} finished today.`)

  return out.slice(0, 3)
}

/** A task open this many days counts as avoided, not merely pending. */
const AVOID_DAYS = 7

function daysOld(createdAt?: string): number {
  if (!createdAt) return 0
  const [y, m, d] = createdAt.split('-').map(Number)
  if (!y) return 0
  const then = new Date(y, m - 1, d).getTime()
  const now = new Date(localDateKey()).getTime()
  return Math.max(0, Math.round((now - then) / 86400000))
}

/* Exceptions are DERIVED from live state, not hardcoded: money rows that still
   need sending, the weekly Datová schránka check not done this week, an old
   unanswered lead. When you act (queue the task, tick the routine step), the
   alert disappears on its own. */

/** One canonical task title per payment, shared by Money and Today's alert, so
 *  queueing or paying it in one place is recognised in the other. */
export function paymentTaskTitle(name: string, amount: string): string {
  return `Send: ${name.split(',')[0]} (${amount})`
}

export interface ExceptionItem {
  id: string
  text: string
  when: string
  action?: 'coach' | 'add-task' | 'open-goals'
  coachId?: string
  /** Free text handed to Coach's analyser (used by the ageing alerts). */
  coachSeed?: string
  /** The task this alert is about, so Today can offer to drop it. */
  taskId?: string
  actionLabel?: string
  task?: { title: string; estimateMin: number }
  /** Raised in Personal but shown in every profile (money, official post). */
  fromPersonal?: boolean
}

/* Money and admin do not belong to a profile: they are true all day, including
   the eight hours he spends in Work. Hiding them there is exactly the avoidance
   this app exists to break, so they are computed once and shown everywhere,
   marked so it is obvious they come from Personal. */
export function globalExceptions(ctx: { tasks: Task[]; routines: Routine[] }): ExceptionItem[] {
  // Money and official post only. Personal's ageing tasks stay in Personal,
  // or the Work profile turns into a wall of somebody else's list.
  return exceptionsFor('personal', ctx)
    .filter((x) => x.id.startsWith('x-money') || x.id === 'x-datovka')
    .map((x) => ({ ...x, fromPersonal: true }))
}

export function exceptionsFor(space: SpaceId, ctx: { tasks: Task[]; routines: Routine[] }): ExceptionItem[] {
  const out: ExceptionItem[] = []

  if (space === 'personal') {
    // Money: every schedule row that still needs an action becomes an alert.
    // TodayPage hides it once its task is queued and done.
    for (const row of MOCK_MONEY?.schedule ?? []) {
      if (row.state !== 'not sent' && row.state !== 'action needed') continue
      const short = row.name.split(',')[0]
      out.push({
        id: `x-money-${row.date}-${short}`,
        text: `${short}: ${row.amount} due ${row.date}, not sent.`,
        when: row.date,
        action: 'add-task',
        actionLabel: 'Add the transfer to today',
        task: { title: paymentTaskTitle(row.name, row.amount), estimateMin: 5 },
      })
    }

  }

  /* A period that ends does not get to quietly drop what he promised it. The
     tasks are still on his list either way, but the PROMISE needs answering:
     move it to the period running now, or admit it is not happening. This is
     derived, so acting on it in Goals takes the alert away with it. */
  const left = ctx.tasks.filter((t) => !t.done && t.space === space && t.horizon && t.horizonKey
    && periodIsPast(t.horizon as GoalTf, t.horizonKey))
  if (left.length) {
    const oldest = left
      .map((t) => goalPeriodRange(t.horizon as GoalTf, t.horizonKey!))
      .sort((a, b) => (a.to < b.to ? -1 : 1))[0]
    out.push({
      id: 'x-left-behind',
      text: left.length === 1
        ? `One thing you promised is still unfinished: “${left[0].title}”.`
        : `${left.length} things you promised are still unfinished.`,
      when: oldest.label,
      action: 'open-goals',
      actionLabel: 'Decide now',
    })
  }

  /* The real avoidance detector: anything still open a week after it appeared,
     oldest first. This is the promise of the app, that a thing cannot quietly
     sit there for three weeks while you push it every evening. */
  const stale = ctx.tasks
    .filter((t) => !t.done && t.space === space && daysOld(t.createdAt) >= AVOID_DAYS)
    .sort((a, b) => daysOld(b.createdAt) - daysOld(a.createdAt))
    .slice(0, 2)
  for (const t of stale) {
    const d = daysOld(t.createdAt)
    out.push({
      id: `x-stale-${t.id}`,
      text: `“${t.title}” has been on your list ${d} days.`,
      when: `${d} days`,
      action: 'coach',
      coachSeed: t.title,
      actionLabel: 'Face it',
      taskId: t.id,
    })
  }

  return out
}
