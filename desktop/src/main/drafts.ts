import { safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

const memory = new Map<string, string>()
const versions = new Map<string, number>()
function file(key: string): string { return join(paths.userData(), 'drafts', createHash('sha256').update(key).digest('hex') + '.enc') }
async function protectedStorage(): Promise<boolean> {
  return await safeStorage.isAsyncEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
}
export const drafts = {
  async get(key: string): Promise<unknown | null> {
    if (typeof key !== 'string' || key.length > 500) throw new Error('Invalid draft key')
    const current = memory.get(key)
    if (current) return JSON.parse(current)
    if (!await protectedStorage() || !existsSync(file(key))) return null
    try { return JSON.parse((await safeStorage.decryptStringAsync(readFileSync(file(key)))).result) } catch { return null }
  },
  async set(key: string, value: unknown): Promise<{ persisted: boolean }> {
    if (typeof key !== 'string' || key.length > 500) throw new Error('Invalid draft key')
    const json = JSON.stringify(value, (name, item) => /password|token|secret/i.test(name) ? undefined : item)
    if (json.length > 2 * 1024 * 1024) throw new Error('Draft exceeds size limit')
    const version = (versions.get(key) ?? 0) + 1; versions.set(key, version)
    memory.set(key, json)
    if (!await protectedStorage()) return { persisted: false }
    const encrypted = await safeStorage.encryptStringAsync(json)
    if (versions.get(key) !== version) return { persisted: false }
    const target = file(key); mkdirSync(join(paths.userData(), 'drafts'), { recursive: true })
    writeFileSync(target + '.tmp', encrypted, { mode: 0o600 }); renameSync(target + '.tmp', target)
    return { persisted: true }
  },
  remove(key: string): void {
    if (typeof key !== 'string' || key.length > 500) throw new Error('Invalid draft key')
    versions.set(key, (versions.get(key) ?? 0) + 1)
    memory.delete(key); rmSync(file(key), { force: true })
  },
}
