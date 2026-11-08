import { create } from 'zustand'

export interface Tab {
  id: string
  path: string
  title?: string
  dirty?: boolean
}

interface WorkspaceState {
  key: string | null
  tabs: Tab[]
  active: string | null
  init(key: string): void
  open(path: string, opts?: { newTab?: boolean; title?: string }): void
  replace(tabId: string, path: string): void
  close(tabId: string): void
  closeOthers(tabId: string): void
  activate(tabId: string): void
  setTitle(tabId: string, title: string): void
  setDirty(tabId: string, dirty: boolean): void
}

const MAX_TABS = 14

function persist(state: Pick<WorkspaceState, 'key' | 'tabs' | 'active'>) {
  if (!state.key) return
  try {
    // New, unsaved documents are not restored after a restart.
    const tabs = state.tabs.filter((t) => !t.path.includes('/new')).map(({ id, path, title }) => ({ id, path, title }))
    localStorage.setItem(`erp.tabs.${state.key}`, JSON.stringify({ tabs, active: state.active }))
  } catch {
    // ignore
  }
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  key: null,
  tabs: [],
  active: null,

  init(key) {
    let tabs: Tab[] = [{ id: uid(), path: '/dashboard' }]
    let active: string | null = tabs[0].id
    try {
      const saved = JSON.parse(localStorage.getItem(`erp.tabs.${key}`) || 'null')
      if (saved?.tabs?.length) {
        tabs = saved.tabs.map((tab: Tab) => tab.path === '/advanced' ? { ...tab, path: '/dashboard', title: undefined } : tab.path === '/advanced/overview' ? { ...tab, path: '/reports/overview', title: undefined } : tab)
        active = saved.tabs.some((t: Tab) => t.id === saved.active) ? saved.active : saved.tabs[0].id
      }
    } catch {
      // ignore
    }
    set({ key, tabs, active })
  },

  open(path, opts = {}) {
    const { tabs } = get()
    // A "new" document always gets its own tab, so several can be open at once.
    const target = path.endsWith('/new') ? `${path}?k=${uid()}` : path
    const existing = !path.endsWith('/new') && tabs.find((t) => t.path === target)
    if (existing && !opts.newTab) {
      set({ active: existing.id })
      persist(get())
      return
    }
    let next = [...tabs, { id: uid(), path: target, title: opts.title }]
    if (next.length > MAX_TABS) {
      const removable = next.find((t) => !t.dirty && t.id !== get().active)
      if (removable) next = next.filter((t) => t.id !== removable.id)
    }
    set({ tabs: next, active: next[next.length - 1].id })
    persist(get())
  },

  replace(tabId, path) {
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, path, dirty: false } : t)) })
    persist(get())
  },

  close(tabId) {
    const { tabs, active } = get()
    const index = tabs.findIndex((t) => t.id === tabId)
    let next = tabs.filter((t) => t.id !== tabId)
    if (next.length === 0) next = [{ id: uid(), path: '/dashboard' }]
    const nextActive = active === tabId ? (next[Math.max(0, index - 1)] ?? next[0]).id : active
    set({ tabs: next, active: nextActive })
    persist(get())
  },

  closeOthers(tabId) {
    set({ tabs: get().tabs.filter((t) => t.id === tabId || t.dirty), active: tabId })
    persist(get())
  },

  activate(tabId) {
    set({ active: tabId })
    persist(get())
  },

  setTitle(tabId, title) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (tab && tab.title !== title) {
      set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) })
      persist(get())
    }
  },

  setDirty(tabId, dirty) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (tab && Boolean(tab.dirty) !== dirty) set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, dirty } : t)) })
  },
}))

export function navigate(path: string, opts?: { newTab?: boolean; title?: string }) {
  useWorkspace.getState().open(path, opts)
}
