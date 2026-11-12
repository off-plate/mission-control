import { type CardKind } from '../assistant'

/* ---- the cards ----
   Every one reads the store directly. None of them is handed anything by the
   model beyond its own name. Every row carries its workspace, always, because
   this page mixes all three on purpose. */


/* Rows land one after another instead of all at once, capped at ten so a long
   list never turns into a loading screen. 18ms apart is under the threshold
   where it reads as waiting; it reads as the list being dealt. */
export const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 10) * 18}ms` })

/** The head of a list, plus any touched row that sits below the cut, first, so
 *  a change is never hidden behind "12 more". */
export function fit<T>(all: T[], n: number, isHot: (x: T) => boolean): T[] {
  return [...all.filter((x, i) => i >= n && isHot(x)), ...all.slice(0, n)]
}

export const rowCls = (on: boolean, done?: boolean) => `as-row${done ? ' is-done' : ''}${on ? ' is-touched' : ''}`

export const TITLES: Record<CardKind, string> = {
  today: 'On the day', backlog: 'The list', habits: 'Habits today',
  calendar: 'Calendar', goals: 'Goals', focus: 'Focus', stale: 'Sitting longest',
  weather: 'Prague', planned: 'Coming up', projects: 'Projects', routines: 'Routines',
  notes: 'Notes', people: 'People', ideas: 'Ideas', bills: 'Bills this cycle', gym: 'Gym targets',
  prompts: 'Prompts', business: 'Business',
}
