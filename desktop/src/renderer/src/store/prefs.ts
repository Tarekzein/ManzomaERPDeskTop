import { create } from 'zustand'
import type { DesktopPreferences } from '@shared/types'
import { platform } from '@/lib/platform'
import { configureApi } from '@/lib/api'

interface PrefsState {
  prefs: DesktopPreferences | null
  locale: 'ar' | 'en'
  load(): Promise<void>
  update(patch: Partial<DesktopPreferences>): Promise<void>
}

function apply(prefs: DesktopPreferences) {
  const root = document.documentElement
  root.lang = prefs.locale
  root.dir = prefs.locale === 'ar' ? 'rtl' : 'ltr'
  const theme = prefs.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : prefs.theme
  root.dataset.theme = theme
  configureApi({ locale: prefs.locale })
}

export const usePrefs = create<PrefsState>((set, get) => ({
  prefs: null,
  locale: 'ar',
  async load() {
    const prefs = await platform.prefs.get()
    apply(prefs)
    set({ prefs, locale: prefs.locale })
  },
  async update(patch) {
    const prefs = await platform.prefs.set({ ...(get().prefs ?? {}), ...patch })
    apply(prefs)
    set({ prefs, locale: prefs.locale })
  },
}))

/** Bilingual string: tr('العملاء', 'Customers'). */
export function tr(ar: string, en: string): string {
  return usePrefs.getState().locale === 'ar' ? ar : en
}

/** Hook form of tr that re-renders when the language changes. */
export function useT(): (ar: string, en: string) => string {
  const locale = usePrefs((s) => s.locale)
  return (ar: string, en: string) => (locale === 'ar' ? ar : en)
}

/** Pick the Arabic or English name of a record. */
export function useName(): (row: { name?: string | null; name_en?: string | null } | null | undefined) => string {
  const locale = usePrefs((s) => s.locale)
  return (row) => (row ? (locale === 'en' && row.name_en ? row.name_en : row.name ?? '') : '')
}

export function nameOf(row: { name?: string | null; name_en?: string | null } | null | undefined): string {
  if (!row) return ''
  return usePrefs.getState().locale === 'en' && row.name_en ? row.name_en : row.name ?? ''
}
