/** Reproducible target preparation; retry transient downloads without discarding valid caches. */
import { spawn } from 'node:child_process'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const testing = args.includes('--test')
const requested = args.filter(arg => ['mac', 'win', 'linux'].includes(arg))
const targets = requested.length ? [...new Set(requested)] : [process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux']
const forwarded = args.filter(arg => arg !== '--test' && !['mac', 'win', 'linux'].includes(arg))
if (targets.includes('mac') && process.platform !== 'darwin') throw new Error('Build macOS DMGs on a Mac (or use the macOS release workflow).')
const env = { ...process.env }
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
env[pathKey] = `${dirname(process.execPath)}${delimiter}${env[pathKey] ?? ''}`
delete env.ELECTRON_RUN_AS_NODE
if (testing) { env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'; delete env.CSC_LINK; delete env.CSC_KEY_PASSWORD }

async function command(script, parameters = [], retry = false, extraEnv = {}) {
  for (let attempt = 1; ; attempt++) {
    let tail = ''
    const child = spawn(process.execPath, [script, ...parameters], { cwd: root, env: { ...env, ...extraEnv }, stdio: ['inherit', 'pipe', 'pipe'] })
    for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', data => { output.write(data); tail = (tail + data).slice(-40_000) })
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => signal ? reject(new Error(`Build interrupted: ${signal}`)) : resolve(code)) })
    if (code === 0) return
    if (!retry || attempt >= 3 || !/ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|fetch failed|network timeout|HTTP (?:429|5\d\d)|status code (?:429|5\d\d)/i.test(tail)) throw new Error(`${script} failed (${code}). Valid download caches were retained; rerun after fixing the reported error.`)
    console.log(`Transient download failure. Retrying ${attempt + 1}/3 using the existing cache…`)
    await new Promise(resolve => setTimeout(resolve, attempt * 3000))
  }
}

await command('node_modules/electron-vite/bin/electron-vite.js', ['build'])
await command('scripts/prepare-backend.mjs', [], true)
await command('scripts/verify-distribution.mjs', ['--staged-only'])
for (const target of targets) {
  const runtimePlatform = { mac: 'darwin', win: 'win32', linux: 'linux' }[target]
  const arches = target === 'mac' ? ['x64', 'arm64'] : target === 'win' ? ['x64'] : [process.arch]
  for (const arch of arches) await command('scripts/fetch-php.mjs', [runtimePlatform, arch], true)
  const flags = target === 'mac' && testing ? ['--mac','dir','--x64','--arm64','--publish=never',...forwarded] : [`--${target}`, '--publish=never', ...forwarded]
  // Documents/iCloud/File Provider can recreate Finder metadata while signing.
  // Seal Mac bundles on local temporary storage, then copy the finished DMGs.
  const macOutput = target === 'mac' ? mkdtempSync(resolve(tmpdir(), 'manzoma-macos-build-')) : null
  if (macOutput) { flags.push(`--config.directories.output=${macOutput}`); console.log(`macOS signing workspace: ${macOutput}`) }
  if (testing && target === 'mac') flags.push('--config.mac.identity=-', '--config.mac.notarize=false', '--config.mac.hardenedRuntime=false', '--config.mac.timestamp=none')
  await command('node_modules/electron-builder/cli.js', flags, true)
  if (macOutput) {
    if (testing) for (const arch of arches) await command('scripts/create-test-dmg.mjs',[resolve(macOutput,arch==='arm64'?'mac-arm64':'mac','ManzomaERP Desktop.app'),arch,macOutput])
    mkdirSync(resolve(root, 'dist'), { recursive: true })
    for (const name of readdirSync(macOutput)) if (/\.(dmg|blockmap)$/.test(name)) copyFileSync(resolve(macOutput, name), resolve(root, 'dist', name))
    for (const name of ['mac', 'mac-arm64']) if (existsSync(resolve(macOutput, name))) {
      rmSync(resolve(root, 'dist', name), { recursive: true, force: true })
      symlinkSync(resolve(macOutput, name), resolve(root, 'dist', name), 'dir')
    }
  }
}
await command('scripts/verify-distribution.mjs')
console.log(testing ? 'TEST installers ready in desktop/dist. These are not signed/notarized public releases.' : 'Installers ready in desktop/dist. Check signing status and the acceptance checklist before distribution.')
