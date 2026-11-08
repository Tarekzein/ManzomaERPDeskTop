import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ListPage } from '@/components/ListPage'
import { DateRange, type Range } from '@/components/DateRange'
import { LookupSelect } from '@/components/Pickers'
import { Button, Money, Select } from '@/components/ui'
import { StatusPill } from '@/components/Status'
import { ADJUSTMENT_REASONS, STOCK_DOCS, statusLabel } from '@/lib/docTypes'
import { date, startOfYear, today } from '@/lib/format'
import { nameOf, tr, useT } from '@/store/prefs'
import { can } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'

const PERMS: Record<string, string> = { adjustment: 'stock.adjust', opening: 'stock.adjust', transfer: 'stock.transfer', count: 'stock.count' }
const STATUSES: Record<string, string[]> = {
  transfer: ['draft', 'in_transit', 'received', 'cancelled'],
  count: ['draft', 'in_progress', 'posted', 'cancelled'],
  default: ['draft', 'posted', 'cancelled'],
}

export default function StockDocList() {
  const t = useT()
  const { params } = useTab()
  const type = params.type as keyof typeof STOCK_DOCS
  const meta = STOCK_DOCS[type]
  const [range, setRange] = useState<Range>({ from: startOfYear(), to: today() })
  const [status, setStatus] = useState('')
  const [warehouse, setWarehouse] = useState<number | null>(null)
  const showCost = can('inventory.view_cost')
  return (
    <ListPage
      title={tr(meta.pluralAr, meta.pluralEn)}
      path={`/stock-documents/${type}`}
      params={{ ...range, status, warehouse_id: warehouse }}
      onOpen={(r) => navigate(`/inventory/docs/${type}/${r.id}`)}
      actions={can(PERMS[type]) && <Button variant="primary" icon={Plus} kbd="F2" onClick={() => navigate(`/inventory/docs/${type}/new`)}>{t('جديد', 'New')}</Button>}
      searchPlaceholder={t('رقم المستند أو الملاحظات', 'Number or notes')}
      filters={<>
        <DateRange value={range} onChange={setRange} />
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('كل الحالات', 'All statuses')} options={(STATUSES[type] ?? STATUSES.default).map((s) => ({ value: s, label: statusLabel(s) }))} />
        <div className="w-44"><LookupSelect kind="warehouses" value={warehouse} onChange={setWarehouse} placeholder={t('كل المخازن', 'All warehouses')} filter={(w) => !w.is_transit} /></div>
      </>}
      csvName={type}
      csv={[{ header: 'number', value: (r: any) => r.number }, { header: 'date', value: (r: any) => r.date }, { header: 'warehouse', value: (r: any) => nameOf(r.warehouse) }, { header: 'status', value: (r: any) => statusLabel(r.status) }]}
      columns={[
        { key: 'number', header: t('الرقم', 'Number'), sortKey: 'number', width: 140, render: (r: any) => <span className="num font-medium">{r.number}</span> },
        { key: 'date', header: t('التاريخ', 'Date'), sortKey: 'date', width: 100, render: (r: any) => <span className="num">{date(r.date)}</span> },
        { key: 'warehouse', header: type === 'transfer' ? t('من', 'From') : t('المخزن', 'Warehouse'), render: (r: any) => nameOf(r.warehouse) },
        ...(type === 'transfer' ? [{ key: 'to', header: t('إلى', 'To'), render: (r: any) => nameOf(r.to_warehouse) }] : []),
        ...(type === 'adjustment' ? [{ key: 'reason', header: t('السبب', 'Reason'), width: 130, render: (r: any) => (r.reason ? tr(...(ADJUSTMENT_REASONS[r.reason] ?? [r.reason, r.reason])) : '') }] : []),
        { key: 'lines', header: t('البنود', 'Lines'), align: 'end', width: 70, render: (r: any) => <span className="num">{r.lines_count}</span> },
        ...(showCost ? [{ key: 'total_cost', header: t('القيمة', 'Value'), align: 'end' as const, width: 120, render: (r: any) => <Money value={r.total_cost} colored={type === 'count'} /> }] : []),
        { key: 'creator', header: t('بواسطة', 'By'), width: 120, render: (r: any) => r.creator?.name ?? '' },
        { key: 'status', header: t('الحالة', 'Status'), width: 110, render: (r: any) => <StatusPill status={r.status} /> },
      ]}
    />
  )
}
