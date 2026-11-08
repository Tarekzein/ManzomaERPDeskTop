import { createContext, useContext, useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'
import type { Params } from './routes'

interface TabCtx {
  tabId: string
  path: string
  params: Params
  query: URLSearchParams
  active: boolean
}

export const TabContext = createContext<TabCtx | null>(null)

export function useTab() {
  const ctx = useContext(TabContext)
  if (!ctx) throw new Error('useTab outside a tab')
  const ws = useWorkspace.getState()
  return {
    ...ctx,
    replace: (path: string) => ws.replace(ctx.tabId, path),
    close: () => ws.close(ctx.tabId),
    setDirty: (dirty: boolean) => ws.setDirty(ctx.tabId, dirty),
  }
}

/** Set the tab title from inside a page. */
export function useTabTitle(title: string | undefined | null) {
  const ctx = useContext(TabContext)
  useEffect(() => {
    if (ctx && title) useWorkspace.getState().setTitle(ctx.tabId, title)
  }, [ctx?.tabId, title])
}

/** Run a handler for a menu/keyboard command only in the visible tab. */
export function useActiveTab(): boolean {
  return useContext(TabContext)?.active ?? false
}
