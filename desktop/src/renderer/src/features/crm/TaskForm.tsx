import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { dateTimeInput, utcDateTime } from '@/features/forms/dateTime'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/query'
import { addDays, today } from '@/lib/format'
import { useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { Modal } from '@/components/Dialogs'
import { Button } from '@/components/ui'

export function TaskForm({ task, leadId, partyId, opportunityId, onClose, onSaved }: { task?: any; leadId?: number; partyId?: number; opportunityId?: number; onClose: () => void; onSaved?: () => void }) {
  const t = useT()
  const custom = useDynamicFields('tasks', task)
  const user = useSession((s) => s.user)
  const [form, setForm] = useState({
    title: task?.title ?? '', notes: task?.notes ?? '', priority: task?.priority ?? 'normal',
    due_at: task?.due_at ? dateTimeInput(task.due_at) : addDays(today(), 1) + 'T10:00',
    reminder: task ? (task.remind_at ? 30 : 0) : 30,
    assigned_to: task?.assigned_to ?? user?.id ?? null,
  })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const due = new Date(form.due_at)
      const remind = form.reminder ? new Date(due.getTime() - form.reminder * 60000) : null
      const body = { ...custom.payload(), title: form.title, notes: form.notes || null, priority: form.priority, due_at: utcDateTime(form.due_at), remind_at: remind ? remind.toISOString() : null, assigned_to: form.assigned_to, lead_id: task?.lead_id ?? leadId, party_id: task?.party_id ?? partyId, opportunity_id: task?.opportunity_id ?? opportunityId }
      task ? await api.put(`/crm/tasks/${task.id}`, body) : await api.post('/crm/tasks', body)
      invalidate('/crm', '/parties')
      toast.success(t('تم حفظ المتابعة', 'Follow-up saved'))
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
    <Modal title={task ? t('تعديل المتابعة', 'Edit follow-up') : t('متابعة جديدة', 'New follow-up')} onClose={onClose} footer={<><Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length || !form.title.trim()} onClick={save}>{t('حفظ', 'Save')}</Button></>}>
      {custom.renderRecord(form, (next) => setForm(next as typeof form), DOMAIN_FORM_WIDGETS)}
    </Modal>
  )
}
