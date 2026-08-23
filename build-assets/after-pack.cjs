/* Ad-hoc sign the finished bundle.

   Out of the box electron-builder skipped signing entirely (there is no Apple
   Developer identity on this machine), which left the app carrying only the
   linker's default signature under the identifier "Electron". That is not just
   cosmetic: macOS keys login items and notification attribution off the bundle
   identity, so "open at login" and every notification would have been filed
   under Electron rather than Mission Control.

   An ad-hoc signature costs nothing and needs no account. It is not notarization
   and does not make the dmg distributable to other Macs, which is documented in
   DESKTOP.md. It does make this app a properly sealed, correctly identified
   bundle on his own machine.

   Signed inside-out: nested code must be sealed before the thing that contains it. */
const { execFileSync } = require('node:child_process')
const { readdirSync, existsSync } = require('node:fs')
const path = require('node:path')

const ID = 'com.offplate.missioncontrol'

function sign(target, identifier) {
  execFileSync('codesign', [
    '--force',
    '--sign', '-',                 // "-" is ad-hoc
    ...(identifier ? ['--identifier', identifier] : []),
    '--timestamp=none',
    target,
  ], { stdio: 'pipe' })
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const frameworks = path.join(appPath, 'Contents', 'Frameworks')

  if (existsSync(frameworks)) {
    for (const entry of readdirSync(frameworks)) {
      const full = path.join(frameworks, entry)
      if (entry.endsWith('.app')) {
        // Helper apps keep their own identifiers; Electron already set them.
        sign(path.join(full, 'Contents', 'MacOS', entry.replace(/\.app$/, '')), null)
        sign(full, null)
      } else if (entry.endsWith('.framework') || entry.endsWith('.dylib')) {
        sign(full, null)
      }
    }
  }
  sign(appPath, ID)

  const out = execFileSync('codesign', ['-dv', '--verbose=2', appPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  void out
  console.log(`  • ad-hoc signed ${path.basename(appPath)} as ${ID}`)
}
