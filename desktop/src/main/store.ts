import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { CompanyProfile, DesktopPreferences } from '../shared/types'
import { paths } from './paths'

interface LocalSecrets {
  appKey: string
}

interface ConfigFile {
  profiles: CompanyProfile[]
  lastProfileId?: string
  prefs: DesktopPreferences
  /** Encrypted with the OS keychain (safeStorage) when available. */
  tokens: Record<string, string>
  /** Per local company: Laravel APP_KEY. */
  secrets: Record<string, string>
}

const defaults: ConfigFile = {
  profiles: [],
  prefs: {
    locale: 'ar',
    theme: 'light',
    printers: {},
    silentReceipt: false,
    receiptCopies: 1,
    autoBackup: { enabled: true, keep: 20, onExit: true },
    zoom: 1,
  },
  tokens: {},
  secrets: {},
}

const transientTokens = new Map<string, string>()
let cache: ConfigFile | null = null

function load(): ConfigFile {
  if (cache) return cache
  const file = paths.config()
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ConfigFile>
      cache = { ...defaults, ...parsed, prefs: { ...defaults.prefs, ...(parsed.prefs ?? {}) } }
      return cache
    } catch {
      // A damaged config should not lock the user out: keep a copy and start clean.
      renameSync(file, `${file}.broken-${Date.now()}`)
    }
  }
  cache = structuredClone(defaults)
  return cache
}

function save(): void {
  const file = paths.config()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8')
  renameSync(tmp, file)
}

async function protectedStorage(): Promise<boolean> {
  return await safeStorage.isAsyncEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
}
async function encrypt(value: string): Promise<string> {
  if (!await protectedStorage()) throw new Error('Enable the operating-system keychain before activating this device.')
  return 'enc:' + (await safeStorage.encryptStringAsync(value)).toString('base64')
}
async function decrypt(value: string): Promise<string | null> {
  if (value.startsWith('enc:')) return (await safeStorage.decryptStringAsync(Buffer.from(value.slice(4), 'base64'))).result
  if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  return null
}
const appKeys = new Map<string, string>()
const preparingKeys = new Map<string, Promise<void>>()

export const store = {
  profiles(): CompanyProfile[] {
    return load().profiles
  },

  profile(id: string): CompanyProfile | undefined {
    return load().profiles.find((p) => p.id === id)
  },

  upsertProfile(profile: CompanyProfile): CompanyProfile {
    const config = load()
    if (config.profiles.some(existing => existing.id !== profile.id)) throw new Error('Each device can use only one company. Use another licensed device for a different company.')
    const index = config.profiles.findIndex((p) => p.id === profile.id)
    if (index >= 0) config.profiles[index] = profile
    else config.profiles.push(profile)
    save()
    return profile
  },

  removeProfile(id: string): void {
    const config = load()
    config.profiles = config.profiles.filter((p) => p.id !== id)
    delete config.tokens[id]
    save()
  },

  touchProfile(id: string): void {
    const profile = this.profile(id)
    if (!profile) return
    profile.lastOpenedAt = new Date().toISOString()
    load().lastProfileId = id
    save()
  },

  prefs(): DesktopPreferences {
    return load().prefs
  },

  setPrefs(patch: Partial<DesktopPreferences>): DesktopPreferences {
    const config = load()
    config.prefs = { ...config.prefs, ...patch, printers: { ...config.prefs.printers, ...(patch.printers ?? {}) }, autoBackup: { ...config.prefs.autoBackup, ...(patch.autoBackup ?? {}) } }
    save()
    return config.prefs
  },

  async token(profileId: string): Promise<string | null> {
    if (transientTokens.has(profileId)) return transientTokens.get(profileId)!
    const value = load().tokens[profileId]
    if (!value?.startsWith('enc:') || !await protectedStorage()) return null
    try { return await decrypt(value) } catch { return null }
  },

  async setToken(profileId: string, token: string): Promise<void> {
    if (!await protectedStorage()) {
      transientTokens.set(profileId, token)
      delete load().tokens[profileId]
    } else {
      load().tokens[profileId] = await encrypt(token)
    }
    save()
  },

  clearToken(profileId: string): void {
    transientTokens.delete(profileId)
    delete load().tokens[profileId]
    save()
  },

  /** Prepare once before any PHP process starts. Never replace an unreadable existing key. */
  async prepareAppKey(profileId: string): Promise<void> {
    if (appKeys.has(profileId)) return
    if (preparingKeys.has(profileId)) return preparingKeys.get(profileId)!
    const pending = (async () => {
      if (!await protectedStorage()) throw new Error('Enable the operating-system keychain before activating this device.')
      const config = load()
      const existing = config.secrets[profileId]
      const key = existing ? await decrypt(existing) : 'base64:' + randomBytes(32).toString('base64')
      if (!key) throw new Error('Cannot read the existing company encryption key. Restore its original device configuration.')
      config.secrets[profileId] = await encrypt(key)
      save()
      appKeys.set(profileId, key)
    })()
    preparingKeys.set(profileId, pending)
    try { await pending } finally { preparingKeys.delete(profileId) }
  },

  appKey(profileId: string): string {
    const key = appKeys.get(profileId)
    if (!key) throw new Error('Company encryption is not ready. Open the company again.')
    return key
  },
}

export type { LocalSecrets }
