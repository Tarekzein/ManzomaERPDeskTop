import { create } from 'zustand'
import type { CompanyProfile } from '@shared/types'
import { api, configureApi } from '@/lib/api'
import { platform } from '@/lib/platform'
import { queryClient } from '@/lib/query'

export interface SessionUser {
  id: number
  name: string
  username: string
  email?: string | null
  locale: 'ar' | 'en'
  branch_id: number | null
  branch?: { id: number; name: string; name_en?: string | null } | null
  default_warehouse_id: number | null
  default_cash_account_id: number | null
  max_discount_percent: string | null
  is_salesperson: boolean
  roles: string[]
  is_admin: boolean
  permissions: string[]
}

export interface Lookups {
  settings: Record<string, any>
  branches: any[]
  warehouses: any[]
  cash_accounts: any[]
  tax_rates: any[]
  units: any[]
  categories: any[]
  brands: any[]
  price_lists: any[]
  cost_centers: any[]
  users: any[]
  technicians?: { id: number; name: string }[]
  crm_stages: any[]
  crm_sources: any[]
  crm_lost_reasons: any[]
  tags: any[]
}

type Phase = 'pick' | 'opening' | 'login' | 'ready' | 'locked'

interface SessionState {
  phase: Phase
  profile: CompanyProfile | null
  baseUrl: string | null
  company?: string
  info: any | null
  user: SessionUser | null
  lookups: Lookups | null
  error: string | null
  open(profile: CompanyProfile): Promise<void>
  close(): Promise<void>
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
  lock(): void
  unlock(password: string): Promise<void>
  refreshLookups(): Promise<void>
  refreshUser(): Promise<void>
}

export const useSession = create<SessionState>((set, get) => ({
  phase: 'pick',
  profile: null,
  baseUrl: null,
  info: null,
  user: null,
  lookups: null,
  error: null,

  async open(profile) {
    set({ phase: 'opening', error: null, profile })
    try {
      const result = await platform.profiles.open(profile.id)
      configureApi({ baseUrl: result.baseUrl, company: result.company, token: null, onUnauthorized: () => get().phase === 'ready' && set({ phase: 'login', user: null }) })
      const info = await api.get('/system/info')
      set({ baseUrl: result.baseUrl, company: result.company, info })
      // Resume a remembered session when the token is still valid.
      const token = await platform.auth.getToken(profile.id)
      if (token) {
        configureApi({ token })
        try {
          const me = await api.get('/auth/me')
          set({ user: me.user })
          await get().refreshLookups()
          set({ phase: 'ready' })
          return
        } catch {
          await platform.auth.clearToken(profile.id)
          configureApi({ token: null })
        }
      }
      set({ phase: 'login' })
    } catch (e) {
      set({ phase: 'pick', error: e instanceof Error ? e.message : String(e) })
    }
  },

  async close() {
    await platform.profiles.close()
    configureApi({ token: null, baseUrl: '' })
    queryClient.clear()
    set({ phase: 'pick', profile: null, user: null, lookups: null, baseUrl: null, info: null })
  },

  async login(username, password) {
    const { profile } = get()
    const result = await api.post('/auth/login', { username, password, device_name: `desktop:${navigator.platform}` })
    configureApi({ token: result.token })
    if (profile) await platform.auth.setToken(profile.id, result.token)
    set({ user: result.user })
    await get().refreshLookups()
    set({ phase: 'ready', error: null })
  },

  async logout() {
    const { profile } = get()
    try {
      await api.post('/auth/logout')
    } catch {
      // already signed out
    }
    if (profile) await platform.auth.clearToken(profile.id)
    configureApi({ token: null })
    queryClient.clear()
    set({ phase: 'login', user: null, lookups: null })
  },

  lock() {
    if (get().phase === 'ready') set({ phase: 'locked' })
  },

  async unlock(password) {
    await api.post('/auth/verify-password', { password })
    set({ phase: 'ready' })
  },

  async refreshLookups() {
    const lookups = await api.get<Lookups>('/lookups')
    set({ lookups })
  },

  async refreshUser() {
    const me = await api.get('/auth/me')
    set({ user: me.user })
  },
}))

export function can(permission: string): boolean {
  const user = useSession.getState().user
  return Boolean(user && (user.is_admin || user.permissions.includes(permission)))
}

export function useCan(): (permission: string | string[]) => boolean {
  const user = useSession((s) => s.user)
  return (permission) => {
    if (!user) return false
    if (user.is_admin) return true
    const list = Array.isArray(permission) ? permission : [permission]
    return list.some((p) => user.permissions.includes(p))
  }
}

export function setting<T = any>(key: string, fallback?: T): T {
  const value = useSession.getState().lookups?.settings?.[key]
  return (value === undefined || value === null ? fallback : value) as T
}

export function currency(): string {
  return setting('company.currency', 'EGP')
}
