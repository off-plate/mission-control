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

const SYSTEM = `You break a personal task into the concrete steps it actually takes, and estimate each one.

Rules:
- 3 to 6 steps. Fewer if the task is genuinely small.
- Each step is a physical action that can be started, not a category. "Find the contract number" not "Preparation".
- The FIRST step must be tiny and frictionless: the thing that gets someone moving when they are avoiding it.
- Estimate each step in minutes, realistically, for someone not yet in flow.
- Czech context is normal: Datova schranka, VZP, splatkovy kalendar, Fakturoid, financni urad.
- Reply in the same language the task is written in.
- No preamble, no encouragement, no em dashes.

Return ONLY JSON: {"steps":[{"title":"...","why":"optional short reason","estimateMin":10}]}`

export interface AiStep { title: string; why?: string; estimateMin: number }

export type BreakdownResult =
  | { ok: true; steps: AiStep[] }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'failed' }

export async function breakdownTask(title: string, category: TaskCategory): Promise<BreakdownResult> {
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
          { role: 'system', content: SYSTEM },
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
      .slice(0, 8)
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
