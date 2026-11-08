#!/usr/bin/env node
/** Download/verify a target-specific PHP runtime atomically; keep a working cache on failure. */
import { createWriteStream, existsSync, mkdirSync, rmSync, chmodSync, readdirSync, renameSync, mkdtempSync, cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { verifyRuntime } from './runtime-checks.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.argv[2] || process.platform, arch = process.argv[3] || process.arch
const version = process.env.PHP_VERSION || '8.4.14'
const base = 'https://dl.static-php.dev/static-php-cli'
const urls = {
  'linux-x64': `${base}/bulk/php-${version}-cli-linux-x86_64.tar.gz`,
  'linux-arm64': `${base}/bulk/php-${version}-cli-linux-aarch64.tar.gz`,
  'darwin-x64': `${base}/bulk/php-${version}-cli-macos-x86_64.tar.gz`,
  'darwin-arm64': `${base}/bulk/php-${version}-cli-macos-aarch64.tar.gz`,
  'win32-x64': `${base}/windows/spc-max/php-${version}-cli-win.zip`,
}
const key = `${platform}-${arch}`, url = process.env.ERP_PHP_URL || urls[key]
if (!urls[key] || !url || new URL(url).protocol !== 'https:') throw new Error(`Use a supported target and an HTTPS ERP_PHP_URL: ${key}`)
const parent = join(root, 'resources', 'php'), dest = join(parent, key), exe = platform === 'win32' ? 'php.exe' : 'php'
mkdirSync(parent, { recursive: true })
if (existsSync(join(dest, exe)) && !process.env.FORCE) {
  verifyRuntime(join(dest, exe), platform, arch)
  console.log(`Verified cached PHP: ${key}`)
  process.exit(0)
}
const temp = mkdtempSync(join(parent, `.download-${key}-`))
try {
  const archive = join(temp, new URL(url).pathname.endsWith('.zip') ? 'php.zip' : 'php.tar.gz')
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`Downloading PHP ${version} for ${key} (${attempt}/3)`)
      const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
      if (!response.ok || !response.body) throw new Error(`PHP download HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
      break
    } catch (error) {
      rmSync(archive, { force: true })
      if (attempt === 3 || /HTTP (?:400|401|403|404)/.test(error.message)) throw error
      console.warn(`Download interrupted: ${error.message}. Retrying…`)
      await new Promise(resolve => setTimeout(resolve, attempt * 2000))
    }
  }
  const unpack = join(temp, 'runtime'); mkdirSync(unpack)
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${unpack.replaceAll("'", "''")}'`], { stdio: 'inherit' })
    else execFileSync('unzip', ['-q', archive, '-d', unpack], { stdio: 'inherit' })
  } else execFileSync('tar', ['-xzf', archive, '-C', unpack], { stdio: 'inherit' })
  function locate(folder, depth = 0) {
    if (existsSync(join(folder, exe))) return folder
    if (depth > 3) return null
    for (const entry of readdirSync(folder, { withFileTypes: true })) if (entry.isDirectory()) { const found = locate(join(folder, entry.name), depth + 1); if (found) return found }
    return null
  }
  const runtime = locate(unpack)
  if (!runtime) throw new Error(`${exe} not found in the downloaded PHP archive.`)
  const ready = join(temp, 'ready'); cpSync(runtime, ready, { recursive: true })
  if (platform !== 'win32') chmodSync(join(ready, exe), 0o755)
  const check = verifyRuntime(join(ready, exe), platform, arch)
  // Swap only a completely downloaded, extracted and verified runtime.
  const previous = join(temp, 'previous')
  if (existsSync(dest)) renameSync(dest, previous)
  try { renameSync(ready, dest) } catch (error) { if (existsSync(previous)) renameSync(previous, dest); throw error }
  console.log(`PHP ready: ${key}; SHA256 ${check.sha256}`)
} finally { rmSync(temp, { recursive: true, force: true }) }
