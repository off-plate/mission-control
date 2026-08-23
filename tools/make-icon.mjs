/* Builds build-assets/icon.icns from build-assets/icon.svg.

   Chromium renders the SVG at each size iconutil wants, rather than upscaling one
   bitmap, so the 16px dock icon is drawn at 16px instead of being a squashed
   1024. Playwright is already a devDependency for the QA suite; nothing new is
   pulled in for this. Re-run after editing the SVG:  node tools/make-icon.mjs */
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const OUT = 'build-assets'
const svg = readFileSync(`${OUT}/icon.svg`, 'utf8')
const set = `${OUT}/icon.iconset`
rmSync(set, { recursive: true, force: true })
mkdirSync(set, { recursive: true })

const sizes = [[16,'16x16'],[32,'16x16@2x'],[32,'32x32'],[64,'32x32@2x'],[128,'128x128'],[256,'128x128@2x'],[256,'256x256'],[512,'256x256@2x'],[512,'512x512'],[1024,'512x512@2x']]
const b = await chromium.launch()
for (const [px, name] of sizes) {
  const p = await b.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 })
  await p.setContent(`<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`)
  writeFileSync(`${set}/icon_${name}.png`, await p.screenshot({ omitBackground: true }))
  await p.close()
}
await b.close()
execFileSync('iconutil', ['-c', 'icns', set, '-o', `${OUT}/icon.icns`])
rmSync(set, { recursive: true, force: true })
console.log('wrote', `${OUT}/icon.icns`)
