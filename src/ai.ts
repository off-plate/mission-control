/* Real task breakdown, through whichever provider is active. notesai.ts's
   /help in Notes reads the same choice and the request()/stripReasoning()
   helpers below.

   Where a key lives, and why: this repo is public, so nothing goes in the
   bundle. Compass keeps its Groq key in the synced Supabase row, but this
   app's row is readable with the anon key that ships in the page, so a key
   stored there would effectively be published. Every key here stays in
   localStorage on the machine it was typed on: never synced, never in the
   repo, never in the build. The cost is that you paste it once per device,
   which is the right trade.

   TWO PROVIDERS, one active at a time (his ask, 2026-09-07: Groq is not the
   only place a key can come from, and the app had it hardcoded three ways --
   the endpoint, the "gsk_" prefix a live key was recognised by, and the model
   name). Adding one is one entry in PROVIDERS; everything downstream --
   Settings' key field, the assistant, task breakdowns and estimates -- reads
   through getAiProvider()/getAiKey()/activeModel() and never names a provider
   itself. Each provider keeps its OWN key in its OWN localStorage slot, so
   switching the toggle back and forth never makes you retype one. */

import type { TaskCategory } from './types'
import { SUPABASE_URL } from './config'

export type AiProvider = 'groq' | 'zai'

export interface ProviderConfig {
  label: string
  /** OpenAI-compatible chat-completions endpoint. */
  endpoint: string
  /** The model, named ONCE per provider so the next retirement is one line,
   *  not three files -- llama-3.3-70b-versatile was shut off for free and
   *  developer tier on 2026-08-16, which silently killed every AI feature
   *  here at the same moment: the assistant, /help in Notes, breakdowns and
   *  estimates. Nothing in the app said so, because a dead model answers with
   *  an HTTP error that each caller was quietly swallowing. */
  model: string
  keyStore: string
  keyPlaceholder: string
  getKeyUrl: string
  /** Extra body fields that ask this provider's model to skip its thinking
   *  phase and answer directly. NOT a shared shape across providers -- this
   *  was the actual bug (2026-09-07): every provider was sent Groq's own
   *  `reasoning_format`/`reasoning_effort: 'none'`, and GLM-5.3 does not
   *  accept "none" as a reasoning_effort value at all (their docs: only
   *  low/high/max for this model), defaults to "max" the moment the flag is
   *  rejected or ignored, and spends the entire response budget on invisible
   *  reasoning_content -- the visible `content` field this app reads stays
   *  empty the whole stream through. That is "took a long time and came back
   *  unreadable", exactly. Z.ai's own way to turn thinking off entirely is a
   *  `thinking: { type: 'disabled' }` object, nothing shaped like Groq's. */
  quiet: Record<string, unknown>
}

export const PROVIDERS: Record<AiProvider, ProviderConfig> = {
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-120b',
    keyStore: 'mc-groq-key',
    keyPlaceholder: 'gsk_…',
    getKeyUrl: 'https://console.groq.com/keys',
    quiet: { reasoning_format: 'hidden', reasoning_effort: 'none' },
  },
  zai: {
    label: 'Z.ai (GLM)',
    /* Not Z.ai's own endpoint. Confirmed live (2026-09-08), his real key, his
       real browser, DevTools open: the actual request shows as a CORS error
       in the Network panel, its own preflight having already passed -- Z.ai's
       server never sends access-control-allow-origin back at all, a choice
       made entirely on their end that no request shape from here could ever
       have worked around. This is Mission Control's own relay instead
       (supabase/functions/zai-chat), which makes the same call
       server-to-server, where CORS does not apply, and hands the answer back
       with the header a browser needs to read it. It carries no secret of
       its own -- the Authorization header IS his key, forwarded through
       untouched -- so it asks nothing new of him: same key, same field in
       Settings, one extra hop he never sees. */
    endpoint: `${SUPABASE_URL}/functions/v1/zai-chat`,
    /* His own trial package, confirmed against his Z.ai console rather than
       their docs (2026-09-07): the GLM-5.3 docs page names only "glm-5.3",
       no "-flash" variant, but a model his account actually lists beats a
       page that may simply not have caught up to it. */
    model: 'glm-5.3-flash',
    keyStore: 'mc-zai-key',
    keyPlaceholder: 'Z.ai API key…',
    getKeyUrl: 'https://z.ai/model-api',
    /* Was `thinking: { type: 'disabled' }`, the general shutoff switch Z.ai's
       own docs describe -- and it was the actual 400 in his live trace
       (2026-09-08): every real request went out twice, quiet flags first,
       then the plain retry once those got rejected, landing back on the
       model's own default of maximum reasoning either way. Their own docs
       carry the reason next to reasoning_effort: "for the GLM-5.3 /
       GLM-5.3-FLASH model, only the low / high / max levels are supported" --
       a restriction specific to this exact model, not the general API, and
       the general shutoff switch is plausibly one more thing it does not
       carry. "low" is the one value their own docs confirm this model
       actually accepts, so it is the real lever here, not full elimination:
       expect noticeably faster than max, not Groq-instant. */
    quiet: { reasoning_effort: 'low' },
  },
}

const PROVIDER_STORE = 'mc-ai-provider'

export function getAiProvider(): AiProvider {
  try { return localStorage.getItem(PROVIDER_STORE) === 'zai' ? 'zai' : 'groq' } catch { return 'groq' }
}
export function setAiProvider(p: AiProvider): void {
  try { localStorage.setItem(PROVIDER_STORE, p) } catch { /* storage unavailable */ }
}

export function getProviderKey(p: AiProvider): string {
  try { return localStorage.getItem(PROVIDERS[p].keyStore) ?? '' } catch { return '' }
}
export function setProviderKey(p: AiProvider, key: string): void {
  try {
    if (key.trim()) localStorage.setItem(PROVIDERS[p].keyStore, key.trim())
    else localStorage.removeItem(PROVIDERS[p].keyStore)
  } catch { /* storage unavailable */ }
}

/** The active provider's key -- what every generic caller below actually
 *  wants, so none of them has to know a provider exists. */
export function getAiKey(): string {
  return getProviderKey(getAiProvider())
}
export function setAiKey(key: string): void {
  setProviderKey(getAiProvider(), key)
}
export function hasAiKey(): boolean {
  /* Was a check for Groq's own "gsk_" prefix, which is meaningless the moment
     a second provider with a different key shape exists. The actual question
     this answers -- will a request be attempted -- only ever needed to know
     whether a key is there at all. */
  return getAiKey().trim().length > 0
}
export function activeModel(): string {
  return PROVIDERS[getAiProvider()].model
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
export function stripReasoning(raw: string): string {
  // Closed blocks first.
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  /* Then any block still open: the budget ran out mid-thought, so everything
     from that tag onward is scratchpad and there is no answer after it. This
     has to run BEFORE stray tags are removed, or there is nothing left to spot. */
  const open = s.search(/<(think|thinking|reasoning)\b/i)
  if (open !== -1) s = s.slice(0, open)
  return s.replace(/<\/?(think|thinking|reasoning)>/gi, '').trim()
}

/** Posts to a provider's own endpoint with its own key. Defaults to whichever
 *  provider is active, so every existing caller that only ever spoke of
 *  "Groq" keeps working unchanged -- it is just quietly Z.ai now when the
 *  toggle says so. notesai.ts pins this to 'groq' explicitly for its one
 *  Groq-only model (see there for why).
 *
 *  Each provider's own `quiet` fields are sent to keep its model from
 *  thinking out loud before it answers. This USED to be one hardcoded Groq
 *  shape (`reasoning_format`/`reasoning_effort: 'none'`) sent to every
 *  provider, retried without it on a 400 -- which quietly assumed an unknown
 *  flag always gets REJECTED. GLM-5.3 does neither: "none" is not a value it
 *  accepts for reasoning_effort at all, and rather than 400 it appears to
 *  fall back to its own default of "max" -- full extended thinking, the
 *  entire response budget spent on invisible reasoning_content, the visible
 *  `content` field this app actually reads left empty the whole stream
 *  through. That is "took a long time and came back unreadable" (his report,
 *  2026-09-07), and the retry-without-flags fallback could not have fixed it
 *  either: dropping the flags entirely still leaves Z.ai's own default of
 *  maximum thinking in force. The fallback below still exists for whatever
 *  the NEXT provider's own quiet fields turn out not to be, but it is no
 *  longer the only line of defence. */
export async function request(body: Record<string, unknown>, key: string, provider: AiProvider = getAiProvider()): Promise<Response> {
  const cfg = PROVIDERS[provider]
  const send = (b: Record<string, unknown>) => fetch(cfg.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  })
  const res = await send({ ...body, ...cfg.quiet })
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
    const res = await request({
      model: activeModel(),
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
    const res = await request({
      model: activeModel(),
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

