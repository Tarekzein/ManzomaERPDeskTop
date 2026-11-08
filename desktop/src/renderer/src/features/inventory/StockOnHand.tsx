import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, money, qty } from '@/lib/format'
import { exportCsv } from '@/lib/csv'
import { can } from '@/store/session'
import { nameOf, useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { DataTable } from '@/components/DataTable'
import { LookupSelect } from '@/components/Pickers'
import { Button, Check, ErrorBox, Input, Money, PageHeader } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint } from '@/features/print/templates'

export default function StockOnHand() {
  const t = useT()
  const [warehouse, setWarehouse] = useState<number | null>(null)
  const [category, setCategory] = useState<number | null>(null)
  const [byBatch, setByBatch] = useState(false)
  const [search, setSearch] = useState('')
  const { data, isLoading, error } = useApi<any>('/stock/on-hand', { warehouse_id: warehouse, category_id: category, by_batch: byBatch ? 1 : undefined, search })
  const showValue = data?.totals?.value !== null && data?.totals?.value !== undefined
  const rows = data?.data ?? []
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('المتاح بالمخازن والسيارات', 'Warehouse & van stock')} actions={<>
        {can('purchases.invoices') && <Button variant="primary" onClick={() => navigate('/docs/purchase_invoice/new')}>{t('شراء بضاعة', 'Buy stock')}</Button>}
        {can('stock.transfer') && <Button onClick={() => navigate('/inventory/docs/transfer/new')}>{t('تموين سيارة / نقل', 'Refill van / transfer')}</Button>}
        <Button icon={Download} onClick={() => exportCsv('stock-on-hand', rows, [
          { header: 'code', value: (r: any) => r.code }, { header: 'item', value: (r: any) => r.name }, { header: 'warehouse', value: (r: any) => r.warehouse }, { header: 'batch', value: (r: any) => r.batch_no ?? '' },
          { header: 'quantity', value: (r: any) => r.quantity }, ...(showValue ? [{ header: 'value', value: (r: any) => r.value }] : []),
        ])}>{t('تصدير', 'Export')}</Button>
        <Button icon={Printer} onClick={() => printElement(<TablePrint title={t('أرصدة المخازن', 'Stock on hand')} subtitle={date(new Date().toISOString())} rows={rows} columns={[
          { header: t('الكود', 'Code'), value: (r) => r.code }, { header: t('الصنف', 'Item'), value: (r) => nameOf(r) }, { header: t('المخزن', 'Warehouse'), value: (r) => r.warehouse },
          { header: t('الكمية', 'Qty'), value: (r) => qty(r.quantity), align: 'end' }, ...(showValue ? [{ header: t('القيمة', 'Value'), value: (r: any) => money(r.value), align: 'end' as const }] : []),
        ]} totals={['', t('الإجمالي', 'Total'), '', qty(data?.totals?.quantity), ...(showValue ? [money(data?.totals?.value)] : [])]} />, { paper: 'A4', title: 'stock' })}>{t('طباعة', 'Print')}</Button>
      </>} />
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <Input className="w-[260px]" placeholder={t('بحث بالاسم أو الكود', 'Search name or code')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="w-44"><LookupSelect kind="warehouses" value={warehouse} onChange={setWarehouse} placeholder={t('كل المخازن', 'All warehouses')} /></div>
        <div className="w-44"><LookupSelect kind="categories" value={category} onChange={setCategory} placeholder={t('كل المجموعات', 'All categories')} /></div>
        <Check checked={byBatch} onChange={setByBatch} label={t('حسب التشغيلة', 'By batch')} />
      </div>
      {error && <ErrorBox error={error} />}
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-hidden rounded-lg" style={{ border: '1px solid var(--rule)' }}>
        <DataTable rows={rows} loading={isLoading} footer maxHeight="100%" rowKey={(r: any) => `${r.product_id}-${r.warehouse_id}-${r.batch_id ?? 0}`} onOpen={(r: any) => navigate(`/inventory/card/${r.product_id}`)} columns={[
          { key: 'code', header: t('الكود', 'Code'), width: 100, render: (r: any) => <span className="num">{r.code}</span> },
          { key: 'name', header: t('الصنف', 'Item'), render: (r: any) => nameOf(r) },
          { key: 'category', header: t('المجموعة', 'Category'), width: 130, render: (r: any) => (r.category_en && document.documentElement.lang === 'en' ? r.category_en : r.category) },
          { key: 'warehouse', header: t('المخزن', 'Warehouse'), width: 140, render: (r: any) => (document.documentElement.lang === 'en' && r.warehouse_en ? r.warehouse_en : r.warehouse) },
          ...(byBatch ? [{ key: 'batch', header: t('التشغيلة', 'Batch'), width: 140, render: (r: any) => <span className="num">{r.batch_no ?? '—'} {r.expiry_date && <span className="muted">· {date(r.expiry_date)}</span>}</span> }] : []),
          { key: 'quantity', header: t('الكمية', 'Qty'), align: 'end', width: 110, render: (r: any) => <span className={`num ${r.quantity < 0 ? 'neg' : ''}`}>{qty(r.quantity)} <span className="muted text-[11px]">{document.documentElement.lang === 'en' && r.unit_en ? r.unit_en : r.unit}</span></span>, footer: <span className="num">{qty(data?.totals?.quantity)}</span> },
          ...(showValue ? [
            { key: 'avg_cost', header: t('متوسط التكلفة', 'Avg. cost'), align: 'end' as const, width: 110, render: (r: any) => <Money value={r.avg_cost} /> },
            { key: 'value', header: t('القيمة', 'Value'), align: 'end' as const, width: 130, render: (r: any) => <Money value={r.value} />, footer: <Money value={data?.totals?.value} /> },
          ] : []),
        ]} />
      </div>
    </div>
  )
}
