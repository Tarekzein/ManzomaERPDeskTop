import { useState } from 'react'
import { Download, FilePlus2, Printer } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, money, qty, today, toNumber } from '@/lib/format'
import { exportCsv } from '@/lib/csv'
import { nameOf, useT } from '@/store/prefs'
import { can } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'
import { DataTable, type Column } from '@/components/DataTable'
import { Button, ErrorBox, Field, Input, Money, NumberInput, PageHeader, Sheet, Spinner } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint, type PrintColumn } from '@/features/print/templates'

export default function InventoryReports() {
  const { params } = useTab()
  if (params.report === 'reconcile') return <Reconcile />
  return <ListReport report={params.report} />
}

function ListReport({ report }: { report: string }) {
  const t = useT()
  const [days, setDays] = useState(report === 'slow' ? 90 : 60)
  const path = { expiry: '/stock/expiring', reorder: '/stock/reorder', slow: '/stock/slow-moving' }[report] ?? null
  const { data, isLoading, error } = useApi<any>(path, report === 'reorder' ? undefined : { days })
  const rows: any[] = data?.data ?? []
  const showCost = can('inventory.view_cost')

  const config: Record<string, { title: string; hint: string; columns: Column<any>[]; print: PrintColumn[] }> = {
    expiry: {
      title: t('أصناف قاربت الصلاحية', 'Expiring batches'),
      hint: t('التشغيلات التي تنتهي صلاحيتها خلال المدة المحددة، الأقرب أولاً.', 'Batches that expire within the period, soonest first.'),
      columns: [
        { key: 'code', header: t('الكود', 'Code'), width: 100, render: (r) => <span className="num">{r.code}</span> },
        { key: 'name', header: t('الصنف', 'Item'), render: (r) => nameOf(r) },
        { key: 'batch', header: t('التشغيلة', 'Batch'), width: 120, render: (r) => <span className="num">{r.batch_no}</span> },
        { key: 'warehouse', header: t('المخزن', 'Warehouse'), width: 140, render: (r) => r.warehouse },
        { key: 'expiry', header: t('تاريخ الانتهاء', 'Expires'), width: 110, render: (r) => <span className="num">{date(r.expiry_date)}</span> },
        { key: 'days', header: t('متبقي', 'Days left'), align: 'end', width: 90, render: (r) => <span className={`num font-medium ${r.days_left < 0 ? 'neg' : r.days_left <= 30 ? 'warn' : ''}`}>{r.days_left < 0 ? t('منتهي', 'Expired') : r.days_left}</span> },
        { key: 'qty', header: t('الكمية', 'Qty'), align: 'end', width: 100, render: (r) => <span className="num">{qty(r.quantity)}</span> },
      ],
      print: [{ header: t('الصنف', 'Item'), value: (r) => `${r.code} ${nameOf(r)}` }, { header: t('التشغيلة', 'Batch'), value: (r) => r.batch_no }, { header: t('المخزن', 'Warehouse'), value: (r) => r.warehouse }, { header: t('الانتهاء', 'Expires'), value: (r) => date(r.expiry_date) }, { header: t('الكمية', 'Qty'), value: (r) => qty(r.quantity), align: 'end' }],
    },
    reorder: {
      title: t('أصناف وصلت لحد الطلب', 'Items at reorder level'),
      hint: t('الكمية المقترحة = كمية الطلب − الرصيد − ما هو مطلوب بالفعل في أوامر شراء مفتوحة.', 'Suggested = reorder quantity − on hand − already on open purchase orders.'),
      columns: [
        { key: 'code', header: t('الكود', 'Code'), width: 100, render: (r) => <span className="num">{r.code}</span> },
        { key: 'name', header: t('الصنف', 'Item'), render: (r) => nameOf(r) },
        { key: 'on_hand', header: t('الرصيد', 'On hand'), align: 'end', width: 100, render: (r) => <span className="num neg">{qty(r.on_hand)}</span> },
        { key: 'reorder_level', header: t('حد الطلب', 'Reorder level'), align: 'end', width: 100, render: (r) => <span className="num">{qty(r.reorder_level)}</span> },
        { key: 'on_order', header: t('تحت الطلب', 'On order'), align: 'end', width: 100, render: (r) => <span className="num">{qty(r.on_order)}</span> },
        { key: 'suggested', header: t('المقترح', 'Suggested'), align: 'end', width: 100, render: (r) => <span className="num font-semibold">{qty(r.suggested)} <span className="muted text-[11px]">{nameOf({ name: r.unit, name_en: r.unit_en })}</span></span> },
        ...(showCost ? [{ key: 'est', header: t('التكلفة التقديرية', 'Est. cost'), align: 'end' as const, width: 120, render: (r: any) => <Money value={toNumber(r.suggested) * toNumber(r.purchase_price)} /> }] : []),
      ],
      print: [{ header: t('الصنف', 'Item'), value: (r) => `${r.code} ${nameOf(r)}` }, { header: t('الرصيد', 'On hand'), value: (r) => qty(r.on_hand), align: 'end' }, { header: t('حد الطلب', 'Reorder'), value: (r) => qty(r.reorder_level), align: 'end' }, { header: t('تحت الطلب', 'On order'), value: (r) => qty(r.on_order), align: 'end' }, { header: t('المقترح', 'Suggested'), value: (r) => qty(r.suggested), align: 'end' }],
    },
    slow: {
      title: t('أصناف راكدة', 'Slow-moving items'),
      hint: t('أصناف لها رصيد ولم تُبع خلال المدة المحددة، الأعلى قيمة أولاً.', 'Items with stock and no sales in the period, highest value first.'),
      columns: [
        { key: 'code', header: t('الكود', 'Code'), width: 100, render: (r) => <span className="num">{r.code}</span> },
        { key: 'name', header: t('الصنف', 'Item'), render: (r) => nameOf(r) },
        { key: 'last_sale', header: t('آخر بيع', 'Last sale'), width: 110, render: (r) => (r.last_sale ? <span className="num">{date(r.last_sale)}</span> : <span className="muted">{t('لم يُبع', 'Never')}</span>) },
        { key: 'on_hand', header: t('الرصيد', 'On hand'), align: 'end', width: 100, render: (r) => <span className="num">{qty(r.on_hand)}</span> },
        ...(showCost ? [{ key: 'value', header: t('القيمة المجمدة', 'Tied-up value'), align: 'end' as const, width: 130, render: (r: any) => <Money value={r.value} />, footer: <Money value={rows.reduce((s, r) => s + toNumber(r.value), 0)} /> }] : []),
      ],
      print: [{ header: t('الصنف', 'Item'), value: (r) => `${r.code} ${nameOf(r)}` }, { header: t('آخر بيع', 'Last sale'), value: (r) => (r.last_sale ? date(r.last_sale) : '—') }, { header: t('الرصيد', 'On hand'), value: (r) => qty(r.on_hand), align: 'end' }, ...(showCost ? [{ header: t('القيمة', 'Value'), value: (r: any) => money(r.value), align: 'end' as const }] : [])],
    },
  }
  const c = config[report]
  if (!c) return <ErrorBox error={new Error('Unknown report')} />
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={c.title} subtitle={c.hint} actions={<>
        {report !== 'reorder' && <Field label={t('عدد الأيام', 'Days')}><NumberInput className="w-24" value={days} onChange={(v) => setDays(Math.max(1, Math.round(v)))} /></Field>}
        {report === 'reorder' && can('purchases.orders') && rows.length > 0 && <Button icon={FilePlus2} onClick={() => navigate(`/docs/purchase_order/new?reorder=1`)}>{t('أمر شراء', 'Purchase order')}</Button>}
        <Button icon={Download} onClick={() => exportCsv(report, rows, c.print.map((p) => ({ header: p.header, value: p.value })))}>{t('تصدير', 'Export')}</Button>
        <Button icon={Printer} onClick={() => printElement(<TablePrint title={c.title} subtitle={date(today())} rows={rows} columns={c.print} />, { paper: 'A4', title: report })}>{t('طباعة', 'Print')}</Button>
      </>} />
      {error && <ErrorBox error={error} />}
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-hidden rounded-lg" style={{ border: '1px solid var(--rule)' }}>
        <DataTable rows={rows} loading={isLoading} maxHeight="100%" footer={report === 'slow' && showCost} rowKey={(r: any) => `${r.product_id ?? r.id}-${r.batch_id ?? ''}-${r.warehouse ?? ''}`} onOpen={(r: any) => navigate(`/inventory/card/${r.product_id ?? r.id}`)} columns={c.columns} />
      </div>
    </div>
  )
}

function Reconcile() {
  const t = useT()
  const [day, setDay] = useState(today())
  const { data, isLoading, error } = useApi<any>('/stock/reconcile', { date: day })
  return (
    <div>
      <PageHeader title={t('مطابقة المخزون مع الحسابات', 'Stock vs. ledger')} subtitle={t('قيمة المخزون من حركات الأصناف مقابل رصيد حساب المخزون في الأستاذ العام.', 'Stock value from item movements against the inventory account balance in the general ledger.')} actions={<Field label={t('في تاريخ', 'As of')}><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>} />
      {isLoading ? <Spinner /> : error ? <ErrorBox error={error} /> : (
        <div className="px-5">
          <Sheet bodyClassName="figure-band">
            <div><div className="muted text-[12px]">{t('قيمة المخزون (الأصناف)', 'Stock value (items)')}</div><div className="figure">{money(data.stock_value)}</div></div>
            <div><div className="muted text-[12px]">{t('رصيد حساب المخزون', 'Inventory account')}</div><div className="figure">{money(data.gl_value)}</div></div>
            <div><div className="muted text-[12px]">{t('الفرق', 'Difference')}</div><div className="figure" style={{ color: Math.abs(toNumber(data.difference)) > 0.009 ? 'var(--red)' : 'var(--green)' }}>{money(data.difference)}</div></div>
          </Sheet>
          <p className="muted mt-3 text-[13px]">{Math.abs(toNumber(data.difference)) > 0.009 ? t('يوجد فرق: غالباً قيد يدوي على حساب المخزون. راجع دفتر أستاذ حساب المخزون.', 'There is a difference, usually a manual entry on the inventory account. Review the inventory account ledger.') : t('المخزون مطابق للحسابات.', 'Stock agrees with the ledger.')}</p>
        </div>
      )}
    </div>
  )
}
