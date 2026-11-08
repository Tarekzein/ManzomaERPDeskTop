import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/query'
import { useT } from '@/store/prefs'
import { Modal } from '@/components/Dialogs'
import { Button } from '@/components/ui'

export function LeadForm({ lead, onClose, onSaved }: { lead?: any; onClose: () => void; onSaved?: (l: any) => void }) {
  const t = useT()
  const custom = useDynamicFields('leads', lead)
  const [form, setForm] = useState<any>({
    name: lead?.name ?? '', company_name: lead?.company_name ?? '', mobile: lead?.mobile ?? '', phone: lead?.phone ?? '', email: lead?.email ?? '',
    city: lead?.city ?? '', address: lead?.address ?? '', source_id: lead?.source_id ?? null, owner_id: lead?.owner_id ?? null,
    status: lead?.status && lead.status !== 'converted' ? lead.status : 'new', expected_value: lead?.expected_value ?? 0, notes: lead?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const body = { ...form, ...custom.payload(), email: form.email || null }
      const r = lead ? await api.put(`/crm/leads/${lead.id}`, body) : await api.post('/crm/leads', body)
      invalidate('/crm')
      toast.success(t('تم الحفظ', 'Saved'))
      onSaved?.(r.data)
      onClose()
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={lead ? t('تعديل عميل محتمل', 'Edit lead') : t('عميل محتمل جديد', 'New lead')} onClose={onClose} size="wide" footer={<><Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length || !form.name.trim()} onClick={save}>{t('حفظ', 'Save')}</Button></>}>
      {custom.renderRecord(form, setForm, DOMAIN_FORM_WIDGETS)}
    </Modal>
  )
}
