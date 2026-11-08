import { useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Filter, Printer, X } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, int, money, percent, qty, startOfYear, today, toNumber } from '@/lib/format'
import { docLabel } from '@/lib/docTypes'
import { exportCsv } from '@/lib/csv'
import { nameOf, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'
import { DataTable, type Column } from '@/components/DataTable'
import { DateRange } from '@/components/DateRange'
import { LookupSelect, PartyPicker, ProductPicker, UserSelect } from '@/components/Pickers'
import { Button, ErrorBox, Money, PageHeader, Select, Sheet } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint } from '@/features/print/templates'

type Dim = 'day' | 'month' | 'party' | 'product' | 'category' | 'brand' | 'salesperson' | 'warehouse' | 'branch' | 'document'
const FILTER_OF: Partial<Record<Dim, string>> = { party: 'party_id', product: 'product_id', category: 'category_id', salesperson: 'salesperson_id', warehouse: 'warehouse_id', branch: 'branch_id' }

/** Sales or purchases sliced by any dimension, with drill-down. */
export default function Analysis() {
  const t = useT()
  const { params } = useTab()
  const side = params.side === 'purchases' ? 'purchases' : 'sales'
  const lookups = useSession((s) => s.lookups)
  const [range, setRange] = useState({ from: startOfYear(), to: today() })
  const [by, setBy] = useState<Dim>('month')
  const [filters, setFilters] = useState<Record<string, { id: number; label: string }>>({})
  const query = { ...range, by, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v.id])) }
  const { data, isLoading, error } = useApi<any>(`/reports/analysis/${side}`, query)
  const rows: any[] = data?.rows ?? []
  const totals = data?.totals ?? {}
  const withProfit = side === 'sales' && totals.profit !== undefined

  const dims: { value: Dim; label: string }[] = [
    { value: 'month', label: t('الشهر', 'Month') }, { value: 'day', label: t('اليوم', 'Day') },
    { value: 'party', label: side === 'sales' ? t('العميل', 'Customer') : t('المورد', 'Supplier') }, { value: 'product', label: t('الصنف', 'Item') },
    { value: 'category', label: t('المجموعة', 'Category') }, { value: 'brand', label: t('العلامة', 'Brand') },
    ...(side === 'sales' ? [{ value: 'salesperson' as Dim, label: t('المندوب', 'Salesperson') }] : []),
    { value: 'warehouse', label: t('المخزن', 'Warehouse') }, { value: 'branch', label: t('الفرع', 'Branch') }, { value: 'document', label: t('المستند', 'Document') },
  ]
  const dimLabel = (d: Dim) => dims.find((x) => x.value === d)?.label ?? d
  const rowLabel = (r: any) => (by === 'document' ? `${docLabel(r.code)} ${r.label}` : by === 'day' ? date(r.label) : nameOf({ name: r.label, name_en: r.label_en }))

  const drill = (r: any) => {
    const key = FILTER_OF[by]
    if (!key) return
    setFilters({ ...filters, [key]: { id: Number(r.key_id), label: `${dimLabel(by)}: ${rowLabel(r)}` } })
    setBy(by === 'product' ? 'party' : by === 'party' ? 'product' : 'product')
  }
  const open = (r: any) => {
    if (by === 'document') navigate(`/docs/${r.code}/${r.key_id}`)
    else if (by === 'party') navigate(`/parties/view/${r.key_id}`)
    else if (by === 'product') navigate(`/inventory/products/${r.key_id}`)
    else drill(r)
  }

  const columns: Column<any>[] = [
    { key: 'label', header: dimLabel(by), render: (r) => <span>{r.code && by !== 'document' ? <span className="num muted me-1">{r.code}</span> : null}{rowLabel(r)}</span>, footer: t('الإجمالي', 'Total') },
    ...(by !== 'document' ? [{ key: 'documents', header: t('مستندات', 'Docs'), align: 'end' as const, width: 80, render: (r: any) => <span className="num">{int(r.documents)}</span> }] : []),
    ...(by === 'product' ? [{ key: 'quantity', header: t('الكمية', 'Qty'), align: 'end' as const, width: 90, render: (r: any) => <span className="num">{qty(r.quantity)}</span> }] : []),
    { key: 'gross', header: t('الإجمالي قبل الخصم', 'Gross'), align: 'end', width: 120, render: (r) => <Money value={r.gross} />, footer: <Money value={totals.gross} /> },
    { key: 'discount', header: t('الخصم', 'Discount'), align: 'end', width: 100, render: (r) => <Money value={r.discount} className="muted" />, footer: <Money value={totals.discount} /> },
    { key: 'net', header: t('الصافي', 'Net'), align: 'end', width: 130, render: (r) => <b><Money value={r.net} paren /></b>, footer: <Money value={totals.net} paren /> },
    { key: 'returns', header: t('منها مرتجعات', 'Returns'), align: 'end', width: 110, render: (r) => (toNumber(r.returns) ? <Money value={r.returns} className="neg" /> : <span className="muted">—</span>), footer: <Money value={totals.returns} /> },
    ...(withProfit ? [
      { key: 'cost', header: t('التكلفة', 'Cost'), align: 'end' as const, width: 120, render: (r: any) => <Money value={r.cost} />, footer: <Money value={totals.cost} /> },
      { key: 'profit', header: t('الربح', 'Profit'), align: 'end' as const, width: 120, render: (r: any) => <Money value={r.profit} paren colored />, footer: <Money value={totals.profit} paren colored /> },
      { key: 'margin', header: t('الهامش', 'Margin'), align: 'end' as const, width: 80, render: (r: any) => <span className={`num ${toNumber(r.margin) < 0 ? 'neg' : ''}`}>{r.margin !== null ? percent(r.margin) : '—'}</span>, footer: <span className="num">{totals.margin !== null && totals.margin !== undefined ? percent(totals.margin) : ''}</span> },
    ] : []),
  ]
  const timeSeries = by === 'month' || by === 'day'
  const title = side === 'sales' ? t('تحليل المبيعات', 'Sales analysis') : t('تحليل المشتريات', 'Purchase analysis')

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} subtitle={t('صافي بعد المرتجعات والخصومات، بدون ضريبة. انقر نقراً مزدوجاً للتفصيل.', 'Net of returns and discounts, before VAT. Double-click a row to drill down.')} actions={<>
        <DateRange value={range} onChange={setRange} />
        <Button icon={Download} onClick={() => exportCsv(`${side}-by-${by}`, rows, [{ header: by, value: rowLabel }, { header: 'documents', value: (r: any) => r.documents }, { header: 'quantity', value: (r: any) => r.quantity }, { header: 'gross', value: (r: any) => r.gross }, { header: 'discount', value: (r: any) => r.discount }, { header: 'net', value: (r: any) => r.net }, { header: 'tax', value: (r: any) => r.tax }, { header: 'returns', value: (r: any) => r.returns }, ...(withProfit ? [{ header: 'cost', value: (r: any) => r.cost }, { header: 'profit', value: (r: any) => r.profit }] : [])])}>{t('تصدير', 'Export')}</Button>
        <Button icon={Printer} onClick={() => printElement(<TablePrint title={`${title} — ${dimLabel(by)}`} subtitle={`${date(range.from)} — ${date(range.to)}${Object.values(filters).length ? ' · ' + Object.values(filters).map((f) => f.label).join(' · ') : ''}`} rows={rows} columns={[
          { header: dimLabel(by), value: rowLabel }, { header: t('الصافي', 'Net'), value: (r) => money(r.net, { paren: true }), align: 'end' }, { header: t('المرتجعات', 'Returns'), value: (r) => money(r.returns, { blankZero: true }), align: 'end' },
          ...(withProfit ? [{ header: t('الربح', 'Profit'), value: (r: any) => money(r.profit, { paren: true }), align: 'end' as const }, { header: t('الهامش', 'Margin'), value: (r: any) => (r.margin !== null ? percent(r.margin) : ''), align: 'end' as const }] : []),
        ]} totals={[t('الإجمالي', 'Total'), money(totals.net, { paren: true }), money(totals.returns), ...(withProfit ? [money(totals.profit, { paren: true }), totals.margin !== null ? percent(totals.margin) : ''] : [])]} />, { paper: 'A4', title: `${side}-${by}` })}>{t('طباعة', 'Print')}</Button>
      </>} />

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <span className="muted text-[13px]">{t('حسب', 'By')}</span>
        <Select className="w-auto" value={by} onChange={(e) => setBy(e.target.value as Dim)} options={dims} />
        <span className="muted ms-3 inline-flex items-center gap-1 text-[13px]"><Filter size={13} />{t('تصفية', 'Filter')}</span>
        {!filters.party_id && <div className="w-48"><PartyPicker role={side === 'sales' ? 'customer' : 'supplier'} value={null} onChange={(id, p) => id && setFilters({ ...filters, party_id: { id, label: nameOf(p) } })} /></div>}
        {!filters.product_id && <div className="w-48"><ProductPicker value={null} onChange={(id, p) => id && setFilters({ ...filters, product_id: { id, label: nameOf(p) } })} /></div>}
        {!filters.category_id && <div className="w-36"><LookupSelect kind="categories" value={null} placeholder={t('مجموعة', 'Category')} onChange={(id) => id && setFilters({ ...filters, category_id: { id, label: `${t('مجموعة', 'Category')}: ${nameOf(lookups?.categories.find((c: any) => c.id === id))}` } })} /></div>}
        {side === 'sales' && !filters.salesperson_id && <div className="w-36"><UserSelect salespeople value={null} placeholder={t('مندوب', 'Salesperson')} onChange={(id) => id && setFilters({ ...filters, salesperson_id: { id, label: `${t('مندوب', 'Salesperson')}: ${lookups?.users.find((u: any) => u.id === id)?.name ?? id}` } })} /></div>}
        {Object.entries(filters).map(([k, f]) => (
          <span key={k} className="pill inline-flex items-center gap-1" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>{f.label}<button className="btn btn-ghost btn-sm btn-icon" onClick={() => { const n = { ...filters }; delete n[k]; setFilters(n) }} aria-label={t('إزالة', 'Remove')}><X size={11} /></button></span>
        ))}
      </div>

      {error && <ErrorBox error={error} />}
      {timeSeries && rows.length > 0 && (
        <Sheet className="mx-5 mb-3">
          <div className="h-[180px] px-2 pt-3" dir="ltr">
            <ResponsiveContainer>
              <BarChart data={rows.map((r) => ({ label: by === 'day' ? r.label.slice(5) : r.label, net: toNumber(r.net), profit: toNumber(r.profit ?? 0) }))} margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} />
                <YAxis hide />
                <Tooltip formatter={(v) => money(v)} contentStyle={{ background: 'var(--sheet)', border: '1px solid var(--rule-strong)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="net" name={t('الصافي', 'Net')} fill="var(--ledger)" radius={[3, 3, 0, 0]} />
                {withProfit && <Bar dataKey="profit" name={t('الربح', 'Profit')} fill="var(--brand)" radius={[3, 3, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Sheet>
      )}
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-hidden rounded-lg" style={{ border: '1px solid var(--rule)' }}>
        <DataTable rows={rows} loading={isLoading} footer maxHeight="100%" rowKey={(r: any) => `${r.key_id}-${r.code}`} onOpen={open} columns={columns} />
      </div>
    </div>
  )
}
