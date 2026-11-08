import { useState } from 'react'
import type { CompanyProfile } from '@shared/types'
import { platform } from '@/lib/platform'
import { useT } from '@/store/prefs'
import { Modal } from '@/components/Dialogs'
import { Button, ErrorBox, Field, Input } from '@/components/ui'

export function ImportCompanyDialog({ onClose, onImported }: { onClose: () => void; onImported: (profile: CompanyProfile) => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const importCompany = async () => {
    setBusy(true); setError(null)
    try { const profile = await platform.profiles.importLocal(name.trim()); if (profile) onImported(profile) }
    catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }
  return <Modal title={t('استيراد شركة سابقة', 'Import an existing company')} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void importCompany()}>{t('اختر النسخة واستورد', 'Choose backup and import')}</Button></>}>
    <div className="grid gap-4">
      {error ? <ErrorBox error={error} /> : null}
      <p className="m-0 muted">{t('يستهلك الاستيراد خانة شركة أوفلاين فارغة من الترخيص. ستبقى بيانات الشركة ومستخدموها، ثم تسجل الدخول باسم المستخدم وكلمة المرور القديمين.', 'Import uses an unused offline company slot. Existing records and users are preserved; sign in afterwards with that company’s original username and password.')}</p>
      <Field label={t('اسم الشركة في هذا الجهاز', 'Company name on this PC')}><Input autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} /></Field>
      <p className="m-0 text-[12px] muted">{t('اختر نسخة Manzoma بصيغة ZIP لاستعادة البيانات والمرفقات، أو SQLite لاستعادة البيانات فقط. لا تتغير الشركات الحالية أو ملف النسخة الأصلي.', 'Choose a Manzoma ZIP backup to include attachments, or SQLite for database records only. Existing companies and the original backup file remain unchanged.')}</p>
    </div>
  </Modal>
}
