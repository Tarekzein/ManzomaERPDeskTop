import { useState } from 'react'
import type { CompanyProfile, CreateLocalCompanyInput } from '@shared/types'
import { platform } from '@/lib/platform'
import { usePrefs, useT } from '@/store/prefs'
import { Button, Field, Input, NumberInput, Select } from '@/components/ui'
import { Modal } from '@/components/Dialogs'

/** Creates a company file on this PC: company details and the first administrator. */
export function SetupWizard({ onClose, onCreated, mode = 'local' }: { mode?: 'local' | 'server'; onClose: () => void; onCreated: (p: CompanyProfile) => void }) {
  const t = useT()
  const locale = usePrefs((s) => s.locale)
  const [step, setStep] = useState<1 | 2>(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CreateLocalCompanyInput>({
    name: '', nameEn: '', currency: 'EGP', vatRate: 14, taxNumber: '', adminName: '', adminUsername: 'admin', adminPassword: '', locale, demo: false,
  })
  const [confirm, setConfirm] = useState('')
  const set = (patch: Partial<CreateLocalCompanyInput>) => setForm((f) => ({ ...f, ...patch }))

  const create = async () => {
    if (!form.name.trim() || !form.adminName.trim() || !form.adminUsername.trim()) return setError(t('أدخل اسم الشركة والمدير واسم المستخدم.', 'Enter the company name, administrator name and username.'))
    if (form.adminPassword.length < 6) return setError(t('كلمة المرور 6 أحرف على الأقل.', 'The password needs at least 6 characters.'))
    if (form.adminPassword !== confirm) return setError(t('كلمتا المرور غير متطابقتين.', 'The passwords do not match.'))
    setBusy(true)
    setError(null)
    try {
      const input = {...form,name:form.name.trim(),nameEn:form.nameEn?.trim(),adminName:form.adminName.trim(),adminUsername:form.adminUsername.trim()}
      onCreated(await (mode === 'server' ? platform.profiles.createServer(input) : platform.profiles.createLocal(input)))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'server' ? t('تسجيل شركة أونلاين', 'Register an online company') : t('شركة جديدة على هذا الجهاز', 'New company on this PC')}
      onClose={busy ? () => undefined : onClose}
      size="wide"
      footer={
        step === 1 ? (
          <>
            <Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
            <Button variant="primary" disabled={!form.name.trim()} onClick={() => setStep(2)}>{t('التالي: المدير', 'Next: administrator')}</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep(1)} disabled={busy}>{t('رجوع', 'Back')}</Button>
            <Button variant="primary" loading={busy} onClick={create}>{busy ? t('جارٍ إنشاء الشركة…', 'Creating the company…') : t('إنشاء الشركة', 'Create company')}</Button>
          </>
        )
      }
    >
      {error && <div role="alert" className="mb-3 rounded-md p-2" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>{error}</div>}
      <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">{step === 1 ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('اسم الشركة بالعربية', 'Company name (Arabic)')} className="col-span-2">
            <Input autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="شركة فلاتر المياه" />
          </Field>
          <Field label={t('اسم الشركة بالإنجليزية', 'Company name (English)')} className="col-span-2">
            <Input value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('العملة الأساسية', 'Base currency')}>
            <Select value={form.currency} onChange={(e) => set({ currency: e.target.value })} options={[{ value: 'EGP', label: t('جنيه مصري', 'Egyptian pound') }, { value: 'SAR', label: t('ريال سعودي', 'Saudi riyal') }, { value: 'AED', label: t('درهم إماراتي', 'UAE dirham') }, { value: 'USD', label: t('دولار أمريكي', 'US dollar') }]} />
          </Field>
          <Field label={t('نسبة ضريبة القيمة المضافة %', 'VAT rate %')}>
            <NumberInput value={form.vatRate} onChange={(v) => set({ vatRate: v })} />
          </Field>
          <Field label={t('رقم التسجيل الضريبي', 'Tax registration no.')}>
            <Input value={form.taxNumber} onChange={(e) => set({ taxNumber: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('لغة المستخدم الأول', 'First user language')}>
            <Select value={form.locale} onChange={(e) => set({ locale: e.target.value as 'ar' | 'en' })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
          </Field>
          <p className="col-span-2 m-0 muted text-[12px]">{mode === 'server' ? t('تُحفظ الشركة على خادم الترخيص وتحتاج إلى الإنترنت. يشاركها مستخدمو الأجهزة المرخصة.', 'The company is stored on your license server and needs internet. Licensed devices can share it.') : t('هذا هو الكمبيوتر الرئيسي للشركة. يلزم الاتصال بالإنترنت لإنشائها أول مرة، وبعدها تعمل دون إنترنت ويمكن مشاركة نفس البيانات مع أجهزة الموظفين على الشبكة المحلية.', 'This is the company’s main computer. Initial creation needs the issuer connection; afterward it works offline and can share the same data with staff over the LAN.')}</p>
          <p className="col-span-2 m-0 text-[12px]" style={{ color: 'var(--brand)' }}>{t('بعد تسجيل الدخول سيفتح دليل لإكمال بيانات الشركة خطوة بخطوة.', 'After signing in, a guide will help you finish setting up the company step by step.')}</p>
          <p className="col-span-2 m-0 muted text-[12px]">{t('سيتم إنشاء دليل حسابات مصري جاهز، والضرائب، والفرع والمخزن والخزينة الرئيسية تلقائياً.', 'A ready Egyptian chart of accounts, taxes, and the main branch, warehouse and cash box are created automatically.')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('اسم مدير النظام', 'Administrator name')} className="col-span-2">
            <Input autoFocus value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} />
          </Field>
          <Field label={t('اسم المستخدم', 'User name')}>
            <Input value={form.adminUsername} onChange={(e) => set({ adminUsername: e.target.value })} dir="ltr" />
          </Field>
          <div />
          <Field label={t('كلمة المرور', 'Password')}>
            <Input type="password" value={form.adminPassword} onChange={(e) => set({ adminPassword: e.target.value })} />
          </Field>
          <Field label={t('تأكيد كلمة المرور', 'Confirm password')}>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
      )}</fieldset>
    </Modal>
  )
}
