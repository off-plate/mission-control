/* Real task breakdown, through Groq.

   Where the key lives, and why: this repo is public, so nothing goes in the
   bundle. Compass keeps its Groq key in the synced Supabase row, but this app's
   row is readable with the anon key that ships in the page, so a key stored
   there would effectively be published. Here it stays in localStorage on the
   machine you typed it on: never synced, never in the repo, never in the build.
   The cost is that you paste it once per device, which is the right trade. */

import type { TaskCategory } from './types'

const KEY_STORE = 'mc-groq-key'
const MODEL = 'llama-3.3-70b-versatile'
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

export function getAiKey(): string {
  try { return localStorage.getItem(KEY_STORE) ?? '' } catch { return '' }
}
export function setAiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORE, key.trim())
    else localStorage.removeItem(KEY_STORE)
  } catch { /* storage unavailable */ }
}
export function hasAiKey(): boolean {
  return getAiKey().startsWith('gsk_')
}

/* How thorough the breakdown should be. Goblin Tools calls this spiciness; the
   idea is the same, that "break this down" means different things depending on
   how stuck you are. */
export type Detail = 'light' | 'normal' | 'deep'

const DEPTH: Record<Detail, string> = {
  light: '3 to 5 steps. The shape of the job, not every movement.',
  normal: '6 to 9 steps. Cover the whole job start to finish, including the checking and the finishing.',
  deep: '10 to 14 steps. Assume executive dysfunction: every step is one unambiguous action with nothing implied between them.',
}

function systemFor(detail: Detail, lang: 'cs' | 'en'): string {
  return `You break a task into the concrete steps it actually takes, and estimate each one.

HOW MANY STEPS
${DEPTH[detail]}

WHAT A STEP IS
- One physical action that can be started and finished. "Find the contract number in the last letter", not "Preparation".
- Cover the FULL arc of the job: work out what is needed, gather it, do it, check it, finish and file it. Do not stop at the doing.
- Steps run in the order they happen. No step assumes work that no earlier step did.
- No step is a restatement of the task itself.
- The first step is small and frictionless, the one that gets someone moving when they are avoiding it.

ESTIMATES
- Minutes per step, realistic for someone not yet in flow, and for the real size of the work. A step that is genuinely two hours says 120.
- Do not make every step the same length.

LANGUAGE
- Write every step in ${lang === 'cs' ? 'CZECH' : 'ENGLISH'}. The task was written in ${lang === 'cs' ? 'Czech' : 'English'}, so match it. Do not switch languages.

STYLE
- Czech admin is ordinary context: Datova schranka, VZP, splatkovy kalendar, Fakturoid, financni urad.
- No preamble, no encouragement, no em dashes.

Return ONLY JSON: {"steps":[{"title":"...","why":"optional short reason","estimateMin":10}]}`
}

/* Which language the task is in. Diacritics settle it immediately; otherwise a
   handful of common Czech function words do. Everything else is English, so a
   plain English task can never come back in Czech. */
export function detectLang(text: string): 'cs' | 'en' {
  if (/[ěščřžýáíéúůňťďó]/i.test(text)) return 'cs'
  // Words that are Czech and nothing else: one is enough.
  const strong = /\b(zavolat|napsat|odepsat|poslat|vyridit|dokoncit|zkontrolovat|udelat|zaplatit|objednat|domluvit|pripravit|schranka|ucetni|faktur\w*|splatk\w*|zadost|urad|pojisten\w*)\b/i
  if (strong.test(text)) return 'cs'
  // Function words are weaker evidence, so they need company.
  const weak = /\b(se|na|do|je|to|pro|od|za|ve|pri|kdyz|nebo|musim|potreba|jeste|uz)\b/gi
  return (text.match(weak) ?? []).length >= 2 ? 'cs' : 'en'
}

/* Reasoning models emit their scratchpad in <think> blocks, and when the budget
   runs out mid-thought the block is never even closed, so the answer is lost
   inside it. Groq is asked to hide the reasoning, and this strips whatever still
   gets through, including an unterminated block. */
function stripReasoning(raw: string): string {
  // Closed blocks first.
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  /* Then any block still open: the budget ran out mid-thought, so everything
     from that tag onward is scratchpad and there is no answer after it. This
     has to run BEFORE stray tags are removed, or there is nothing left to spot. */
  const open = s.search(/<(think|thinking|reasoning)\b/i)
  if (open !== -1) s = s.slice(0, open)
  return s.replace(/<\/?(think|thinking|reasoning)>/gi, '').trim()
}

/** Groq rejects unknown params on some models, so the reasoning flags are sent
 *  first and dropped on a 400 rather than failing the whole call. */
async function groq(body: Record<string, unknown>, key: string): Promise<Response> {
  const send = (b: Record<string, unknown>) => fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  })
  const res = await send({ ...body, reasoning_format: 'hidden', reasoning_effort: 'none' })
  if (res.status !== 400) return res
  return send(body)
}

export interface AiStep { title: string; why?: string; estimateMin: number }

/** One realistic estimate for a task, from the same model that writes the
 *  breakdowns. The clock button used a local rule of thumb that read as "15m
 *  for everything"; if AI estimates the steps, it estimates the whole too. */
export async function estimateTask(title: string, category: TaskCategory): Promise<number | null> {
  const key = getAiKey()
  if (!key) return null
  try {
    const res = await groq({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You estimate how long a personal task realistically takes for one focused person, including the usual friction (finding things, small interruptions). Reply as JSON: {"minutes": <integer 5-480>}. Round to a sensible 5-minute step. No text outside the JSON.' },
        { role: 'user', content: `Task: ${title}
Kind of work: ${category}` },
      ],
    }, key)
    if (!res.ok) return null
    const data = await res.json()
    const parsed = JSON.parse(stripReasoning(data.choices?.[0]?.message?.content ?? '') || '{}')
    const n = Number(parsed.minutes)
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.max(5, Math.min(480, Math.round(n / 5) * 5))
  } catch {
    return null
  }
}

export type BreakdownResult =
  | { ok: true; steps: AiStep[] }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'failed' }

export async function breakdownTask(title: string, category: TaskCategory, detail: Detail = 'normal'): Promise<BreakdownResult> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  try {
    const res = await groq({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemFor(detail, detectLang(title)) },
        { role: 'user', content: `Task: ${title}\nKind of work: ${category}` },
      ],
    }, key)
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'bad-key' }
    if (res.status === 429) return { ok: false, reason: 'rate-limit' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const data = await res.json()
    const parsed = JSON.parse(stripReasoning(data.choices?.[0]?.message?.content ?? '') || '{}')
    const steps: AiStep[] = (parsed.steps ?? [])
      .filter((s: { title?: string }) => typeof s?.title === 'string' && s.title.trim())
      .slice(0, 14)
      .map((s: { title: string; why?: string; estimateMin?: number }) => ({
        title: s.title.trim(),
        why: typeof s.why === 'string' && s.why.trim() ? s.why.trim() : undefined,
        estimateMin: Math.max(1, Math.round(Number(s.estimateMin) || 10)),
      }))
    if (!steps.length) return { ok: false, reason: 'failed' }
    return { ok: true, steps }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/* ---------- Filing what you said ---------- */

const SPOKEN = `You take something spoken or typed quickly and file each part of it.

Each item is one of:
- "task": something to do.
- "goal": an outcome with a finish line.
- "done": something already finished, spoken in the past tense.

Rules:
- Split on the real boundaries between items, not on punctuation. One sentence can hold two items; three sentences can be one.
- Strip the words that only signalled the bucket. "goal this week send ten cold emails" files as "Send ten cold emails", not "Goal this week send ten cold emails".
- Keep his own wording otherwise, in the language he used. Do not translate, tidy or expand.
- If he said how long something takes, put it in estimateMin. Never guess one he did not say.
- Take nothing that is not there. Thinking aloud with no commitment in it returns an empty list.
- Output only JSON. No commentary, no <think> blocks.

Return ONLY JSON: {"items":[{"kind":"task|goal|done","text":"...","estimateMin":15}]}`

export interface SpokenItem {
  kind: 'task' | 'goal' | 'done'
  text: string
  estimateMin?: number
}

export async function parseSpoken(input: string): Promise<{ ok: true; items: SpokenItem[] } | { ok: false; reason: string }> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  try {
    const res = await groq({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SPOKEN },
        { role: 'user', content: input },
      ],
    }, key)
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'bad-key' }
    if (res.status === 429) return { ok: false, reason: 'rate-limit' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const data = await res.json()
    const p = JSON.parse(stripReasoning(data.choices?.[0]?.message?.content ?? '') || '{}')
    const items: SpokenItem[] = (p.items ?? [])
      .filter((i: { text?: string }) => typeof i?.text === 'string' && i.text.trim())
      .map((i: { kind?: string; text: string; estimateMin?: number }) => ({
        kind: (['task', 'goal', 'done'].includes(i.kind ?? '') ? i.kind : 'task') as SpokenItem['kind'],
        text: i.text.trim(),
        estimateMin: Number(i.estimateMin) > 0 ? Math.round(Number(i.estimateMin)) : undefined,
      }))
    return { ok: true, items }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
