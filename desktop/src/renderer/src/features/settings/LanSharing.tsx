import { useEffect, useState } from 'react'
import { platform } from '@/lib/platform'
import { useT } from '@/store/prefs'
import { useSession, useCan } from '@/store/session'
import { Button, ErrorBox, Field, NumberInput, Select, Sheet, Textarea } from '@/components/ui'

export function LanSharing() {
  const t=useT(),can=useCan(),profile=useSession(state=>state.profile)
  const [status,setStatus]=useState<{enabled:boolean;urls:string[];port:number}|null>(null)
  const [port,setPort]=useState(9443),[url,setUrl]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[error,setError]=useState<unknown>(null)
  useEffect(()=>{let cancelled=false;void platform.lan.status().then(value=>{if(!cancelled){setStatus(value);setPort(value.port);setUrl(value.urls[0]??'')}}).catch(failure=>{if(!cancelled)setError(failure)});return()=>{cancelled=true}},[])
  if(profile?.mode!=='local'||!can('settings.manage'))return null
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError(null);try{await action()}catch(failure){setError(failure)}finally{setBusy(false)}}
  return <Sheet title={t('مشاركة الشركة على الشبكة المحلية','Share this company on the local network')} bodyClassName="grid gap-4 p-4">
    <p className="m-0 muted">{t('هذا هو الكمبيوتر الرئيسي. تصل أجهزة الموظفين إلى نفس قاعدة البيانات عبر اتصال مشفر، ولكل جهاز شركة واحدة. يجب أن يبقى الكمبيوتر الرئيسي مفتوحاً والشركة قيد التشغيل.','This is the main computer. Staff devices use the same database through an encrypted connection, with one company per device. Keep this computer on and the company open.')}</p>
    {error ? <ErrorBox error={error}/> : null}
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('منفذ الشبكة','Network port')}><NumberInput value={port} disabled={busy||status?.enabled} onChange={setPort}/></Field>
      <Button variant={status?.enabled?'default':'primary'} loading={busy} disabled={!status} onClick={()=>void run(async()=>{const next=await platform.lan.configure(!status?.enabled,port);setStatus(next);setUrl(next.urls[0]??'');setCode('');setCopied(false)})}>{status?.enabled?t('إيقاف المشاركة','Stop sharing'):t('تفعيل المشاركة','Enable sharing')}</Button>
    </div>
    {status?.enabled && <>
      {status.urls.length ? <Field label={t('عنوان الكمبيوتر الرئيسي','Main computer address')} hint={t('ثبت عنوانه في إعدادات الراوتر، واسمح بمنفذ الشبكة في جدار الحماية للشبكة الخاصة فقط.','Reserve this address in your router and allow the port in the firewall for private networks only.')}><Select dir="ltr" value={url} options={status.urls.map(value=>({value,label:value}))} onChange={event=>{setUrl(event.target.value);setCode('');setCopied(false)}}/></Field> : <p role="status">{t('اتصل بشبكة Wi-Fi أو كابل شبكة محلي لإظهار عنوان المشاركة.','Connect to Wi-Fi or Ethernet to show the sharing address.')}</p>}
      <div><Button disabled={busy||!url} onClick={()=>void run(async()=>{setCode(await platform.lan.invitation(url));setCopied(false)})}>{t('إنشاء رمز الربط','Generate pairing code')}</Button></div>
      {code && <Field label={t('رمز الربط','Pairing code')} hint={t('فعّل ترخيص الشركة على الجهاز الآخر ثم اختر الاتصال بالكمبيوتر الرئيسي والصق الرمز. يلزم الإنترنت للربط الأول فقط.','Activate the company license on the other device, choose Connect to the main computer and paste this code. Internet is needed for initial pairing only.')}>
        <Textarea dir="ltr" rows={3} readOnly value={code} onFocus={event=>event.target.select()}/>
        <div className="mt-2"><Button onClick={()=>void run(async()=>{await navigator.clipboard.writeText(code);setCopied(true)})}>{copied?t('تم النسخ','Copied'):t('نسخ الرمز','Copy code')}</Button></div>
      </Field>}
    </>}
  </Sheet>
}
