import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, money, today } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { DateRange } from '@/components/DateRange'
import { StatementTable } from '@/components/Statement'
import { Button, ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint } from '@/features/print/templates'

/** Cash book for one box or bank: what came in, what went out, running balance. */
export default function CashStatement() {
  const t = useT()
  const { params } = useTab()
  const [range, setRange] = useState({ from: today(), to: today() })
  const { data, isLoading, error } = useApi<any>(`/cash-accounts/${params.id}/statement`, range)
  useTabTitle(data ? nameOf(data.cash_account) : undefined)
  if (isLoading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const title = nameOf(data.cash_account)
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} subtitle={t('حركة الخزينة', 'Cash book')} actions={<>
        <DateRange value={range} onChange={setRange} />
        <Button icon={Printer} onClick={() => printElement(<TablePrint title={`${t('حركة', 'Cash book')}: ${title}`} subtitle={`${date(range.from)} — ${date(range.to)}`} rows={[{ description: t('رصيد أول المدة', 'Opening balance'), balance: data.opening_balance }, ...data.lines]} columns={[
          { header: t('التاريخ', 'Date'), value: (r) => (r.date ? date(r.date) : '') }, { header: t('المرجع', 'Ref.'), value: (r) => r.reference ?? '' }, { header: t('البيان', 'Description'), value: (r) => r.description ?? '' },
          { header: t('وارد', 'In'), value: (r) => (r.debit ? money(r.debit) : ''), align: 'end' }, { header: t('منصرف', 'Out'), value: (r) => (r.credit ? money(r.credit) : ''), align: 'end' }, { header: t('الرصيد', 'Balance'), value: (r) => money(r.balance), align: 'end' },
        ]} totals={['', '', t('الإجمالي', 'Totals'), money(data.total_in), money(data.total_out), money(data.closing_balance)]} />, { paper: 'A4', title: 'cash-book' })}>{t('طباعة', 'Print')}</Button>
      </>} />
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-auto rounded-lg sheet">
        <StatementTable lines={data.lines} opening={data.opening_balance} closing={data.closing_balance} debitLabel={t('وارد', 'In')} creditLabel={t('منصرف', 'Out')} />
      </div>
    </div>
  )
}
