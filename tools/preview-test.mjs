/* The core's typing preview: his real phrasings, the shape each must show.
   `node tools/preview-test.mjs` -- exits non-zero on the first wrong shape. */
import { build } from 'esbuild'
import assert from 'assert/strict'
const out = await build({ entryPoints: [new URL('../src/jarviscore.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', jsx: 'automatic' })
const { previewShape } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
const cases = [
  ['Add Ráj Snubních Prstenů as a business prospect', 'prospect'],
  ['add Kavárna Lípa as a new prospect', 'prospect'],
  ['Add Implement Orbit Animation to my to-do list', 'tasks'],
  ['plan the CTP review for today noon', 'tasks'],
  ['plan the floorplan for tomorrow', 'calendar'],
  ['mark Spotify paid', 'bills'],
  ['mark the report done', 'tasks'],
  ['start a focus block', 'focus'],
  ['add a habit to stretch every day', 'habit'],
  ['new project kitchen renovation', 'building'],
  ['I have an idea for a sauna', 'idea'],
  ['log bench 90 kg at the gym', 'gym'],
  ['add my brother Tomas', 'person'],
  ['write this down: tiles are grey', 'note'],
  ['hello there', 'core'],
]
for (const [t, want] of cases) assert.equal(previewShape(t), want, `"${t}" previewed ${previewShape(t)}, wanted ${want}`)
console.log(`preview: ${cases.length} phrasings, all the right shape`)
