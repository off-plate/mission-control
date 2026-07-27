/* Demo language parser for the dictation assistant. It splits what you say
   into items and guesses where each belongs. This is a stand-in: the real
   build sends the text to a model (Groq is the strong free option) that
   returns the same shape, then the store places and logs it identically. */

export interface ParsedItem {
  kind: 'task' | 'goal' | 'done'
  text: string
  estimateMin?: number
}

const GOAL_HINTS = /\b(goal|goals|chci|want to|i want|by the end|this (week|month|quarter|year))\b/i
const DONE_HINTS = /\b(done|did|finished|completed|hotovo|udělal|dokončil|už jsem)\b/i
const TASK_LEADS = /^(task|todo|to-do|úkol)\s*[:\-]\s*/i
const GOAL_LEADS = /^(goal|cíl)\s*[:\-]\s*/i
const DONE_LEADS = /^(done|hotovo)\s*[:\-]\s*/i

function estimate(line: string): number | undefined {
  const m = line.match(/(\d+)\s*(hours?|hrs?|h|minutes?|mins?|min|m)\b/i)
  if (!m) return undefined
  const n = Number(m[1])
  return /^h|hour|hr/i.test(m[2]) ? n * 60 : n
}

export function parseDictation(input: string): ParsedItem[] {
  return input
    .split(/[\n;.]+|,\s+(?:and\s+)?|\band\s+(?:then\s+)?|\bthen\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .map((raw) => {
      let kind: ParsedItem['kind'] = 'task'
      if (GOAL_LEADS.test(raw) || GOAL_HINTS.test(raw)) kind = 'goal'
      if (DONE_LEADS.test(raw) || DONE_HINTS.test(raw)) kind = 'done'
      /* Strip the words that only told us WHICH bucket this is. Leaving them in
         produced labels like "Goal this week send 10 cold emails". */
      const text = raw
        .replace(TASK_LEADS, '')
        .replace(GOAL_LEADS, '')
        .replace(DONE_LEADS, '')
        .replace(/^(goal|cíl)\s+(this\s+(week|month|quarter|year)\s+)?/i, '')
        .replace(/^(done|finished|completed|hotovo)\s+(with\s+)?/i, '')
        .replace(/^(i (need to|have to|should|want to)|today i want to|remind me to|už jsem|udělal jsem)\s+/i, '')
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
