import type { CompanyProfile, DesktopPreferences, ErpBridge, MenuCommand } from '@shared/types'
import { serverSettings } from '@shared/serverSettings'

declare global {
  interface Window {
    erp?: ErpBridge
  }
}

export const isDesktop = typeof window !== 'undefined' && Boolean(window.erp)

const PREFS_KEY = 'erp.prefs'
const memoryDrafts = new Map<string, unknown>()
const PROFILES_KEY = 'erp.profiles'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable
  }
}

const defaultPrefs: DesktopPreferences = {
  locale: 'ar',
  theme: 'light',
  printers: {},
  silentReceipt: false,
  receiptCopies: 1,
  autoBackup: { enabled: true, keep: 20, onExit: true },
  zoom: 1,
}

/**
 * Browser fallback so the same UI runs in a normal browser against a server
 * backend (development, end-to-end tests). Local company files need the
 * desktop app.
 */
function webBridge(): ErpBridge {
  const devUrl = (import.meta.env.VITE_API_URL as string | undefined) || serverSettings.serverUrl
  const profiles = (): CompanyProfile[] => {
    const list = read<CompanyProfile[]>(PROFILES_KEY, [])
    if (list.length === 0 && devUrl) {
      const seed: CompanyProfile = { id: 'web-default', name: 'الخادم', mode: 'server', serverUrl: devUrl, createdAt: new Date().toISOString() }
      write(PROFILES_KEY, [seed])
      return [seed]
    }
    return list
  }
  const notDesktop = () => Promise.reject(new Error('Available in the desktop app.'))
  const printIframe = (html: string) =>
    new Promise<{ ok: boolean }>((resolve) => {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;inset-inline-start:-9999px'
      frame.srcdoc = html
      frame.onload = () => {
        setTimeout(() => {
          frame.contentWindow?.focus()
          frame.contentWindow?.print()
          setTimeout(() => frame.remove(), 1000)
          resolve({ ok: true })
        }, 300)
      }
      document.body.appendChild(frame)
    })
  const download = (name: string, content: string, encoding?: string) => {
    const bytes = encoding === 'base64' ? Uint8Array.from(atob(content), (c) => c.charCodeAt(0)) : new TextEncoder().encode(content)
    const url = URL.createObjectURL(new Blob([bytes]))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return {
    isDesktop: true,
    lan: {status:async()=>({enabled:false,urls:[],port:9443}),configure:notDesktop,invitation:notDesktop},
    licensing: { status: async () => ({ required: false, valid: true }), request: notDesktop, activate: notDesktop, import: notDesktop, refresh: notDesktop, headers: async () => ({}) },
    app: {
      info: async () => ({ version: 'web', platform: navigator.platform, isDev: true, userData: '', electron: '' }),
      diagnostics: async () => ({ platform: 'browser', userAgent: navigator.userAgent }),
      quit: async () => window.close(),
    },
    profiles: {
      list: async () => profiles(),
      joinLan: notDesktop,
      saveServer: async (p) => {
        const list = profiles()
        const profile: CompanyProfile = { id: p.id ?? crypto.randomUUID(), name: p.name, mode: 'server', serverUrl: (p.serverUrl ?? '').replace(/\/+$/, ''), company: p.company, createdAt: new Date().toISOString() }
        write(PROFILES_KEY, [...list.filter((x) => x.id !== profile.id), profile])
        return profile
      },
      remove: async (id) => write(PROFILES_KEY, profiles().filter((p) => p.id !== id)),
      createLocal: notDesktop,
      createServer: notDesktop,
      importLocal: notDesktop,
      open: async (id) => {
        const profile = profiles().find((p) => p.id === id)
        if (!profile) throw new Error('Unknown company')
        return { profile, baseUrl: profile.serverUrl!, company: profile.company }
      },
      close: async () => undefined,
      testServer: async (url) => {
        try {
          const r = await fetch(`${url.replace(/\/+$/, '')}/api/system/ping`)
          const companies = await fetch(`${url.replace(/\/+$/, '')}/api/system/companies`).then((x) => x.json()).catch(() => ({ data: [] }))
          return { ok: r.ok, companies: companies.data }
        } catch (e) {
          return { ok: false, message: String(e) }
        }
      },
    },
    backend: { status: async () => ({ profileId: null, state: 'running' }), logs: async () => '' },
    auth: {
      getToken: async (id) => sessionStorage.getItem(`erp.token.${id}`),
      setToken: async (id, token) => sessionStorage.setItem(`erp.token.${id}`, token),
      clearToken: async (id) => sessionStorage.removeItem(`erp.token.${id}`),
    },
    drafts: {
      get: async (key) => memoryDrafts.get(key) ?? null,
      set: async (key, value) => { memoryDrafts.set(key, structuredClone(value)); return { persisted: false } },
      remove: async (key) => { memoryDrafts.delete(key) },
    },
    print: {
      printers: async () => [],
      html: async (r) => printIframe(r.html),
      pdf: async (r) => printIframe(r.html),
    },
    backup: { exportTo: async () => ({ ok: false, error: 'Desktop only' }), restore: async () => ({ ok: false, error: 'Desktop only' }), openFolder: async () => undefined },
    prefs: {
      get: async () => ({ ...defaultPrefs, ...read<Partial<DesktopPreferences>>(PREFS_KEY, {}) }),
      set: async (patch) => {
        const next = { ...defaultPrefs, ...read<Partial<DesktopPreferences>>(PREFS_KEY, {}), ...patch }
        write(PREFS_KEY, next)
        return next
      },
    },
    files: {
      save: async (r) => {
        download(r.defaultName, r.content, r.encoding)
        return { ok: true }
      },
      openText: () =>
        new Promise((resolve) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.csv,.txt'
          input.onchange = async () => {
            const file = input.files?.[0]
            resolve(file ? { ok: true, name: file.name, content: await file.text() } : { ok: false })
          }
          input.click()
        }),
    },
    shell: { openExternal: async (url) => void window.open(url, '_blank', 'noopener'), openLogs: async () => undefined },
    notify: async (title, body) => {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body })
    },
    onMenu: () => () => undefined,
    onBackendExit: () => () => undefined,
  }
}

export const platform: ErpBridge = (typeof window !== 'undefined' && window.erp) || webBridge()

/** Command bus fed by the native menu (desktop) or keyboard shortcuts (browser). */
type Listener = (command: MenuCommand) => void
const listeners = new Set<Listener>()
export const commands = {
  emit(command: MenuCommand) {
    listeners.forEach((l) => l(command))
  },
  on(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
platform.onMenu((command) => commands.emit(command))

if (!isDesktop && typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey
    let command: MenuCommand | null = null
    if (e.key === 'F2') command = 'new-document'
    else if (mod && e.key.toLowerCase() === 'k') command = 'command-palette'
    else if (mod && e.key.toLowerCase() === 'p') command = 'print'
    else if (mod && e.key.toLowerCase() === 'l') command = 'lock'
    if (command) {
      e.preventDefault()
      commands.emit(command)
    }
  })
}
