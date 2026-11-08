import { readdirSync, writeFileSync, statSync, existsSync, createReadStream, openSync, readSync, closeSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyPackagedResources } from './runtime-checks.mjs'
const root = 'build/backend'
if (!existsSync(root)) throw new Error('Staged production backend is missing.')
function scan(directory, base = root) {
  for (const entry of readdirSync(directory,{withFileTypes:true})) {
    const path = join(directory, entry.name), name = relative(base,path).replaceAll('\\','/')
    if (/(^|\/)\.env(?:\.|$)/.test(name) && !name.endsWith('.env.example') || /\.(sqlite(?:-wal|-shm|-journal)?|db|pem|key|mzb|(?:sqlite|sql|db)\.zip)$/.test(name) || (entry.isFile() && name.startsWith('storage/')) || name.startsWith('storage/app/control/') || name.startsWith('storage/backups/') || name.startsWith('storage/issuer-backups/')) throw new Error('Private/runtime file found in staged backend: '+name)
    if (entry.isDirectory()) scan(path, base)
  }
}
scan(root)
if (process.argv.includes('--staged-only')) {
  console.log('Staged backend passed: no private keys, databases, sessions, attachments or backups.')
  process.exit(0)
}
const installers = readdirSync('dist').filter(name=>/\.(exe|dmg|deb|AppImage)$/.test(name) && statSync(join('dist',name)).isFile())
if (!installers.length) throw new Error('No installer artifacts found.')
for (const directory of readdirSync('dist', { withFileTypes: true }).filter(entry => existsSync(join('dist', entry.name)) && statSync(join('dist', entry.name)).isDirectory())) {
  let resources, platform, arch
  if (/^mac(?:-arm64)?$/.test(directory.name)) {
    const app = readdirSync(join('dist', directory.name)).find(name => name.endsWith('.app'))
    if (!app) continue
    resources = join('dist', directory.name, app, 'Contents/Resources'); platform = 'darwin'; arch = directory.name.endsWith('arm64') ? 'arm64' : 'x64'
  } else if (directory.name === 'win-unpacked') { resources = join('dist', directory.name, 'resources'); platform = 'win32'; arch = 'x64' }
  if (!resources) continue
  verifyPackagedResources(resources, platform, arch)
  scan(join(resources, 'backend'), join(resources, 'backend'))
}
const checksums = []
for (const name of installers.sort()) {
  const file = join('dist', name), descriptor = openSync(file, 'r'), size = statSync(file).size
  try {
    const signature = Buffer.alloc(4)
    readSync(descriptor, signature, 0, 4, name.endsWith('.dmg') ? size - 512 : 0)
    if (name.endsWith('.exe') && signature.toString('ascii', 0, 2) !== 'MZ' || name.endsWith('.dmg') && signature.toString('ascii') !== 'koly') throw new Error(`Invalid installer container: ${name}`)
  } finally { closeSync(descriptor) }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  checksums.push(hash.digest('hex') + '  ' + name)
}
writeFileSync('dist/SHA256SUMS', checksums.join('\n')+'\n')
console.log('Distribution content checks passed; installer checksums generated.')
