/* The same task in other words. `node tools/similar-test.mjs`.
   Pairs are his own phrasings from the 2026-10-16 dictated day. */
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import assert from 'assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = await build({ entryPoints: [resolve(HERE, '../src/similar.ts')], bundle: true, write: false, format: 'esm', logLevel: 'error' })
const { similarTo } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)

const open = ["Buy Michael's Corner domain", 'Send reminders to prospects', 'HWBT website', 'Email ARSTAS about documents', 'Redesign Sonar UI', 'VZP letter', 'Poslat Korejšovi dokument'].map((title) => ({ title }))
const same = {
  "Finalize and buy the Michael's Corner domain": "Buy Michael's Corner domain",
  'Send a couple of reminders to prospects who did not reply': 'Send reminders to prospects',
  'Finish and send the HWBT website': 'HWBT website',
  'Redesign the Sonar application UI and make it interactive': 'Redesign Sonar UI',
  'poslat dokument Korejsovi': 'Poslat Korejšovi dokument',
}
const different = ['Send 10 new outreach emails', 'Email Moneta about payment plan', 'Record morning coffee video with Claude', 'Website for Off-Plate']
for (const [said, row] of Object.entries(same)) assert.equal(similarTo(said, open)?.title, row, `"${said}" should match "${row}"`)
for (const said of different) assert.equal(similarTo(said, open), null, `"${said}" is a new task`)
console.log(`similar: ${Object.keys(same).length} rephrasings caught, ${different.length} new tasks left alone.`)
