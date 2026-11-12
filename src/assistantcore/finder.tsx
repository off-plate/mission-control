import { useRef } from 'react'
import { useStore } from '../store'
import { isMeeting, useCalendar } from '../calendar'
import { SPACE_LABELS } from '../mock'
import { type Find } from '../assistant'
import { useAssistantBills } from '../assistantbills'
import { goalCurrent, daysClean, type SpaceId } from '../types'
import { localDateKey, taskMinutes, goalPeriodKey, goalPeriodRange, type GoalTf } from '../util'
import { TIER_LABEL } from '../peoplelayout'
import { SOURCES, STAGES, label } from '../prospectcalc'
import { APPS } from '../apps'
import { dropUrl, fold, noteName } from './shared'

/** The model's eyes: one lookup over his real rows, answered in plain lines
 *  it can copy titles out of. Read from the latest render each time, so a
 *  lookup after an action sees what that action wrote. */
export function useFinder() {
  const st = useStore()
  const { state: cal } = useCalendar()
  const bills = useAssistantBills()
  const live = useRef({ st, cal, bills })
  live.current = { st, cal, bills }

  return (q: Find): string => {
    const { st: s, cal: c, bills: b } = live.current
    const day = localDateKey()
    const qf = q.query ? fold(q.query) : ''
    const words = qf.split(' ').filter((w) => w.length > 2)
    const hit = (t: string) => !qf || fold(t).includes(qf) || (words.length > 0 && words.every((w) => fold(t).includes(w)))
    const projectName = (id?: string) => s.projects.find((p) => p.id === id)?.name
    const where = (t: { space?: SpaceId; projectId?: string }) => projectName(t.projectId) ?? (t.space ? SPACE_LABELS[t.space] : 'Unfiled')
    let rows: string[] = []
    switch (q.what) {
      case 'tasks':
        rows = s.tasks.filter((t) => !t.done && hit(t.title)).map((t) => [
          dropUrl(t.title) || t.title,
          t.list === 'today' ? `planned ${t.plannedOn ?? day}${t.slot ? ` ${t.slot}` : ''}${t.at ? ` at ${t.at}` : ''}` : 'on the list',
          where(t), `${taskMinutes(t)}m`,
          t.subtasks?.length ? `steps: ${t.subtasks.map((x) => `${x.title}${x.done ? ' (done)' : ''}`).join('; ')}` : '',
          t.createdAt ? `added ${t.createdAt}` : '',
        ].filter(Boolean).join(' | '))
        break
      case 'done':
        rows = s.tasks.filter((t) => t.done && hit(t.title))
          .sort((x, y) => (y.doneAt ?? '').localeCompare(x.doneAt ?? ''))
          .map((t) => `${dropUrl(t.title) || t.title} | done ${t.doneAt ? localDateKey(new Date(t.doneAt)) : '?'}${t.actualMin != null ? ` | took ${t.actualMin}m` : ''} | ${where(t)}`)
        break
      case 'projects':
        rows = s.projects.filter((p) => hit(p.name)).map((p) => `${p.name} | ${SPACE_LABELS[p.space]} | ${s.tasks.filter((t) => t.projectId === p.id && !t.done).length} open tasks`)
        break
      case 'habits':
        rows = s.habits.filter((h) => !h.archivedAt && hit(h.name)).map((h) => [
          h.name, h.kind === 'break' ? `quitting, ${daysClean(h, s.slips) ?? 0}d clean` : h.kind, h.frequency,
          h.paused ? 'paused' : '', h.kind !== 'break' ? (h.days[s.todayIndex] ? 'kept today' : 'open today') : '',
        ].filter(Boolean).join(' | '))
        break
      case 'routines':
        rows = s.routines.filter((r) => !r.archivedAt && hit(r.title)).map((r) => `${r.title} | ${r.cadence} | steps: ${r.steps.map((x) => `${x.title}${r.doneStepIds.includes(x.id) ? ' (done)' : ''}`).join('; ') || 'none yet'}`)
        break
      case 'goals':
        rows = s.goals.filter((g) => hit(g.name)).map((g) => {
          const tf = (g.timeframe ?? 'quarter') as GoalTf
          const cur = goalCurrent(g, s.habits, s.habitLog, goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf)), s.slips, s.focusSessions)
          return [
            g.name, `${cur} of ${g.target} ${g.unit}`, tf, g.closed ? `closed ${g.closed.on}` : 'open',
            g.habitId ? 'counts itself from a habit' : '',
            g.milestones?.length ? `milestones: ${g.milestones.map((x) => `${x.label}${x.done ? ' (done)' : ''}`).join('; ')}` : '',
          ].filter(Boolean).join(' | ')
        })
        break
      case 'notes':
        rows = s.notes.filter((n) => hit(`${noteName(n)} ${n.body}`)).map((n) => [
          noteName(n), s.noteFolders.find((f) => f.id === n.folderId)?.name ?? SPACE_LABELS[n.space],
          n.pinned ? 'pinned' : '', n.done ? 'done' : '', n.body.replace(/\s+/g, ' ').slice(0, 140),
        ].filter(Boolean).join(' | '))
        rows.push(`Folders: ${s.noteFolders.map((f) => f.name).join('; ') || 'none'}`)
        break
      case 'people':
        rows = s.people.filter((p) => hit(`${p.name} ${p.rel ?? ''}`)).map((p) => {
          const last = s.personContacts.filter((x) => x.personId === p.id).map((x) => x.day).sort().at(-1)
          return [p.name, TIER_LABEL[p.tier], p.rel, p.job, p.birthday ? `birthday ${p.birthday}` : '', last ? `last in touch ${last}` : 'no contact logged'].filter(Boolean).join(' | ')
        })
        rows.push(...s.prospects.filter((p) => hit(`${p.name} ${p.domain ?? ''} ${p.people.map((x) => x.name).join(' ')}`)).map((p) => [
          `prospect ${p.name}`, p.domain, label(STAGES, p.stage), label(SOURCES, p.source), p.value != null ? `value ${p.value}` : '',
          p.people.map((x) => [x.name, x.role, x.decides ? 'decides' : ''].filter(Boolean).join(' ')).join('; '),
          p.touches.map((t) => `${t.step} ${t.day}`).join(', ') || 'no touches',
        ].filter(Boolean).join(' | ')))
        break
      case 'ideas':
        rows = s.ideaBoard.filter((x) => hit(`${x.title} ${x.body}`)).map((x) => `${x.title}${x.body ? ` | ${x.body.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`)
        break
      case 'bills':
        if (b.loading) return 'Bills is still loading on this device.'
        if (!b.ready) return 'Bills is not signed in on this device.'
        rows = b.items.filter((i) => hit(i.name)).map((i) => `${i.name} | ${i.amount} Kč | ${i.paid ? 'paid' : i.overdue ? 'OVERDUE' : 'unpaid'}${i.dueOn ? ` | due ${i.dueOn}` : ''}`)
        break
      case 'calendar': {
        if (c.status !== 'ok') return 'The calendar is not connected or has not loaded.'
        const from = new Date(); from.setDate(from.getDate() - 7)
        const to = new Date(); to.setDate(to.getDate() + 21)
        rows = c.events.filter((e) => e.day >= localDateKey(from) && e.day <= localDateKey(to) && hit(e.title))
          .sort((x, y) => `${x.day}${String(x.start ?? 0).padStart(4, '0')}`.localeCompare(`${y.day}${String(y.start ?? 0).padStart(4, '0')}`))
          .map((e) => `${e.day}${e.start != null ? ` ${String(Math.floor(e.start / 60)).padStart(2, '0')}:${String(e.start % 60).padStart(2, '0')}` : ' all day'} | ${e.title} | ${isMeeting(e) ? 'meeting' : 'block'}`)
        break
      }
      case 'focus':
        rows = s.focusSessions.slice(-60).reverse().filter((f) => hit(f.label ?? '')).map((f) => `${f.day} | ${f.minutes}m${f.label ? ` | ${f.label}` : ''}`)
        break
      case 'gym':
        rows = s.gymGoals.filter((g) => hit(g.name)).map((g) => `${g.name} | ${g.current ?? '?'} of ${g.goal} ${g.unit}${g.exerciseName ? ` | ${g.exerciseName}` : ''}`)
        break
      case 'prompts':
        rows = s.prompts.filter((p) => hit(p.text)).map((p) => `${p.text.replace(/\s+/g, ' ').slice(0, 120)} | ${p.project} | ${p.kind}${p.sentAt ? ' | sent' : ''}`)
        break
      case 'apps':
        rows = APPS.filter((x) => hit(x.name)).map((x) => x.name)
        break
    }
    if (!rows.length) return `Nothing found${q.query ? ` for "${q.query}"` : ''}.`
    const CAP = 40
    return rows.slice(0, CAP).map((r) => `- ${r}`).join('\n') + (rows.length > CAP ? `\n(${rows.length - CAP} more: narrow the query)` : '')
  }
}
