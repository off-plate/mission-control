/* Demo language parser for the dictation assistant. It splits what you say
   into items and guesses where each belongs. This is a stand-in: the real
   build sends the text to a model (Groq is the strong free option) that
   returns the same shape, then the store places and logs it identically.

   The mic is set to Czech, so Czech is the FIRST language here, not a bonus.
   And one rule above all: never strip a word whose meaning was not applied.
   The old version deleted "cíl" from the front of a line and then filed the
   line as a task, which is worse than not understanding it at all. */

export interface ParsedItem {
  kind: 'task' | 'goal' | 'done'
  text: string
  estimateMin?: number
}

/* What makes a line a goal: the word for one (EN or CZ, diacritics optional),
   or wanting-language. A bare "týden" does not - planning a week is a task. */
const GOAL_HINTS = /\b(goals?|c[íi]le?|chci|cht[ěe]l bych|want to|i want|by the end|this (week|month|quarter|year))\b/i
const DONE_HINTS = /\b(done|did|finished|completed|hotovo|ud[ěe]lal|dokon[čc]il|u[žz] jsem)\b/i
const TASK_LEADS = /^(task|todo|to-do|[úu]kol)\b\s*[:\-]?\s*/i
const GOAL_LEADS = /^(goals?|c[íi]l)\b\s*[:\-]?\s*/i
const DONE_LEADS = /^(done|hotovo)\b\s*[:\-]?\s*/i
/* "na tento týden", "do konce měsíce", "this month" - the horizon phrase that
   follows a goal word and belongs to the routing, not to the goal's name. */
const HORIZON_TAIL = /^((na|za|do|pro)\s+)?((konce?\s+)?(tento|tenhle|tohoto|p[řr][íi][šs]t[íi])\s+)?(t[ýy]den|t[ýy]dne|m[ěe]s[íi]ce?|kvart[áa]lu?|roku?|this\s+(week|month|quarter|year))\s*/i

function estimate(line: string): number | undefined {
  const m = line.match(/(\d+)\s*(hours?|hrs?|h|hodin[ay]?|minutes?|mins?|min|minut[ya]?|m)\b/i)
  if (!m) return undefined
  const n = Number(m[1])
  return /^h/i.test(m[2]) ? n * 60 : n
}

export function parseDictation(input: string): ParsedItem[] {
  return input
    .split(/[\n;.]+|,\s+(?:and\s+)?|\band\s+(?:then\s+)?|\bthen\b|\ba\s+pak\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .map((raw) => {
      let kind: ParsedItem['kind'] = 'task'
      if (GOAL_LEADS.test(raw) || GOAL_HINTS.test(raw)) kind = 'goal'
      if (DONE_LEADS.test(raw) || DONE_HINTS.test(raw)) kind = 'done'
      /* Strip ONLY the words whose meaning the kind above actually carries. */
      let text = raw.replace(TASK_LEADS, '')
      if (kind === 'goal') {
        text = text.replace(GOAL_LEADS, '').replace(HORIZON_TAIL, '')
          .replace(/^(chci|cht[ěe]l bych|i want to|want to)\s+/i, '')
      }
      if (kind === 'done') {
        text = text.replace(DONE_LEADS, '')
          .replace(/^(done|finished|completed|hotovo)\s+(with\s+)?/i, '')
          .replace(/^(u[žz] jsem|ud[ěe]lal jsem|dokon[čc]il jsem)\s+/i, '')
      }
      text = text
        .replace(/^(i (need to|have to|should)|today i want to|remind me to|mus[íi]m|m[ěe]l bych)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim()
      return { kind, text: text.charAt(0).toUpperCase() + text.slice(1), estimateMin: estimate(raw) }
    })
    .filter((p) => p.text.length > 1)
}

export const TAB_FOR: Record<ParsedItem['kind'], string> = {
  task: 'Plan · today',
  done: 'Plan · done today',
  goal: 'Goals · this week',
}
