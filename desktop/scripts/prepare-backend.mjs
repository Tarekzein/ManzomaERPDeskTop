#!/usr/bin/env node
/**
 * Stage the Laravel backend for packaging: copy ../backend to build/backend
 * without development files, then install production dependencies only.
 *
 *   node scripts/prepare-backend.mjs
 */
import { cpSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { createPublicKey } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, '..', 'backend')
const target = resolve(root, 'build', 'backend')

// storage contains business attachments, sessions, backups, issuer identity and registry.
// Ship empty runtime directories, never a developer's storage contents.
const skip = [
  'vendor', 'node_modules', 'tests', '.git', '.github', '.idea', '.vscode',
  '.env', '.env.backup', '.phpunit.result.cache', 'phpunit.xml', 'database/database.sqlite', 'storage',
]

if (!existsSync(join(root, 'resources', 'license-public-key.pem'))) {
  throw new Error('Copy the control server signing PUBLIC key to desktop/resources/license-public-key.pem before packaging. Never copy the private key.')
}

const currentPublicKey = readFileSync(join(root, 'resources', 'license-public-key.pem'), 'utf8')
if (currentPublicKey.includes('PRIVATE KEY')) throw new Error('Refusing to bundle a private issuer key.')
const parsedKey = createPublicKey(currentPublicKey)
if (parsedKey.asymmetricKeyType !== 'rsa' || parsedKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error('An RSA issuer PUBLIC key with at least 2048 bits is required.')

const legacy = JSON.parse(readFileSync(join(root, 'resources', 'license-legacy-public-keys.json'), 'utf8'))
if (!Array.isArray(legacy) || legacy.length > 5 || legacy.some(key => typeof key !== 'string' || !key.includes('BEGIN PUBLIC KEY') || key.includes('PRIVATE KEY'))) throw new Error('Legacy trust file must contain at most five PUBLIC keys only.')

for (const key of legacy) createPublicKey(key)

if (!existsSync(join(source, 'artisan'))) {
  console.error(`Backend not found at ${source}`)
  process.exit(1)
}

console.log(`Staging ${source} → ${target}`)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, {
  recursive: true,
  filter: (src) => {
    const rel = relative(source, src).split(sep).join('/')
    if ((/(^|\/)\.env(?:\.|$)/.test(rel) && !rel.endsWith('.env.example')) || /\.(?:sqlite(?:-wal|-shm|-journal)?|db)$/.test(rel) || /\.(?:key|pem|mzb|(?:sqlite|sql|db)\.zip)$/.test(rel) || /^storage\/app\/control(?:\/|$)/.test(rel)) return false
    return !skip.some((s) => rel === s || rel.startsWith(`${s}/`))
  },
})

// Development caches would point at this machine's paths.
const cacheDir = join(target, 'bootstrap', 'cache')
if (existsSync(cacheDir)) {
  for (const f of readdirSync(cacheDir)) if (f.endsWith('.php')) rmSync(join(cacheDir, f))
}

for (const folder of ['bootstrap/cache', 'storage/framework/views', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/logs']) mkdirSync(join(target, folder), { recursive: true })

const composer = process.env.COMPOSER_BINARY || 'composer'
console.log('Installing production dependencies…')
execFileSync(composer, ['install', '--no-dev', '--prefer-dist', '--optimize-autoloader', '--no-interaction', '--no-progress', '--no-scripts'], { cwd: target, stdio: 'inherit' })
execFileSync(process.env.ERP_PHP_BINARY || 'php', ['artisan', 'package:discover', '--ansi'], {
  cwd: target,
  stdio: 'inherit',
  env: { ...process.env, APP_ENV: 'production', APP_DEBUG: 'false', ERP_CONTROL_ENABLED: 'false', ERP_MULTI_COMPANY: 'false', ERP_STORAGE_PATH: join(target, 'storage'), DB_URL: '', APP_KEY: 'base64:' + Buffer.alloc(32, 1).toString('base64'), DB_CONNECTION: 'sqlite', DB_DATABASE: ':memory:', APP_PACKAGES_CACHE: join(cacheDir, 'packages.php'), APP_SERVICES_CACHE: join(cacheDir, 'services.php') },
})
// When composer falls back to git clones, drop the history and test suites.
let pruned = 0
const prune = (dir, depth) => {
  if (depth > 4 || !existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    if (entry.name === '.git' || (depth >= 2 && ['tests', 'Tests', 'docs', '.github'].includes(entry.name))) {
      rmSync(full, { recursive: true, force: true })
      pruned++
    } else {
      prune(full, depth + 1)
    }
  }
}
prune(join(target, 'vendor'), 0)
console.log(`Pruned ${pruned} development folders from vendor.`)
console.log('Backend ready.')
