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

export interface AiStep { title: string; why?: string; estimateMin: number }

export type BreakdownResult =
  | { ok: true; steps: AiStep[] }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'failed' }

export async function breakdownTask(title: string, category: TaskCategory, detail: Detail = 'normal'): Promise<BreakdownResult> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemFor(detail, detectLang(title)) },
          { role: 'user', content: `Task: ${title}\nKind of work: ${category}` },
        ],
      }),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'bad-key' }
    if (res.status === 429) return { ok: false, reason: 'rate-limit' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const data = await res.json()
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}')
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

/* ---------- Reading a photographed journal page ---------- */

const VISION_MODEL = 'qwen/qwen3.6-27b'

/* Downscale before sending. A full phone photo blows the free tier's token
   budget and adds nothing: the text is just as readable at 1600px. */
export async function shrinkImage(file: File, maxEdge = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.85)
}

const TRANSCRIBE = `You transcribe a photographed page of handwriting. You are reading someone's personal journal.

Rules:
- Transcribe VERBATIM. Do not summarise, tidy, translate or complete anything.
- The writing is Czech or English, often mixed. Keep the language exactly as written.
- Czech diacritics matter: ě š č ř ž ý á í é ú ů ň ť ď. Restore them properly.
- Keep the line breaks and any bullets or dashes the page has.
- If a word is genuinely unreadable, write [?] in its place. NEVER invent a word to fill a gap.
- Output only the transcription. No preamble, no commentary, no markdown fences.`

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'too-big' | 'failed' }

export async function transcribeImage(dataUrl: string): Promise<TranscribeResult> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  if (dataUrl.length > 20 * 1024 * 1024) return { ok: false, reason: 'too-big' }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: TRANSCRIBE },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'bad-key' }
    if (res.status === 429) return { ok: false, reason: 'rate-limit' }
    if (res.status === 413) return { ok: false, reason: 'too-big' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const data = await res.json()
    const text = (data.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, reason: 'failed' }
    return { ok: true, text }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

const EXTRACT = `You read a personal journal entry and pull out only what the writer committed to.

Rules:
- A TASK is one concrete thing to do. A GOAL is an outcome with a finish line. A HABIT is something repeated on a rhythm.
- Only take what is actually in the text. Never invent, infer an implied task, or add anything sensible that is not written.
- Ignore reflection, feelings and description. Those are not items.
- Anything containing [?] is unreliable: leave it out.
- Keep each title in the language it was written in, and keep the writer's own words.
- If the entry contains nothing actionable, return empty arrays. That is a valid answer.

Return ONLY JSON:
{"tasks":[{"title":"...","estimateMin":15}],"goals":[{"title":"...","why":"optional"}],"habits":[{"title":"...","frequency":"daily|weekdays|times-per-week|weekly|monthly"}]}`

export interface JournalItems {
  tasks: { title: string; estimateMin?: number }[]
  goals: { title: string; why?: string }[]
  habits: { title: string; frequency?: string }[]
}

export async function extractFromJournal(text: string): Promise<{ ok: true; items: JournalItems } | { ok: false; reason: string }> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EXTRACT },
          { role: 'user', content: text },
        ],
      }),
    })
    if (!res.ok) return { ok: false, reason: 'failed' }
    const data = await res.json()
    const p = JSON.parse(data.choices?.[0]?.message?.content ?? '{}')
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
    return {
      ok: true,
      items: {
        tasks: (p.tasks ?? []).map((t: { title?: string; estimateMin?: number }) => ({ title: str(t.title), estimateMin: Number(t.estimateMin) || undefined })).filter((t: { title: string }) => t.title),
        goals: (p.goals ?? []).map((g: { title?: string; why?: string }) => ({ title: str(g.title), why: str(g.why) || undefined })).filter((g: { title: string }) => g.title),
        habits: (p.habits ?? []).map((h: { title?: string; frequency?: string }) => ({ title: str(h.title), frequency: str(h.frequency) || 'daily' })).filter((h: { title: string }) => h.title),
      },
    }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
