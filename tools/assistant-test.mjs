/* The assistant's loop, against a scripted model. No network, no key, no data.
   `node tools/assistant-test.mjs` -- exits non-zero on the first broken rule.

   What it holds the loop to (each one was a real miss, 2026-10-04):
   - a lookup goes back to the model and the turn carries on
   - a failed action goes back to the model, and a fix round runs
   - a long dictated list arrives whole (there used to be a cap of six)
   - the Groq request carries only flags gpt-oss accepts
   - the prompt stays small enough for the free tier's 8,000 tokens a minute */
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import assert from 'assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = await build({
  entryPoints: [resolve(HERE, '../src/assistant.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
  define: { 'import.meta.env': '{}' },
})
const store = { 'mc-groq-key': 'test' }
/* speech.ts reaches for the browser's voices when it loads. */
globalThis.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {} }
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: (k) => { delete store[k] } }
const A = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)

/* The model, one scripted reply per round. */
const sent = []
let script = []
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  sent.push(body)
  const content = JSON.stringify(script.shift() ?? { say: 'Out of script.' })
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
}

const brief = {
  now: '09:00', weekday: 'Sunday', planned: [], backlogCount: 0, backlog: [], oldest: [],
  habits: { due: 0, kept: 0, open: [] }, allHabits: [], routines: { due: 0, kept: 0, open: [] },
  meetings: [], blocks: [], tomorrow: [], tomorrowMeetings: [], focusToday: 0, goals: [],
  unfinishedYesterday: [], completedYesterday: [], weather: null, bills: null, quitting: [], nextTask: null,
}
const ran = []
const looked = []
const hands = {
  run: async (acts) => acts.map((a) => { ran.push(a); return a.match === 'wrong' ? { ok: false, text: 'nothing here is called "wrong"' } : { ok: true, text: `${a.kind} ok` } }),
  find: (q) => { looked.push(q); return '- VZP letter | on the list' },
}

// 1. Look up, then act on what the lookup found, then answer.
script = [
  { find: [{ what: 'tasks', query: 'vzp' }] },
  { say: 'Putting the VZP letter on the morning.', do: [{ kind: 'move', match: 'VZP letter', slot: 'morning' }] },
]
let r = await A.ask('put the vzp thing on the morning', brief, [], hands)
assert.equal(r.ok, true)
assert.deepEqual(looked, [{ what: 'tasks', query: 'vzp' }])
assert.equal(ran.length, 1)
assert.equal(sent.length, 2, 'lookup round, then the acting round, and the clean result ends it')
assert.match(sent[1].messages.at(-1).content, /LOOKUP tasks "vzp":\n- VZP letter/)

// 2. A failure goes back, and the fix round runs.
sent.length = 0; ran.length = 0
script = [
  { say: 'Ticking it.', do: [{ kind: 'done', match: 'wrong' }] },
  { say: 'Found the right one.', do: [{ kind: 'done', match: 'VZP letter' }] },
]
r = await A.ask('done with vzp', brief, [], hands)
assert.equal(ran.length, 2)
assert.match(sent[1].messages.at(-1).content, /FAILED: nothing here is called "wrong"/)
assert.equal(r.reply.say, 'Found the right one.')

// 2b. An action that cannot succeed, sent again, runs once and the turn ends.
sent.length = 0; ran.length = 0
script = [
  { say: 'Marking it.', do: [{ kind: 'done', match: 'wrong' }] },
  { say: 'Still cannot find it.', do: [{ kind: 'done', match: 'wrong' }] },
]
r = await A.ask('done with the wrong one', brief, [], hands)
assert.equal(ran.length, 1, 'a repeated failing action is not run again')
assert.equal(sent.length, 2)

// 3. Nine dictated tasks arrive as nine, and junk is dropped, not run.
sent.length = 0; ran.length = 0
script = [{ say: 'Adding all of them.', do: [
  ...Array.from({ length: 9 }, (_, i) => ({ kind: 'add', title: `Task ${i + 1}`, slot: 'noon', min: '20' })),
  { kind: 'add' }, { kind: 'invented', title: 'x' }, { kind: 'move', match: 'Task 1' },
] }]
r = await A.ask('nine things', brief, [], hands)
assert.equal(ran.length, 9, 'every dictated row, no cap, and invalid ones dropped')
assert.equal(ran[0].min, 20, 'a number sent as a string is still a number')
assert.equal(sent.length, 1, 'all ok, nothing to look up: one request')

// 4. Off-Plate the old workspace word lands as the project.
const [legacy] = A.cleanActions([{ kind: 'add', title: 'Post', space: 'offplate' }])
assert.equal(legacy.space, 'personal')
assert.equal(legacy.project, 'Off-Plate')

// 5. The request itself.
const body = sent[0]
assert.equal(body.include_reasoning, false)
assert.equal(body.reasoning_effort, 'low')
assert.equal(body.reasoning_format, undefined, 'gpt-oss rejects reasoning_format with a 400')
const chars = body.messages.filter((m) => m.role === 'system').reduce((n, m) => n + m.content.length, 0)
const tokens = Math.round(chars / 3.8)
assert.ok(tokens < 4500, `prompt is ~${tokens} tokens; the free tier allows 8,000 a minute`)

console.log(`assistant loop: 6 checks passed. Prompt ~${tokens} tokens with an empty briefing.`)
