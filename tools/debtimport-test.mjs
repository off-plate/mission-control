/* READING A PASTED LIST OF DEBTS, TESTED.

   Getting his creditors into Bills one form at a time is why several of them
   were never entered at all, so the whole list can be pasted instead. That
   makes a parser the thing standing between a paste and his real balances,
   and a parser that misreads a line quietly writes the wrong number: 42 350
   read as 100 is a plausible-looking figure, not a crash.

   The shapes that actually matter here are Czech ones. "42 350 Kč" groups
   thousands with a space, and a copy out of a bank statement carries a
   non-breaking or thin space instead of a plain one; a comma is a decimal
   point, not a separator. A name can also end in a digit ("Second card 2"),
   which is the case that breaks a naive "grab the last number" rule.

   The module is pure, so this needs no browser. Run it with
   `node tools/debtimport-test.mjs`.
*/
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'debtimp-'))
await build({ entryPoints: [new URL('../src/debtimport.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'd.mjs') })
const { parseDebtLines } = await import(join(dir, 'd.mjs'))

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message) } }
const one = (line) => parseDebtLines(line)[0]
const reads = (line, name, amount) => {
  const r = one(line)
  if (r.name !== name) throw new Error(`name ${JSON.stringify(r.name)} !== ${JSON.stringify(name)}`)
  if (r.amount !== amount) throw new Error(`amount ${r.amount} !== ${amount}`)
}

t('a colon and space-grouped thousands', () => reads('Health office: 42 350 Kč', 'Health office', 42350))
t('the spaces a statement pastes in', () => reads('Health office:\u00a042\u202f350\u2009Kč', 'Health office', 42350))
t('no separator at all', () => reads('Social office 61200', 'Social office', 61200))
t('an em dash', () => reads('Parents — 30 000', 'Parents', 30000))
t('a tab and CZK', () => reads('Bank\t88 100 CZK', 'Bank', 88100))
t('the ,- suffix', () => reads('Card: 45 000,-', 'Card', 45000))
t('a comma is a decimal, and rounds', () => reads('Fee: 1 234,50 Kč', 'Fee', 1235))
t('dots group thousands too', () => reads('Old: 1.234.567 Kč', 'Old', 1234567))

/* The two that a naive rule gets wrong. */
t('a name ending in a digit keeps its digit', () => reads('Second card 2: 12 000', 'Second card 2', 12000))
t('a name with a hash keeps it', () => reads('Loan #3 - 5 000 Kč', 'Loan #3', 5000))

/* Nothing is written on a guess: a line with no figure, or a figure of
   nothing, comes back unusable rather than as a zero-crown debt. */
t('a line with no figure is left out', () => reads('call the bank about this', 'call the bank about this', null))
t('zero is not an amount', () => reads('Cleared: 0', 'Cleared', null))

t('blank lines are not rows', () => {
  const rows = parseDebtLines('A: 1 000\n\n   \n  B: 2 000  \nC: 3 000')
  if (rows.length !== 3) throw new Error(`${rows.length} rows, wanted 3`)
  if (rows[1].name !== 'B') throw new Error(`trailing spaces kept: ${JSON.stringify(rows[1].name)}`)
})

t('a whole list keeps its order and its total', () => {
  const rows = parseDebtLines(['A: 42 350 Kč', 'B: 7 415 Kč', 'C: 61 200 Kč', 'D: 23 806 Kč'].join('\n'))
  if (rows.map((r) => r.name).join('') !== 'ABCD') throw new Error('order lost')
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
  if (total !== 134771) throw new Error(`total ${total}`)
})

console.log(`${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
