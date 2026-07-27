import { MOCK_MONEY } from './mock'
import type { Routine, SpaceId, Task } from './types'

export { SPACE_LABELS, MOCK_AGENDA } from './mock'

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
  action?: 'coach' | 'add-task'
  coachId?: string
  actionLabel?: string
  task?: { title: string; estimateMin: number }
}

export function exceptionsFor(space: SpaceId, ctx: { tasks: Task[]; routines: Routine[] }): ExceptionItem[] {
  const out: ExceptionItem[] = []

  if (space === 'personal') {
    // Money: every schedule row that still needs an action becomes an alert.
    // TodayPage hides it once its task is queued and done.
    for (const row of MOCK_MONEY.schedule) {
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

    /* Datová schránka: one fact, two places you can settle it. Either tick the
       weekly-reset step, or finish a task that says you checked it. Both clear
       the alert, so it can never nag about something already done. */
    const weekly = ctx.routines.find((r) => r.id === 'r-weekly')
    const viaTask = ctx.tasks.some((t) => t.done && /datov[áa]\s*schr[áa]nk/i.test(t.title))
    const dsChecked = weekly?.doneStepIds.includes('wk1') || viaTask
    if (weekly && !dsChecked) {
      const isSunday = new Date().getDay() === 0
      out.push({
        id: 'x-datovka',
        text: 'Datová schránka not checked this week.',
        when: isSunday ? 'Sunday rule, today' : 'weekly rule',
        action: 'coach',
        coachId: 'datova-schranka',
        actionLabel: 'Walk me through it',
      })
    }
  }

  if (space === 'offplate') {
    // A lead that is still waiting on a reply. Derived from the open task, so
    // sending the follow-up (completing the task) clears the alert itself.
    const lead = ctx.tasks.find((t) => t.space === 'offplate' && !t.done && /follow-up|workshop lead/i.test(t.title))
    if (lead) {
      out.push({
        id: 'x-lead',
        text: 'Workshop lead from Thursday still has no reply.',
        when: 'open',
        action: 'coach',
        coachId: 'chase-supplier',
        actionLabel: 'Draft the follow-up',
      })
    }
  }

  return out
}
