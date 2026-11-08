import { useCallback, useEffect, useState, useRef, type ReactNode } from 'react'
import { Languages, ShieldCheck } from 'lucide-react'
import type { LicenseStatus } from '@shared/types'
import { platform } from '@/lib/platform'
import { Button, ErrorBox, Spinner } from '@/components/ui'
import { usePrefs, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { LicenseContent } from './LicenseDialog'

/** Fail closed before mounting any company, import or login UI. */
export function LicenseGate({ children }: { children: ReactNode }) {
  const t = useT()
  const locale = usePrefs(state => state.locale)
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [error, setError] = useState<unknown>(null)
  const revision = useRef(0)
  const check = useCallback(async () => {
    const request = ++revision.current
    try {
      const next = await platform.licensing.status()
      if (request !== revision.current) return
      setStatus(next); setError(null)
      if (!next.valid && useSession.getState().phase !== 'pick') await useSession.getState().close()
    } catch (failure) { if (request === revision.current) { setStatus(null); setError(failure) } }
  }, [])
  useEffect(() => {
    void check()
    const changed = () => { void check() }
    const timer = window.setInterval(changed, 30000)
    window.addEventListener('focus', changed)
    window.addEventListener('erp:license-changed', changed)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', changed); window.removeEventListener('erp:license-changed', changed) }
  }, [check])
  if (status?.valid) return <>{children}</>
  if (!status && !error) return <Spinner label={t('جارٍ التحقق من الترخيص…', 'Verifying your license…')} />
  return <main className="auth-page h-full overflow-auto p-5 sm:p-12" data-license-gate>
    <section className="sheet auth-card mx-auto w-full max-w-[720px] p-5 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><span className="auth-icon"><ShieldCheck size={26} /></span><h1 className="mb-1 mt-3 text-[23px] font-bold">{t('تفعيل التطبيق أولاً', 'Activate your application first')}</h1><p className="m-0 muted">{t('تحقق من الترخيص قبل تسجيل الدخول أو إنشاء شركة أو استيراد بيانات شركة سابقة.', 'Verify your license before signing in, creating a company or importing an existing company.')}</p></div>
        <Button size="sm" variant="ghost" icon={Languages} lang={locale === 'ar' ? 'en' : 'ar'} onClick={() => void usePrefs.getState().update({ locale: locale === 'ar' ? 'en' : 'ar' })}>{locale === 'ar' ? 'English' : 'العربية'}</Button>
      </div>
      {error ? <ErrorBox error={error} onRetry={() => void check()} /> : null}
      <LicenseContent onVerified={() => void check()} />
    </section>
  </main>
}
