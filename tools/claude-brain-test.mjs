/* Spike: can a Claude model, run through `claude -p` on the Mac, be the
   assistant's brain? `node tools/claude-brain-test.mjs [model] [dump.txt]`

   Runs the REAL ask() loop (real SYSTEM prompt, briefing, parser, cleanActions,
   multi-round) with fetch stubbed so every model call goes to the claude CLI.
   Hands are mocked and record what would have run. Nothing touches his data,
   no network call other than claude itself, no key needed.

   Prints: the actions in order, the sentence the assistant would say, rounds,
   wall time, and the claude CLI's own usage figures. */
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { spawn } from 'child_process'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODEL = process.argv[2] || 'claude-haiku-5-5'
const DUMP = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : readFileSync(resolve(HERE, 'claude-brain-dump.txt'), 'utf8')

const out = await build({
  entryPoints: [resolve(HERE, '../src/assistant.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
  define: { 'import.meta.env': '{}' },
})
const store = { 'mc-groq-key': 'spike' }
globalThis.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {} }
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: (k) => { delete store[k] } }
const A = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)

/* An empty cwd so the CLI loads no CLAUDE.md, no project settings. */
const CWD = mkdtempSync(resolve(tmpdir(), 'mc-brain-'))
const usage = []

function claude(system, transcript) {
  return new Promise((ok, fail) => {
    const t0 = Date.now()
    const p = spawn('claude', [
      '-p', '--model', MODEL, '--output-format', 'json',
      '--system-prompt', system,
      '--tools', '', '--disable-slash-commands', '--no-session-persistence',
      '--strict-mcp-config', '--setting-sources', '',
      ...(process.env.EFFORT ? ['--effort', process.env.EFFORT] : []),
    ], { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] })
    let o = '', e = ''
    p.stdout.on('data', (d) => (o += d))
    p.stderr.on('data', (d) => (e += d))
    p.on('close', (code) => {
      if (code !== 0) return fail(new Error(`claude exit ${code}: ${e || o}`.slice(0, 600)))
      try {
        const j = JSON.parse(o)
        usage.push({ ms: Date.now() - t0, in: j.usage?.input_tokens, cacheRead: j.usage?.cache_read_input_tokens, cacheMake: j.usage?.cache_creation_input_tokens, out: j.usage?.output_tokens, cost: j.total_cost_usd })
        ok(String(j.result ?? ''))
      } catch (x) { fail(new Error('bad CLI output: ' + o.slice(0, 300))) }
    })
    p.stdin.end(transcript)
  })
}

/* The app's request body is {messages:[system, system, ...turns]}. Same split
   the Gemini path uses (oneSystem): all system text in one, turns as a log. */
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  const sys = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const turns = body.messages.filter((m) => m.role !== 'system')
  const transcript = turns.length === 1
    ? turns[0].content
    : turns.map((m) => `${m.role === 'user' ? 'USER' : 'YOU (earlier reply)'}:\n${m.content}`).join('\n\n') + '\n\nReply now to the last USER message with the single JSON object.'
  const content = await claude(sys, transcript)
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
}

/* A small, invented day. Titles are fake on purpose. */
const brief = {
  now: '08:40', weekday: 'Saturday',
  planned: [
    { slot: 'morning', items: [{ title: 'Call the dentist', done: false, min: 10, space: 'personal' }] },
    { slot: 'noon', items: [] },
    { slot: 'afternoon', items: [{ title: 'Groceries', done: false, min: 45, space: 'personal' }] },
    { slot: 'evening', items: [] },
  ],
  backlogCount: 3,
  backlog: [
    { title: 'Renew the car insurance', space: 'personal' },
    { title: 'Pay the gym membership', space: 'personal' },
    { title: 'Sort the winter tyres', space: 'personal' },
  ],
  oldest: [], habits: { due: 2, kept: 0, open: ['Stretch', 'Read 20 pages'] }, allHabits: ['Stretch', 'Read 20 pages'],
  routines: { due: 1, kept: 0, open: ['Evening shutdown'] }, meetings: [], blocks: [], tomorrow: [], tomorrowMeetings: [],
  focusToday: 0, goals: [{ name: 'Run 10k', pct: 40 }], unfinishedYesterday: [], completedYesterday: [],
  weather: null, bills: null, quitting: [], nextTask: null,
}
const ran = []
const looked = []
const hands = {
  run: async (acts) => acts.map((a) => { ran.push(a); return { ok: true, text: `${a.kind} ok` } }),
  find: (q) => { looked.push(q); return '(nothing found)' },
}

const t0 = Date.now()
const r = await A.ask(DUMP, brief, [], hands)
const wall = ((Date.now() - t0) / 1000).toFixed(1)

console.log(`MODEL ${MODEL}   ${DUMP.split(/\s+/).length} words in   ${usage.length} CLI call(s)   ${wall}s wall`)
console.log(r.ok ? '' : 'FAILED: ' + JSON.stringify(r))
console.log('\nACTIONS (' + ran.length + '):')
ran.forEach((a, i) => console.log(String(i + 1).padStart(2), JSON.stringify(a)))
if (looked.length) console.log('\nLOOKUPS:', JSON.stringify(looked))
if (r.ok) console.log('\nSAY:\n' + r.reply.say)
console.log('\nUSAGE per call:', JSON.stringify(usage))
