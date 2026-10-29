// Runs after electron-builder signs the app, before the DMG/ZIP are packaged.
// Notarizes the .app with Apple and staples the ticket to it.
// Requires a keychain profile named "lucid-notary" (see build-and-workflow notes).
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

exports.default = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const zipPath = path.join(context.appOutDir, `${appName}-notarize.zip`)

  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' })
  try {
    execFileSync('xcrun', ['notarytool', 'submit', zipPath, '--keychain-profile', 'lucid-notary', '--wait'], { stdio: 'inherit' })
  } finally {
    fs.rmSync(zipPath, { force: true })
  }
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })
}
