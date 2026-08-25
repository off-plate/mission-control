/* Mission Control <-> Obsidian, one folder, both directions.

   What this is for. The vault at iCloud is where the thinking gets written, and
   Mission Control is where it gets acted on. Keeping the same note in both by
   hand is the kind of chore that quietly stops happening, so this job does it:
   one folder in the vault mirrors one folder of Notes, and an edit on either
   side reaches the other.

   Why a background job and not the desktop app. He edits Mission Control on the
   phone and in a browser too, and those changes still have to land in the vault.
   The vault only exists on this Mac, so the Mac is the only place that can do
   the work anyway. A timer here catches up whenever the laptop is open, whoever
   made the change and wherever they made it.

   Why it can write to his account at all. It signs in exactly the way the app
   does, with the emailed 8-digit code, once (`--login`). The refresh token lives
   in ~/.mc-obsidian, mode 600, OUTSIDE this repo, which is public. There is no
   service key anywhere: this job can reach precisely what he can reach.

   The one rule everything below obeys: NEVER LOSE TEXT. When both sides changed
   the same note, the newer text wins the note and the older is kept, on the note
   as `conflict` (Mission Control shows it) and as a sibling file in the vault, so
   whichever side he is standing on, the words are still there.

   Usage:
     node tools/obsidian-sync.mjs --login    sign in once
     node tools/obsidian-sync.mjs --dry      say what it would do, change nothing
     node tools/obsidian-sync.mjs            do it
     node tools/obsidian-sync.mjs --status   show where things stand */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

/* ---- what is wired to what ------------------------------------------------ */

const VAULT = path.join(
  os.homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/Off-Plate System/Mission Control/MC Notes',
)

/* One flat folder on the Mission Control side. Notes stopped being filed by
   workspace at his instruction, so this does not pick a workspace to live in;
   the folder row still carries one because the stored shape has the field. */
const FOLDER_ID = 'nf-obsidian'
const FOLDER_NAME = 'MC Notes'
const FOLDER_SPACE = 'personal'

/* Same two values the app ships in src/config.ts. The anon key is meant to be
   public; the row is readable only with his session attached. */
const SUPABASE_URL = 'https://fhfempisopwsdkmvywbt.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_MDxQPm0SzLHFTnDqg-eyyQ_0yposnES'
const TABLE = 'mc_state'

const STATE_DIR = path.join(os.homedir(), '.mc-obsidian')
const SESSION_FILE = path.join(STATE_DIR, 'session.json')
const LEDGER_FILE = path.join(STATE_DIR, 'ledger.json')
const LOG_FILE = path.join(STATE_DIR, 'sync.log')

/* This job, as a device. The app's merge treats two copies carrying the SAME
   device as one device catching up with itself and never raises a conflict
   banner for them. Obsidian genuinely is a different writer, so it says so. */
const DEV = 'obsidian'

/** How many past bodies a note remembers, copied from src/sync-merge.ts. */
const HIST = 60

/* A vanished file means "he deleted it", and the answer to that is to tick the
   note off. But iCloud evicting a folder looks exactly the same from here, and
   that would tick off everything at once. So a run that would act on more than
   this refuses and says why. */
const MAX_VANISHED = 3

const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry')
const STATUS = args.has('--status')
const LOGIN = args.has('--login')

/* ---- small shared helpers ------------------------------------------------- */

/** FNV-1a, byte for byte the app's src/sync-merge.ts bodyHash. Two writers have
 *  to agree on the hash of the same text without exchanging it, so this cannot
 *  drift from that one. */
export function bodyHash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

/** The app's noteTitle, so a note this job creates is titled the way the app
 *  would have titled it. */
export function noteTitle(body) {
  const first = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return first.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+(\[[ xX]\]\s*)?/, '').slice(0, 120)
}

/** The app's localDateKey: the local day, not UTC. A note written at 1am in
 *  Prague belongs to that day, not to yesterday. */
function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

let seq = 0
const newNoteId = () => `note-${Date.now().toString(36)}${(seq++).toString(36)}o`

const lines = []
function say(msg) {
  lines.push(msg)
  console.log(msg)
}

async function flushLog() {
  if (!lines.length) return
  const stamp = new Date().toISOString()
  const text = lines.map((l) => `${stamp}  ${l}`).join('\n') + '\n'
  try { await fsp.appendFile(LOG_FILE, text) } catch { /* logging is never the reason a run fails */ }
}

/* ---- the file format ------------------------------------------------------
   Frontmatter carries the join key and nothing else that matters, so Obsidian
   shows two tidy properties and stays out of the way. Everything after it is
   the note body VERBATIM. Not reformatted, not re-wrapped, not re-indented:
   a byte-identical round trip is the only version of this that cannot slowly
   eat his text. */

export function renderFile(note) {
  const fm = [
    '---',
    `mc: ${note.id}`,
    `updated: ${new Date(note.updatedAt || Date.now()).toISOString()}`,
    '---',
    '',
  ].join('\n')
  return `${fm}${note.body}\n`
}

/** Split a file into its frontmatter and the body below it. A file with no
 *  frontmatter is one he just created in Obsidian, and that is a normal thing
 *  to find, not an error. */
export function parseFile(text) {
  if (!text.startsWith('---\n')) return { fm: {}, body: text.replace(/\n+$/, '') }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { fm: {}, body: text.replace(/\n+$/, '') }
  const head = text.slice(4, end)
  const rest = text.slice(end + 4).replace(/^\n/, '').replace(/\n+$/, '')
  const fm = {}
  for (const line of head.split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) fm[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { fm, body: rest }
}

/* A filename is a title with the characters a filesystem cannot take removed.
   It is derived, never authoritative on its own: see the rename rules below. */
export function fileNameFor(title, taken) {
  const base = (title || 'Untitled')
    .replace(/[\/\\:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80) || 'Untitled'
  let name = `${base}.md`
  let n = 2
  while (taken.has(name.toLowerCase())) { name = `${base} (${n++}).md`; }
  taken.add(name.toLowerCase())
  return name
}

/* ---- the account ---------------------------------------------------------- */

function client() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function saveSession(session) {
  await fsp.mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  await fsp.writeFile(SESSION_FILE, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    email: session.user?.email ?? '',
    saved: new Date().toISOString(),
  }, null, 2), { mode: 0o600 })
  await fsp.chmod(SESSION_FILE, 0o600)
}

/** Sign in the way the app does: an 8-digit code to his inbox. Run once. The
 *  refresh token this banks is what every later run uses. */
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

/** A signed-in client, or null if he has never run --login. Refresh tokens
 *  rotate, so the new one is banked every time or the next run is locked out. */
async function signedIn() {
  let saved
  try { saved = JSON.parse(await fsp.readFile(SESSION_FILE, 'utf8')) } catch { return null }
  const c = client()
  const { data, error } = await c.auth.setSession({
    access_token: saved.access_token,
    refresh_token: saved.refresh_token,
  })
  if (error || !data.session) {
    const r = await c.auth.refreshSession({ refresh_token: saved.refresh_token })
    if (r.error || !r.data.session) return null
    await saveSession(r.data.session)
    return { c, user: r.data.session.user }
  }
  await saveSession(data.session)
  return { c, user: data.session.user }
}

/** The state row as it stands on the server right now. Read fresh immediately
 *  before every write, exactly as src/supabase.ts does, so a save from here can
 *  never erase what another device banked in the meantime. */
async function readHead(c, uid) {
  const { data, error } = await c.from(TABLE).select('data').eq('id', uid).maybeSingle()
  if (error) throw new Error(`could not read state: ${error.message}`)
  return data?.data ?? null
}

async function writeHead(c, uid, state) {
  /* Stamp it the way a device would, so the topbar in the app can say "Updated
     from Obsidian 2 min ago" instead of a change appearing from nowhere. The
     dev id is a literal rather than a random one: this job IS one writer, on
     one machine, for as long as it exists. */
  state.lastWrite = { dev: DEV, name: 'Obsidian', at: Date.now() }
  /* And savedAt, because the merge picks the newer blob by this field and this
     job genuinely did just write. The head was read moments ago, so everything
     else in the copy being stamped is current; being the newer side is true,
     not a way of winning. */
  state.savedAt = Date.now()
  const { error } = await c.from(TABLE).upsert({
    id: uid, owner: uid, data: state, updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`could not write state: ${error.message}`)
}

/* ---- the ledger -----------------------------------------------------------
   What both sides looked like the last time they agreed. Without it there is no
   way to tell "he changed the note" from "he changed the file", and the whole
   thing collapses into last-writer-wins, which loses paragraphs. */

async function readLedger() {
  try { return JSON.parse(await fsp.readFile(LEDGER_FILE, 'utf8')) } catch { return {} }
}
async function writeLedger(l) {
  await fsp.mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  await fsp.writeFile(LEDGER_FILE, JSON.stringify(l, null, 2))
}

/* ---- reading the vault ---------------------------------------------------- */

/** Every real note file in the folder, plus the names iCloud has not downloaded
 *  yet. A placeholder is a file that EXISTS and is merely not here, so treating
 *  it as deleted would tick off a note he never touched. */
async function readVault() {
  await fsp.mkdir(VAULT, { recursive: true })
  const entries = await fsp.readdir(VAULT, { withFileTypes: true })
  const files = []
  const pending = []
  for (const e of entries) {
    if (e.isDirectory()) continue
    /* iCloud parks an undownloaded file as ".<name>.md.icloud". */
    const cloud = e.name.match(/^\.(.+)\.icloud$/)
    if (cloud) { pending.push(cloud[1]); continue }
    if (!e.name.endsWith('.md')) continue
    if (e.name.startsWith('.')) continue
    /* The losing side of a past conflict. It is his to read and delete; this
       job never reads one back in, or a resolved conflict would return. */
    if (/ \(conflict [\d-]+ [\d-]+\)\.md$/.test(e.name)) continue
    const full = path.join(VAULT, e.name)
    const stat = await fsp.stat(full)
    const text = await fsp.readFile(full, 'utf8')
    const { fm, body } = parseFile(text)
    files.push({ name: e.name, full, mtimeMs: stat.mtimeMs, id: fm.mc || null, body })
  }
  return { files, pending }
}

/* ---- the run -------------------------------------------------------------- */

async function run() {
  const auth = await signedIn()
  if (!auth) {
    say('not signed in. Run: node tools/obsidian-sync.mjs --login')
    process.exitCode = 3
    return
  }
  const { c, user } = auth
  const state = await readHead(c, user.id)
  if (!state) { say('no state row for this account yet; open Mission Control once and sign in.'); process.exitCode = 3; return }

  const notes = Array.isArray(state.notes) ? state.notes : []
  const folders = Array.isArray(state.noteFolders) ? state.noteFolders : []
  const ledger = await readLedger()
  const { files, pending } = await readVault()

  if (pending.length) say(`iCloud has not downloaded ${pending.length} file(s) yet; leaving them alone this run.`)

  /* Notes on the Mission Control side of the mirror. Done ones are deliberately
     included: a note ticked off in the app has to take its file with it. */
  const mine = notes.filter((n) => n.folderId === FOLDER_ID)
  const byId = new Map(mine.map((n) => [n.id, n]))
  const fileById = new Map(files.filter((f) => f.id).map((f) => [f.id, f]))
  const taken = new Set(files.map((f) => f.name.toLowerCase()))

  /* Everything the run decides, collected before anything is done, so --dry is
     the same code path as a real run and cannot drift from it. */
  const plan = { create: [], toVault: [], toApp: [], rename: [], conflict: [], tick: [], remove: [] }

  /* 1. Files with no id: new in Obsidian. In Obsidian the FILENAME is the title,
        so that is what the note gets, and the file's own text goes underneath. */
  for (const f of files) {
    if (f.id) continue
    const title = f.name.replace(/\.md$/, '')
    const body = f.body.trim() ? `# ${title}\n\n${f.body}` : `# ${title}`
    plan.create.push({ file: f, title, body })
  }

  /* 2. Notes with no file. Either brand new in the app, or ticked off. */
  for (const n of mine) {
    if (fileById.has(n.id)) continue
    if (n.done) { if (ledger[n.id]) plan.remove.push({ id: n.id, name: ledger[n.id].file, why: 'done in the app' }); continue }
    if (ledger[n.id]) {
      /* It had a file and the file is gone: he deleted it in Obsidian. */
      plan.tick.push({ note: n, name: ledger[n.id].file })
    } else {
      plan.toVault.push({ note: n, name: null })
    }
  }

  /* 3. Both sides present. This is where the real work is. */
  for (const n of mine) {
    const f = fileById.get(n.id)
    if (!f) continue
    if (n.done) { plan.remove.push({ id: n.id, name: f.name, why: 'done in the app' }); continue }

    const seen = ledger[n.id]
    const noteChanged = !seen || bodyHash(n.body) !== seen.hash
    const fileChanged = !seen || bodyHash(f.body) !== seen.hash
    const renamed = seen && f.name !== seen.file

    if (noteChanged && fileChanged && n.body !== f.body) {
      plan.conflict.push({ note: n, file: f })
    } else if (fileChanged && n.body !== f.body) {
      plan.toApp.push({ note: n, file: f })
    } else if (noteChanged && n.body !== f.body) {
      plan.toVault.push({ note: n, name: f.name })
    }

    /* A rename in Obsidian is him retitling the note; the filename is the title
       there, so it wins and the note's first line follows it. A retitle in the
       app moves the other way and renames the file. Handled after the body, so
       a run that does both ends up consistent either way. */
    if (renamed && !plan.conflict.some((x) => x.note.id === n.id)) {
      plan.rename.push({ note: n, file: f, from: seen.file, to: f.name, source: 'vault' })
    } else if (seen && !renamed) {
      const want = noteTitle(n.body)
      if (want && want !== seen.title) plan.rename.push({ note: n, file: f, from: f.name, to: null, source: 'app' })
    }
  }

  /* 4. The rail. A folder iCloud has evicted looks precisely like him deleting
        everything, and that would tick off the lot in one run. */
  if (plan.tick.length > MAX_VANISHED) {
    say(`REFUSING: ${plan.tick.length} files vanished at once, which is more likely iCloud than a decision.`)
    say(`  ${plan.tick.map((t) => t.name).join(', ')}`)
    say('  Nothing was changed. If the deletions are real, run again after removing fewer at a time.')
    process.exitCode = 2
    return
  }

  const total = plan.create.length + plan.toVault.length + plan.toApp.length
    + plan.conflict.length + plan.tick.length + plan.remove.length + plan.rename.length

  if (STATUS || DRY) {
    say(`${mine.length} note(s) in ${FOLDER_NAME}, ${files.length} file(s) in the vault.`)
    for (const p of plan.create) say(`  new file -> new note      ${p.file.name}`)
    for (const p of plan.toVault) say(`  note -> file              ${noteTitle(p.note.body) || 'Untitled'}`)
    for (const p of plan.toApp) say(`  file -> note              ${p.file.name}`)
    for (const p of plan.rename) say(`  retitled (${p.source})        ${p.from}`)
    for (const p of plan.conflict) say(`  BOTH CHANGED              ${p.file.name}`)
    for (const p of plan.tick) say(`  file deleted -> done      ${p.name}`)
    for (const p of plan.remove) say(`  ${p.why} -> file removed  ${p.name}`)
    if (!total) say('  nothing to do.')
    return
  }

  if (!total) { say('nothing to do.'); return }

  /* ---- carry it out ------------------------------------------------------
     Vault first, then one write to the server. If the process dies between the
     two, the next run reads the files it just wrote, finds the ledger unchanged
     for them, and simply does the app half again. Nothing is lost either way. */

  const noteEdits = new Map()   // id -> patched note row
  const noteAdds = []
  const ledgerNext = { ...ledger }

  const stampBody = (n, body) => ({
    ...n,
    body,
    title: noteTitle(body),
    hist: [...(n.hist ?? []), bodyHash(n.body)].slice(-HIST),
    dev: DEV,
    updatedAt: Date.now(),
  })

  for (const p of plan.create) {
    const id = newNoteId()
    const now = Date.now()
    const row = {
      id, space: FOLDER_SPACE, folderId: FOLDER_ID, title: p.title, body: p.body,
      color: 'amber', when: todayKey(), updatedAt: now, hist: [], dev: DEV,
    }
    noteAdds.push(row)
    await fsp.writeFile(p.file.full, renderFile(row))
    ledgerNext[id] = { file: p.file.name, hash: bodyHash(p.body), title: p.title, mtimeMs: Date.now() }
    say(`new note from ${p.file.name}`)
  }

  for (const p of plan.toApp) {
    const patched = stampBody(p.note, p.file.body)
    noteEdits.set(p.note.id, patched)
    await fsp.writeFile(p.file.full, renderFile(patched))
    ledgerNext[p.note.id] = { file: p.file.name, hash: bodyHash(patched.body), title: patched.title, mtimeMs: Date.now() }
    say(`vault -> app: ${p.file.name}`)
  }

  for (const p of plan.toVault) {
    const name = p.name ?? fileNameFor(noteTitle(p.note.body), taken)
    const full = path.join(VAULT, name)
    await fsp.writeFile(full, renderFile(p.note))
    ledgerNext[p.note.id] = { file: name, hash: bodyHash(p.note.body), title: noteTitle(p.note.body), mtimeMs: Date.now() }
    say(`app -> vault: ${name}`)
  }

  /* Both sides wrote. Newer text becomes the note; the older is kept where he
     will actually see it, on the note AND beside the file. */
  for (const p of plan.conflict) {
    const fileAt = p.file.mtimeMs
    const noteAt = p.note.updatedAt || 0
    const fileWins = fileAt > noteAt
    const winner = fileWins ? p.file.body : p.note.body
    const loser = fileWins ? p.note.body : p.file.body
    const patched = { ...stampBody(p.note, winner), conflict: { body: loser, at: Math.min(fileAt, noteAt) } }
    noteEdits.set(p.note.id, patched)
    await fsp.writeFile(p.file.full, renderFile(patched))
    const d = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}`
    const side = path.join(VAULT, `${p.file.name.replace(/\.md$/, '')} (conflict ${stamp}).md`)
    await fsp.writeFile(side, `${loser}\n`)
    ledgerNext[p.note.id] = { file: p.file.name, hash: bodyHash(winner), title: patched.title, mtimeMs: Date.now() }
    say(`BOTH CHANGED ${p.file.name}: kept the ${fileWins ? 'vault' : 'app'} text, older one saved beside it`)
  }

  for (const p of plan.rename) {
    if (p.source === 'vault') {
      /* The filename is the title in Obsidian, so the note's first line follows. */
      const title = p.file.name.replace(/\.md$/, '')
      const base = noteEdits.get(p.note.id) ?? p.note
      const rest = base.body.split('\n').slice(1).join('\n')
      const body = rest ? `# ${title}\n${rest}` : `# ${title}`
      const patched = stampBody(base, body)
      noteEdits.set(p.note.id, patched)
      await fsp.writeFile(p.file.full, renderFile(patched))
      ledgerNext[p.note.id] = { file: p.file.name, hash: bodyHash(body), title, mtimeMs: Date.now() }
      say(`retitled in the vault: ${p.from} -> ${p.file.name}`)
    } else {
      const base = noteEdits.get(p.note.id) ?? p.note
      const title = noteTitle(base.body)
      taken.delete(p.file.name.toLowerCase())
      const name = fileNameFor(title, taken)
      if (name !== p.file.name) await fsp.rename(p.file.full, path.join(VAULT, name))
      await fsp.writeFile(path.join(VAULT, name), renderFile(base))
      ledgerNext[p.note.id] = { file: name, hash: bodyHash(base.body), title, mtimeMs: Date.now() }
      say(`retitled in the app: ${p.file.name} -> ${name}`)
    }
  }

  for (const p of plan.tick) {
    noteEdits.set(p.note.id, { ...p.note, done: Date.now(), dev: DEV, updatedAt: Date.now() })
    delete ledgerNext[p.note.id]
    say(`deleted in the vault -> ticked off in the app: ${p.name}`)
  }

  for (const p of plan.remove) {
    const full = path.join(VAULT, p.name)
    try { await fsp.rm(full, { force: true }) } catch { /* already gone is the outcome we wanted */ }
    delete ledgerNext[p.id]
    say(`${p.why}: removed ${p.name} from the vault`)
  }

  /* One write, against the head as it is RIGHT NOW rather than the copy read at
     the top of this run. Anything another device banked while the files were
     being written is still there underneath. */
  const head = await readHead(c, user.id)
  const fresh = head ?? state
  const freshNotes = Array.isArray(fresh.notes) ? [...fresh.notes] : []
  for (let i = 0; i < freshNotes.length; i++) {
    const patched = noteEdits.get(freshNotes[i].id)
    if (patched) freshNotes[i] = patched
  }
  fresh.notes = [...noteAdds, ...freshNotes]

  const freshFolders = Array.isArray(fresh.noteFolders) ? [...fresh.noteFolders] : []
  if (!freshFolders.some((f) => f.id === FOLDER_ID)) {
    freshFolders.push({ id: FOLDER_ID, space: FOLDER_SPACE, name: FOLDER_NAME, parentId: `nf-space-${FOLDER_SPACE}`, order: 0 })
    say(`created the ${FOLDER_NAME} folder in Mission Control`)
  }
  fresh.noteFolders = freshFolders

  await writeHead(c, user.id, fresh)
  await writeLedger(ledgerNext)
  say(`done: ${total} change(s).`)
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntry) try {
  if (LOGIN) await login()
  else await run()
} catch (e) {
  say(`FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
} finally {
  await flushLog()
}
