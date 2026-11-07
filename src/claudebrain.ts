/* The Claude brain, the app's half (2026-11-07).

   Every request is dropped in the mc_brain mailbox; the daemon on his Mac
   (tools/claude-brain.mjs) asks `claude -p` and writes the answer back. This
   file posts the request, waits, reads the answer, and deletes the row.

   It NEVER makes him wait on a closed lid: the daemon writes a heartbeat every
   30 seconds, and a stale one (or a request nobody claims within a few seconds)
   returns a plain "off" so the assistant answers with Gemini instead. Every
   failure here means "use the other brain", never an error on screen.

   Claude answers EVERY request while it is on (his call, 2026-11-07, after a
   60-word cut-off annoyed him). Gemini and Groq are the fallback, and they take
   over instantly when the Mac is asleep, so the default never costs a wait. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { currentAccount, dbClient } from './supabase'

const TABLE = 'mc_brain'
const ON_KEY = 'mc-claude-brain'
const MODEL_KEY = 'mc-claude-model'

export const CLAUDE_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
] as const
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]['id']

const BEAT_FRESH_MS = 90_000
const CLAIM_WAIT_MS = 10_000
const REPLY_WAIT_MS = 150_000
const POLL_MS = 1000

const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window */ } }

/** ON unless he switched it off: Claude is the default brain, the others are
 *  the fallback (his call, 2026-11-07: no word limit, "make Claude the default"). */
export const claudeBrainOn = (): boolean => read(ON_KEY) !== '0'
export const setClaudeBrain = (on: boolean) => write(ON_KEY, on ? '1' : '0')
export function getClaudeModel(): ClaudeModel {
  const m = read(MODEL_KEY)
  return CLAUDE_MODELS.find((x) => x.id === m)?.id ?? 'claude-haiku-5-5'
}
export const setClaudeModel = (m: ClaudeModel) => write(MODEL_KEY, m)

/** True when this question should go to Claude first: unless he switched it off. */
export const claudeWanted = (_question: string): boolean => claudeBrainOn()

/* A test seam: the unit test hands in a fake mailbox instead of Supabase. */
let override: { client: SupabaseClient; uid: string } | null = null
export const __setBrainClient = (v: { client: SupabaseClient; uid: string } | null) => { override = v }

async function mailbox(): Promise<{ c: SupabaseClient; uid: string } | null> {
  if (override) return { c: override.client, uid: override.uid }
  const c = dbClient()
  if (!c) return null
  const me = await currentAccount()
  return me ? { c, uid: me.id } : null
}

/** Is the Mac's daemon alive right now? */
export async function macOnline(): Promise<boolean> {
  const box = await mailbox()
  if (!box) return false
  const { data, error } = await box.c.from(TABLE).select('beat_at').eq('owner', box.uid).eq('kind', 'beat').maybeSingle()
  if (error || !data?.beat_at) return false
  return Date.now() - Date.parse(data.beat_at) < BEAT_FRESH_MS
}

export type ClaudeAnswer =
  | { ok: true; text: string }
  | { ok: false; reason: 'off' | 'mac-off' | 'timeout' | 'failed' }

export interface ClaudeMsg { role: 'system' | 'user' | 'assistant'; content: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One round trip. `waits` is only for the test, which cannot sit for ten seconds. */
export async function askClaude(
  messages: ClaudeMsg[],
  model: ClaudeModel = getClaudeModel(),
  waits: { claim: number; reply: number; poll: number } = { claim: CLAIM_WAIT_MS, reply: REPLY_WAIT_MS, poll: POLL_MS },
): Promise<ClaudeAnswer> {
  const box = await mailbox()
  if (!box) return { ok: false, reason: 'off' }
  if (!(await macOnline())) return { ok: false, reason: 'mac-off' }
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const turns = messages.filter((m) => m.role !== 'system')
  const ins = await box.c.from(TABLE)
    .insert({ owner: box.uid, kind: 'ask', model, request: { system, turns } })
    .select('id').single()
  if (ins.error || !ins.data) return { ok: false, reason: 'failed' }
  const id = ins.data.id as string
  const t0 = Date.now()
  /* The row is deleted on every way out: what he dictated should leave the
     database the moment the app has the answer, not wait for the daemon's
     daily sweep. */
  /* A supabase-js query is lazy: it only goes out when something awaits it, so
     `void query` would silently never delete. `.then` is what sends it. */
  const drop = () => { box.c.from(TABLE).delete().eq('id', id).then(() => {}, () => {}) }
  try {
    for (;;) {
      await sleep(waits.poll)
      const { data, error } = await box.c.from(TABLE).select('status, reply, error').eq('id', id).maybeSingle()
      if (!error && data) {
        if (data.status === 'done') return { ok: true, text: String(data.reply ?? '') }
        if (data.status === 'error') return { ok: false, reason: 'failed' }
        if (data.status === 'queued' && Date.now() - t0 > waits.claim) return { ok: false, reason: 'mac-off' }
      }
      if (Date.now() - t0 > waits.reply) return { ok: false, reason: 'timeout' }
    }
  } finally {
    drop()
  }
}
