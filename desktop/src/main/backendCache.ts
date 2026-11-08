import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Company caches survive app upgrades/dev use; generated provider lists must not. */
export function prepareBackendCache(storage: string, backend: string): boolean {
  const cache = join(storage, 'bootstrap')
  mkdirSync(cache, { recursive: true })
  const hash = createHash('sha256').update('manzoma-runtime-cache-v1\0' + resolve(backend))
  for (const name of ['vendor/composer/installed.json', 'bootstrap/app.php', 'bootstrap/providers.php']) {
    hash.update(name)
    if (existsSync(join(backend, name))) hash.update(readFileSync(join(backend, name)))
  }
  const fingerprint = hash.digest('hex')
  const marker = join(cache, 'runtime-fingerprint')
  if (existsSync(marker) && readFileSync(marker, 'utf8') === fingerprint) return false
  // Only Laravel's generated bootstrap files; company data, keys and backups stay intact.
  for (const name of ['packages.php', 'services.php', 'config.php', 'routes.php', 'events.php']) rmSync(join(cache, name), { force: true })
  writeFileSync(marker + '.tmp', fingerprint, { mode: 0o600 })
  renameSync(marker + '.tmp', marker)
  return true
}
