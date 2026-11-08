import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarPlus, Handshake, Pencil, UserCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { date, datetime, money } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { Button, ErrorBox, Kv, Money, Pill, Sheet, Spinner } from '@/components/ui'
import { StatusPill } from '@/components/Status'
import { confirmDialog } from '@/components/Dialogs'
import { ActivityForm, ACTIVITY_TYPES } from './ActivityForm'
import { TaskForm } from './TaskForm'
import { LeadForm } from './LeadForm'
import { DealForm } from './Pipeline'

export default function LeadView() {
  const t = useT()
  const allowed = useCan()
  const { params } = useTab()
  const lead = useApi<any>(`/crm/leads/${params.id}`)
  const activities = useApi<any>('/crm/activities', { lead_id: params.id, per_page: 50 })
  const tasks = useApi<any>('/crm/tasks', { lead_id: params.id, status: 'open', per_page: 50 })
  const [modal, setModal] = useState<'edit' | 'activity' | 'task' | 'deal' | null>(null)
  const l = lead.data?.data
  useTabTitle(l ? l.company_name || l.name : undefined)
  if (lead.isLoading) return <Spinner />
  if (lead.error) return <ErrorBox error={lead.error} />

  const convert = async () => {
    const ok = await confirmDialog({ title: t('تحويل إلى عميل', 'Convert to customer'), message: t('سيتم إنشاء حساب عميل بنفس البيانات، وتنتقل إليه الصفقات والأنشطة.', 'A customer account is created with these details; deals and activities move to it.'), confirmLabel: t('تحويل', 'Convert') })
    if (!ok) return
    try {
      const r = await api.post(`/crm/leads/${l.id}/convert`, {})
      invalidate('/crm', '/parties')
      toast.success(t('تم إنشاء العميل', 'Customer created'))
      void lead.refetch()
      navigate(`/parties/view/${r.data.party_id}`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--rule)' }}>
        <div>
          <div className="flex items-center gap-2"><h1 className="m-0 text-[20px] font-semibold">{l.company_name || l.name}</h1><StatusPill status={l.status} /></div>
          <div className="muted mt-1 text-[12px]">{l.company_name && l.name} {l.mobile && <span className="num">· {l.mobile}</span>} {l.city && `· ${l.city}`} · {t('المسؤول', 'Owner')}: {l.owner?.name ?? '—'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {allowed('crm.manage') && <Button icon={CalendarPlus} onClick={() => setModal('activity')}>{t('تسجيل نشاط', 'Log activity')}</Button>}
          {allowed('crm.manage') && <Button icon={Handshake} onClick={() => setModal('deal')}>{t('صفقة جديدة', 'New deal')}</Button>}
          {allowed('crm.manage') && <Button icon={Pencil} onClick={() => setModal('edit')}>{t('تعديل', 'Edit')}</Button>}
          {l.status !== 'converted' && allowed(['customers.manage']) && <Button variant="primary" icon={UserCheck} onClick={convert}>{t('تحويل إلى عميل', 'Convert to customer')}</Button>}
          {l.party && <Button onClick={() => navigate(`/parties/view/${l.party.id}`)}>{t('فتح حساب العميل', 'Open customer')}</Button>}
        </div>
      </div>
      <div className="grid gap-4 px-5 pt-4" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        <div className="grid content-start gap-4">
          <Sheet title={t('سجل التواصل', 'Contact history')} bodyClassName="px-4 py-2">
            {(activities.data?.data ?? []).length === 0 ? <div className="muted py-3">{t('سجّل أول مكالمة أو زيارة مع هذا العميل.', 'Log the first call or visit with this lead.')}</div> : activities.data.data.map((a: any) => {
              const type = ACTIVITY_TYPES.find((x) => x.value === a.type)
              return (
                <div key={a.id} className="flex gap-3 py-2" style={{ borderBottom: '1px solid var(--rule)' }}>
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: 'var(--ledger-soft)', color: 'var(--ledger)' }}>{type && <type.icon size={13} />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2"><span className="font-medium">{a.subject}</span><span className="num muted text-[11px]">{datetime(a.occurred_at)}</span></div>
                    {a.body && <div className="whitespace-pre-wrap text-[12px]">{a.body}</div>}
                    <div className="muted text-[11px]">{a.user?.name}{a.outcome ? ` · ${a.outcome}` : ''}</div>
                  </div>
                </div>
              )
            })}
          </Sheet>
        </div>
        <div className="grid content-start gap-4">
          <Sheet title={t('البيانات', 'Details')} bodyClassName="px-4 py-2">
            <Kv label={t('التقييم', 'Score')}><span className="num">{l.score}/100</span></Kv>
            <Kv label={t('القيمة المتوقعة', 'Expected value')}><Money value={l.expected_value} /></Kv>
            <Kv label={t('المصدر', 'Source')}>{nameOf(l.source) || '—'}</Kv>
            {l.email && <Kv label={t('البريد', 'Email')}><span dir="ltr">{l.email}</span></Kv>}
            {l.address && <Kv label={t('العنوان', 'Address')}>{l.address}</Kv>}
            <Kv label={t('أضيف في', 'Added')}><span className="num">{date(l.created_at)}</span></Kv>
            {l.notes && <p className="muted my-2 whitespace-pre-wrap">{l.notes}</p>}
          </Sheet>
          <Sheet title={t('المتابعات', 'Follow-ups')} actions={allowed('crm.manage') && <Button size="sm" variant="ghost" onClick={() => setModal('task')}>{t('إضافة', 'Add')}</Button>} bodyClassName="px-4 py-2">
            {(tasks.data?.data ?? []).length === 0 ? <div className="muted py-2">{t('لا توجد متابعات مفتوحة', 'No open follow-ups')}</div> : tasks.data.data.map((tk: any) => <Kv key={tk.id} label={<span className="num">{datetime(tk.due_at)}</span>}>{tk.title}</Kv>)}
          </Sheet>
          <Sheet title={t('الصفقات', 'Deals')} bodyClassName="px-4 py-2">
            {(l.opportunities ?? []).length === 0 ? <div className="muted py-2">{t('لا توجد صفقات', 'No deals')}</div> : l.opportunities.map((o: any) => <Kv key={o.id} label={o.title}><span className="inline-flex items-center gap-2"><span className="num">{money(o.value)}</span><Pill>{nameOf(o.stage)}</Pill></span></Kv>)}
          </Sheet>
        </div>
      </div>
      {modal === 'edit' && <LeadForm lead={l} onClose={() => setModal(null)} onSaved={() => lead.refetch()} />}
      {modal === 'activity' && <ActivityForm leadId={l.id} onClose={() => setModal(null)} onSaved={() => { void activities.refetch(); void tasks.refetch(); void lead.refetch() }} />}
      {modal === 'task' && <TaskForm leadId={l.id} onClose={() => setModal(null)} onSaved={() => tasks.refetch()} />}
      {modal === 'deal' && <DealForm leadId={l.id} defaultTitle={l.company_name || l.name} defaultValue={Number(l.expected_value)} onClose={() => setModal(null)} onSaved={() => lead.refetch()} />}
    </div>
  )
}
