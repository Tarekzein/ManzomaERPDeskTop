import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackendStatus, CompanyProfile, CreateLocalCompanyInput } from '../shared/types'
import { paths } from './paths'
import { store } from './store'
import { licensing } from './licensing'
import { log } from './log'
import { CompanyAutomation } from './companyAutomation'
import { prepareBackendCache } from './backendCache'
import { userErrorMessage } from '../shared/userError'
import { lanHost } from './lanHost'

/**
 * Runs the Laravel backend for a local company file.
 *
 * Each local company is its own SQLite database. The backend is PHP's
 * built-in web server bound to 127.0.0.1 on a free port, so nothing is
 * reachable from the network. Server-mode profiles never start a process.
 */
class BackendManager {
  private child: ChildProcess | null = null
  private status: BackendStatus = { profileId: null, state: 'stopped' }
  private logBuffer: string[] = []
  private stopping = false
  private restarts = 0
  private onExitListeners: ((code: number | null) => void)[] = []
  private automation?: CompanyAutomation

  current(): BackendStatus {
    return { ...this.status, automation: this.automation ? { ...this.automation.state } : undefined }
  }

  logs(): string {
    return this.logBuffer.join('')
  }

  onUnexpectedExit(listener: (code: number | null) => void): void {
    this.onExitListeners.push(listener)
  }

  /** Environment that points Laravel at one company's files. */
  env(profileId: string, port?: number): NodeJS.ProcessEnv {
    const storage = paths.storage(profileId)
    prepareBackendCache(storage, paths.backend())
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APP_ENV: 'production',
      APP_DEBUG: 'false',
      APP_KEY: store.appKey(profileId),
      APP_URL: port ? `http://127.0.0.1:${port}` : 'http://127.0.0.1',
      APP_LOCALE: store.prefs().locale,
      DB_CONNECTION: 'sqlite',
      DB_DATABASE: paths.database(profileId),
      DB_URL: '',
      DB_BUSY_TIMEOUT: '10000',
      DB_JOURNAL_MODE: 'WAL',
      ERP_STORAGE_PATH: storage,
      ERP_BACKUP_PATH: paths.backups(profileId),
      ERP_MULTI_COMPANY: 'false',
      APP_SERVICES_CACHE: join(storage, 'bootstrap', 'services.php'),
      APP_PACKAGES_CACHE: join(storage, 'bootstrap', 'packages.php'),
      APP_CONFIG_CACHE: join(storage, 'bootstrap', 'config.php'),
      APP_ROUTES_CACHE: join(storage, 'bootstrap', 'routes.php'),
      APP_EVENTS_CACHE: join(storage, 'bootstrap', 'events.php'),
      LOG_CHANNEL: 'single',
      LOG_LEVEL: paths.isDev ? 'debug' : 'warning',
      CACHE_STORE: 'file',
      SESSION_DRIVER: 'array',
      QUEUE_CONNECTION: 'sync',
      BCRYPT_ROUNDS: '10',
      ...licensing.localEnvironment(profileId),
    }
    // The built-in server can fork workers on macOS/Linux (not Windows).
    if (process.platform !== 'win32') env.PHP_CLI_SERVER_WORKERS = '4'

    return env
  }

  /** Run an artisan command for a company and return its output. */
  async artisan(profileId: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}, timeout = 180_000): Promise<string> {
    await store.prepareAppKey(profileId)
    const backend = paths.backend()
    return new Promise((resolve, reject) => {
      execFile(paths.php(), [join(backend, 'artisan'), ...args, '--no-interaction'], { cwd: backend, env: { ...this.env(profileId), ...extraEnv }, timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        this.append(`$ artisan ${args.join(' ')}\n${stdout}${stderr}`)
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim().split('\n').slice(-6).join('\n')))
        } else {
          resolve(stdout)
        }
      })
    })
  }

  /** First run: create the company database, chart of accounts and administrator. */
  async createCompany(profile: CompanyProfile, input: CreateLocalCompanyInput): Promise<void> {
    const db = paths.database(profile.id)
    if (!existsSync(db)) writeFileSync(db, '')
    const args = [
      'erp:install', '--json',
      `--company=${input.name}`,
      `--company-en=${input.nameEn || input.name}`,
      `--currency=${input.currency || 'EGP'}`,
      `--vat=${input.vatRate}`,
      `--admin-name=${input.adminName}`,
      `--admin-username=${input.adminUsername}`,
      `--locale=${input.locale}`,
    ]
    if (input.taxNumber) args.push(`--tax-number=${input.taxNumber}`)
    if (input.demo) args.push('--demo')
    // The password travels in the environment, not on the command line.
    const output = await this.artisan(profile.id, args, { ERP_ADMIN_PASSWORD: input.adminPassword }, 600_000)
    const line = output.trim().split('\n').filter((l) => l.startsWith('{')).pop()
    const result = line ? JSON.parse(line) : null
    if (!result?.ok) throw new Error(result?.error || 'Install failed')
  }

  async importCompany(profile: CompanyProfile, source: string): Promise<{ name?: string }> {
    const output = await this.artisan(profile.id, ['erp:import-company', source, '--json'], {}, 600_000)
    const line = output.trim().split('\n').filter(value => value.startsWith('{')).pop()
    const result = line ? JSON.parse(line) : null
    if (!result?.ok) throw new Error(result?.error || 'Company import failed.')
    return { name: result.name }
  }

  async start(profile: CompanyProfile): Promise<string> {
    if (this.status.profileId === profile.id && this.status.state === 'running' && this.status.baseUrl) {
      return this.status.baseUrl
    }
    await this.stop()
    killStaleServer()
    this.restarts = 0
    this.status = { profileId: profile.id, state: 'starting' }
    try {
      // Bring the schema and permissions up to date after an app update.
      await this.artisan(profile.id, ['erp:upgrade', '--json'])
      const port = await freePort()
      const baseUrl = `http://127.0.0.1:${port}`
      this.spawnServer(profile, port)
      await waitFor(`${baseUrl}/api/system/ping`, 25_000)
      this.status = { profileId: profile.id, state: 'running', baseUrl, pid: this.child?.pid }
      this.automation = new CompanyAutomation(() => this.artisan(profile.id, ['erp:maintenance-scan'], {}, 90_000))
      this.automation.start()
      await lanHost.resume(profile.id,baseUrl)
      log('backend', `running ${profile.name} on ${baseUrl}`)
      return baseUrl
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.status = { profileId: profile.id, state: 'error', error: userErrorMessage(message, store.prefs().locale) }
      log('backend', 'start failed', message)
      await this.stop()
      throw new Error(message)
    }
  }

  private spawnServer(profile: CompanyProfile, port: number): void {
    const backend = paths.backend()
    const router = join(backend, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php')
    const child = spawn(paths.php(), ['-S', `127.0.0.1:${port}`, router], {
      cwd: join(backend, 'public'),
      env: this.env(profile.id, port),
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    this.child = child
    this.stopping = false
    if (child.pid) writeFileSync(pidFile(), JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }))
    child.stdout?.on('data', (d) => this.append(String(d)))
    child.stderr?.on('data', (d) => this.append(String(d)))
    child.on('exit', (code) => {
      this.append(`\n[backend exited with code ${code}]\n`)
      if (this.child === child) this.child = null
      if (this.stopping) return
      log('backend', `unexpected exit ${code}`)
      // Restart a crashed server a few times before giving up.
      if (this.restarts < 3 && this.status.state === 'running') {
        this.restarts++
        this.spawnServer(profile, port)
        return
      }
      this.status = { ...this.status, state: 'error', error: userErrorMessage('The company database could not start. Close and reopen the application. If it continues, contact your administrator.', store.prefs().locale) }
      this.onExitListeners.forEach((l) => l(code))
    })
  }

  async stop(): Promise<void> {
    await lanHost.stop()
    await this.automation?.stop()
    this.automation = undefined
    const child = this.child
    if (!child || child.pid === undefined) {
      this.child = null
      if (this.status.state !== 'error') this.status = { profileId: null, state: 'stopped' }
      return
    }
    this.stopping = true
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
        } else {
          // Negative pid: the whole process group, including server workers.
          process.kill(-child.pid!, 'SIGTERM')
        }
      } catch {
        child.kill('SIGKILL')
      }
    })
    this.child = null
    this.status = { profileId: null, state: 'stopped' }
    rmSync(pidFile(), { force: true })
  }

  private append(text: string): void {
    this.logBuffer.push(text)
    if (this.logBuffer.length > 400) this.logBuffer.splice(0, this.logBuffer.length - 400)
    try {
      appendFileSync(join(paths.logs(), 'backend.log'), text)
    } catch {
      // ignore
    }
  }
}

function pidFile(): string {
  return join(paths.userData(), 'backend.pid')
}

/**
 * If the app was killed (crash, Task Manager) its PHP server keeps running and
 * holds the company file open. Stop it before starting a new one — but only
 * when the recorded pid is still a PHP built-in server of ours.
 */
export function killStaleServer(): void {
  const file = pidFile()
  if (!existsSync(file)) return
  try {
    const { pid } = JSON.parse(readFileSync(file, 'utf8')) as { pid: number }
    if (!pid || pid === process.pid) return
    if (process.platform === 'win32') {
      const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }).toString()
      if (/php/i.test(row)) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)]).toString()
      if (command.includes('server.php') && command.includes('php')) {
        process.kill(-pid, 'SIGTERM')
        log('backend', `stopped a leftover server (pid ${pid})`)
      }
    }
  } catch {
    // Not running any more, or not ours.
  } finally {
    rmSync(file, { force: true })
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`The backend did not start in time (${lastError}).`)
}

export const backend = new BackendManager()
