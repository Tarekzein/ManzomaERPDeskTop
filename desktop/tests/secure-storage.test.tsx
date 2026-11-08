import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const fixture = vi.hoisted(() => ({ root: '', encrypt: async (value: string) => Buffer.from(value) }))
vi.mock('electron', () => ({ safeStorage: { isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'test_keychain', encryptStringAsync: (value: string) => fixture.encrypt(value), decryptStringAsync: async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false }) } }))
vi.mock('../src/main/paths', () => ({ paths: { userData: () => fixture.root } }))
import { drafts } from '../src/main/drafts'
beforeAll(() => { fixture.root = mkdtempSync(join(tmpdir(), 'manzoma-storage-test-')) })
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))
describe('Asynchronous encrypted drafts', () => {
  it('does not resurrect a discarded draft when encryption finishes late', async () => {
    let finish!: (buffer: Buffer) => void
    fixture.encrypt = () => new Promise<Buffer>(resolve => { finish = resolve })
    const pending = drafts.set('customer:1', { name: 'Household', password: 'never-store', token: 'never-store' })
    await Promise.resolve(); await Promise.resolve()
    drafts.remove('customer:1')
    finish(Buffer.from('{}'))
    expect(await pending).toEqual({ persisted: false })
    expect(await drafts.get('customer:1')).toBeNull()
    expect(existsSync(join(fixture.root, 'drafts')) && readdirSync(join(fixture.root, 'drafts')).length > 0).toBe(false)
  })
  it('removes passwords and tokens before saving a recoverable form', async () => {
    fixture.encrypt = async value => { expect(value).not.toContain('never-store'); return Buffer.from(value) }
    await drafts.set('customer:2', { name: 'Household', password: 'never-store', token: 'never-store', nested: { secret: 'never-store' } })
    expect(await drafts.get('customer:2')).toEqual({ name: 'Household', nested: {} })
  })
})
