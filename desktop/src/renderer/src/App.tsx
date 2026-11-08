import { useEffect } from 'react'
import { toast } from 'sonner'
import { useSession } from '@/store/session'
import { usePrefs, tr } from '@/store/prefs'
import { useWorkspace } from '@/store/workspace'
import { platform } from '@/lib/platform'
import { Spinner } from '@/components/ui'
import { LicenseGate } from '@/features/boot/LicenseGate'
import { CompanyPicker } from '@/features/boot/CompanyPicker'
import { Login } from '@/features/boot/Login'
import { Shell } from '@/workspace/Shell'

export function App() {
  const prefs = usePrefs((s) => s.prefs)

  useEffect(() => {
    void usePrefs.getState().load()
    return platform.onBackendExit(() => toast.error(tr('توقف خادم البيانات المحلي. أعد فتح الشركة.', 'The local data server stopped. Open the company again.')))
  }, [])

  if (!prefs) return <Spinner />
  return <LicenseGate><LicensedApplication /></LicenseGate>
}

function LicensedApplication() {
  const prefs = usePrefs(s => s.prefs)
  const { phase, profile, user } = useSession()
  // Each company and user gets their own set of open tabs.
  useEffect(() => {
    if (phase === 'ready' && profile && user) useWorkspace.getState().init(`${profile.id}:${user.id}`)
  }, [phase === 'ready', profile?.id, user?.id])

  // Follow the user's language when they sign in for the first time on this PC.
  useEffect(() => {
    if (user?.locale && prefs && !localStorage.getItem('erp.localeChosen')) {
      localStorage.setItem('erp.localeChosen', '1')
      if (user.locale !== prefs.locale) void usePrefs.getState().update({ locale: user.locale })
    }
  }, [user?.id])

  if (phase === 'pick' || phase === 'opening') return <CompanyPicker />
  if (phase === 'login') return <Login />
  return <Shell />
}
