import { licenseServerUrl } from './licenseServer'

export interface ServerSettings { serverUrl: string; licenseServerUrl: string }
declare const __ERP_SERVER_DEFAULTS__: ServerSettings | undefined

/** Only public URL defaults are embedded; environment secrets never reach the renderer. */
export function resolveServerSettings(mode: string, env: Record<string, string | undefined>): ServerSettings {
  const server = env.ERP_SERVER_URL?.trim() || (mode === 'development' ? 'http://127.0.0.1:8000' : '')
  const issuer = env.ERP_LICENSE_SERVER_URL?.trim() || server
  return { serverUrl: server ? licenseServerUrl(server) : '', licenseServerUrl: issuer ? licenseServerUrl(issuer) : '' }
}

export const serverSettings: ServerSettings = typeof __ERP_SERVER_DEFAULTS__ === 'undefined'
  ? { serverUrl: '', licenseServerUrl: '' } : __ERP_SERVER_DEFAULTS__
