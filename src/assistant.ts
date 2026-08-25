/* The assistant's brain. Pure: it builds the briefing, calls the model, and
   validates what comes back. Nothing here renders and nothing here writes.

   THE RULE THAT MAKES IT TRUSTWORTHY: the model never states a number.

   It cannot say "you have three things today", because a model that says that
   will one day say four when there are three, and then every figure in this
   app is worth nothing. It picks WHICH CARD TO SHOW; the app draws that card
   from the same store every other page reads. So the sentence is the model's
   and the data is his, and the two cannot disagree because they do not come
   from the same place.

   MULTI-USER, BY CONSTRUCTION: this runs in his browser, against a store that
   is already scoped to his account, with a key that lives on his device only.
   There is no server here to query the wrong row. Another person's data is not
   kept out by a check that could be wrong; it is not in the building.

   The briefing below is deliberately small: counts and titles, no bodies, no
   money, no note contents. It is what a colleague glancing at the screen would
   see, and nothing that would be a problem if the model logged it. */

import { getAiKey, groq } from './ai'

const MODEL = 'llama-3.3-70b-versatile'

/** What a card shows. The app owns every one of these; the model only names one. */
export type CardKind =
  | 'today'      // what is on the day, by part of day
  | 'backlog'    // the list, oldest first
  | 'habits'     // what today asks of him
  | 'calendar'   // the meetings ahead
  | 'goals'
  | 'focus'      // the week's blocks
  | 'stale'      // what has been sitting too long

export interface Card { kind: CardKind; note?: string }

export interface Reply {
  /** One or two sentences. His language, no numbers. */
  say: string
  /** What to draw underneath, in order. */
  show: Card[]
  /** Follow-ups worth a tap, phrased as he would ask them. */
  next?: string[]
}

const KINDS: CardKind[] = ['today', 'backlog', 'habits', 'calendar', 'goals', 'focus', 'stale']

/** A compact picture of his day. Titles and counts, nothing private. */
export interface Brief {
  now: string
  weekday: string
  planned: { slot: string; items: { title: string; done: boolean; min: number }[] }[]
  backlogCount: number
  oldest: { title: string; days: number }[]
  habits: { due: number; kept: number; open: string[] }
  meetings: { at: string; title: string }[]
  focusToday: number
  goals: { name: string; pct: number }[]
}

const SYSTEM = `You are the assistant inside Mission Control, Michael's own life dashboard.

He is Czech, in Prague, running a design agency job plus a side business, and
the app exists because admin rots on his list and evenings get lost. Talk to him
the way a sharp chief of staff would: short, direct, no cheerleading, no
"I'd be happy to". Never more than two sentences before the cards.

YOU MUST NOT STATE NUMBERS OR TITLES. Not "you have 3 tasks", not "your first
is X". The app draws the real data from his own log; if you write a number it
will eventually be the wrong one and he will stop believing the app. Say what
he should look at and why, then name the cards.

Answer ONLY with JSON:
{"say": "...", "show": [{"kind":"today"}], "next": ["...", "..."]}

kind is one of: today, backlog, habits, calendar, goals, focus, stale.
Use several cards when the question spans them. Use none if he is just talking.
"next" holds up to three follow-ups written in HIS voice, as questions he might
ask next. Reply in the language he wrote in.`

/** The opening move, before he has asked anything. */
export const OPENING_PROMPT =
  'Open the day. Look at the briefing and tell me what deserves attention first, then show it.'

export function briefText(b: Brief): string {
  const slots = b.planned
    .map((s) => `${s.slot}: ${s.items.length ? s.items.map((i) => `${i.title}${i.done ? ' (done)' : ''}`).join('; ') : 'empty'}`)
    .join('\n')
  return [
    `Now: ${b.now}, ${b.weekday}`,
    `Planned today:\n${slots}`,
    `Backlog: ${b.backlogCount} open`,
    b.oldest.length ? `Oldest untouched: ${b.oldest.map((o) => `${o.title} (${o.days}d)`).join('; ')}` : 'Nothing is ageing badly',
    `Habits today: ${b.habits.kept} of ${b.habits.due} kept${b.habits.open.length ? `, still open: ${b.habits.open.join('; ')}` : ''}`,
    b.meetings.length ? `Meetings: ${b.meetings.map((m) => `${m.at} ${m.title}`).join('; ')}` : 'No meetings in the calendar',
    `Focus logged today: ${b.focusToday} minutes`,
    b.goals.length ? `Goals: ${b.goals.map((g) => `${g.name} ${g.pct}%`).join('; ')}` : 'No goals set',
  ].join('\n')
}

export type Outcome =
  | { ok: true; reply: Reply }
  | { ok: false; reason: 'no-key' | 'rejected' | 'offline' | 'unreadable'; detail?: string }

/** One turn. `history` is the conversation so far, oldest first. */
export async function ask(
  question: string,
  brief: Brief,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<Outcome> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  let res: Response
  try {
    res = await groq({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'system', content: `Today's briefing, read from his own log:\n${briefText(brief)}` },
        ...history.slice(-8),
        { role: 'user', content: question },
      ],
    }, key)
  } catch {
    return { ok: false, reason: 'offline' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected' }
  if (!res.ok) return { ok: false, reason: 'unreadable', detail: `The model answered ${res.status}.` }

  try {
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as Partial<Reply>
    const say = typeof parsed.say === 'string' ? parsed.say.trim() : ''
    if (!say) return { ok: false, reason: 'unreadable' }
    /* Anything it invented outside the card vocabulary is dropped rather than
       rendered: an unknown card is a card this app cannot promise is true. */
    const show = Array.isArray(parsed.show)
      ? parsed.show.filter((c): c is Card => !!c && KINDS.includes((c as Card).kind)).slice(0, 4)
      : []
    const next = Array.isArray(parsed.next)
      ? parsed.next.filter((n) => typeof n === 'string' && n.trim()).slice(0, 3)
      : []
    return { ok: true, reply: { say, show, next } }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}
