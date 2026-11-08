import { useEffect, useState } from 'react'
import { platform, isDesktop } from '@/lib/platform'
import { datetime } from '@/lib/format'
import { useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import type { BackendStatus } from '@shared/types'

export function AutomationStatus() {
  const t = useT()
  const profile = useSession(state => state.profile)
  const [status, setStatus] = useState<BackendStatus | null>(null)
  useEffect(() => {
    if (!isDesktop || profile?.mode !== 'local') return
    let active = true
    const poll = () => { void platform.backend.status().then(next => { if (active) setStatus(next) }).catch(() => undefined) }
    poll(); const timer = setInterval(poll, 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [profile?.id, profile?.mode])
  if (!isDesktop || profile?.mode !== 'local') return null
  const scan = status?.automation
  return <div role="status" className="rounded border p-3 text-[13px]" style={{ borderColor: 'var(--rule)' }}>
    <strong>{t('متابعة تلقائية محلية', 'Local automatic follow-up')}</strong>
    <p className="muted m-0 mt-1">{t('يتم فحص المواعيد والمخزون أثناء فتح الشركة، والتعويض بعد إيقاظ الجهاز. لا يعمل الفحص عند إغلاق التطبيق.', 'Schedules and stock are checked while this company is open, with catch-up after sleep. Scans do not run while the application is closed.')}</p>
    <span>{scan?.running ? t('جارٍ الفحص…', 'Scanning…') : scan?.lastSuccess ? `${t('آخر فحص ناجح: ', 'Last successful scan: ')}${datetime(scan.lastSuccess)}` : t('في انتظار الفحص الأول', 'Waiting for the first scan')}</span>
    {scan?.lastError && <p className="error m-0 mt-1">{t('تعذر الفحص الأخير. ستتم إعادة المحاولة تلقائياً؛ راجع سجل الخادم إذا استمر التعذر.', 'The latest scan failed and will retry automatically. Check the local server log if the problem persists.')}</p>}
  </div>
}
