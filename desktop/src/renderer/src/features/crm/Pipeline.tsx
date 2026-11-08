import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, FileText, Plus, User } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { date, money, today } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useCan, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { Button, Check, ErrorBox, Field, PageHeader, Spinner, Textarea } from '@/components/ui'
import { Modal } from '@/components/Dialogs'

/**
 * Deals by stage. Drag a card to move it; dropping on "Lost" asks why.
 */
export default function Pipeline() {
  const t = useT()
  const allowed = useCan()
  const [mine, setMine] = useState(false)
  const board = useApi<any>('/crm/board', { mine: mine ? 1 : undefined })
  const reasons = useSession((s) => s.lookups?.crm_lost_reasons ?? [])
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [lost, setLost] = useState<{ deal: any; stageId: number } | null>(null)
  const [form, setForm] = useState<any | null>(null)

  const move = async (deal: any, stageId: number, extra: any = {}) => {
    try {
      await api.post(`/crm/opportunities/${deal.id}/move`, { stage_id: stageId, ...extra })
      invalidate('/crm')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const quote = async (deal: any) => {
    try {
      const r = await api.post(`/crm/opportunities/${deal.id}/quotation`)
      invalidate('/crm')
      navigate(`/docs/sales_quotation/${r.data.id}`)
    } catch (e: any) {
      if (e.context?.quotation_id) navigate(`/docs/sales_quotation/${e.context.quotation_id}`)
      else toast.error(e.message)
    }
  }

  if (board.isLoading) return <Spinner />
  if (board.error) return <ErrorBox error={board.error} />
  const { stages, summary } = board.data

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('مسار الصفقات', 'Pipeline')}
        subtitle={<span>{summary.open_count} {t('صفقة مفتوحة', 'open deals')} · {t('القيمة', 'value')} <span className="num">{money(summary.open_value)}</span> · {t('المرجّحة', 'weighted')} <span className="num">{money(summary.weighted_value)}</span></span>}
        actions={<>
          {allowed('crm.view_all') && <Check checked={mine} onChange={setMine} label={t('صفقاتي فقط', 'My deals only')} />}
          {allowed('crm.manage') && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>{t('صفقة جديدة', 'New deal')}</Button>}
        </>}
      />
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-4">
        {stages.map((stage: any) => (
          <div
            key={stage.id}
            className={`kanban-col flex w-[272px] shrink-0 flex-col ${over === stage.id ? 'drop' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(stage.id) }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(null)
              const deal = stages.flatMap((s: any) => s.deals).find((d: any) => d.id === dragging)
              setDragging(null)
              if (!deal || deal.stage_id === stage.id) return
              if (stage.is_lost) setLost({ deal, stageId: stage.id })
              else void move(deal, stage.id)
            }}
          >
            <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2" style={{ borderTop: `3px solid ${stage.color ?? 'var(--rule-strong)'}`, borderRadius: '10px 10px 0 0' }}>
              <div className="font-semibold">{nameOf(stage)}</div>
              <div className="text-end text-[11px] muted"><div className="num">{money(stage.total)}</div><div>{stage.deals.length} · {stage.probability}%</div></div>
            </div>
            <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-2 pb-2">
              {stage.deals.map((deal: any) => (
                <div key={deal.id} draggable={allowed('crm.manage')} className={`deal ${dragging === deal.id ? 'dragging' : ''}`} onDragStart={() => setDragging(deal.id)} onDragEnd={() => setDragging(null)} onDoubleClick={() => setForm(deal)}>
                  <div className="font-medium leading-snug">{deal.title}</div>
                  <div className="muted mt-0.5 flex items-center gap-1 text-[12px]"><User size={11} />{deal.party ? nameOf(deal.party) : deal.lead?.company_name || deal.lead?.name}</div>
                  <div className="mt-1.5 flex items-center justify-between text-[12px]">
                    <span className="num font-semibold">{money(deal.value)}</span>
                    {deal.expected_close_date && <span className={`num inline-flex items-center gap-1 ${deal.status === 'open' && deal.expected_close_date < today() ? 'neg' : 'muted'}`}><CalendarClock size={11} />{date(deal.expected_close_date)}</span>}
                  </div>
                  {deal.status === 'lost' && deal.lost_reason && <div className="mt-1 text-[11px] neg">{nameOf(deal.lost_reason)}</div>}
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="muted text-[11px]">{deal.owner?.name}</span>
                    {deal.status !== 'lost' && allowed('sales.quotations') && (
                      <button className="btn btn-ghost btn-sm" onClick={() => quote(deal)}><FileText size={12} />{deal.quotation ? deal.quotation.number : t('عرض سعر', 'Quote')}</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {lost && <LostDialog reasons={reasons} onClose={() => setLost(null)} onConfirm={(reason, note) => { void move(lost.deal, lost.stageId, { lost_reason_id: reason, lost_note: note }); setLost(null) }} />}
      {form && <DealForm deal={form.id ? form : undefined} onClose={() => setForm(null)} onSaved={() => board.refetch()} />}
    </div>
  )
}

function LostDialog({ reasons, onClose, onConfirm }: { reasons: any[]; onClose: () => void; onConfirm: (reason: number, note: string) => void }) {
  const t = useT()
  const [reason, setReason] = useState<number | null>(null)
  const [note, setNote] = useState('')
  return (
    <Modal title={t('لماذا خسرنا الصفقة؟', 'Why was the deal lost?')} onClose={onClose} footer={<><Button onClick={onClose}>{t('رجوع', 'Back')}</Button><Button variant="danger" disabled={!reason} onClick={() => onConfirm(reason!, note)}>{t('تسجيل الخسارة', 'Mark as lost')}</Button></>}>
      <div className="grid gap-2">
        {reasons.map((r) => (
          <label key={r.id} className="check rounded-md px-2 py-1.5" style={{ background: reason === r.id ? 'var(--red-soft)' : undefined }}>
            <input type="radio" name="reason" checked={reason === r.id} onChange={() => setReason(r.id)} />
            <span>{nameOf(r)}</span>
          </label>
        ))}
        <Field label={t('تفاصيل (اختياري)', 'Details (optional)')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

export function DealForm({ deal, leadId, partyId, defaultTitle, defaultValue, onClose, onSaved }: { deal?: any; leadId?: number; partyId?: number; defaultTitle?: string; defaultValue?: number; onClose: () => void; onSaved?: () => void }) {
  const t = useT()
  const custom = useDynamicFields('opportunities', deal)
  const stages = useSession((s) => s.lookups?.crm_stages ?? [])
  const [form, setForm] = useState<any>({
    title: deal?.title ?? defaultTitle ?? '', value: deal?.value ?? defaultValue ?? 0, stage_id: deal?.stage_id ?? stages.find((s: any) => !s.is_won && !s.is_lost)?.id,
    party: deal?.party, party_id: deal?.party_id ?? partyId ?? null, lead_id: deal?.lead_id ?? leadId ?? null, owner_id: deal?.owner_id ?? null,
    expected_close_date: deal?.expected_close_date ?? '', notes: deal?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const body = { ...form, ...custom.payload(), expected_close_date: form.expected_close_date || null }
      deal ? await api.put(`/crm/opportunities/${deal.id}`, body) : await api.post('/crm/opportunities', body)
      invalidate('/crm')
      toast.success(t('تم حفظ الصفقة', 'Deal saved'))
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
    <Modal title={deal ? t('تعديل صفقة', 'Edit deal') : t('صفقة جديدة', 'New deal')} onClose={onClose} footer={<><Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length} onClick={save}>{t('حفظ', 'Save')}</Button></>}>
      {custom.renderRecord(form, setForm, DOMAIN_FORM_WIDGETS)}
    </Modal>
  )
}
