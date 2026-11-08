import { useState } from 'react'
import { platform } from '@/lib/platform'
import { useT } from '@/store/prefs'
import { Modal } from '@/components/Dialogs'
import { Button, ErrorBox, Field, Textarea } from '@/components/ui'
import type { CompanyProfile } from '@shared/types'

export function LanConnectDialog({onClose,onConnected}:{onClose:()=>void;onConnected:(profile:CompanyProfile)=>void}) {
  const t=useT(),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null)
  return <Modal title={t('الاتصال بالكمبيوتر الرئيسي','Connect to the main computer')} onClose={onClose}
    footer={<><Button onClick={onClose} disabled={busy}>{t('رجوع','Back')}</Button><Button variant="primary" loading={busy} disabled={!code.trim()} onClick={async()=>{
      setBusy(true);setError(null)
      try {onConnected(await platform.profiles.joinLan(code))} catch(failure){setError(failure)} finally {setBusy(false)}
    }}>{t('ربط هذا الجهاز','Pair this device')}</Button></>}>
    <p className="mt-0 muted">{t('الصق رمز المشاركة من إعدادات الكمبيوتر الرئيسي. يلزم الإنترنت للربط أول مرة، وبعده تعمل أجهزة الشبكة المحلية دون إنترنت حتى انتهاء الترخيص.','Paste the sharing code from the main computer settings. Initial pairing needs internet; afterward LAN devices work without internet until license expiry.')}</p>
    {error ? <ErrorBox error={error}/> : null}
    <Field label={t('رمز الربط','Pairing code')} hint={t('استخدم نفس ترخيص الشركة على كل الأجهزة. لا تنشئ شركة جديدة على أجهزة الموظفين.','Use the same company license on every device. Do not create another company on staff computers.')}>
      <Textarea autoFocus dir="ltr" rows={4} value={code} disabled={busy} maxLength={32000} placeholder="MZLAN1.…" onChange={event=>setCode(event.target.value)}/>
    </Field>
  </Modal>
}
