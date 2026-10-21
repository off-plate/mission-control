/* A LINK IN A NOTE MUST STAY A LINK.

   mdToHtml's output goes straight into innerHTML, and note text arrives from
   Obsidian sync and from AI replies, not only from his keyboard. A quote
   inside a URL used to close the href attribute and open a new one, so
   `https://x"onmouseover="...` ran script. This pins the escape.

   Run it with `node tools/richtext-test.mjs`.
*/
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const dir = mkdtempSync(join(tmpdir(), 'richtext-'))
await build({ entryPoints: [new URL('../src/richtext.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'r.mjs') })
const { mdToHtml } = await import(join(dir, 'r.mjs'))

const html = mdToHtml('see https://x.cz/"onmouseover="alert(1) now')
assert.ok(!html.includes('"onmouseover'), html)
assert.ok(html.includes('&quot;onmouseover'), html)
assert.ok(mdToHtml('https://ok.cz/a?b=1&c=2').includes('href="https://ok.cz/a?b=1&amp;c=2"'))
/* A PASTED TABLE MUST STAY A TABLE. A line break inside a cell used to be
   stored as a real newline, which cut the row in two; those notes mend on
   read. A pipe inside a cell is one cell, and <br> is a break in it. */
const t = mdToHtml('| A | B |\n| --- | --- |\n| SEO\nmonthly | 3 000 \\| 4 000 |\nafter')
assert.ok(t.includes('<td>SEO<br>monthly</td><td>3 000 | 4 000</td></tr></tbody></table><p>after</p>'), t)
const u = mdToHtml('| A |\n| --- |\n| one<br>two |')
assert.ok(u.includes('<td>one<br>two</td>'), u)
console.log('richtext: 5 passed')
