import { userErrorMessage, httpErrorMessage } from '../shared/userError'
import { reserveCompanyDirectory } from './companyDirectory'
import { licensing } from './licensing'
import { drafts } from './drafts'
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { CompanyProfile, CreateLocalCompanyInput, DesktopPreferences, PdfRequest, PrintRequest, SaveFileRequest } from '../shared/types'
import { backend } from './backend'
import { backupDue, backupNow, exportBackup, openBackupFolder, restoreBackup } from './backup'
import { buildMenu } from './menu'
import { paths } from './paths'
import { listPrinters, printHtml, saveHtmlAsPdf } from './printing'
import { store } from './store'
import { log } from './log'
import { lanHost } from './lanHost'

// Translate native failures at the IPC boundary too, including callers that use toast messages.
function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (licensing.required() && (channel.startsWith('licensing:') || channel.startsWith('profiles:'))) await licensing.initialize()
      const result = await listener(event, ...args)
      // Some native APIs return a failed result rather than rejecting (printing/backups).
      if (result && typeof result === 'object' && typeof result.error === 'string') {
        log('ipc', `${channel} returned a failure`, result.error)
        result.error = userErrorMessage(result.error, store.prefs().locale)
      }
      if (result?.ok === false && typeof result.message === 'string') result.message = userErrorMessage(result.message, store.prefs().locale)
      return result
    }
    catch (error) {
      log('ipc', `${channel} failed`, error instanceof Error ? error.stack : String(error))
      throw new Error(userErrorMessage(error, store.prefs().locale))
    }
  })
}

let activeProfile: CompanyProfile | null = null
let creatingLocalCompany = false

export function currentProfile(): CompanyProfile | null {
  return activeProfile
}

/**
 * Every privileged operation the renderer may request. Inputs are validated
 * here because the renderer is treated as untrusted.
 */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const win = () => getWindow()

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isDev: paths.isDev,
    userData: paths.userData(),
    electron: process.versions.electron,
  }))
  handle('app:diagnostics', () => {
    const license = licensing.status()
    const automation = backend.current().automation
    return { version: app.getVersion(), platform: process.platform, architecture: process.arch, electron: process.versions.electron,
      connectionMode: activeProfile?.mode ?? null, license: { required: license.required, valid: license.valid, mode: license.mode, expiresAt: license.expiresAt,
        companyLimit: license.companies, deviceLimit: license.devices, localCompanies: license.localCompanies, unusedLocalSlots: license.unusedLocalSlots, unconfirmedLocalCompanies: license.unconfirmedLocalCompanies, lastCompanyConfirmation: license.lastCompanyConfirmation },
      automation: { running: automation?.running ?? false, lastSuccess: automation?.lastSuccess, lastAttempt: automation?.lastAttempt, failed: Boolean(automation?.lastError) }, generatedAt: new Date().toISOString() }
  })
  handle('app:quit', () => app.quit())

  handle('licensing:status', () => { const status = licensing.status(); if (status.valid) void licensing.syncLocalCompanies().catch(() => undefined); return status })
  handle('licensing:request', () => JSON.stringify(licensing.request(), null, 2))
  handle('licensing:activate', (_event, server: string, key: string) => licensing.activate(String(server), String(key)))
  handle('licensing:import', (_event, contents: string) => licensing.import(String(contents)))
  handle('licensing:refresh', async () => { await licensing.refresh(); await licensing.syncLocalCompanies(true).catch(() => undefined); return licensing.status() })
  handle('licensing:headers', (_event, method: string, path: string) => licensing.headers(activeProfile, String(method), String(path)))

  // ── Company profiles ──────────────────────────────────────────────
  handle('profiles:list', () => { licensing.assertVerified(); licensing.restoreCompanyShortcut(); return store.profiles() })

  handle('profiles:save-server', async (_e, input: Partial<CompanyProfile>) => {
    licensing.assertVerified()
    const url = normaliseUrl(String(input.serverUrl ?? ''))
    if (!url) throw new Error('Invalid server address')
    licensing.serverHeaders(url)
    await licensing.assignOnline(String(input.company || 'default'))
    const existing = input.id ? store.profile(input.id) : undefined
    return store.upsertProfile({
      id: existing?.id ?? randomUUID(),
      name: String(input.name || url).slice(0, 120),
      mode: 'server',
      serverUrl: url,
      company: input.company ? String(input.company).toLowerCase().replace(/[^a-z0-9_]/g, '') : undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    })
  })

  handle('profiles:test-server', async (_e, rawUrl: string) => {
    licensing.assertVerified()
    const url = normaliseUrl(rawUrl)
    if (!url) return { ok: false, message: 'Invalid address' }
    try {
      const ping = await fetch(`${url}/api/system/ping`, { signal: AbortSignal.timeout(5000) })
      if (!ping.ok) return { ok: false, message: httpErrorMessage(ping.status, store.prefs().locale) }
      const body = (await ping.json()) as { app?: string }
      if (body.app !== 'manzoma-erp') return { ok: false, message: 'Not a ManzomaERP server' }
      const companies = await fetch(`${url}/api/system/companies`, { headers: licensing.serverHeaders(url), signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => ({ data: [] }))
      return { ok: true, companies: companies.data ?? [] }
    } catch (error) {
      log('connection', 'Server connection failed', error instanceof Error ? error.stack : String(error))
      return { ok: false, message: userErrorMessage(error, store.prefs().locale) }
    }
  })

  handle('profiles:join-lan', async (_event, invitation: string) => {
    licensing.assertVerified()
    return store.upsertProfile(await licensing.joinLan(String(invitation)))
  })
  const requireHostAdmin = async () => {
    if (!activeProfile || activeProfile.mode !== 'local') throw new Error('Only the main computer can share this company.')
    const current = backend.current(), token = await store.token(activeProfile.id)
    if (!current.baseUrl || !token) throw new Error('Sign in as a company administrator to manage local network sharing.')
    const response = await fetch(current.baseUrl+'/api/auth/me',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}})
    const result = await response.json()
    if (!response.ok || !(result.user?.is_admin || result.user?.permissions?.includes('settings.manage'))) throw new Error('Sign in as a company administrator to manage local network sharing.')
    return {profile:activeProfile,baseUrl:current.baseUrl}
  }
  handle('lan:status', () => lanHost.status())
  handle('lan:configure', async (_event, enabled: boolean, port: number) => {
    const host = await requireHostAdmin()
    return lanHost.configure(Boolean(enabled),host.profile.id,host.baseUrl,Number(port))
  })
  handle('lan:invitation', async (_event, url: string) => {
    const host = await requireHostAdmin()
    if (!lanHost.status().urls.includes(url)) throw new Error('Use the HTTPS address from the main computer pairing code.')
    return licensing.invitation(url,host.profile,lanHost.certificateFingerprint(host.profile.id))
  })

  handle('profiles:remove', async (_e, id: string) => {
    const profile = store.profile(id)
    if (!profile) return
    if (activeProfile?.id === id) {
      await backend.stop()
      activeProfile = null
    }
    store.removeProfile(id)
    // Local company files are kept on disk; only the shortcut is removed.
  })

  handle('profiles:create-server', async (_event, input: CreateLocalCompanyInput) => {
    licensing.assertVerified()
    if (creatingLocalCompany) throw new Error('A company is already being created. Please wait.')
    creatingLocalCompany = true
    try { return await licensing.registerServerCompany(input) }
    finally { creatingLocalCompany = false }
  })

  handle('profiles:create-local', async (_e, input: CreateLocalCompanyInput) => {
    if (!input?.name || !input.adminUsername || String(input.adminPassword ?? '').length < 6) {
      throw new Error('Company name, user name and a password of at least 6 characters are required.')
    }
    if (creatingLocalCompany) throw new Error('A company is already being created. Please wait.')
    creatingLocalCompany = true
    let reservation: ReturnType<typeof reserveCompanyDirectory> | undefined
    try {
      const profile: CompanyProfile = { id: await licensing.reserveLocalCompanyId() ?? randomUUID(), name: String(input.name).slice(0, 120), mode: 'local', createdAt: new Date().toISOString() }
      reservation = reserveCompanyDirectory(paths.userData(), profile.id)
      await backend.stop()
      activeProfile = null
      await backend.createCompany(profile, input)
      store.upsertProfile(profile)
      void licensing.syncLocalCompanies(true).catch(() => undefined)
      return profile
    } catch (error) {
      // Leave nothing half-created behind.
      try {
        reservation?.discard()
      } catch {
        // ignore
      }
      throw error
    } finally { creatingLocalCompany = false }
  })

  handle('profiles:import-local', async (_event, name: string) => {
    licensing.assertVerified()
    if (creatingLocalCompany) throw new Error('A company is already being created or imported. Please wait.')
    const requestedName = String(name ?? '').trim().slice(0,120)
    if (!requestedName) throw new Error('Enter a company name.')
    creatingLocalCompany = true
    let reservation: ReturnType<typeof reserveCompanyDirectory> | undefined
    try {
      const selected = await dialog.showOpenDialog(win() ?? undefined!, { properties: ['openFile'], filters: [{ name: 'Manzoma company backup', extensions: ['zip','sqlite','db'] }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      // Revalidate after the file dialog: a license can expire while it is open.
      licensing.assertVerified()
      const profile: CompanyProfile = { id: await licensing.reserveLocalCompanyId() ?? randomUUID(), name: requestedName, mode: 'local', createdAt: new Date().toISOString() }
      reservation = reserveCompanyDirectory(paths.userData(), profile.id)
      await backend.stop(); activeProfile = null
      await backend.importCompany(profile, selected.filePaths[0])
      store.upsertProfile(profile)
      void licensing.syncLocalCompanies(true).catch(() => undefined)
      return profile
    } catch (error) {
      try { reservation?.discard() } catch { /* Keep original backup unchanged. */ }
      throw error
    } finally { creatingLocalCompany = false }
  })

  handle('profiles:open', async (_e, id: string) => {
    const profile = store.profile(id)
    if (!profile) throw new Error('Unknown company')
    await licensing.open(profile)
    let baseUrl: string
    if (profile.mode === 'local') {
      baseUrl = await backend.start(profile)
      if (store.prefs().autoBackup.enabled && backupDue(profile)) {
        void backupNow(profile).catch((e) => log('backup', 'scheduled backup failed', String(e)))
      }
    } else {
      await backend.stop()
      baseUrl = profile.serverUrl!
    }
    activeProfile = profile
    store.touchProfile(id)
    return { profile, baseUrl, company: profile.company }
  })

  handle('profiles:close', async () => {
    if (activeProfile?.mode === 'local' && store.prefs().autoBackup.onExit) {
      await backupNow(activeProfile).catch(() => null)
    }
    await backend.stop()
    activeProfile = null
  })

  handle('backend:status', () => backend.current())
  handle('backend:logs', () => backend.logs())

  // ── Session token (encrypted with the OS keychain) ─────────────────
  handle('auth:get-token', (_e, profileId: string) => { licensing.assertVerified(); return store.token(profileId) })
  handle('auth:set-token', (_e, profileId: string, token: string) => { licensing.assertVerified(); return store.setToken(profileId, String(token)) })
  handle('auth:clear-token', (_e, profileId: string) => store.clearToken(profileId))

  handle('drafts:get', (_event, key: string) => { licensing.assertVerified(); return drafts.get(key) })
  handle('drafts:set', (_event, key: string, value: unknown) => { licensing.assertVerified(); return drafts.set(key, value) })
  handle('drafts:remove', (_event, key: string) => drafts.remove(key))

  // ── Printing ──────────────────────────────────────────────────────
  handle('print:printers', () => listPrinters(win()))
  handle('print:html', (_e, request: PrintRequest) => printHtml(sanitisePrint(request)))
  handle('print:pdf', (_e, request: PdfRequest) => saveHtmlAsPdf(win(), { ...request, html: String(request.html), defaultName: basename(String(request.defaultName || 'document')) }))

  // ── Backups (local companies) ─────────────────────────────────────
  handle('backup:export', () => (activeProfile ? exportBackup(win(), activeProfile) : { ok: false, error: 'No company open' }))
  handle('backup:restore', async () => {
    if (!activeProfile || activeProfile.mode !== 'local') return { ok: false, error: 'Restore is available for local companies.' }
    const result = await restoreBackup(win(), activeProfile)
    if (result.ok) await backend.start(activeProfile)
    return result
  })
  handle('backup:open-folder', () => activeProfile && openBackupFolder(activeProfile))

  // ── Preferences ───────────────────────────────────────────────────
  handle('prefs:get', () => store.prefs())
  handle('prefs:set', (_e, patch: Partial<DesktopPreferences>) => {
    const prefs = store.setPrefs(patch)
    const w = win()
    if (w && patch.locale) buildMenu(w, prefs.locale)
    if (w && patch.zoom) w.webContents.setZoomFactor(Math.min(Math.max(prefs.zoom, 0.7), 1.6))
    return prefs
  })

  // ── Files ─────────────────────────────────────────────────────────
  handle('files:save', async (_e, request: SaveFileRequest) => {
    const target = await dialog.showSaveDialog(win() ?? undefined!, { defaultPath: basename(request.defaultName), filters: request.filters })
    if (target.canceled || !target.filePath) return { ok: false }
    writeFileSync(target.filePath, Buffer.from(String(request.content), request.encoding === 'base64' ? 'base64' : 'utf8'))
    return { ok: true, path: target.filePath }
  })
  handle('files:open-text', async (_e, filters?: { name: string; extensions: string[] }[]) => {
    const choice = await dialog.showOpenDialog(win() ?? undefined!, { properties: ['openFile'], filters })
    if (choice.canceled || !choice.filePaths[0]) return { ok: false }
    return { ok: true, name: basename(choice.filePaths[0]), content: readFileSync(choice.filePaths[0], 'utf8') }
  })

  handle('shell:open-external', (_e, url: string) => {
    if (/^https?:\/\//i.test(String(url))) void shell.openExternal(String(url))
  })
  handle('shell:open-logs', () => void shell.openPath(paths.logs()))

  handle('notify', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 400) }).show()
  })

  backend.onUnexpectedExit((code) => win()?.webContents.send('backend:exit', { code }))
}

function normaliseUrl(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}`
  } catch {
    return null
  }
}

function sanitisePrint(request: PrintRequest): PrintRequest {
  const papers = ['A4', 'A5', 'receipt80', 'receipt58'] as const
  return {
    html: String(request.html),
    printer: request.printer ? String(request.printer) : undefined,
    silent: Boolean(request.silent),
    copies: Math.min(Math.max(Number(request.copies) || 1, 1), 10),
    paper: papers.includes(request.paper) ? request.paper : 'A4',
    landscape: Boolean(request.landscape),
  }
}
