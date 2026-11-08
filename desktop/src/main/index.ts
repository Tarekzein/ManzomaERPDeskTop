import { app, BrowserWindow, session, shell } from 'electron'
import { isAbsolute, join } from 'node:path'
import { BRAND } from '../shared/brand'
import { backend, killStaleServer } from './backend'
import { backupNow } from './backup'
import { currentProfile, registerIpc } from './ipc'
import { buildMenu } from './menu'
import { paths } from './paths'
import { store } from './store'
import { log } from './log'
import { X509Certificate } from 'node:crypto'

let mainWindow: BrowserWindow | null = null

// A stable data folder in development and installed builds alike
// (company files live under it, so it must never move).
app.setName(BRAND.name)
// Explicit separate profiles are useful for installer acceptance and support;
// ordinary launches keep the original stable company-data directory.
const explicitUserData = app.commandLine.getSwitchValue('user-data-dir')
if (explicitUserData && !isAbsolute(explicitUserData)) throw new Error('--user-data-dir must be an absolute path.')
app.setPath('userData', explicitUserData || join(app.getPath('appData'), BRAND.dataFolder))

// One copy of the app per user: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

if (process.platform === 'win32') app.setAppUserModelId('com.manzomatech.erp.desktop')

function createWindow(): void {
  const prefs = store.prefs()
  mainWindow = new BrowserWindow({
    title: BRAND.name,
    width: 1440,
    height: 880,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: prefs.theme === 'light' ? '#f6f7fb' : '#0b0d16',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
    mainWindow?.webContents.setZoomFactor(prefs.zoom || 1)
  })

  // The app never navigates away from itself; external links open in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL ? url.startsWith(process.env.ELECTRON_RENDERER_URL) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  buildMenu(mainWindow, prefs.locale)

  if (paths.isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Trust only the exact LAN certificate in a cryptographically verified pairing code.
  session.defaultSession.setCertificateVerifyProc(({hostname,certificate}, callback) => {
    const profiles = store.profiles().filter(profile => profile.mode === 'lan' && profile.serverUrl && new URL(profile.serverUrl).hostname === hostname)
    if (!profiles.length) { callback(-3); return }
    try {
      const actual = new X509Certificate(certificate.data).fingerprint256.replaceAll(':','').toLowerCase()
      callback(profiles.some(profile => profile.tlsFingerprint === actual) ? 0 : -2)
    } catch { callback(-2) }
  })
  // No permission prompts from the renderer (camera, geolocation…).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'notifications' || permission === 'clipboard-sanitized-write'))
  killStaleServer()
  registerIpc(() => mainWindow)
  // Unpackaged runs live inside Electron.app, whose Dock icon macOS would show; packaged builds use the .icns.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'))
  createWindow()
  log('app', `started ${app.getVersion()} (${process.platform}), backend: ${paths.backend()}, php: ${paths.php()}`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  const profile = currentProfile()
  if (profile?.mode === 'local' || backend.current().state === 'running') {
    event.preventDefault()
    const finish = async () => {
      try {
        if (profile?.mode === 'local' && store.prefs().autoBackup.onExit) await backupNow(profile)
      } catch (error) {
        log('backup', 'exit backup failed', String(error))
      }
      await backend.stop()
      app.quit()
    }
    void finish()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
