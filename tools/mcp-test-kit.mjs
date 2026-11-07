/* Shared test kit for the Claude connector (supabase/functions/mc-mcp).

   import { loadKit } from './mcp-test-kit.mjs'
   const K = await loadKit({ modules: ['tools-people.ts'], extra: ["export { slugTag as appSlugTag } from './src/tags.ts'"] })
   const { M, fixture, stateDb, fakeServer, refuses, clone } = K

   - M       everything bundled: ops, commit, reg, the app's real merge (mergeStates, appRowKey,
             appBodyHash) and each module as a namespace named after its file (tools-people.ts
             becomes M.tools_people, ops-people.ts becomes M.ops_people)
   - fixture()           a realistic state blob to extend with your own rows
   - fakeDb(tables)      in-memory PostgREST: select / insert / update / delete, eq neq lt lte gt gte
                         in is, order, limit, single, maybeSingle, and select() after a write
   - stateDb(blob)       a fakeDb holding mc_state for user 'u1' (what commit() reads and writes)
   - fakeServer(K, reg, db)  registers tool modules on a recording server, validates every call's
                         input with the REAL zod, runs the handler through the real commit()

   zod is looked up as 'zod', then $ZOD_PATH. With neither, schemas are not validated and the kit
   says so. Run with ZOD_PATH=<path to zod/index.js> to validate. */
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, resolve } from 'path'
import assert from 'assert/strict'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const clone = (x) => JSON.parse(JSON.stringify(x))
const FN = './supabase/functions/mc-mcp'

async function loadZod() {
  const tries = ['zod', process.env.ZOD_PATH].filter(Boolean)
  for (const spec of tries) {
    try {
      const mod = await import(spec.startsWith('/') ? pathToFileURL(spec).href : spec)
      const z = mod.z ?? mod.default?.z ?? mod
      if (z?.object) return { z, real: true }
    } catch { /* try the next */ }
  }
  console.warn('mcp-test-kit: zod not found (set ZOD_PATH): tool input schemas are NOT validated in this run')
  const chain = () => new Proxy(function () {}, { get: (_t, k) => (k === 'parse' ? (x) => x : chain()), apply: () => chain() })
  return { z: { object: chain, string: chain, number: chain, boolean: chain, enum: chain, array: chain, any: chain, literal: chain, union: chain, record: chain }, real: false }
}

export async function loadKit({ modules = [], extra = [] } = {}) {
  const lines = [
    `export * from '${FN}/ops.ts'`,
    `export * from '${FN}/commit.ts'`,
    `export * from '${FN}/reg.ts'`,
    `export { mergeStates, rowKey as appRowKey, bodyHash as appBodyHash } from './src/sync-merge.ts'`,
    ...modules.map((m) => `export * as ${m.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9]+/g, '_')} from '${FN}/${m}'`),
    ...extra,
  ]
  const out = await build({
    stdin: { contents: lines.join('\n'), resolveDir: ROOT, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', define: { 'import.meta.env': '{}' },
  })
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
  const M = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  const { z, real } = await loadZod()
  const refuses = (fn, re, msg) => assert.throws(fn, (e) => e instanceof M.McError && re.test(e.message), msg)
  const refusesAsync = (fn, re, msg) => assert.rejects(fn, (e) => e instanceof M.McError && re.test(e.message), msg)
  return { M, z, zodReal: real, fixture, fakeDb, stateDb: (blob, uid = 'u1') => stateDb(blob, uid), fakeServer: (K, regs, db, uid) => fakeServer(K, regs, db, uid), refuses, refusesAsync, clone }
}

/* ---- a realistic blob ---------------------------------------------------- */
export const TODAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date())
export function fixture() {
  return {
    schema: 'v1', savedAt: 1000,
    tasks: [
      { id: 't-a', title: 'Připravit tabulku pro Michala', source: 'mc', estimateMin: 0, done: false, space: 'work', list: 'backlog', category: 'quick', createdAt: '2026-11-01', addedAt: 1 },
      { id: 't-b', title: 'Call the dentist', source: 'mc', estimateMin: 10, estimated: true, done: false, space: 'personal', list: 'today', plannedOn: TODAY, slot: 'morning', category: 'call', createdAt: '2026-11-01', addedAt: 2 },
      { id: 't-c', title: 'Call the insurance', source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'call', createdAt: '2026-11-01', addedAt: 3 },
    ],
    projects: [{ id: 'p-sonar', name: 'Sonar', space: 'work', createdAt: '2026-10-01' }, { id: 'p-off', name: 'Off-Plate', space: 'personal', createdAt: '2026-10-01' }],
    habits: [{ id: 'h-stretch', name: 'Stretch', space: 'personal', paused: false, days: [false, false, false, false, false, false, false] }],
    habitLog: [], routines: [], goals: [],
    notes: [{ id: 'note-1', space: 'personal', folderId: 'nf-space-personal', title: 'Groceries', body: 'Groceries\nmilk', color: 'amber', when: '2026-11-01', updatedAt: 500, hist: [], dev: 'dphone' }],
    noteFolders: [], people: [], personBonds: [], personContacts: [], prospects: [], ideaBoard: [], gymGoals: [], prompts: [],
    focusSessions: [], ledger: [], graveyard: [],
  }
}

/* ---- an in-memory PostgREST ----------------------------------------------- */
let idSeq = 0
export function fakeDb(initial = {}) {
  const tables = {}
  for (const [t, rows] of Object.entries(initial)) tables[t] = clone(rows)
  const db = { tables, calls: { updates: 0, inserts: 0, deletes: 0 }, beforeUpdate: null, from }
  function from(name) {
    const rows = (tables[name] ??= [])
    const q = { op: 'select', f: [], cols: null, ret: false, one: null, ord: null, lim: null, patch: null, ins: null }
    const cmp = { eq: (a, b) => a === b, neq: (a, b) => a !== b, lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b, gte: (a, b) => a >= b, in: (a, b) => b.includes(a), is: (a, b) => (b === null ? a == null : a === b) }
    const api = {}
    for (const op of Object.keys(cmp)) api[op] = (k, v) => { q.f.push((r) => cmp[op](r[k], v)); return api }
    api.select = (cols) => { if (q.op === 'select') q.cols = cols ?? null; else { q.ret = true; q.retCols = cols } return api }
    api.insert = (r) => { q.op = 'insert'; q.ins = Array.isArray(r) ? r : [r]; return api }
    api.upsert = (r) => { q.op = 'upsert'; q.ins = Array.isArray(r) ? r : [r]; return api }
    api.update = (p) => { q.op = 'update'; q.patch = p; return api }
    api.delete = () => { q.op = 'delete'; return api }
    api.order = (k, o) => { q.ord = [k, o?.ascending !== false]; return api }
    api.limit = (n) => { q.lim = n; return api }
    api.single = () => { q.one = 'single'; return api }
    api.maybeSingle = () => { q.one = 'maybe'; return api }
    const proj = (r, cols) => {
      if (!cols || cols === '*') return clone(r)
      const o = {}
      for (const k of cols.split(',').map((x) => x.trim())) o[k] = r[k]
      return clone(o)
    }
    const shape = (list, cols) => {
      const out = list.map((r) => proj(r, cols))
      if (q.one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: `expected 1 row, got ${out.length}` } }
      if (q.one === 'maybe') return { data: out[0] ?? null, error: null }
      return { data: out, error: null }
    }
    api.then = (res, rej) => Promise.resolve().then(() => {
      const hit = () => rows.filter((r) => q.f.every((fn) => fn(r)))
      if (q.op === 'insert' || q.op === 'upsert') {
        db.calls.inserts++
        const made = q.ins.map((r) => {
          const row = { id: r.id ?? `row${++idSeq}`, created_at: new Date().toISOString(), ...clone(r) }
          if (q.op === 'upsert') { const i = rows.findIndex((x) => x.id === row.id); if (i >= 0) { rows[i] = { ...rows[i], ...row }; return rows[i] } }
          rows.push(row); return row
        })
        return q.ret ? shape(made, q.retCols) : { data: null, error: null }
      }
      if (q.op === 'update') {
        db.calls.updates++
        if (db.beforeUpdate) { const h = db.beforeUpdate; db.beforeUpdate = null; h(db) }
        const m = hit(); m.forEach((r) => Object.assign(r, clone(q.patch)))
        return q.ret ? shape(m, q.retCols) : { data: null, error: null }
      }
      if (q.op === 'delete') {
        db.calls.deletes++
        const m = hit(); for (const r of m) rows.splice(rows.indexOf(r), 1)
        return q.ret ? shape(m, q.retCols) : { data: null, error: null }
      }
      let m = hit()
      if (q.ord) m = [...m].sort((a, b) => (a[q.ord[0]] < b[q.ord[0]] ? -1 : a[q.ord[0]] > b[q.ord[0]] ? 1 : 0) * (q.ord[1] ? 1 : -1))
      if (q.lim) m = m.slice(0, q.lim)
      return shape(m, q.cols)
    }).then(res, rej)
    return api
  }
  return db
}
export const stateDb = (blob, uid = 'u1') => fakeDb({ mc_state: [{ id: uid, owner: uid, data: blob, updated_at: '2026-11-07T10:00:00.000Z' }] })

/* ---- a recording MCP server ------------------------------------------------ */
export function fakeServer(K, regs, db, uid = 'u1') {
  const tools = {}
  const server = { registerTool(name, cfg, cb) { assert.ok(!tools[name], `duplicate tool name: ${name}`); tools[name] = { cfg, cb } } }
  const r = K.M.makeReg({ server, z: K.z, db, uid })
  for (const reg of Array.isArray(regs) ? regs : [regs]) reg(r)
  const call = async (name, args = {}) => {
    const t = tools[name]
    assert.ok(t, `no such tool: ${name}`)
    const parsed = K.zodReal && t.cfg.inputSchema ? t.cfg.inputSchema.parse(args) : args // a bad input throws, as it is refused in production
    const res = await t.cb(parsed)
    const txt = res.content.map((c) => c.text).join('\n')
    let json; try { json = JSON.parse(txt) } catch { /* plain text */ }
    return { isError: !!res.isError, text: txt, json }
  }
  return { tools, call, names: () => Object.keys(tools) }
}
