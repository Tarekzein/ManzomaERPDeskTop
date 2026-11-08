import { useEffect, useState } from 'react'
import type { LicenseStatus } from '@shared/types'
import { platform } from '@/lib/platform'
import { useT } from '@/store/prefs'
import { Modal } from '@/components/Dialogs'
import { Button, ErrorBox, Field, Input, Pill } from '@/components/ui'
import { datetime } from '@/lib/format'
import { serverSettings } from '@shared/serverSettings'
import { userErrorMessage } from '@shared/userError'
import { usePrefs } from '@/store/prefs'

export function LicenseDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  return <Modal title={t('ترخيص التطبيق', 'Application license')} onClose={onClose} footer={<Button onClick={onClose}>{t('إغلاق', 'Close')}</Button>}><LicenseContent /></Modal>
}

export function LicenseContent({ onVerified }: { onVerified?: () => void }) {
  const t = useT()
  const locale = usePrefs(state => state.locale)
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [server, setServer] = useState(serverSettings.licenseServerUrl || 'https://')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [message, setMessage] = useState('')
  useEffect(() => { void platform.licensing.status().then(value => { setStatus(value); if (value.issuer) setServer(value.issuer) }).catch(setError) }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage('')
    try { await action(); const current = await platform.licensing.status(); setStatus(current); window.dispatchEvent(new Event('erp:license-changed')); if (current.valid) onVerified?.() } catch (failure) { setError(failure) } finally { setBusy(false) }
  }
  return <div className="grid gap-5" aria-busy={busy || undefined}>
      {error ? <ErrorBox error={error} /> : null}
      {message && <p role="status">{message}</p>}
      {status && <div className="grid gap-2 rounded-lg border p-4" style={{ borderColor: 'var(--rule)' }}>
        <Pill tone={status.valid ? 'green' : 'red'}>{status.required ? status.valid ? t('مرخص', 'Licensed') : t('يتطلب التفعيل', 'Activation required') : t('وضع التطوير — الترخيص غير مفروض', 'Development — licensing not enforced')}</Pill>
        {status.customerName && <strong>{status.customerName}</strong>}
        {status.expiresAt && <span>{t('ينتهي في: ', 'Expires: ')}{datetime(status.expiresAt)}</span>}
        {status.companies && <span>{t('حد الشركات المشترك: ', 'Shared company limit: ')}{status.companies} · {t('حد الأجهزة: ', 'Device limit: ')}{status.devices}</span>}
        <span>{t('شركة واحدة لكل جهاز؛ الأجهزة المتصلة بنفس الشركة لا تستهلك شركات إضافية.','One company per device; devices sharing the same company do not use extra company capacity.')}</span>
        {status.assignment && <strong>{t('شركة هذا الجهاز: ','This device’s company: ')}{status.assignment.name}</strong>}
        {status.offlineSlots !== undefined && <span>{t('سعة الشركات المحلية المخصصة لهذا الجهاز: ', 'Local company capacity assigned to this device: ')}{status.offlineSlots}</span>}
        {status.localCompanies !== undefined && <div className="grid gap-2 border-t pt-3 text-[13px]" style={{ borderColor: 'var(--rule)' }}>
          <span>{t('الشركات المحلية الفعلية: ', 'Actual local companies: ')}<strong>{status.localCompanies}</strong> · {t('سعة محجوزة غير مستخدمة: ', 'Unused assigned capacity: ')}{status.unusedLocalSlots}</span>
          {!!status.unconfirmedLocalCompanies && <span role="status">{t('شركات تنتظر تأكيد التسجيل عند الاتصال: ', 'Companies awaiting registration confirmation online: ')}{status.unconfirmedLocalCompanies}</span>}
          <span className="muted">{t('آخر تأكيد مع الخادم: ', 'Last server confirmation: ')}{status.lastCompanyConfirmation ? datetime(status.lastCompanyConfirmation) : t('لم يتم بعد', 'Not yet confirmed')}</span>
          {status.companySyncFailed && <span className="muted">{t('تعذر تأكيد الشركات حالياً. ستتم إعادة المحاولة عند الاتصال، ويستمر العمل المحلي حتى انتهاء الترخيص.', 'Company confirmation is pending a connection. Local work remains available until license expiry.')}</span>}
        </div>}
        {status.error && <small className="error">{userErrorMessage(status.error, locale)}</small>}
      </div>}
      <fieldset disabled={busy} className="m-0 grid min-w-0 gap-4 border-0 p-0">
        <div className="grid gap-3">
          <h3 className="m-0 text-[14px] font-semibold">{t('الصق المفتاح وفعّل التطبيق', 'Paste your key and activate')}</h3>
          <p className="m-0 text-[13px] muted">{t('اتصل بالإنترنت للتفعيل أول مرة. إذا كان ترخيصك يدعم الأوفلاين، يمكنك بعدها استخدام التطبيق دون إنترنت حتى تاريخ انتهاء الترخيص.', 'Connect to the internet for initial activation. If your license includes offline use, you can then work without internet until the license expires.')}</p>
          <Field label={t('مفتاح التفعيل', 'Activation key')} hint={t('انسخ المفتاح كاملاً من مسؤول الترخيص والصقه هنا. يتضمن عنوان الخادم ولا يُحفظ بعد التفعيل.', 'Copy the complete key from your license administrator and paste it here. It includes the server address and is not kept after activation.')}><Input dir="ltr" type="password" autoComplete="off" maxLength={4096} placeholder="MZ1.…" value={key} onChange={event => setKey(event.target.value)} /></Field>
          <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!key.trim()} onClick={() => void run(async () => { await platform.licensing.activate(server,key.trim()); setKey(''); setMessage(t('تم تفعيل الجهاز. يمكنك الآن اختيار شركتك أو استيراد بياناتها ثم تسجيل الدخول.', 'Device activated. Choose or import your company, then sign in.')) })}>{busy ? t('جارٍ التحقق…', 'Verifying…') : t('تفعيل هذا الجهاز', 'Activate this device')}</Button>
            {status?.valid && <Button onClick={() => void run(async () => { const refreshed = await platform.licensing.refresh(); if (!refreshed.valid) throw new Error(refreshed.error); setMessage(t('تم تحديث الترخيص.', 'License refreshed.')) })}>{t('تحديث الترخيص عبر الإنترنت', 'Refresh license online')}</Button>}</div>
        </div>
        <details className="border-t pt-4" style={{ borderColor: 'var(--rule)' }}>
          <summary className="cursor-pointer text-[12px] muted">{t('لديك مفتاح من إصدار سابق؟', 'Using a key from an earlier version?')}</summary>
          <div className="mt-3"><Field label={t('عنوان خادم الترخيص للمفاتيح القديمة فقط', 'License server address for legacy keys only')}><Input dir="ltr" type="url" value={server} onChange={event => setServer(event.target.value)} /></Field></div>
        </details>
      </fieldset>
  </div>
}
