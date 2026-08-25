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

import { MODEL, getAiKey, groq } from './ai'

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
  planned: { slot: string; items: { title: string; done: boolean; min: number; space: string }[] }[]
  backlogCount: number
  oldest: { title: string; days: number; space: string }[]
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

YOU SEE ALL THREE WORKSPACES AT ONCE. Every other page in this app is filtered
to the one he is standing in; you are not, on purpose, because half a day
answered confidently is a wrong answer. The briefing marks each item with its
workspace and the cards show that mark on every row. So you may say the shape of
it in words, like that most of what is left is Off-Plate rather than the job,
which is exactly the judgement he cannot get anywhere else in the app.

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

/* The chips under the box. Not "attach", "search", "reason", "create image":
   those are a general chatbot's furniture and none of them is a thing this app
   can do. His words: he wants them to be practices that are useful in THIS
   application. So each one is a question about his own week that the assistant
   can actually answer from his own log, and pressing one asks it. */
export const STARTERS: { label: string; ask: string }[] = [
  { label: 'What is on today', ask: 'What is on my plate today? Show me the day.' },
  { label: 'What am I avoiding', ask: 'What have I been putting off the longest? Show me the oldest things on the list.' },
  { label: 'Plan my evening', ask: 'It is evening. What is realistic to finish tonight, and what should wait?' },
  { label: 'How was my week', ask: 'How did this week actually go? Show me the focus and the habits.' },
  { label: 'What is next', ask: 'What is coming up in the calendar, and does the day still fit?' },
  { label: 'Habits today', ask: 'Which habits are still open today?' },
]

/** The line under the question on the empty page.

 *  Computed HERE, from his own briefing, and never sent to a model. It is the
 *  proactive half of what he asked for, and it costs no request: opening the
 *  page should tell him something true immediately, not spin while a model is
 *  asked what his own log already says. It is also the one place numbers are
 *  allowed in a sentence, because the app is the one counting. */
export function opener(b: Brief): string {
  const open = b.planned.flatMap((s) => s.items).filter((i) => !i.done).length
  const oldest = b.oldest[0]
  const bits: string[] = []
  if (open) bits.push(`${open} thing${open === 1 ? '' : 's'} still open today`)
  if (b.meetings.length) bits.push(`${b.meetings.length} in the calendar`)
  if (b.habits.due - b.habits.kept > 0) bits.push(`${b.habits.due - b.habits.kept} habit${b.habits.due - b.habits.kept === 1 ? '' : 's'} not kept yet`)
  const head = bits.length ? `${bits.join(', ')}.` : 'Nothing on the day yet.'
  return oldest && oldest.days >= 7
    ? `${head} "${oldest.title}" has been waiting ${oldest.days} days.`
    : head
}

/** The opening move, before he has asked anything. */
export const OPENING_PROMPT =
  'Open the day. Look at the briefing and tell me what deserves attention first, then show it.'

export function briefText(b: Brief): string {
  const slots = b.planned
    .map((s) => `${s.slot}: ${s.items.length ? s.items.map((i) => `[${i.space}] ${i.title}${i.done ? ' (done)' : ''}`).join('; ') : 'empty'}`)
    .join('\n')
  return [
    `Now: ${b.now}, ${b.weekday}`,
    'Everything below spans all his workspaces at once.',
    `Planned today:\n${slots}`,
    `Backlog: ${b.backlogCount} open`,
    b.oldest.length ? `Oldest untouched: ${b.oldest.map((o) => `[${o.space}] ${o.title} (${o.days}d)`).join('; ')}` : 'Nothing is ageing badly',
    `Habits today: ${b.habits.kept} of ${b.habits.due} kept${b.habits.open.length ? `, still open: ${b.habits.open.join('; ')}` : ''}`,
    b.meetings.length ? `Meetings: ${b.meetings.map((m) => `${m.at} ${m.title}`).join('; ')}` : 'No meetings in the calendar',
    `Focus logged today: ${b.focusToday} minutes`,
    b.goals.length ? `Goals: ${b.goals.map((g) => `${g.name} ${g.pct}%`).join('; ')}` : 'No goals set',
  ].join('\n')
}

/** The first balanced {...} in a blob of text, or null. */
function firstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (!depth) return text.slice(start, i + 1) }
  }
  return null
}

export type Outcome =
  | { ok: true; reply: Reply }
  | { ok: false; reason: 'no-key' | 'rejected' | 'offline' | 'unreadable' | 'model-gone'; detail?: string }

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
  if (!res.ok) {
    /* Say WHAT went wrong, in the provider's own words. The model this app used
       was retired on 2026-08-16 and every AI feature died at once, silently,
       because each caller swallowed the error and showed nothing. A dead model
       answers 404 with a sentence naming itself; that sentence belongs on
       screen. */
    let detail = `The model answered ${res.status}.`
    try {
      const body = await res.json()
      const msg = body?.error?.message
      if (typeof msg === 'string' && msg.trim()) detail = msg.trim()
    } catch { /* not JSON, keep the status */ }
    return { ok: false, reason: res.status === 404 ? 'model-gone' : 'unreadable', detail }
  }

  try {
    const data = await res.json()
    const raw = String(data?.choices?.[0]?.message?.content ?? '')
    /* Parsed out of the text rather than trusting a JSON response mode this
       model does not document. It answers with an object, sometimes wrapped in
       a fence or a sentence, so the first balanced {...} is taken and the rest
       ignored. */
    const parsed = JSON.parse(firstObject(raw) ?? raw) as Partial<Reply>
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
