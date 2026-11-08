import { useEffect, useRef } from 'react'
import { ArrowUpRight, ClipboardCheck } from 'lucide-react'
import { useApi } from '@/lib/query'
import { can, useSession } from '@/store/session'
import { useT } from '@/store/prefs'
import { useWorkspace } from '@/store/workspace'
import { Button } from '@/components/ui'
import { openSetupGuide, type GuideState } from './guide'

/** Only a newly installed company's owner is prompted; existing/imported companies keep their state. */
export function SetupGuideBanner() {
  const t = useT()
  const { profile, user, phase } = useSession()
  const scope = `${profile?.id}:${user?.id}`
  const workspaceKey = useWorkspace(state => state.key)
  const path = useWorkspace(state => state.tabs.find(tab => tab.id === state.active)?.path)
  const { data } = useApi<GuideState>(phase === 'ready' && can('settings.manage') ? '/setup-guide' : null)
  const prompted = useRef('')
  useEffect(() => {
    if (data?.auto_start && workspaceKey === scope && prompted.current !== scope) {
      prompted.current = scope
      openSetupGuide()
    }
  }, [data?.auto_start, workspaceKey, scope])
  // The guide itself and the dashboard (which shows SetupGuideCard) don't need the banner too.
  if (!data?.auto_start || ['/getting-started', '/dashboard'].includes(path?.split('?')[0] ?? '') || phase !== 'ready') return null
  return <aside className="setup-banner" aria-label={t('متابعة إعداد الشركة', 'Continue company setup')}>
    <ClipboardCheck size={18} className="shrink-0" />
    <div className="min-w-0 flex-1"><strong>{t('إعداد شركتك خطوة بخطوة', 'Set up your company, step by step')}</strong><span>{t(` تمت مراجعة ${data.done} من ${data.total} خطوات.`, ` ${data.done} of ${data.total} steps reviewed.`)}</span></div>
    <Button size="sm" onClick={openSetupGuide}>{t('متابعة الدليل', 'Continue setup')}<ArrowUpRight size={14} className="flow-arrow" /></Button>
  </aside>
}
