/* The Mac half of the Claude brain: picks up what Mission Control drops in the
   mc_brain mailbox, asks `claude -p`, writes the answer back.

   Why it exists. The assistant's brain can be a Claude model on his own Claude
   subscription, but a browser or a phone cannot run `claude`. The Mac can. So
   the app writes a request row, this process answers it, and the app reads the
   answer. When the Mac is asleep the heartbeat goes stale and the app answers
   with Gemini instead, so nothing ever waits on a closed lid.

   It is ONE long-lived process, not a timer. A Supabase refresh token rotates,
   and the Obsidian job lost two days to overlapping timer runs spending the
   same token (see tools/obsidian-sync.mjs). One process holds the session and
   banks every refresh itself.

   It signs in exactly as the app does, with the emailed 8-digit code, once
   (`--login`). The token lives in ~/.mc-brain, mode 600, OUTSIDE this repo,
   which is public. There is no service key: it can reach what he can reach.

   Privacy: what he dictated is never written to the log. The log keeps the
   request id, model, seconds, tokens and cost.

   The model has NO tools (`--tools ""`), no settings, no skills, and runs in an
   empty folder. It can only return text, and the app only runs actions from a
   closed list, so a pasted instruction inside a dictation cannot do anything.

   Usage:
     node tools/claude-brain.mjs --login     sign in once
     node tools/claude-brain.mjs --status    who it is, is it running, last beat
     node tools/claude-brain.mjs --once      answer what is queued, then exit
     node tools/claude-brain.mjs             run until stopped */

import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

const SUPABASE_URL = 'https://fhfempisopwsdkmvywbt.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_MDxQPm0SzLHFTnDqg-eyyQ_0yposnES'
const TABLE = 'mc_brain'

const STATE_DIR = path.join(os.homedir(), '.mc-brain')
const SESSION_FILE = path.join(STATE_DIR, 'session.json')
const PID_FILE = path.join(STATE_DIR, 'pid')
const LOG_FILE = path.join(STATE_DIR, 'brain.log')

/* The only models a row may name. The app is trusted with his own account, but
   a row is just data: an unknown model string must never reach the command line. */
export const ALLOWED_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5']
const DEFAULT_MODEL = 'claude-haiku-5-5'

const CLAUDE = fs.existsSync('/opt/homebrew/bin/claude') ? '/opt/homebrew/bin/claude' : 'claude'
const POLL_MS = 3000
const BEAT_MS = 30_000
const CLAUDE_TIMEOUT_MS = 150_000
const MAX_REQUEST_CHARS = 200_000
const STALE_WORKING_MS = 5 * 60_000
const KEEP_MS = 24 * 3600_000

const say = (m) => console.log(m)
function log(line) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
  } catch { /* a log that cannot be written must never stop an answer */ }
}

/* ---- the question, as `claude -p` wants it ---------------------------------- */

/** The app sends {system, turns:[{role,content}]}. One turn is the question as
 *  is. Several (a lookup or fix round) become a plain transcript, ending with
 *  the reminder to answer in the one JSON shape. Same as the spike harness, so
 *  what was tested is what runs. */
export function transcriptOf(turns) {
  if (turns.length === 1) return String(turns[0].content)
  return turns
    .map((m) => `${m.role === 'user' ? 'USER' : 'YOU (earlier reply)'}:\n${m.content}`)
    .join('\n\n') + '\n\nReply now to the last USER message with the single JSON object.'
}

/** Validate a request row before anything is spawned. Returns an error string
 *  or null. */
export function checkRequest(row) {
  const r = row?.request
  if (!r || typeof r.system !== 'string' || !r.system) return 'request has no system prompt'
  if (!Array.isArray(r.turns) || !r.turns.length) return 'request has no turns'
  if (!r.turns.every((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')) return 'request turns are malformed'
  if (JSON.stringify(r).length > MAX_REQUEST_CHARS) return 'request is too large'
  return null
}

let scratch = null
async function emptyCwd() {
  /* An empty folder so the CLI finds no CLAUDE.md and no project settings. */
  scratch ??= await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-brain-'))
  return scratch
}

/** One `claude -p` call. Resolves {text, ms, usage, cost}; rejects with a short
 *  reason. `spawnFn` is injectable so the test never starts a real model. */
export async function runClaude({ system, turns, model }, spawnFn = spawn) {
  const cwd = await emptyCwd()
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const p = spawnFn(CLAUDE, [
      '-p', '--model', model, '--output-format', 'json',
      '--system-prompt', system,
      '--tools', '', '--disable-slash-commands', '--no-session-persistence',
      '--strict-mcp-config', '--setting-sources', '',
    ], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('claude took too long')) }, CLAUDE_TIMEOUT_MS)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`could not start claude: ${e.message}`)) })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`))
      try {
        const j = JSON.parse(out)
        if (j.is_error) return reject(new Error(`claude said: ${String(j.result ?? '').slice(0, 300)}`))
        resolve({ text: String(j.result ?? ''), ms: Date.now() - t0, usage: j.usage ?? {}, cost: j.total_cost_usd })
      } catch { reject(new Error('claude gave output that is not JSON')) }
    })
    p.stdin.end(transcriptOf(turns))
  })
}

/* ---- one request ------------------------------------------------------------ */

/** Claim a queued row and answer it. The claim is a conditional update, so two
 *  daemons (or a restart mid-poll) can never both answer the same row. Returns
 *  true when this call answered it. */
export async function handle(c, row, run = runClaude) {
  const bad = checkRequest(row)
  const model = ALLOWED_MODELS.includes(row.model) ? row.model : DEFAULT_MODEL
  const { data: claimed, error: claimErr } = await c.from(TABLE)
    .update({ status: 'working', claimed_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'queued').select('id')
  if (claimErr || !claimed?.length) return false
  if (bad) {
    await c.from(TABLE).update({ status: 'error', error: bad, finished_at: new Date().toISOString() }).eq('id', row.id)
    log(`${row.id} rejected: ${bad}`)
    return true
  }
  try {
    const r = await run({ system: row.request.system, turns: row.request.turns, model })
    await c.from(TABLE).update({ status: 'done', reply: r.text, finished_at: new Date().toISOString() }).eq('id', row.id)
    log(`${row.id} ${model} ${(r.ms / 1000).toFixed(1)}s in=${r.usage.input_tokens ?? '?'} out=${r.usage.output_tokens ?? '?'} cost=$${(r.cost ?? 0).toFixed(4)}`)
  } catch (e) {
    await c.from(TABLE).update({ status: 'error', error: String(e.message).slice(0, 400), finished_at: new Date().toISOString() }).eq('id', row.id)
    log(`${row.id} failed: ${e.message}`)
  }
  return true
}

/** One pass over the mailbox: answer what is queued (oldest first), fail rows a
 *  crashed run left 'working', delete finished rows past a day. */
export async function sweep(c, uid, run = runClaude) {
  const { data: queued } = await c.from(TABLE).select('id, model, request')
    .eq('owner', uid).eq('kind', 'ask').eq('status', 'queued')
    .order('created_at', { ascending: true }).limit(5)
  let answered = 0
  for (const row of queued ?? []) if (await handle(c, row, run)) answered++

  const staleBefore = new Date(Date.now() - STALE_WORKING_MS).toISOString()
  await c.from(TABLE).update({ status: 'error', error: 'the Mac stopped before answering', finished_at: new Date().toISOString() })
    .eq('owner', uid).eq('kind', 'ask').eq('status', 'working').lt('claimed_at', staleBefore)
  const keepAfter = new Date(Date.now() - KEEP_MS).toISOString()
  await c.from(TABLE).delete().eq('owner', uid).eq('kind', 'ask').lt('created_at', keepAfter)
  return answered
}

/** The heartbeat row: created once, then touched. The app reads beat_at. */
export async function beat(c, uid, state = {}) {
  const now = new Date().toISOString()
  if (!state.id) {
    const { data } = await c.from(TABLE).select('id').eq('owner', uid).eq('kind', 'beat').maybeSingle()
    if (data) state.id = data.id
    else {
      const ins = await c.from(TABLE).insert({ owner: uid, kind: 'beat', status: 'done', beat_at: now }).select('id').single()
      if (ins.data) state.id = ins.data.id
      return state
    }
  }
  await c.from(TABLE).update({ beat_at: now }).eq('id', state.id)
  return state
}

/* ---- the account ------------------------------------------------------------- */

const client = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
})

async function saveSession(session) {
  await fsp.mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${SESSION_FILE}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    email: session.user?.email ?? '',
    saved: new Date().toISOString(),
  }, null, 2), { mode: 0o600 })
  await fsp.rename(tmp, SESSION_FILE)
}

async function login() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const c = client()
  const email = (await rl.question('Mission Control email: ')).trim()
  const { error: sendErr } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (sendErr) { rl.close(); throw new Error(`could not send the code: ${sendErr.message}`) }
  const token = (await rl.question('8-digit code from the email: ')).trim()
  rl.close()
  const { data, error } = await c.auth.verifyOtp({ email, token, type: 'email' })
  if (error || !data.session) throw new Error(`code rejected: ${error?.message ?? 'no session'}`)
  await saveSession(data.session)
  say(`signed in as ${data.session.user.email}. Token saved to ${SESSION_FILE} (mode 600).`)
}

async function signedIn() {
  let saved
  try { saved = JSON.parse(await fsp.readFile(SESSION_FILE, 'utf8')) } catch { return null }
  const c = client()
  let session
  const set = await c.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
  if (set.error || !set.data.session) {
    const r = await c.auth.refreshSession({ refresh_token: saved.refresh_token })
    if (r.error || !r.data.session) return null
    session = r.data.session
  } else session = set.data.session
  await saveSession(session)
  /* The refresh token rotates: bank every new one, or a restart is locked out. */
  c.auth.onAuthStateChange((_e, s) => { if (s) saveSession(s).catch(() => {}) })
  return { c, user: session.user }
}

/* ---- running ----------------------------------------------------------------- */

function takePidLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  try {
    const old = Number(fs.readFileSync(PID_FILE, 'utf8'))
    if (old && old !== process.pid) { process.kill(old, 0); return false } // alive: someone else is serving
  } catch { /* no pid file, or that pid is gone */ }
  fs.writeFileSync(PID_FILE, String(process.pid))
  return true
}

async function serve({ once }) {
  const auth = await signedIn()
  if (!auth) {
    say('Not signed in. Run: node tools/claude-brain.mjs --login')
    log('not signed in; exiting')
    return 0
  }
  const { c, user } = auth
  if (once) {
    const n = await sweep(c, user.id)
    say(`answered ${n}`)
    return 0
  }
  if (!takePidLock()) { say('already running'); return 0 }
  log(`serving ${user.email}`)
  say(`serving ${user.email}. Ctrl-C to stop.`)
  const state = {}
  let busy = false
  let stop = false
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop = true; try { fs.unlinkSync(PID_FILE) } catch {} ; process.exit(0) })
  let lastBeat = 0
  while (!stop) {
    if (!busy) {
      busy = true
      try {
        if (Date.now() - lastBeat >= BEAT_MS) { await beat(c, user.id, state); lastBeat = Date.now() }
        await sweep(c, user.id)
      } catch (e) { log(`pass failed: ${e.message}`) }
      busy = false
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return 0
}

async function status() {
  const auth = await signedIn()
  if (!auth) return say('not signed in (run --login)')
  const { c, user } = auth
  say(`signed in as ${user.email}`)
  const { data } = await c.from(TABLE).select('beat_at').eq('owner', user.id).eq('kind', 'beat').maybeSingle()
  const age = data?.beat_at ? Math.round((Date.now() - Date.parse(data.beat_at)) / 1000) : null
  say(age == null ? 'no heartbeat yet: the daemon has never run' : `last heartbeat ${age}s ago ${age < 90 ? '(running)' : '(NOT running)'}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = process.argv[2]
  try {
    if (arg === '--login') await login()
    else if (arg === '--status') await status()
    else process.exitCode = await serve({ once: arg === '--once' })
  } catch (e) {
    say(`error: ${e.message}`)
    log(`fatal: ${e.message}`)
    process.exitCode = 1
  }
}
