import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useState } from 'react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { useT } from '@/store/prefs'
import { Button, ErrorBox, Field, Input, Select, Sheet, Textarea } from '@/components/ui'
import { Modal } from '@/components/Dialogs'

export function AddressEditor({ partyId, onSaved }: { partyId: number; onSaved: (id: number) => void }) {
  const t = useT()
  const custom = useDynamicFields('party-addresses')
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<Record<string, unknown>>({ label: '', is_default: false })
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  return <><Button onClick={() => setOpen(true)}>{t('إضافة موقع', 'Add location')}</Button>{open && <Modal title={t('عنوان الخدمة', 'Service address')} onClose={() => { if (!busy) setOpen(false) }} footer={<Button loading={busy} variant="primary" onClick={async () => {
    setBusy(true); setError(null)
    try { const result = await api.post(`/parties/${partyId}/addresses`, { ...value, ...custom.payload() }); invalidate(`/parties/${partyId}/addresses`); onSaved(result.data.id); setOpen(false) } catch (failure) { custom.capture(failure); setError(failure) } finally { setBusy(false) }
  }}>{t('حفظ', 'Save')}</Button>}><div className="grid gap-3">{error ? <ErrorBox error={error} /> : null}
    {custom.renderRecord(value, setValue, undefined, busy, ['core.label', 'core.city', 'core.street', 'core.building', 'core.floor', 'core.apartment', 'core.landmark', 'core.is_default'])}
  </div></Modal>}</>
}

export function ScheduleCorrection({ unit, onSaved }: { unit: any; onSaved: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [schedule, setSchedule] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  return <><Button onClick={() => setOpen(true)}>{t('تصحيح تاريخ الاستبدال', 'Correct replacement history')}</Button>{open && <Modal title={t('تصحيح موثق لجدول الصيانة', 'Audited schedule correction')} onClose={() => setOpen(false)} footer={<Button variant="primary" loading={busy} disabled={!schedule || !date || !reason.trim()} onClick={async () => {
    setBusy(true); setError(null)
    try { await api.post(`/customer-units/${unit.id}/schedule-overrides`, { schedule_id: Number(schedule), last_replaced_on: date, reason }); setOpen(false); onSaved() } catch (failure) { setError(failure) } finally { setBusy(false) }
  }}>{t('حفظ التصحيح', 'Save correction')}</Button>}><div className="grid gap-3">{error ? <ErrorBox error={error} /> : null}
    <Field label={t('المرحلة', 'Stage')}><Select value={schedule} placeholder="—" options={unit.schedules.map((stage: any) => ({ value: stage.id, label: t(stage.label_ar, stage.label_en) }))} onChange={(event) => setSchedule(event.target.value)} /></Field>
    <Field label={t('تاريخ آخر استبدال فعلي', 'Actual last replacement')}><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
    <Field label={t('سبب التصحيح', 'Correction reason')}><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
  </div></Modal>}</>
}

export function TemplateManager() {
  const t = useT()
  const custom = useDynamicFields('message-templates')
  const templates = useApi<any>('/maintenance/templates')
  const [form, setForm] = useState<Record<string, unknown>>({ key: 'maintenance_due', locale: 'ar', body: '' })
  const key = String(form.key ?? ''), locale = String(form.locale ?? 'ar'), body = String(form.body ?? '')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  return <Sheet title={t('قوالب المتابعة اليدوية', 'Manual follow-up templates')} bodyClassName="grid gap-3 p-4">
    {(error || templates.error) ? <ErrorBox error={error || templates.error} /> : null}
    <Select value="" placeholder={t('تعديل قالب موجود', 'Edit an existing template')} options={(templates.data?.data ?? []).map((item: any) => ({ value: item.id, label: `${item.key} (${item.locale}) v${item.version}` }))} onChange={(event) => { const item = templates.data?.data.find((row: any) => row.id === Number(event.target.value)); if (item) { setForm({ key: item.key, locale: item.locale, body: item.body }); custom.setValues(item.custom_fields ?? {}) } }} />
    <p className="muted">{t('المتغيرات المتاحة في نص الرسالة:', 'Available message placeholders:')} <span dir="ltr">{'{{customer}} · {{unit}} · {{stage}} · {{due_date}} · {{company}}'}</span></p>
    {custom.renderRecord(form, setForm, undefined, busy)}
    <Button loading={busy} disabled={!key || !body.trim()} onClick={async () => { setBusy(true); setError(null); try { await api.post('/maintenance/templates', { key, locale, body, ...custom.payload() }); await templates.refetch() } catch (failure) { custom.capture(failure); setError(failure) } finally { setBusy(false) } }}>{t('نشر إصدار جديد', 'Publish new version')}</Button>
  </Sheet>
}
