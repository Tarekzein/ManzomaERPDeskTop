import { contextBridge, ipcRenderer } from 'electron'
import type { ErpBridge, MenuCommand } from '../shared/types'

/**
 * The only door between the web UI and the operating system. Each method is
 * a named IPC call; no generic invoke is exposed.
 */
const api: ErpBridge = {
  isDesktop: true,
  licensing: {
    status: () => ipcRenderer.invoke('licensing:status'),
    request: () => ipcRenderer.invoke('licensing:request'),
    activate: (server, key) => ipcRenderer.invoke('licensing:activate', server, key),
    import: (contents) => ipcRenderer.invoke('licensing:import', contents),
    refresh: () => ipcRenderer.invoke('licensing:refresh'),
    headers: (method, path) => ipcRenderer.invoke('licensing:headers', method, path),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    diagnostics: () => ipcRenderer.invoke('app:diagnostics'),
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    saveServer: (profile) => ipcRenderer.invoke('profiles:save-server', profile),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
    createLocal: (input) => ipcRenderer.invoke('profiles:create-local', input),
    createServer: (input) => ipcRenderer.invoke('profiles:create-server', input),
    importLocal: (name) => ipcRenderer.invoke('profiles:import-local', name),
    open: (id) => ipcRenderer.invoke('profiles:open', id),
    close: () => ipcRenderer.invoke('profiles:close'),
    testServer: (url) => ipcRenderer.invoke('profiles:test-server', url),
    joinLan: invitation => ipcRenderer.invoke('profiles:join-lan', invitation),
  },
  lan: {
    status: () => ipcRenderer.invoke('lan:status'),
    configure: (enabled, port) => ipcRenderer.invoke('lan:configure',enabled,port),
    invitation: url => ipcRenderer.invoke('lan:invitation',url),
  },
  backend: {
    status: () => ipcRenderer.invoke('backend:status'),
    logs: () => ipcRenderer.invoke('backend:logs'),
  },
  auth: {
    getToken: (profileId) => ipcRenderer.invoke('auth:get-token', profileId),
    setToken: (profileId, token) => ipcRenderer.invoke('auth:set-token', profileId, token),
    clearToken: (profileId) => ipcRenderer.invoke('auth:clear-token', profileId),
  },
  drafts: {
    get: (key) => ipcRenderer.invoke('drafts:get', key),
    set: (key, value) => ipcRenderer.invoke('drafts:set', key, value),
    remove: (key) => ipcRenderer.invoke('drafts:remove', key),
  },
  print: {
    printers: () => ipcRenderer.invoke('print:printers'),
    html: (request) => ipcRenderer.invoke('print:html', request),
    pdf: (request) => ipcRenderer.invoke('print:pdf', request),
  },
  backup: {
    exportTo: () => ipcRenderer.invoke('backup:export'),
    restore: () => ipcRenderer.invoke('backup:restore'),
    openFolder: () => ipcRenderer.invoke('backup:open-folder'),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch),
  },
  files: {
    save: (request) => ipcRenderer.invoke('files:save', request),
    openText: (filters) => ipcRenderer.invoke('files:open-text', filters),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    openLogs: () => ipcRenderer.invoke('shell:open-logs'),
  },
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  onMenu: (callback) => {
    const listener = (_: unknown, command: MenuCommand) => callback(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  onBackendExit: (callback) => {
    const listener = (_: unknown, info: { code: number | null }) => callback(info)
    ipcRenderer.on('backend:exit', listener)
    return () => ipcRenderer.removeListener('backend:exit', listener)
  },
}

contextBridge.exposeInMainWorld('erp', api)
