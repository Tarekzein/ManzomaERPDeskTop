import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ListPage } from '@/components/ListPage'
import { DateRange, type Range } from '@/components/DateRange'
import { Button, Money, Select } from '@/components/ui'
import { StatusPill } from '@/components/Status'
import { DOC_TYPES, docLabel, statusLabel, type TradeType } from '@/lib/docTypes'
import { date, money, startOfMonth, today } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'
import { UserSelect } from '@/components/Pickers'

const STATUSES: Record<string, string[]> = {
  sales_quotation: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
  sales_order: ['draft', 'confirmed', 'partially_invoiced', 'invoiced', 'cancelled', 'closed'],
  purchase_order: ['draft', 'confirmed', 'partially_received', 'received', 'cancelled', 'closed'],
  default: ['draft', 'posted', 'void'],
}

export default function DocumentList() {
  const t = useT()
  const allowed = useCan()
  const { params, query } = useTab()
  const type = params.type as TradeType
  const meta = DOC_TYPES[type]
  const isInvoice = type === 'sales_invoice' || type === 'purchase_invoice'
  const [range, setRange] = useState<Range>({ from: query.get('from') ?? startOfMonth(), to: query.get('to') ?? today() })
  const [status, setStatus] = useState(query.get('status') ?? '')
  const [payment, setPayment] = useState(query.get('payment_status') ?? '')
  const [salesperson, setSalesperson] = useState<number | null>(null)

  return (
    <ListPage
      title={docLabel(type, true)}
      path={`/documents/${type}`}
      params={{ from: payment ? undefined : range.from, to: payment ? undefined : range.to, status, payment_status: payment, salesperson_id: salesperson, party_id: query.get('party') ?? undefined }}
      onOpen={(row) => navigate(`/docs/${type}/${row.id}`)}
      actions={allowed(meta.permission) && <Button variant="primary" icon={Plus} onClick={() => navigate(`/docs/${type}/new`)} kbd="F2">{t('جديد', 'New')}</Button>}
      searchPlaceholder={t('رقم المستند أو اسم العميل/المورد', 'Document number or party name')}
      csvName={type}
      csv={[
        { header: t('الرقم', 'Number'), value: (r: any) => r.number },
        { header: t('التاريخ', 'Date'), value: (r: any) => r.date },
        { header: meta.partyRole === 'customer' ? t('العميل', 'Customer') : t('المورد', 'Supplier'), value: (r: any) => nameOf(r.party) },
        { header: t('الصافي', 'Net'), value: (r: any) => r.net_total },
        { header: t('الضريبة', 'VAT'), value: (r: any) => r.tax_total },
        { header: t('الإجمالي', 'Total'), value: (r: any) => r.total },
        { header: t('المسدد', 'Paid'), value: (r: any) => r.paid_amount },
        { header: t('الحالة', 'Status'), value: (r: any) => statusLabel(r.status) },
      ]}
      filters={
        <>
          {!payment && <DateRange value={range} onChange={setRange} />}
          <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('كل الحالات', 'All statuses')} options={(STATUSES[type] ?? STATUSES.default).map((s) => ({ value: s, label: statusLabel(s) }))} />
          {isInvoice && (
            <Select className="w-auto" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder={t('كل حالات السداد', 'Any payment status')} options={[
              { value: 'open', label: t('غير مسددة بالكامل', 'Not fully paid') },
              { value: 'overdue', label: t('متأخرة', 'Overdue') },
              { value: 'unpaid', label: t('غير مدفوعة', 'Unpaid') },
              { value: 'partial', label: t('مدفوعة جزئياً', 'Partly paid') },
              { value: 'paid', label: t('مدفوعة', 'Paid') },
            ]} />
          )}
          {meta.side === 'sales' && <div className="w-44"><UserSelect salespeople value={salesperson} onChange={setSalesperson} placeholder={t('كل المندوبين', 'All salespeople')} /></div>}
        </>
      }
      summary={(totals) => (
        <div className="figure-band sheet">
          <div><div className="muted text-[12px]">{t('عدد المستندات', 'Documents')}</div><div className="figure">{totals.count}</div></div>
          <div><div className="muted text-[12px]">{t('الصافي قبل الضريبة', 'Net before tax')}</div><div className="figure">{money(totals.net_total)}</div></div>
          <div><div className="muted text-[12px]">{t('الضريبة', 'VAT')}</div><div className="figure">{money(totals.tax_total)}</div></div>
          <div><div className="muted text-[12px]">{t('الإجمالي', 'Total')}</div><div className="figure">{money(totals.total)}</div></div>
          {isInvoice && <div><div className="muted text-[12px]">{t('المتبقي', 'Outstanding')}</div><div className="figure" style={{ color: Number(totals.outstanding) > 0 ? 'var(--red)' : undefined }}>{money(totals.outstanding)}</div></div>}
        </div>
      )}
      columns={[
        { key: 'number', header: t('الرقم', 'Number'), sortKey: 'number', width: 150, render: (r: any) => <span className="num font-medium">{r.number.startsWith('D-') ? t('مسودة', 'Draft') : r.number}</span> },
        { key: 'date', header: t('التاريخ', 'Date'), sortKey: 'date', width: 100, render: (r: any) => <span className="num">{date(r.date)}</span> },
        { key: 'party', header: meta.partyRole === 'customer' ? t('العميل', 'Customer') : t('المورد', 'Supplier'), render: (r: any) => nameOf(r.party) },
        ...(isInvoice ? [{ key: 'due', header: t('الاستحقاق', 'Due'), sortKey: 'due_date', width: 100, render: (r: any) => <span className={`num ${r.payment_status && r.payment_status !== 'paid' && r.due_date < today() ? 'neg' : ''}`}>{date(r.due_date)}</span> }] : []),
        ...(meta.side === 'sales' ? [{ key: 'salesperson', header: t('المندوب', 'Salesperson'), render: (r: any) => r.salesperson?.name ?? '' }] : [{ key: 'reference', header: t('المرجع', 'Reference'), render: (r: any) => <span className="num">{r.reference}</span> }]),
        { key: 'total', header: t('الإجمالي', 'Total'), align: 'end', sortKey: 'total', width: 120, render: (r: any) => <Money value={r.total} /> },
        ...(isInvoice ? [{ key: 'outstanding', header: t('المتبقي', 'Outstanding'), align: 'end' as const, width: 120, render: (r: any) => (r.outstanding ? <Money value={r.outstanding} className="neg" /> : <span className="muted">—</span>) }] : []),
        { key: 'status', header: t('الحالة', 'Status'), width: 130, render: (r: any) => <span className="inline-flex gap-1"><StatusPill status={r.status} />{r.payment_status && r.payment_status !== 'unpaid' && <StatusPill status={r.payment_status} />}</span> },
      ]}
    />
  )
}
