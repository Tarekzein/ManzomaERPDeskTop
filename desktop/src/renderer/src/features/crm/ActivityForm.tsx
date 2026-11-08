import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { dateTimeInput, utcDateTime } from '@/features/forms/dateTime'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useState } from 'react'
import { toast } from 'sonner'
import { MessageCircle, Phone, Users, MapPin, Mail, StickyNote } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/query'
import { addDays, today } from '@/lib/format'
import { useT } from '@/store/prefs'
import { Modal } from '@/components/Dialogs'
import { Button } from '@/components/ui'

export const ACTIVITY_TYPES = [
  { value: 'call', ar: 'مكالمة', en: 'Call', icon: Phone },
  { value: 'whatsapp', ar: 'واتساب', en: 'WhatsApp', icon: MessageCircle },
  { value: 'visit', ar: 'زيارة', en: 'Visit', icon: MapPin },
  { value: 'meeting', ar: 'اجتماع', en: 'Meeting', icon: Users },
  { value: 'email', ar: 'بريد', en: 'Email', icon: Mail },
  { value: 'note', ar: 'ملاحظة', en: 'Note', icon: StickyNote },
]

/** Log a call/visit and book the next step in the same form. */
export function ActivityForm({ leadId, partyId, opportunityId, onClose, onSaved }: { leadId?: number; partyId?: number; opportunityId?: number; onClose: () => void; onSaved?: () => void }) {
  const t = useT()
  const custom = useDynamicFields('activities')
  const [form, setForm] = useState({ type: 'call', subject: '', body: '', outcome: '', duration_minutes: 0, occurred_at: dateTimeInput(new Date().toISOString()), follow_up: { title: '', due_at: addDays(today(), 2) + 'T11:00' } as { title: string; due_at: string } | null })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const activityType = ACTIVITY_TYPES.find((item) => item.value === form.type)
      await api.post('/crm/activities', { ...custom.payload(),
        ...form, outcome: form.outcome || null, duration_minutes: form.duration_minutes || null, occurred_at: utcDateTime(form.occurred_at),
        subject: form.subject || (activityType ? t(activityType.ar, activityType.en) : ''),
        lead_id: leadId, party_id: partyId, opportunity_id: opportunityId,
        follow_up: form.follow_up?.title ? { title: form.follow_up.title, due_at: utcDateTime(form.follow_up.due_at) } : undefined,
      })
      invalidate('/crm', '/parties')
      toast.success(t('تم تسجيل النشاط', 'Activity logged'))
      onSaved?.()
      onClose()
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={t('تسجيل نشاط', 'Log activity')} onClose={onClose} footer={<><Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length} onClick={save}>{t('حفظ', 'Save')}</Button></>}>
      {custom.renderRecord(form, (next) => setForm(next as typeof form), DOMAIN_FORM_WIDGETS)}
    </Modal>
  )
}
