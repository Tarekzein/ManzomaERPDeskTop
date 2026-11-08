import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import '@/styles/app.css'
import { api, configureApi } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { useSession } from '@/store/session'
import { usePrefs } from '@/store/prefs'
import { navigate, useWorkspace } from '@/store/workspace'
import { TabContext } from '@/workspace/TabContext'
import { DialogHost } from '@/components/Dialogs'
import { buildHtml } from '@/features/print/printService'
import { TradeDocA4 } from '@/features/print/templates'
import ProductEditor from '@/features/inventory/ProductEditor'
import DocumentEditor from '@/features/trading/DocumentEditor'

// Actual editors and HTTP APIs, using only an isolated test company and shell.
function App() {
  const [ready, setReady] = useState(false)
  const tabs = useWorkspace(s => s.tabs)
  const active = useWorkspace(s => s.active)
  const tab = tabs.find(t => t.id === active)
  const path = tab?.path.split('?')[0] ?? ''
  const segments = path.split('/')
  const isProduct = path.startsWith('/inventory/products/')
  const params = isProduct ? { id: segments[3] === 'new' ? undefined : segments[3] }
    : { type: segments[2], id: segments[3] === 'new' ? undefined : segments[3] }
  Object.assign(window, { sparePartsReview: {
    async start(baseUrl: string) {
      configureApi({ baseUrl, locale: 'en' })
      const login = await api.post('/auth/login', { username: 'admin', password: 'spare-parts-test-123', device_name: 'isolated-verification' })
      configureApi({ token: login.token })
      const lookups = await api.get('/lookups')
      useSession.setState({ phase: 'ready', baseUrl, user: login.user, lookups })
      usePrefs.setState({ locale: 'en' })
      navigate('/inventory/products/new')
      setReady(true)
    },
    api, navigate,
    print: (doc: any) => buildHtml(<TradeDocA4 doc={doc} />, 'A4'),
    locale(locale: 'ar' | 'en') {
      document.documentElement.lang = locale
      document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
      usePrefs.setState({ locale })
      configureApi({ locale })
    },
    path: () => useWorkspace.getState().tabs.find(t => t.id === useWorkspace.getState().active)?.path,
  } })
  return <QueryClientProvider client={queryClient}>
    {ready && tab && <TabContext.Provider key={`${tab.id}:${path}`} value={{ tabId: tab.id, path: tab.path, active: true, params: params as Record<string, string>, query: new URLSearchParams(tab.path.split('?')[1] ?? '') }}>
      {isProduct ? <ProductEditor /> : <DocumentEditor />}
    </TabContext.Provider>}
    <DialogHost /><Toaster />
  </QueryClientProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
