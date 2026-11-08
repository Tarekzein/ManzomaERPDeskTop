import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareBackendCache } from '../src/main/backendCache'
import { userErrorMessage, httpErrorMessage } from '../src/shared/userError'
import { resolveServerSettings } from '../src/shared/serverSettings'

const folders: string[] = []
afterEach(() => { folders.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })) })

describe('Readable failures', () => {
  it('replaces the reported Pail crash and OS/HTML/SQL diagnostics in both languages', () => {
    for (const locale of ['ar', 'en']) {
      for (const raw of ['In Application.php line 969: Class "Laravel\\Pail\\PailServiceProvider" not found', 'SQLSTATE[HY000] secret query', '<!doctype html><html>private trace</html>', 'Error invoking remote method \'profiles:open\': Error: TypeError: bad private stack']) {
        const message = userErrorMessage(raw, locale)
        expect(message).not.toMatch(/Pail|SQLSTATE|private|Application.php|TypeError|<html>/)
        expect(/[\u0600-\u06ff]/.test(message)).toBe(locale === 'ar')
      }
    }
    expect(userErrorMessage('fetch failed', 'en')).toContain('connection')
    expect(userErrorMessage('EACCES /private/path', 'ar')).toContain('صلاحيات')
  })
  it('preserves known business errors and re-translates them after a language switch', () => {
    const ar = userErrorMessage('Invalid activation key.', 'ar')
    expect(ar).toContain('التفعيل')
    expect(userErrorMessage(ar, 'en')).toMatch(/^Invalid activation key\.?$/)
    expect(httpErrorMessage(413, 'ar')).toContain('الملف')
    expect(httpErrorMessage(503, 'en')).toContain('server')
    expect(userErrorMessage('Some unknown English exception', 'ar')).not.toMatch(/[A-Za-z]/)
  })
})

describe('Environment URLs', () => {
  it('separates dev/build defaults and supports a separate issuer without embedding secrets', () => {
    expect(resolveServerSettings('development', {})).toEqual({serverUrl:'http://127.0.0.1:8000',licenseServerUrl:'http://127.0.0.1:8000'})
    expect(resolveServerSettings('production', {})).toEqual({serverUrl:'',licenseServerUrl:''})
    expect(resolveServerSettings('production', {ERP_SERVER_URL:'https://erp.example.test/',ERP_LICENSE_SERVER_URL:'https://license.example.test',DB_PASSWORD:'secret'})).toEqual({serverUrl:'https://erp.example.test',licenseServerUrl:'https://license.example.test'})
    expect(() => resolveServerSettings('production', {ERP_SERVER_URL:'http://remote.example.test'})).toThrow('HTTPS')
  })
})

describe('Company bootstrap cache recovery', () => {
  it('repairs stale dev provider caches once and again after a backend change without touching records', () => {
    const root = mkdtempSync(join(tmpdir(), 'manzoma-cache-test-')); folders.push(root)
    const storage = join(root, 'storage'), backend = join(root, 'backend'), cache = join(storage, 'bootstrap')
    mkdirSync(cache, { recursive:true }); mkdirSync(join(backend, 'vendor/composer'), {recursive:true})
    writeFileSync(join(backend, 'vendor/composer/installed.json'), '{"packages":[]}')
    const db = join(root, 'company.sqlite'); writeFileSync(db, 'preserved company')
    for (const name of ['packages.php','services.php','config.php','routes.php','events.php']) writeFileSync(join(cache,name), 'Laravel\\Pail\\PailServiceProvider')
    expect(prepareBackendCache(storage, backend)).toBe(true)
    expect(existsSync(join(cache,'packages.php'))).toBe(false)
    expect(existsSync(join(cache,'services.php'))).toBe(false)
    writeFileSync(join(cache,'packages.php'), 'valid production discovery')
    expect(prepareBackendCache(storage, backend)).toBe(false)
    expect(readFileSync(join(cache,'packages.php'),'utf8')).toBe('valid production discovery')
    writeFileSync(join(backend, 'vendor/composer/installed.json'), '{"packages":["updated"]}')
    expect(prepareBackendCache(storage, backend)).toBe(true)
    expect(existsSync(join(cache,'packages.php'))).toBe(false)
    expect(readFileSync(db,'utf8')).toBe('preserved company')
  })
})
