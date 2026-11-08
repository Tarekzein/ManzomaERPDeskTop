import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Where things live, in development and in an installed build. */
export const paths = {
  isDev: !app.isPackaged,

  userData(): string {
    return app.getPath('userData')
  },

  config(): string {
    return join(this.userData(), 'config.json')
  },

  logs(): string {
    return ensure(join(this.userData(), 'logs'))
  },

  /** One folder per local company file: database, storage, backups. */
  company(id: string): string {
    return ensure(join(this.userData(), 'companies', id))
  },

  database(id: string): string {
    return join(this.company(id), 'company.sqlite')
  },

  storage(id: string): string {
    return ensure(join(this.company(id), 'storage'))
  },

  backups(id: string): string {
    return ensure(join(this.company(id), 'backups'))
  },

  /** Laravel app: bundled under resources/ when installed, the sibling folder in development. */
  backend(): string {
    if (process.env.ERP_BACKEND_DIR) return resolve(process.env.ERP_BACKEND_DIR)
    return app.isPackaged ? join(process.resourcesPath, 'backend') : resolve(app.getAppPath(), '..', 'backend')
  },

  /** PHP runtime: bundled static binary when installed, system PHP in development. */
  php(): string {
    if (process.env.ERP_PHP_BINARY) return process.env.ERP_PHP_BINARY
    const exe = process.platform === 'win32' ? 'php.exe' : 'php'
    // Installed: resources/php/php(.exe). Development: resources/php/<os>-<arch>/ from `npm run fetch:php`.
    const bundled = app.isPackaged
      ? join(process.resourcesPath, 'php', exe)
      : resolve(app.getAppPath(), 'resources', 'php', `${process.platform}-${process.arch}`, exe)
    if (app.isPackaged && !existsSync(bundled)) throw new Error('Bundled PHP runtime is missing. Reinstall the desktop application.')
    return existsSync(bundled) ? bundled : 'php'
  },
}

function ensure(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
