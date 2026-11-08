import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, money, qty, startOfYear, today } from '@/lib/format'
import { sourceLabel, sourceLink } from '@/lib/docTypes'
import { nameOf, useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { DataTable } from '@/components/DataTable'
import { DateRange } from '@/components/DateRange'
import { LookupSelect } from '@/components/Pickers'
import { Button, ErrorBox, Money, PageHeader, Spinner } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint } from '@/features/print/templates'

/** كارت الصنف: every movement of one item with a running quantity. */
export default function ItemCard() {
  const t = useT()
  const { params } = useTab()
  const [range, setRange] = useState({ from: startOfYear(), to: today() })
  const [warehouse, setWarehouse] = useState<number | null>(null)
  const { data, isLoading, error } = useApi<any>(`/products/${params.id}/card`, { ...range, warehouse_id: warehouse })
  useTabTitle(data ? `${t('كارت', 'Card')} ${nameOf(data.product)}` : undefined)
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const showCost = data.closing_value !== null
  const rows = [{ id: 'o', date: '', reference: '', source_type: null, in: 0, out: 0, balance: data.opening_quantity, value: data.opening_value, _opening: true }, ...data.lines]
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={`${t('كارت صنف', 'Item card')}: ${nameOf(data.product)}`} subtitle={<span className="num">{data.product.code}</span>} actions={<>
        <Button onClick={() => navigate(`/inventory/products/${params.id}`)}>{t('بيانات الصنف', 'Item details')}</Button>
        <DateRange value={range} onChange={setRange} />
        <div className="w-44"><LookupSelect kind="warehouses" value={warehouse} onChange={setWarehouse} placeholder={t('كل المخازن', 'All warehouses')} /></div>
        <Button icon={Printer} onClick={() => printElement(<TablePrint title={`${t('كارت صنف', 'Item card')} ${nameOf(data.product)}`} subtitle={`${date(range.from)} — ${date(range.to)}`} rows={data.lines} columns={[
          { header: t('التاريخ', 'Date'), value: (r) => date(r.date) }, { header: t('المستند', 'Document'), value: (r) => `${sourceLabel(r.source_type)} ${r.reference ?? ''}` }, { header: t('الطرف', 'Party'), value: (r) => r.party ?? '' },
          { header: t('وارد', 'In'), value: (r) => (r.in ? qty(r.in) : ''), align: 'end' }, { header: t('منصرف', 'Out'), value: (r) => (r.out ? qty(r.out) : ''), align: 'end' }, { header: t('الرصيد', 'Balance'), value: (r) => qty(r.balance), align: 'end' },
        ]} totals={['', t('الإجمالي', 'Totals'), '', qty(data.total_in), qty(data.total_out), qty(data.closing_quantity)]} />, { paper: 'A4', title: data.product.code })}>{t('طباعة', 'Print')}</Button>
      </>} />
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-hidden rounded-lg" style={{ border: '1px solid var(--rule)' }}>
        <DataTable rows={rows} footer maxHeight="100%" onOpen={(r: any) => { const link = sourceLink(r.source_type, r.source_id); if (link) navigate(link) }} columns={[
          { key: 'date', header: t('التاريخ', 'Date'), width: 96, render: (r: any) => <span className="num">{date(r.date)}</span> },
          { key: 'doc', header: t('المستند', 'Document'), render: (r: any) => (r._opening ? <b>{t('رصيد أول المدة', 'Opening balance')}</b> : <span>{sourceLabel(r.source_type)} <span className="num muted">{r.reference}</span></span>) },
          { key: 'party', header: t('الطرف', 'Party'), render: (r: any) => r.party ?? '' },
          { key: 'warehouse', header: t('المخزن', 'Warehouse'), width: 130, render: (r: any) => nameOf(r.warehouse) },
          { key: 'batch', header: t('التشغيلة', 'Batch'), width: 100, render: (r: any) => <span className="num">{r.batch?.batch_no ?? ''}</span> },
          { key: 'in', header: t('وارد', 'In'), align: 'end', width: 90, render: (r: any) => (r.in ? <span className="num">{qty(r.in)}</span> : ''), footer: <span className="num">{qty(data.total_in)}</span> },
          { key: 'out', header: t('منصرف', 'Out'), align: 'end', width: 90, render: (r: any) => (r.out ? <span className="num">{qty(r.out)}</span> : ''), footer: <span className="num">{qty(data.total_out)}</span> },
          { key: 'balance', header: t('الرصيد', 'Balance'), align: 'end', width: 100, render: (r: any) => <span className={`num font-medium ${r.balance < 0 ? 'neg' : ''}`}>{qty(r.balance)}</span>, footer: <span className="num">{qty(data.closing_quantity)}</span> },
          ...(showCost ? [
            { key: 'unit_cost', header: t('التكلفة', 'Cost'), align: 'end' as const, width: 100, render: (r: any) => (r._opening ? '' : <Money value={r.unit_cost} />) },
            { key: 'value', header: t('القيمة', 'Value'), align: 'end' as const, width: 120, render: (r: any) => <Money value={r.value} />, footer: <span className="num">{money(data.closing_value)}</span> },
          ] : []),
        ]} />
      </div>
    </div>
  )
}
