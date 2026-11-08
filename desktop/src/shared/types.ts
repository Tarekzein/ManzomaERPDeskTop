/**
 * Contract between the Electron main process and the renderer (window.erp).
 * Keep this file free of Node and DOM imports: both sides compile it.
 */

export type ConnectionMode = 'local' | 'server' | 'lan'

export interface CompanyProfile {
  id: string
  name: string
  mode: ConnectionMode
  /** Server mode: base URL of the shared backend, e.g. http://192.168.1.10:8080 */
  serverUrl?: string
  /** Server mode with several companies on one server (X-Company header). */
  company?: string
  hostDeviceId?: string
  tlsFingerprint?: string
  createdAt: string
  lastOpenedAt?: string
}

export interface CreateLocalCompanyInput {
  name: string
  nameEn?: string
  currency: string
  vatRate: number
  taxNumber?: string
  adminName: string
  adminUsername: string
  adminPassword: string
  locale: 'ar' | 'en'
  demo: boolean
}

export interface OpenProfileResult {
  profile: CompanyProfile
  baseUrl: string
  company?: string
}

export type BackendState = 'stopped' | 'starting' | 'running' | 'error'

export interface BackendStatus {
  automation?: { running: boolean; lastSuccess?: string; lastError?: string; lastAttempt?: string }
  profileId: string | null
  state: BackendState
  baseUrl?: string
  error?: string
  pid?: number
}

export interface PrintRequest {
  html: string
  /** Printer name; empty uses the system default. */
  printer?: string
  silent?: boolean
  copies?: number
  paper: 'A4' | 'A5' | 'receipt80' | 'receipt58'
  landscape?: boolean
}

export interface PdfRequest {
  html: string
  paper: PrintRequest['paper']
  landscape?: boolean
  defaultName: string
}

export interface PrinterInfo {
  name: string
  displayName: string
  isDefault: boolean
}

export interface DesktopPreferences {
  locale: 'ar' | 'en'
  theme: 'dark' | 'light' | 'system'
  printers: { receipt?: string; a4?: string }
  silentReceipt: boolean
  receiptCopies: number
  autoBackup: { enabled: boolean; keep: number; onExit: boolean }
  zoom: number
}

export interface BackupEntry {
  file: string
  path: string
  size: number
  created_at: string
}

export interface SaveFileRequest {
  defaultName: string
  content: string
  encoding?: 'utf8' | 'base64'
  filters?: { name: string; extensions: string[] }[]
}

export type MenuCommand =
  | 'switch-company'
  | 'backup-now'
  | 'preferences'
  | 'about'
  | 'lock'
  | 'command-palette'
  | 'new-document'
  | 'print'

export interface LicenseStatus {
  required: boolean; valid: boolean; error?: string; customerName?: string; expiresAt?: string;
  mode?: 'online' | 'offline' | 'hybrid'; offlineSlots?: number; companies?: number; devices?: number; issuer?: string;
  localCompanies?: number; unusedLocalSlots?: number; unconfirmedLocalCompanies?: number;
  lastCompanyConfirmation?: string; companySyncFailed?: boolean;
  assignment?: { id: string; name: string; mode: 'online' | 'offline'; host_device_id?: string | null } | null;
}

export interface ErpBridge {
  licensing: {
    status(): Promise<LicenseStatus>
    request(): Promise<string>
    activate(server: string, key: string): Promise<LicenseStatus>
    import(contents: string): Promise<LicenseStatus>
    refresh(): Promise<LicenseStatus>
    headers(method: string, path: string): Promise<Record<string, string>>
  }
  isDesktop: true
  app: {
    info(): Promise<{ version: string; platform: string; isDev: boolean; userData: string; electron: string }>
    diagnostics(): Promise<Record<string, unknown>>
    quit(): Promise<void>
  }
  profiles: {
    list(): Promise<CompanyProfile[]>
    saveServer(profile: Omit<CompanyProfile, 'createdAt' | 'mode' | 'id'> & { id?: string }): Promise<CompanyProfile>
    remove(id: string): Promise<void>
    createLocal(input: CreateLocalCompanyInput): Promise<CompanyProfile>
    createServer(input: CreateLocalCompanyInput): Promise<CompanyProfile>
    importLocal(name: string): Promise<CompanyProfile | null>
    open(id: string): Promise<OpenProfileResult>
    close(): Promise<void>
    testServer(url: string): Promise<{ ok: boolean; message?: string; companies?: { slug: string; name: string }[] }>
    joinLan(invitation: string): Promise<CompanyProfile>
  }
  lan: {
    status(): Promise<{ enabled: boolean; urls: string[]; port: number }>
    configure(enabled: boolean, port: number): Promise<{ enabled: boolean; urls: string[]; port: number }>
    invitation(url: string): Promise<string>
  }
  backend: {
    status(): Promise<BackendStatus>
    logs(): Promise<string>
  }
  auth: {
    getToken(profileId: string): Promise<string | null>
    setToken(profileId: string, token: string): Promise<void>
    clearToken(profileId: string): Promise<void>
  }
  drafts: {
    get(key: string): Promise<unknown | null>
    set(key: string, value: unknown): Promise<{ persisted: boolean }>
    remove(key: string): Promise<void>
  }
  print: {
    printers(): Promise<PrinterInfo[]>
    html(request: PrintRequest): Promise<{ ok: boolean; error?: string }>
    pdf(request: PdfRequest): Promise<{ ok: boolean; path?: string; error?: string }>
  }
  backup: {
    exportTo(): Promise<{ ok: boolean; path?: string; error?: string }>
    restore(): Promise<{ ok: boolean; error?: string }>
    openFolder(): Promise<void>
  }
  prefs: {
    get(): Promise<DesktopPreferences>
    set(patch: Partial<DesktopPreferences>): Promise<DesktopPreferences>
  }
  files: {
    save(request: SaveFileRequest): Promise<{ ok: boolean; path?: string }>
    openText(filters?: { name: string; extensions: string[] }[]): Promise<{ ok: boolean; name?: string; content?: string }>
  }
  shell: {
    openExternal(url: string): Promise<void>
    openLogs(): Promise<void>
  }
  notify(title: string, body: string): Promise<void>
  onMenu(callback: (command: MenuCommand) => void): () => void
  onBackendExit(callback: (info: { code: number | null }) => void): () => void
}
