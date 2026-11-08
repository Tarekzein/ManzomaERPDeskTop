import { useRef, useState } from 'react'
import { api } from '@/lib/api'
import { today, date, datetime } from '@/lib/format'
import { useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { can } from '@/store/session'
import { Button, Check, ErrorBox, Field, Input, Select, Sheet, Textarea } from '@/components/ui'

export function VisitCorrections({ visit, onSaved, onBusy }: { visit: any; onSaved: () => void; onBusy?: (busy: boolean) => void }) {
  const t = useT()
  const [kind, setKind] = useState('note')
  const [reason, setReason] = useState('')
  const [day, setDay] = useState(today())
  const [returned, setReturned] = useState(false)
  const [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const pending = useRef({ body: '', key: '' })
  return <details className="rounded border p-3" style={{ borderColor: 'var(--rule)' }}>
    <summary className="cursor-pointer font-semibold">{t('التصحيحات وسجل المراجعة', 'Corrections and review history')}</summary>
    <div className="mt-4 grid gap-3">
      {(visit.corrections ?? []).map((row: any) => <article key={row.id} className="rounded border p-3" style={{ borderColor: 'var(--rule)' }}><strong>{row.kind === 'note' ? t('إضافة للتقرير', 'Report addendum') : t('عكس استهلاك القطع', 'Consumption reversed')}</strong><p>{row.reason}</p><small className="muted">{row.actor_name} · {date(row.effective_on)} · {datetime(row.created_at)}</small></article>)}
      {can('service.correct') && <Sheet bodyClassName="grid gap-3 p-4">
        <p className="muted m-0">{t('يظل التقرير الأصلي محفوظاً. عكس القطع يتطلب إرجاعها فعلياً؛ الفواتير المسجلة تُصحح عبر المرتجعات أو الإشعارات الدائنة.', 'The original report is preserved. Reversing parts requires their physical return; billed work is corrected through invoice returns or credits.')}</p>
        {error ? <ErrorBox error={error} /> : null}
        <fieldset disabled={busy} className="grid gap-3 border-0 p-0">
          <Field label={t('نوع التصحيح', 'Correction type')}><Select value={kind} options={[{ value: 'note', label: t('إضافة توضيح للتقرير', 'Add a report clarification') }, ...(!visit.invoice_id && visit.status === 'completed' ? [{ value: 'reverse_consumption', label: t('عكس الاستهلاك وإرجاع كل القطع', 'Reverse consumption and return all parts') }] : [])]} onChange={event => setKind(event.target.value)} /></Field>
          <Field label={t('تاريخ التصحيح', 'Correction date')}><Input type="date" max={today()} value={day} onChange={event => setDay(event.target.value)} /></Field>
          <Field label={t('السبب والتفاصيل', 'Reason and details')}><Textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} /></Field>
          {kind === 'reverse_consumption' && <><Check checked={returned} onChange={setReturned} label={t('أؤكد رجوع جميع القطع المسجلة فعلياً للمخزن / السيارة.', 'I confirm all recorded parts were physically returned to the warehouse / van.')} /><Check checked={history} onChange={setHistory} label={t('أؤكد إعادة تواريخ المراحل لحالتها السابقة إن لم يحدث الاستبدال.', 'I confirm restoring the previous stage dates where replacement did not occur.')} /></>}
          <Button variant={kind === 'reverse_consumption' ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 5 || !day || (kind === 'reverse_consumption' && (!returned || !history))} onClick={async () => {
            const body = { kind, reason: reason.trim(), effective_on: day, restock_confirmed: returned, restore_stage_history: history }
            const serialized = JSON.stringify(body)
            if (pending.current.body !== serialized) pending.current = { body: serialized, key: crypto.randomUUID() }
            setBusy(true); onBusy?.(true); setError(null)
            try { await api.postOnce(`/service-visits/${visit.id}/corrections`, body, pending.current.key); onSaved() } catch (failure) { setError(failure) } finally { setBusy(false); onBusy?.(false) }
          }}>{t('حفظ التصحيح الموثق', 'Save audited correction')}</Button>
        </fieldset>
      </Sheet>}
      {visit.invoice_id && can('sales.invoices') && <Button onClick={() => navigate(`/docs/sales_invoice/${visit.invoice_id}`)}>{t('فتح الفاتورة والمرتجعات', 'Open invoice and returns')}</Button>}
    </div>
  </details>
}
