import { BrowserWindow, dialog, shell } from 'electron'
import { closeSync, copyFileSync, existsSync, openSync, readSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { CompanyProfile } from '../shared/types'
import { backend } from './backend'
import { paths } from './paths'
import { store } from './store'
import { log } from './log'

/**
 * Local company backups. The backend writes a consistent copy with SQLite's
 * VACUUM INTO; these helpers schedule it, export copies to removable media
 * and restore a chosen file.
 */
export async function backupNow(profile: CompanyProfile): Promise<string | null> {
  if (profile.mode !== 'local') return null
  const keep = store.prefs().autoBackup.keep
  const output = await backend.artisan(profile.id, ['erp:backup', '--bundle', '--json', `--keep=${keep}`])
  const line = output.trim().split('\n').filter((l) => l.startsWith('{')).pop()
  return line ? (JSON.parse(line).path as string) : null
}

export async function exportBackup(parent: BrowserWindow | null, profile: CompanyProfile): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const file = await backupNow(profile)
    if (!file) return { ok: false, error: 'No backup created' }
    const target = await dialog.showSaveDialog(parent ?? undefined!, { defaultPath: `${profile.name}-${basename(file)}`, filters: [{ name: 'Company backup', extensions: ['zip'] }] })
    if (target.canceled || !target.filePath) return { ok: false }
    copyFileSync(file, target.filePath)
    return { ok: true, path: target.filePath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Replace the company database with a backup. The current file is kept as a
 * safety copy first, and the backend is restarted afterwards.
 */
export async function restoreBackup(parent: BrowserWindow | null, profile: CompanyProfile): Promise<{ ok: boolean; error?: string }> {
  const choice = await dialog.showOpenDialog(parent ?? undefined!, { properties: ['openFile'], defaultPath: paths.backups(profile.id), filters: [{ name: 'Company backup', extensions: ['zip', 'sqlite'] }] })
  if (choice.canceled || !choice.filePaths[0]) return { ok: false }
  const source = choice.filePaths[0]
  const bundle = source.toLowerCase().endsWith('.zip')
  if (!bundle && !isSqlite(source)) return { ok: false, error: 'The selected file is not a company backup.' }

  try {
    await backupNow(profile).catch(() => null)
    await backend.stop()
    if (bundle) {
      await backend.artisan(profile.id, ['erp:restore', source, '--confirm', '--json'], {}, 600_000)
      log('backup', `restored ${profile.name} from verified bundle`)
      return { ok: true }
    }
    const db = paths.database(profile.id)
    if (existsSync(db)) copyFileSync(db, join(paths.backups(profile.id), `backup-before-restore-${Date.now()}.sqlite`))
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(db + suffix)) unlinkSync(db + suffix)
    }
    copyFileSync(source, db)
    log('backup', `restored ${profile.name} from ${source}`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function openBackupFolder(profile: CompanyProfile): void {
  void shell.openPath(paths.backups(profile.id))
}

/** True when the last backup is older than a day. */
export function backupDue(profile: CompanyProfile): boolean {
  if (profile.mode !== 'local') return false
  const dir = paths.backups(profile.id)
  const files = readdirSync(dir).filter((f) => f.startsWith('backup-')).map((f) => statSync(join(dir, f)).mtimeMs)
  return files.length === 0 || Date.now() - Math.max(...files) > 24 * 3600 * 1000
}

function isSqlite(file: string): boolean {
  try {
    const fd = openSync(file, 'r')
    const buffer = Buffer.alloc(16)
    readSync(fd, buffer, 0, 16, 0)
    closeSync(fd)
    return buffer.toString('utf8', 0, 15) === 'SQLite format 3'
  } catch {
    return false
  }
}
