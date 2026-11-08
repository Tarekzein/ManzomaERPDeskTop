import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ListPage } from '@/components/ListPage'
import { DateRange, type Range } from '@/components/DateRange'
import { LookupSelect } from '@/components/Pickers'
import { Button, Money, Select } from '@/components/ui'
import { StatusPill } from '@/components/Status'
import { METHODS, VOUCHER_KINDS, statusLabel } from '@/lib/docTypes'
import { date, money, startOfMonth, today } from '@/lib/format'
import { nameOf, tr, useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'

type Kind = keyof typeof VOUCHER_KINDS

export default function Vouchers() {
  const t = useT()
  const allowed = useCan()
  const { params, query } = useTab()
  const kind = params.kind as Kind
  const meta = VOUCHER_KINDS[kind]
  const [range, setRange] = useState<Range>({ from: startOfMonth(), to: today() })
  const [status, setStatus] = useState('')
  const [method, setMethod] = useState('')
  const [cash, setCash] = useState<number | null>(null)
  const filter = kind === 'expense' ? { expenses: 1 } : kind === 'payment' ? { type: 'payment', with_party: 1 } : { type: kind }
  const who = (r: any) => (r.party ? nameOf(r.party) : r.type === 'transfer' ? nameOf(r.to_cash_account) : r.payee || nameOf(r.account))
  return (
    <ListPage
      title={tr(meta.pluralAr, meta.pluralEn)}
      path="/vouchers"
      params={{ ...filter, ...range, status, method, cash_account_id: cash, party_id: query.get('party') ?? undefined }}
      onOpen={(r) => navigate(`/finance/vouchers/${kind}/${r.id}`)}
      actions={allowed(kind === 'expense' ? ['expenses.manage', 'vouchers.manage'] : 'vouchers.manage') && <Button variant="primary" icon={Plus} kbd="F2" onClick={() => navigate(`/finance/vouchers/${kind}/new`)}>{t('جديد', 'New')}</Button>}
      searchPlaceholder={t('الرقم أو البيان أو الاسم', 'Number, description or name')}
      filters={<>
        <DateRange value={range} onChange={setRange} />
        <div className="w-44"><LookupSelect kind="cash_accounts" value={cash} onChange={setCash} placeholder={t('كل الخزائن', 'All cash accounts')} /></div>
        {kind !== 'transfer' && <Select className="w-auto" value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t('كل الطرق', 'Any method')} options={Object.entries(METHODS).map(([value, [ar, en]]) => ({ value, label: tr(ar, en) }))} />}
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('كل الحالات', 'All statuses')} options={['draft', 'posted', 'void'].map((s) => ({ value: s, label: statusLabel(s) }))} />
      </>}
      summary={(totals) => totals && (
        <div className="sheet figure-band">
          <div><div className="muted text-[12px]">{t('عدد السندات المرحلة', 'Posted vouchers')}</div><div className="figure">{totals.count}</div></div>
          <div><div className="muted text-[12px]">{t('الإجمالي', 'Total')}</div><div className="figure">{money(totals.amount)}</div></div>
        </div>
      )}
      csvName={kind}
      csv={[{ header: 'number', value: (r: any) => r.number }, { header: 'date', value: (r: any) => r.date }, { header: 'name', value: who }, { header: 'description', value: (r: any) => r.description }, { header: 'amount', value: (r: any) => r.amount }, { header: 'status', value: (r: any) => r.status }]}
      columns={[
        { key: 'number', header: t('الرقم', 'Number'), sortKey: 'number', width: 130, render: (r: any) => <span className="num font-medium">{r.number.startsWith('D-') ? t('مسودة', 'Draft') : r.number}</span> },
        { key: 'date', header: t('التاريخ', 'Date'), sortKey: 'date', width: 100, render: (r: any) => <span className="num">{date(r.date)}</span> },
        { key: 'who', header: kind === 'receipt' ? t('من', 'From') : kind === 'transfer' ? t('إلى', 'To') : kind === 'expense' ? t('بند المصروف', 'Expense') : t('إلى', 'To'), render: (r: any) => who(r) },
        { key: 'cash', header: kind === 'transfer' ? t('من', 'From') : t('الخزينة', 'Cash account'), width: 150, render: (r: any) => nameOf(r.cash_account) || (r.method === 'cheque' ? t('حافظة الشيكات', 'Cheque portfolio') : '') },
        ...(kind !== 'transfer' ? [{ key: 'method', header: t('الطريقة', 'Method'), width: 100, render: (r: any) => tr(...(METHODS[r.method] ?? [r.method, r.method])) }] : []),
        { key: 'description', header: t('البيان', 'Description'), render: (r: any) => <span className="muted">{r.description}</span> },
        { key: 'amount', header: t('المبلغ', 'Amount'), align: 'end', sortKey: 'amount', width: 130, render: (r: any) => <Money value={r.amount} /> },
        { key: 'status', header: t('الحالة', 'Status'), width: 90, render: (r: any) => <StatusPill status={r.status} /> },
      ]}
    />
  )
}
