/* The half of the Obsidian sync that can be tested without his account.

   Every case here is one that would have quietly damaged a note: a body that
   comes back from the vault subtly different, a title that will not survive a
   filesystem, a hash that disagrees with the app's. The reconcile itself is
   exercised with --dry against the real folder, which changes nothing.

   Run: node tools/obsidian-test.mjs */

import { bodyHash, noteTitle, renderFile, parseFile, fileNameFor } from './obsidian-sync.mjs'

let pass = 0
const fails = []
const is = (name, got, want) => {
  if (got === want) { pass++; return }
  fails.push(`${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`)
}
const ok = (name, cond) => is(name, Boolean(cond), true)

/* ---- the hash has to be the app's, exactly ------------------------------- */
/* Recomputed here the way src/sync-merge.ts writes it. If these two ever
   disagree, the app reads every ordinary Obsidian save as a divergence and puts
   a conflict banner on a note nobody fought over. */
function appHash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}
for (const s of ['', 'a', '# Case\n\nbody', 'Příliš žluťoučký kůň\núpěl ďábelské ódy', '🙂 emoji']) {
  is(`hash matches the app for ${JSON.stringify(s.slice(0, 20))}`, bodyHash(s), appHash(s))
}

/* ---- the round trip must not lose text ----------------------------------- */
const bodies = [
  '# Restaurant automation\n\nFirst point.\n- a\n- b',
  'No heading at all, just a line',
  '# Title\n\n\n\nfour blank lines above',
  '# Tabulka\n\n| a | b |\n| - | - |\n| 1 | 2 |',
  '# Kód\n\n```js\nconst x = "---"\n```',
  '# Frontmatter inside the body\n\n---\nmc: not-a-real-key\n---\n\nstill body',
  '# Trailing spaces   \n\nand a line ending in space ',
  '# Diakritika\n\nPříliš žluťoučký kůň úpěl ďábelské ódy.',
  '# Wikilink\n\nSee [[OP Definition]] and #tag.',
  '# Emoji\n\n🙂 ✅ 🚗',
]
for (const body of bodies) {
  const note = { id: 'note-x', body, updatedAt: 1756000000000 }
  const back = parseFile(renderFile(note))
  is(`round trip: ${JSON.stringify(body.slice(0, 28))}`, back.body, body)
  is(`id survives: ${JSON.stringify(body.slice(0, 20))}`, back.fm.mc, 'note-x')
}

/* A body that itself starts with a --- fence is the nastiest case: a naive
   parser eats the note's own text as frontmatter. */
const fenced = { id: 'note-y', body: '---\nnot frontmatter\n---\nreal text', updatedAt: 1 }
is('body starting with a fence survives', parseFile(renderFile(fenced)).body, fenced.body)
is('body starting with a fence keeps its id', parseFile(renderFile(fenced)).fm.mc, 'note-y')

/* A file he just made in Obsidian has no frontmatter at all. */
is('no frontmatter reads as all body', parseFile('just typing\nmore').body, 'just typing\nmore')
is('no frontmatter has no id', parseFile('just typing').fm.mc, undefined)

/* ---- titles -------------------------------------------------------------- */
is('title strips the hash', noteTitle('# Restaurant case\n\nbody'), 'Restaurant case')
is('title without a hash', noteTitle('Restaurant case\n\nbody'), 'Restaurant case')
is('title skips leading blank lines', noteTitle('\n\n# Late title'), 'Late title')
is('title strips a bullet', noteTitle('- [ ] a task note'), 'a task note')
is('empty body has an empty title', noteTitle(''), '')
ok('title is capped at 120', noteTitle('# ' + 'x'.repeat(300)).length === 120)

/* ---- filenames ----------------------------------------------------------- */
const taken = new Set()
is('slash cannot escape the folder', fileNameFor('Off-Plate / Michael', taken), 'Off-Plate Michael.md')
is('a second note of the same name gets a suffix', fileNameFor('Off-Plate / Michael', taken), 'Off-Plate Michael (2).md')
is('brackets go, they fight wikilinks', fileNameFor('[OP] Definition', new Set()), 'OP Definition.md')
is('an empty title still makes a file', fileNameFor('', new Set()), 'Untitled.md')
is('a dotfile cannot be made by accident', fileNameFor('...hidden', new Set()), 'hidden.md')
is('diacritics are kept, they are legal', fileNameFor('Žluťoučký kůň', new Set()), 'Žluťoučký kůň.md')
ok('a very long title is cut to something openable', fileNameFor('y'.repeat(300), new Set()).length <= 84)

/* ---- the conflict sibling is never read back in -------------------------- */
const CONFLICT_RE = / \(conflict [\d-]+ [\d-]+\)\.md$/
ok('a conflict sibling is recognised', CONFLICT_RE.test('Case (conflict 2026-08-25 14-30).md'))
ok('an ordinary note is not mistaken for one', !CONFLICT_RE.test('Case.md'))
ok('a note that merely says conflict is safe', !CONFLICT_RE.test('Conflict resolution.md'))

console.log(`${pass} passed, ${fails.length} failed`)
for (const f of fails) console.log(`  FAIL ${f}`)
process.exit(fails.length ? 1 : 0)
