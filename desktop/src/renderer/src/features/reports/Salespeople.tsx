import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, int, money, percent, startOfMonth, today, toNumber } from '@/lib/format'
import { exportCsv } from '@/lib/csv'
import { useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { DataTable } from '@/components/DataTable'
import { DateRange } from '@/components/DateRange'
import { Button, ErrorBox, Money, PageHeader } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint } from '@/features/print/templates'

/** Net sales, profit and commission per salesperson. */
export default function Salespeople() {
  const t = useT()
  const [range, setRange] = useState({ from: startOfMonth(), to: today() })
  const { data, isLoading, error } = useApi<any>('/reports/salespeople', range)
  const rows: any[] = data?.rows ?? []
  const totals = data?.totals ?? {}
  const withProfit = totals.profit !== undefined
  const commission = rows.reduce((s, r) => s + toNumber(r.commission), 0)
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('أداء المندوبين', 'Salespeople')} subtitle={t('العمولة = صافي المبيعات بعد المرتجعات × نسبة عمولة المندوب.', 'Commission = net sales after returns × the salesperson’s rate.')} actions={<>
        <DateRange value={range} onChange={setRange} />
        <Button icon={Download} onClick={() => exportCsv('salespeople', rows, [{ header: 'salesperson', value: (r: any) => r.label }, { header: 'invoices', value: (r: any) => r.documents }, { header: 'net', value: (r: any) => r.net }, { header: 'returns', value: (r: any) => r.returns }, { header: 'collected', value: (r: any) => r.collected_at_sale }, { header: 'rate', value: (r: any) => r.commission_rate }, { header: 'commission', value: (r: any) => r.commission }])}>{t('تصدير', 'Export')}</Button>
        <Button icon={Printer} onClick={() => printElement(<TablePrint title={t('عمولات المندوبين', 'Sales commissions')} subtitle={`${date(range.from)} — ${date(range.to)}`} rows={rows} columns={[
          { header: t('المندوب', 'Salesperson'), value: (r) => r.label }, { header: t('الفواتير', 'Invoices'), value: (r) => int(r.documents), align: 'end' }, { header: t('صافي المبيعات', 'Net sales'), value: (r) => money(r.net), align: 'end' },
          { header: t('النسبة', 'Rate'), value: (r) => percent(r.commission_rate), align: 'end' }, { header: t('العمولة', 'Commission'), value: (r) => money(r.commission), align: 'end' },
        ]} totals={[t('الإجمالي', 'Total'), '', money(totals.net), '', money(commission)]} />, { paper: 'A4', title: 'commissions' })}>{t('طباعة', 'Print')}</Button>
      </>} />
      {error && <ErrorBox error={error} />}
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-hidden rounded-lg" style={{ border: '1px solid var(--rule)' }}>
        <DataTable rows={rows} loading={isLoading} footer maxHeight="100%" rowKey={(r: any) => r.key_id} onOpen={() => navigate('/reports/sales')} columns={[
          { key: 'label', header: t('المندوب', 'Salesperson'), render: (r: any) => r.label, footer: t('الإجمالي', 'Total') },
          { key: 'documents', header: t('الفواتير', 'Invoices'), align: 'end', width: 90, render: (r: any) => <span className="num">{int(r.documents)}</span> },
          { key: 'net', header: t('صافي المبيعات', 'Net sales'), align: 'end', width: 140, render: (r: any) => <b><Money value={r.net} paren /></b>, footer: <Money value={totals.net} /> },
          { key: 'returns', header: t('المرتجعات', 'Returns'), align: 'end', width: 110, render: (r: any) => <Money value={r.returns} className={toNumber(r.returns) ? 'neg' : 'muted'} />, footer: <Money value={totals.returns} /> },
          ...(withProfit ? [{ key: 'profit', header: t('الربح', 'Profit'), align: 'end' as const, width: 120, render: (r: any) => <Money value={r.profit} paren colored />, footer: <Money value={totals.profit} /> }, { key: 'margin', header: t('الهامش', 'Margin'), align: 'end' as const, width: 80, render: (r: any) => <span className="num">{r.margin !== null ? percent(r.margin) : '—'}</span> }] : []),
          { key: 'collected', header: t('محصل عند البيع', 'Collected at sale'), align: 'end', width: 130, render: (r: any) => <Money value={r.collected_at_sale} /> },
          { key: 'rate', header: t('نسبة العمولة', 'Rate'), align: 'end', width: 90, render: (r: any) => <span className="num">{percent(r.commission_rate)}</span> },
          { key: 'commission', header: t('العمولة', 'Commission'), align: 'end', width: 120, render: (r: any) => <b><Money value={r.commission} /></b>, footer: <Money value={commission} /> },
        ]} />
      </div>
    </div>
  )
}
