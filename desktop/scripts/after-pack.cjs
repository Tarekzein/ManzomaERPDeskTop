const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async function afterPack(context) {
  const { verifyPackagedResources } = await import('./runtime-checks.mjs')
  const arch = require('builder-util').Arch[context.arch]
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  verifyPackagedResources(resources, context.electronPlatformName, arch)
  // Finder/resource-fork attributes can come from copied build assets. Remove
  // them only from this generated bundle before macOS code signing.
  if (context.electronPlatformName === 'darwin') execFileSync('/usr/bin/xattr', ['-cr', join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)])
  console.log(`Package resources verified: ${context.electronPlatformName}-${arch}, PHP + production backend + public trust.`)
}
