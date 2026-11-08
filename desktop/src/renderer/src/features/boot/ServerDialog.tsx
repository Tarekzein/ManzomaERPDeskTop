import { useState } from 'react'
import type { CompanyProfile } from '@shared/types'
import { platform } from '@/lib/platform'
import { usePrefs, useT } from '@/store/prefs'
import { userErrorMessage } from '@shared/userError'
import { Button, Field, Input, Select } from '@/components/ui'
import { Modal } from '@/components/Dialogs'

/** Connect to a company backend on the office network or the cloud. */
export function ServerDialog({ profile, onClose, onSaved, initialUrl }: { initialUrl?: string; profile: CompanyProfile | null; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const locale = usePrefs(state => state.locale)
  const [name, setName] = useState(profile?.name ?? '')
  const [url, setUrl] = useState(profile?.serverUrl ?? initialUrl ?? 'https://')
  const [company, setCompany] = useState(profile?.company ?? '')
  const [companies, setCompanies] = useState<{ slug: string; name: string }[]>([])
  const [status, setStatus] = useState<{ ok: boolean; message?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const test = async () => {
    setBusy(true)
    let result
    try { result = await platform.profiles.testServer(url) }
    catch (error) { result = {ok:false,message:error instanceof Error ? error.message : String(error),companies:[]} }
    if (result.ok && !(result.companies?.length)) result = {...result,ok:false,message:t('لا توجد شركات مخصصة لهذا الترخيص. سجل شركة جديدة أو اطلب تخصيص شركة موجودة.', 'No companies are assigned to this license. Register a new company or ask the administrator to assign one.')}
    setStatus(result)
    setCompanies(result.companies ?? [])
    if (result.companies?.length && !company) setCompany(result.companies[0].slug)
    setBusy(false)
  }

  return (
    <Modal
      title={profile ? t('تعديل اتصال الخادم', 'Edit server connection') : t('الاتصال بخادم', 'Connect to a server')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={test} loading={busy}>{t('اختبار الاتصال', 'Test connection')}</Button>
          <Button
            variant="primary"
            disabled={!status?.ok || !company || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await platform.profiles.saveServer({ id: profile?.id, name: name || companies.find((c) => c.slug === company)?.name || url, serverUrl: url, company: company || undefined })
                onSaved()
              } catch (error) { setStatus({ok:false,message:error instanceof Error ? error.message : String(error)}) }
              finally { setBusy(false) }
            }}
          >
            {t('حفظ', 'Save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t('عنوان الخادم', 'Server address')} hint={t('استخدم رابط HTTPS للخادم المنشور، أو http://127.0.0.1:8000 للاختبار على هذا الجهاز.', 'Use your deployed HTTPS address, or http://127.0.0.1:8000 for testing on this computer.')}>
          <Input autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setStatus(null) }} dir="ltr" />
        </Field>
        {companies.length > 0 && (
          <Field label={t('الشركة', 'Company')}>
            <Select value={company} onChange={(e) => setCompany(e.target.value)} options={companies.map((c) => ({ value: c.slug, label: c.name }))} />
          </Field>
        )}
        <Field label={t('اسم يظهر في القائمة', 'Name shown in the list')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {status && (
          <div role={status.ok ? 'status' : 'alert'} className="rounded-md p-2 text-[12px]" style={{ background: status.ok ? 'var(--ledger-soft)' : 'var(--red-soft)', color: status.ok ? 'var(--ledger)' : 'var(--red)' }}>
            {status.ok ? t('تم الاتصال بالخادم.', 'Connected to the server.') : userErrorMessage(status.message, locale)}
          </div>
        )}
      </div>
    </Modal>
  )
}
