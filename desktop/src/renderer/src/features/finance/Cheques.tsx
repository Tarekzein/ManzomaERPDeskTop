import { useState } from 'react'
import { ListPage } from '@/components/ListPage'
import { Money, Segmented, Select, Field, Input } from '@/components/ui'
import { StatusPill } from '@/components/Status'
import { statusLabel } from '@/lib/docTypes'
import { addDays, date, money, today } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'

export const CHEQUE_STATUSES = {
  received: ['in_portfolio', 'deposited', 'collected', 'bounced', 'returned', 'endorsed', 'cancelled'],
  issued: ['issued', 'cleared', 'cancelled'],
}

/** Cheque portfolio (received) and our issued cheques, ordered by due date. */
export default function Cheques() {
  const t = useT()
  const { query } = useTab()
  const [direction, setDirection] = useState<'received' | 'issued'>((query.get('direction') as any) ?? 'received')
  const [status, setStatus] = useState(query.get('due') ? (direction === 'received' ? 'in_portfolio,deposited' : 'issued') : '')
  const [dueTo, setDueTo] = useState(query.get('due') ? addDays(today(), Number(query.get('due'))) : '')
  const [dueFrom, setDueFrom] = useState('')
  const open = direction === 'received' ? 'in_portfolio,deposited' : 'issued'
  return (
    <ListPage
      title={t('الشيكات', 'Cheques')}
      path="/cheques"
      params={{ direction, status, due_from: dueFrom, due_to: dueTo }}
      defaultSort="due_date"
      onOpen={(r) => navigate(`/finance/cheques/${r.id}`)}
      searchPlaceholder={t('رقم الشيك أو البنك أو الساحب', 'Cheque no., bank or drawer')}
      filters={<>
        <Segmented value={direction} onChange={(v) => { setDirection(v); setStatus('') }} options={[{ value: 'received', label: t('أوراق قبض (واردة)', 'Received') }, { value: 'issued', label: t('أوراق دفع (صادرة)', 'Issued') }]} />
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('كل الحالات', 'All statuses')} options={[{ value: open, label: t('المفتوحة فقط', 'Open only') }, ...CHEQUE_STATUSES[direction].map((s) => ({ value: s, label: statusLabel(s) }))]} />
        <Field label={t('استحقاق من', 'Due from')}><Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} /></Field>
        <Field label={t('إلى', 'to')}><Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} /></Field>
      </>}
      summary={(totals) => totals && (
        <div className="sheet figure-band">
          <div><div className="muted text-[12px]">{t('عدد الشيكات', 'Cheques')}</div><div className="figure">{totals.count}</div></div>
          <div><div className="muted text-[12px]">{t('الإجمالي', 'Total')}</div><div className="figure">{money(totals.amount)}</div></div>
        </div>
      )}
      rowClassName={(r: any) => (['in_portfolio', 'deposited', 'issued'].includes(r.status) && r.due_date < today() ? 'row-alert' : undefined)}
      csvName={`cheques-${direction}`}
      csv={[{ header: 'number', value: (r: any) => r.number }, { header: 'bank', value: (r: any) => r.bank_name }, { header: 'due_date', value: (r: any) => r.due_date }, { header: 'party', value: (r: any) => nameOf(r.party) }, { header: 'amount', value: (r: any) => r.amount }, { header: 'status', value: (r: any) => statusLabel(r.status) }]}
      columns={[
        { key: 'due_date', header: t('الاستحقاق', 'Due'), sortKey: 'due_date', width: 100, render: (r: any) => <span className={`num ${['in_portfolio', 'deposited', 'issued'].includes(r.status) && r.due_date <= today() ? 'neg font-semibold' : ''}`}>{date(r.due_date)}</span> },
        { key: 'number', header: t('رقم الشيك', 'Cheque no.'), sortKey: 'number', width: 120, render: (r: any) => <span className="num">{r.number}</span> },
        { key: 'bank', header: t('البنك', 'Bank'), width: 150, render: (r: any) => r.bank_name ?? nameOf(r.cash_account) },
        { key: 'party', header: direction === 'received' ? t('من', 'From') : t('إلى', 'To'), render: (r: any) => nameOf(r.party) || r.drawer_name },
        { key: 'voucher', header: t('السند', 'Voucher'), width: 120, render: (r: any) => <span className="num muted">{r.voucher?.number}</span> },
        { key: 'amount', header: t('المبلغ', 'Amount'), align: 'end', sortKey: 'amount', width: 130, render: (r: any) => <Money value={r.amount} /> },
        { key: 'status', header: t('الحالة', 'Status'), width: 110, render: (r: any) => <StatusPill status={r.status} /> },
      ]}
    />
  )
}
