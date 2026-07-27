/* Real breakdown, when it is available.

   The call goes to a Supabase Edge Function, never straight to a model, because
   this repo is public and a key in the bundle would be public with it. If the
   function is not deployed the app says so plainly instead of passing a canned
   list off as a model's answer. */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'
import type { TaskCategory } from './types'

export interface AiStep {
  title: string
  why?: string
  estimateMin: number
}

export type BreakdownResult =
  | { ok: true; steps: AiStep[] }
  | { ok: false; reason: 'not-deployed' | 'no-key' | 'failed' }

export const AI_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/breakdown` : ''

export async function breakdownTask(title: string, category: TaskCategory): Promise<BreakdownResult> {
  if (!AI_ENDPOINT) return { ok: false, reason: 'not-deployed' }
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ title, category }),
    })
    if (res.status === 404) return { ok: false, reason: 'not-deployed' }
    if (res.status === 503) return { ok: false, reason: 'no-key' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const data = (await res.json()) as { steps?: AiStep[] }
    if (!data.steps?.length) return { ok: false, reason: 'failed' }
    return { ok: true, steps: data.steps }
  } catch {
    return { ok: false, reason: 'not-deployed' }
  }
}
