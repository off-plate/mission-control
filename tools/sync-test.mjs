/* The offline promise, tested.

   "Save offline, sync when the connection comes back" is the reason the desktop
   app exists, so it gets asserted rather than asserted-to. This drives the real
   Outbox state machine with a fake saver and a fake clock, in Node, with a
   minimal browser shim. No network, no account, no flakiness. */

import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---- browser shim ----
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
const handlers = new Map()
const on = (t, f) => { if (!handlers.has(t)) handlers.set(t, []); handlers.get(t).push(f) }
const fire = (t) => (handlers.get(t) || []).forEach((f) => f())
/* Node 22 ships a real navigator whose properties are getter-only, so it has to be
   redefined rather than assigned. */
let isOnline = true
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => ({ get onLine() { return isOnline } }),
})
globalThis.window = {
  addEventListener: on,
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (id) => clearInterval(id),
}
globalThis.document = { addEventListener: on, visibilityState: 'visible' }

// ---- bundle sync.ts so Node can import it ----
const dir = mkdtempSync(join(tmpdir(), 'mc-sync-'))
const out = join(dir, 'sync.mjs')
/* The real Supabase client is never called here: the Outbox takes its saver by
   injection. Stubbing the module keeps the test hermetic and stops esbuild from
   dragging the whole SDK in just to throw it away. */
const stubSupabase = {
  name: 'stub-supabase',
  setup(b) {
    b.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'stub' }))
    /* react only serves the useSyncStatus hook, which is not what is under test. */
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
      contents: a.path === 'react'
        ? 'export const useState = () => { throw new Error("not under test") }; export const useEffect = () => {}'
        : 'export const SUPABASE_ENABLED = true; export async function saveRemoteState() { throw new Error("the test must inject a saver") }',
      loader: 'js',
    }))
  },
}
await build({
  entryPoints: ['src/sync.ts'], bundle: true, format: 'esm', outfile: out,
  logLevel: 'silent', platform: 'neutral',
  plugins: [stubSupabase],
})
const { Outbox } = await import(`file://${out}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = []
const ok = (cond, label) => { if (!cond) fail.push(label); console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`) }

// ---------------------------------------------------------------- scenario 1
// Offline edit is held, then delivered on reconnect. The whole point.
{
  store.clear(); handlers.clear()
  let attempts = 0
  let online = false
  const saver = async (json) => {
    attempts++
    if (!online) return { ok: false, reason: 'offline', message: 'no network' }
    return { ok: true, merged: json }
  }
  const box = new Outbox(saver, true)
  box.start()

  isOnline = false
  box.push(JSON.stringify({ task: 'written on a plane' }))
  await sleep(50)
  ok(box.dirty === true, 'offline edit is marked unsent')
  ok(box.status().phase === 'offline', `phase reports offline (got ${box.status().phase})`)
  const attemptsWhileOffline = attempts

  // connection returns
  online = true
  isOnline = true
  fire('online')
  await sleep(150)
  ok(attempts > attemptsWhileOffline, 'reconnect triggers a send without any new edit')
  ok(box.dirty === false, 'the unsent edit is cleared once the server takes it')
  ok(box.status().phase === 'synced', `phase returns to synced (got ${box.status().phase})`)
  ok(box.status().lastSyncedAt !== null, 'last-synced time is recorded')
}

// ---------------------------------------------------------------- scenario 2
// The intent to sync survives quitting the app while offline.
{
  store.clear(); handlers.clear()
  const box = new Outbox(async () => ({ ok: false, reason: 'offline' }), true)
  box.start()
  isOnline = false
  box.push(JSON.stringify({ note: 'typed in a tunnel' }))
  await sleep(50)
  ok(store.get('mc-sync-dirty') !== undefined, 'unsent marker is persisted, not just in memory')

  // simulate a relaunch: brand new Outbox, same storage
  const fresh = new Outbox(async () => ({ ok: true, merged: '{}' }), true)
  fresh.start()
  ok(fresh.status().phase === 'waiting', `a relaunch knows work is still unsent (got ${fresh.status().phase})`)
}

// ---------------------------------------------------------------- scenario 3
// A server error retries rather than giving up.
{
  store.clear(); handlers.clear()
  isOnline = true
  let attempts = 0
  const box = new Outbox(async (json) => {
    attempts++
    return attempts < 3 ? { ok: false, reason: 'error', message: 'boom' } : { ok: true, merged: json }
  }, true)
  box.start()
  box.push('{"a":1}')
  await sleep(9000)
  ok(attempts >= 3, `a failing write is retried (attempts: ${attempts})`)
  ok(box.dirty === false, 'and clears once it finally lands')
}

// ---------------------------------------------------------------- scenario 4
// Signed out is not an error and must not spin forever.
{
  store.clear(); handlers.clear()
  let attempts = 0
  const box = new Outbox(async () => { attempts++; return { ok: false, reason: 'signed-out' } }, true)
  box.start()
  box.push('{"a":1}')
  await sleep(3000)
  ok(attempts === 1, `signed out does not retry in a loop (attempts: ${attempts})`)
  ok(box.dirty === false, 'and does not leave a permanent unsent marker')
}

// ---------------------------------------------------------------- scenario 5
// A newer edit while a write is in flight is not lost.
{
  store.clear(); handlers.clear()
  isOnline = true
  const seen = []
  const box = new Outbox(async (json) => { seen.push(json); await sleep(120); return { ok: true, merged: json } }, true)
  box.start()
  box.push('{"v":1}')
  await sleep(20)
  box.push('{"v":2}')       // lands mid-flight
  await sleep(500)
  ok(seen.includes('{"v":2}'), 'an edit made mid-write is still sent')
  ok(box.dirty === false, 'and the outbox settles clean')
}

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall sync checks passed')
process.exit(fail.length ? 1 : 0)
