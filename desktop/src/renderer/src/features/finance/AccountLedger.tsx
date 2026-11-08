import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, money, startOfYear, today } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { DateRange } from '@/components/DateRange'
import { LookupSelect, PartyPicker } from '@/components/Pickers'
import { StatementTable } from '@/components/Statement'
import { Button, ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint } from '@/features/print/templates'

/** General ledger for one account (including its sub-accounts). */
export default function AccountLedger() {
  const t = useT()
  const { params } = useTab()
  const [range, setRange] = useState({ from: startOfYear(), to: today() })
  const [party, setParty] = useState<number | null>(null)
  const [costCenter, setCostCenter] = useState<number | null>(null)
  const { data, isLoading, error } = useApi<any>(`/accounts/${params.id}/ledger`, { ...range, party_id: party, cost_center_id: costCenter })
  useTabTitle(data ? `${t('أستاذ', 'Ledger')} ${data.account.code}` : undefined)
  if (isLoading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const title = `${data.account.code} — ${nameOf(data.account)}`
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} subtitle={t('دفتر الأستاذ العام', 'General ledger')} actions={<>
        <DateRange value={range} onChange={setRange} />
        <div className="w-52"><PartyPicker value={party} onChange={(id) => setParty(id)} placeholder={t('كل الأطراف', 'All parties')} /></div>
        <div className="w-40"><LookupSelect kind="cost_centers" value={costCenter} onChange={setCostCenter} placeholder={t('كل مراكز التكلفة', 'All cost centres')} /></div>
        <Button icon={Printer} onClick={() => printElement(<TablePrint title={`${t('دفتر أستاذ', 'Ledger')}: ${title}`} subtitle={`${date(range.from)} — ${date(range.to)}`} rows={[{ description: t('رصيد أول المدة', 'Opening balance'), debit: '', credit: '', balance: data.opening_balance }, ...data.lines]} columns={[
          { header: t('التاريخ', 'Date'), value: (r) => (r.date ? date(r.date) : '') }, { header: t('القيد', 'Entry'), value: (r) => r.number ?? '' }, { header: t('البيان', 'Description'), value: (r) => r.line_description || r.description || '' },
          { header: t('مدين', 'Debit'), value: (r) => (r.debit ? money(r.debit) : ''), align: 'end' }, { header: t('دائن', 'Credit'), value: (r) => (r.credit ? money(r.credit) : ''), align: 'end' }, { header: t('الرصيد', 'Balance'), value: (r) => money(r.balance, { paren: true }), align: 'end' },
        ]} totals={['', '', t('الإجمالي', 'Totals'), money(data.total_debit), money(data.total_credit), money(data.closing_balance, { paren: true })]} />, { paper: 'A4', title: data.account.code })}>{t('طباعة', 'Print')}</Button>
      </>} />
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-auto rounded-lg sheet">
        <StatementTable lines={data.lines.map((l: any) => ({ ...l, description: [l.line_description || l.description, data.account.is_group ? `(${l.account_code} ${l.account_name})` : ''].filter(Boolean).join(' ') }))} opening={data.opening_balance} closing={data.closing_balance} showParty />
      </div>
    </div>
  )
}
