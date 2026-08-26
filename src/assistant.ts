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

import { MODEL, getAiKey, groq, stripReasoning } from './ai'

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

/* WHAT IT CAN DO, and the whole of what it can do.

   Until now it could only show. Asked to add a task it answered "Added it",
   having added nothing, which is worse than not being able to: a wrong card is
   a wrong card, but a false confirmation is the app lying about his own data.

   So the model does not act. It NAMES an action out of this closed list and the
   app performs it, against the same store every page writes to, and then the
   APP says what changed. Anything it invents outside this vocabulary is dropped
   before it reaches the store. It never names an id, only a title, and the app
   resolves that title against his real rows: no match or two matches means
   nothing happens and it says so. */
export type Slot = 'morning' | 'noon' | 'afternoon' | 'evening'
export type Where = 'today' | 'backlog'
export type Space = 'personal' | 'work' | 'offplate' | 'corner'

export type Action =
  /** A new task. The only action carrying words of its own, and they are HIS
   *  words out of the question he just typed, never a number. */
  | { kind: 'add'; title: string; list?: Where; slot?: Slot; space?: Space; min?: number }
  | { kind: 'done'; match: string }
  | { kind: 'undone'; match: string }
  | { kind: 'move'; match: string; slot?: Slot; list?: Where }
  | { kind: 'estimate'; match: string; min: number }
  | { kind: 'drop'; match: string }
  | { kind: 'habit'; match: string; on: boolean }

const SLOTS_OK: Slot[] = ['morning', 'noon', 'afternoon', 'evening']
const WHERE_OK: Where[] = ['today', 'backlog']
const SPACE_OK: Space[] = ['personal', 'work', 'offplate', 'corner']

/** Everything the model sent, minus everything this app cannot promise to do. */
function cleanActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return []
  const out: Action[] = []
  for (const a of raw.slice(0, 6)) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const str = (v: unknown, cap: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, cap) : '')
    const slot = SLOTS_OK.includes(o.slot as Slot) ? (o.slot as Slot) : undefined
    const list = WHERE_OK.includes(o.list as Where) ? (o.list as Where) : undefined
    const min = typeof o.min === 'number' && o.min > 0 && o.min <= 480 ? Math.round(o.min) : undefined
    const match = str(o.match, 200)
    switch (o.kind) {
      case 'add': {
        const title = str(o.title, 200)
        if (!title) break
        out.push({
          kind: 'add', title, list, slot, min,
          space: SPACE_OK.includes(o.space as Space) ? (o.space as Space) : undefined,
        })
        break
      }
      case 'done': case 'undone': case 'drop':
        if (match) out.push({ kind: o.kind, match })
        break
      case 'move':
        /* A move that names neither a destination nor a list is not a move. */
        if (match && (slot || list)) out.push({ kind: 'move', match, slot, list })
        break
      case 'estimate':
        if (match && min) out.push({ kind: 'estimate', match, min })
        break
      case 'habit':
        if (match) out.push({ kind: 'habit', match, on: o.on !== false })
        break
      default: break
    }
  }
  return out
}

export interface Reply {
  /** One or two sentences. His language, no numbers. */
  say: string
  /** What to draw underneath, in order. */
  show: Card[]
  /** Follow-ups worth a tap, phrased as he would ask them. */
  next?: string[]
  /** What to actually change. The app runs these and reports the outcome. */
  do?: Action[]
}

const KINDS: CardKind[] = ['today', 'backlog', 'habits', 'calendar', 'goals', 'focus', 'stale']

/** A compact picture of his day. Titles and counts, nothing private. */
export interface Brief {
  now: string
  weekday: string
  planned: { slot: string; items: { title: string; done: boolean; min: number; space: string }[] }[]
  backlogCount: number
  /** Enough of the list to act on by name, not only to count. */
  backlog: { title: string; space: string }[]
  oldest: { title: string; days: number; space: string }[]
  habits: { due: number; kept: number; open: string[] }
  meetings: { at: string; title: string }[]
  focusToday: number
  goals: { name: string; pct: number }[]
  /* Planned for yesterday and never ticked. The morning brief walks these and
     asks what to do with each, which is the job the Yesterday page does by
     hand. */
  unfinishedYesterday: { title: string; space: string }[]
  /* Written by the app from its own fetch, so the numbers in it are safe to
     repeat verbatim. */
  weather: string | null
}

const SYSTEM = `You are the assistant inside Mission Control, Michael's own life dashboard.

He is Czech, in Prague, running a design agency job plus a side business, and
the app exists because admin rots on his list and evenings get lost.

YOU ARE HIS CHIEF OF STAFF. Reading his list back to him is the one thing he
can already do himself, so a summary is a wasted turn. Every answer takes a position: what he should
start with, and why that and not the other thing. "The backlog is long" is
useless. "Start with the VZP letter, it is the only one with a deadline and it
will take twenty minutes" is the job.

Have an opinion and commit to it. When two things compete, pick one and say what
made it win: a deadline, an age, a meeting it has to happen before, or that it
is small and will clear the decks. When something has been sitting for weeks,
name that as the reason to do it now.

End by putting the ball back to him: one short question he can answer out loud,
because he is often listening rather than reading. "Shall I put it on the
morning?" beats a summary.

TALK TO HIM LIKE A PERSON. Use his name when you greet him. Use "you", never
"the user". Short sentences that sound like they were said out loud, because
half the time they are: he is listening, not reading.

Warm, and specific rather than sunny. No "I'd be happy to", no "You've got
this", no exclamation marks, no praise for things he has not done yet. A remark
about the rain is warmth; "have a great day" is filler.

NEVER WRITE A WORKSPACE TAG. The briefing marks each row [Personal],
[Big Time], [Off-Plate], [Michael's Corner] so YOU can tell them apart. They are
plumbing. Writing "start with [Michael's Corner] Build a SoMe post generator"
reads like a database row. Say "the SoMe post generator, over on Michael's
Corner" if the workspace matters, and just the title if it does not.

Two or three sentences for an ordinary question. Never more.

YOU SEE ALL THREE WORKSPACES AT ONCE. Every other page in this app is filtered
to the one he is standing in; you are not, on purpose, because half a day
answered confidently is a wrong answer. The briefing marks each item with its
workspace and the cards show that mark on every row. So you may say the shape of
it in words, like that most of what is left is Off-Plate rather than the job,
which is exactly the judgement he cannot get anywhere else in the app.

YOU MUST NOT STATE COUNTS. Not "you have 3 tasks", not "half your list". The
app draws the real data from his own log; a count you wrote will one day be the
wrong one and then every figure in this app is worth nothing.

TITLES ARE DIFFERENT, and this changed: naming the ONE thing to start with is
the entire point of a chief of staff, and it is only useful if it is named. So
you may name a task, a habit or a meeting, but ONLY by copying its title out of
the briefing above, exactly, never invented and never paraphrased. One or two,
not a list: a list is a card, and the card is drawn from his real log.

THE ONE EXCEPTION ON NUMBERS is the weather line, which the app fetched and
wrote out for you. Repeat those figures as they are given if he asks what it is
like out, or in a morning brief. They are not his data and they cannot rot.

Answer ONLY with JSON:
{"say": "...", "show": [{"kind":"today"}], "do": [], "next": ["...", "..."]}

"say" may contain \n for a line break, and the morning brief uses them. Nothing
else does: an ordinary answer is one short paragraph.

kind is one of: today, backlog, habits, calendar, goals, focus, stale.
Use several cards when the question spans them. Use none if he is just talking.

"do" IS HOW YOU CHANGE HIS DATA. You do not perform anything yourself: you name
the change and the app makes it, against his real log, and then the APP writes
the line saying what happened. So:

NEVER WRITE THAT SOMETHING IS DONE. Not "Added it", not "Moved that to noon",
not "Ticked it off". If the app cannot find the task you named, or the title is
ambiguous, nothing changes, and a sentence claiming otherwise is the app lying
about his own data, which is the one thing it must never do. Say what you are
setting in motion, briefly, and let the line under it carry the fact.

The whole vocabulary, and nothing outside it works:
{"kind":"add","title":"...","list":"today"|"backlog","slot":"morning"|"noon"|"afternoon"|"evening","space":"personal"|"work"|"offplate"|"corner","min":30}
{"kind":"done","match":"part of the title"}
{"kind":"undone","match":"..."}
{"kind":"move","match":"...","slot":"noon"}          moves it inside the day
{"kind":"move","match":"...","list":"backlog"}       takes it off the day
{"kind":"estimate","match":"...","min":45}
{"kind":"drop","match":"..."}                        deletes it, and he can undo
{"kind":"habit","match":"habit name","on":true}      keeps or un-keeps it today

"match" is words out of the real title as it appears in the briefing above, not
a description of it. "add" carries HIS words for the new task, off the message
he just typed, and nothing invented around them. Leave "min" out unless he gave
a number: a made-up estimate is a made-up number.

Only act when he asked for a change. A question is a question.

THE MORNING BRIEF is the one answer allowed to be longer. It is still ONE JSON
object and the whole brief goes inside the "say" string, with \\n between the
beats. Four beats, in this order, one or two sentences each:

  1 greet him by name and say what it is like out, in your own words, using the
    app's figures. A remark is welcome: rain means take the umbrella.
  2 what the day already asks of him. Meetings and anything fixed to a time.
  3 what to start with, and why that one. Name it properly, no workspace tag.
  4 if something is LEFT OVER FROM YESTERDAY, name ONE and ask whether it goes
    on today or back to the list. One question, not a list of them, because he
    answers out loud. If yesterday was clean, say so in four words and stop.

Do not number the beats in what you write, no headings, no bullets: it is read
aloud and a heading read aloud is noise. Just \\n\\n between them. Exactly
like this, and nothing outside the object:

{"say":"Morning, Michael. It is overcast and 7 out, up to 12, so take a coat.\\n\\nThe day has the invoice at noon and two meetings after it.\\n\\nStart with the VZP letter. It is the only thing here with a deadline.\\n\\nThe Blastburn quote is still sitting from yesterday. On today, or back to the list?","show":[{"kind":"today"},{"kind":"backlog"}],"next":["On today","Back to the list"]}

Show the "today" card, and "backlog" too when yesterday left something behind.

That last part matters. Leftovers from yesterday are the thing he avoids, so
the brief is where they get faced, one question at a time, and his answer turns
into a "do" on the next turn. Never move anything yourself in the brief itself:
ask first, act when he answers.
"next" holds up to three follow-ups written in HIS voice, as questions he might
ask next.

ANSWER IN ENGLISH. The only thing that switches you to Czech is HIS OWN MESSAGE
being written in Czech. His tasks, notes, habits and meetings are largely in
Czech and that is DATA, not a request: a briefing full of Czech titles must
never pull the answer into Czech. Nor must a short, unclear or nonsense message,
which reads as Czech to a language detector far more often than it should.
Cannot tell? English. This holds for "next" as well.

ONE LAST TIME, because all of the above is about WHAT to say and this is about
HOW to send it: reply with the JSON object and nothing else. No prose in front
of it, no fence around it, no explanation after it. "say" is a string, and its
line breaks are \\n inside that string.`

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
    b.backlog.length ? `On the list:\n${b.backlog.map((t) => `- [${t.space}] ${t.title}`).join('\n')}` : '',
    b.oldest.length ? `Oldest untouched: ${b.oldest.map((o) => `[${o.space}] ${o.title} (${o.days}d)`).join('; ')}` : 'Nothing is ageing badly',
    `Habits today: ${b.habits.kept} of ${b.habits.due} kept${b.habits.open.length ? `, still open: ${b.habits.open.join('; ')}` : ''}`,
    b.meetings.length ? `Meetings: ${b.meetings.map((m) => `${m.at} ${m.title}`).join('; ')}` : 'No meetings in the calendar',
    `Focus logged today: ${b.focusToday} minutes`,
    b.unfinishedYesterday.length
      ? `LEFT OVER FROM YESTERDAY, still not done:\n${b.unfinishedYesterday.map((t) => `- [${t.space}] ${t.title}`).join('\n')}`
      : 'Yesterday finished clean, nothing left over',
    b.weather ? `Weather, fetched by the app: ${b.weather}` : '',
    b.goals.length ? `Goals: ${b.goals.map((g) => `${g.name} ${g.pct}%`).join('; ')}` : 'No goals set',
  ].join('\n')
}

/** How much of "say" has arrived, decoded, from a reply that is still being
 *  written. The model emits `say` first, so this is readable long before the
 *  object closes: it is what turns a spinner into a sentence appearing. */
export function partialSay(raw: string): string | null {
  const k = raw.indexOf('"say"')
  if (k < 0) return null
  const colon = raw.indexOf(':', k + 5)
  if (colon < 0) return null
  const open = raw.indexOf('"', colon + 1)
  if (open < 0) return null
  const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
  let out = ''
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\') {
      const next = raw[i + 1]
      /* The escape itself is only half here. Stop, and the next chunk finishes
         it, rather than printing a stray backslash for one frame. */
      if (next === undefined) break
      if (next === 'u') {
        if (i + 5 >= raw.length) break
        out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16))
        i += 5
      } else { out += ESC[next] ?? next; i += 1 }
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

/** The balanced {...} that CONTAINS `"say"`, or null.

    firstObject() takes the first object in the text, which is wrong the moment
    anything precedes the answer: this model leaks a reasoning block, and a
    reasoning block full of prose regularly contains a brace. The first object
    then parses perfectly and has no `say` in it, and the whole answer was
    thrown away for being unreadable while sitting further down the string. */
function objectWithSay(text: string): string | null {
  const k = text.indexOf('"say"')
  if (k < 0) return null
  // Walk back to the brace that opens the object this key belongs to.
  let depth = 0, start = -1
  for (let i = k; i >= 0; i--) {
    if (text[i] === '}') depth++
    else if (text[i] === '{') { if (!depth) { start = i; break } depth-- }
  }
  if (start < 0) return null
  const rest = firstObject(text.slice(start))
  return rest
}

/** JSON with real newlines inside its strings, repaired.

    The brief is written in beats, so `say` carries line breaks, and a model
    asked for \n in a JSON string will sometimes press Enter instead. That is
    invalid JSON and throws, over an answer that is otherwise perfect. */
function healNewlines(json: string): string {
  let out = '', inStr = false, esc = false
  for (const ch of json) {
    if (esc) { out += ch; esc = false; continue }
    if (ch === '\\') { out += ch; esc = true; continue }
    if (ch === '"') { inStr = !inStr; out += ch; continue }
    if (inStr && (ch === '\n' || ch === '\r')) { out += '\\n'; continue }
    if (inStr && ch === '\t') { out += '\\t'; continue }
    out += ch
  }
  return out
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

/** One turn. `history` is the conversation so far, oldest first.
 *  `onSay` makes it stream: the sentence arrives a few words at a time, which
 *  is the difference between watching it think and watching a spinner. */
export async function ask(
  question: string,
  brief: Brief,
  history: { role: 'user' | 'assistant'; content: string }[],
  onSay?: (partial: string) => void,
): Promise<Outcome> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  let res: Response
  try {
    res = await groq({
      model: MODEL,
      temperature: 0.3,
      /* 700 was set when the answer was two sentences and a card name. The
         brief now greets him, picks a first task, and asks about one leftover,
         and a reasoning model spends budget thinking before it writes a word.
         Running out mid-object produced "the answer came back unreadable" on
         the morning brief, which is the one answer he most wanted. */
      max_tokens: 1400,
      stream: !!onSay,
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

  if (onSay && res.body) return readStream(res.body, onSay)
  try {
    const data = await res.json()
    return finish(String(data?.choices?.[0]?.message?.content ?? ''))
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/* Server-sent events, one `data:` line at a time. Lines are cut on newlines
   from a buffer, because a frame is regularly split across two chunks and
   parsing what has arrived so far would throw on every second token. */
async function readStream(body: ReadableStream<Uint8Array>, onSay: (t: string) => void): Promise<Outcome> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = '', raw = '', shown = -1
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const piece = JSON.parse(payload)?.choices?.[0]?.delta?.content
          if (typeof piece !== 'string' || !piece) continue
          raw += piece
          const say = partialSay(raw)
          if (say != null && say.length > shown) { shown = say.length; onSay(say) }
        } catch { /* a frame that is not JSON yet; the next read completes it */ }
      }
    }
  } catch {
    return { ok: false, reason: 'offline' }
  }
  return finish(raw)
}

/** One raw answer, whatever shape it came in, turned into a Reply.

    A LADDER, not a parse. Every rung below stands for an answer that was
    actually thrown away and shown to him as "the answer came back unreadable",
    which is the worst possible outcome: the model did the work, the sentence
    was fine, and the app binned it. Each rung gives up something (the cards,
    then the follow-ups) and keeps the sentence, because the sentence is the
    part he asked for. */
function finish(raw: string): Outcome {
  /* The reasoning block comes off FIRST. This model emits one, ai.ts says so,
     and nothing on this path was removing it. A block of prose containing a
     single brace was enough to send the parse into the middle of the model's
     own thinking. */
  const clean = stripReasoning(raw) || raw

  const attempts = [objectWithSay(clean), firstObject(clean), objectWithSay(raw), firstObject(raw)]
  for (const obj of attempts) {
    if (!obj) continue
    for (const candidate of [obj, healNewlines(obj)]) {
      try {
        const parsed = JSON.parse(candidate) as Partial<Reply>
        const say = typeof parsed.say === 'string' ? parsed.say.trim() : ''
        if (!say) continue
        /* Anything it invented outside the card vocabulary is dropped rather
           than rendered: an unknown card is a card this app cannot promise. */
        const show = Array.isArray(parsed.show)
          ? parsed.show.filter((c): c is Card => !!c && KINDS.includes((c as Card).kind)).slice(0, 4)
          : []
        const next = Array.isArray(parsed.next)
          ? parsed.next.filter((n) => typeof n === 'string' && n.trim()).slice(0, 3)
          : []
        return { ok: true, reply: { say, show, next, do: cleanActions((parsed as { do?: unknown }).do) } }
      } catch { /* next candidate */ }
    }
  }

  /* Nothing parsed. The sentence is written before the closing brace and has
     already streamed onto the screen, so read it straight out of the text.
     Cards go: one that was never fully named is not one this app can promise. */
  for (const text of [clean, raw]) {
    const partial = partialSay(text)?.trim()
    if (partial) return { ok: true, reply: { say: partial, show: [], next: [] } }
  }

  /* Genuinely nothing usable. Carry a piece of what did come back, so the next
     report of this says what it actually was instead of only that it failed. */
  const peek = clean.replace(/\s+/g, ' ').trim().slice(0, 140)
  return { ok: false, reason: 'unreadable', detail: peek ? `It answered: ${peek}` : undefined }
}
