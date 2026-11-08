import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownToLine, BadgeCheck, CornerUpLeft, ExternalLink, Forward, OctagonX, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { date, datetime, today } from '@/lib/format'
import { statusLabel } from '@/lib/docTypes'
import { nameOf, useT } from '@/store/prefs'
import { can } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { Button, ErrorBox, Field, Input, Kv, Money, Sheet, Spinner } from '@/components/ui'
import { LookupSelect, PartyPicker } from '@/components/Pickers'
import { Modal } from '@/components/Dialogs'
import { Stamp } from '@/components/Status'

interface Action { key: string; label: string; icon: LucideIcon; needs?: 'bank' | 'supplier'; danger?: boolean; hint: string }

/** One cheque: details, history, and the next steps its status allows. */
export default function ChequeView() {
  const t = useT()
  const { params } = useTab()
  const { data, isLoading, error, refetch } = useApi<any>(`/cheques/${params.id}`)
  const [action, setAction] = useState<Action | null>(null)
  const cheque = data?.data
  useTabTitle(cheque ? `${t('شيك', 'Cheque')} ${cheque.number}` : undefined)
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />

  const actions: Action[] = []
  const s = cheque.status
  if (cheque.direction === 'received') {
    if (['in_portfolio', 'bounced'].includes(s)) actions.push({ key: 'deposit', label: s === 'bounced' ? t('إعادة إيداع', 'Re-deposit') : t('إيداع بالبنك', 'Deposit'), icon: ArrowDownToLine, needs: 'bank', hint: t('يُرسل الشيك للبنك للتحصيل.', 'Send the cheque to the bank for collection.') })
    if (['in_portfolio', 'deposited'].includes(s)) actions.push({ key: 'collect', label: t('تم التحصيل', 'Collected'), icon: BadgeCheck, needs: s === 'in_portfolio' ? 'bank' : undefined, hint: t('يُضاف المبلغ لرصيد البنك.', 'The amount is added to the bank balance.') })
    if (['in_portfolio', 'deposited'].includes(s)) actions.push({ key: 'bounce', label: t('مرتد', 'Bounced'), icon: OctagonX, danger: true, hint: t('يعود المبلغ مديونية على العميل وتعود الفواتير مفتوحة.', 'The amount is owed by the customer again and the invoices reopen.') })
    if (['in_portfolio', 'bounced'].includes(s)) actions.push({ key: 'return', label: t('رد للعميل', 'Return to customer'), icon: CornerUpLeft, hint: t('يُسلم الشيك للعميل ويبقى المبلغ مديونية عليه.', 'The cheque is handed back; the customer still owes the amount.') })
    if (s === 'in_portfolio') actions.push({ key: 'endorse', label: t('تظهير لمورد', 'Endorse to supplier'), icon: Forward, needs: 'supplier', hint: t('يُستخدم الشيك لسداد مستحقات مورد.', 'Use the cheque to pay a supplier.') })
  } else if (s === 'issued') {
    actions.push({ key: 'clear', label: t('تم الصرف من البنك', 'Cleared by bank'), icon: BadgeCheck, hint: t('يُخصم المبلغ من رصيد البنك.', 'The amount leaves the bank balance.') })
    actions.push({ key: 'cancel', label: t('إلغاء الشيك', 'Cancel cheque'), icon: XCircle, danger: true, hint: t('يعود المبلغ مستحقاً للمورد.', 'The amount is owed to the supplier again.') })
  }

  return (
    <div className="pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--rule)' }}>
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[18px] font-semibold">{cheque.direction === 'received' ? t('شيك وارد', 'Received cheque') : t('شيك صادر', 'Issued cheque')} <span className="num muted">{cheque.number}</span></h1>
          <Stamp status={s} />
        </div>
        <div className="flex flex-wrap gap-2">
          {cheque.voucher && <Button icon={ExternalLink} onClick={() => navigate(`/finance/vouchers/any/${cheque.voucher.id}`)}>{t('السند', 'Voucher')} {cheque.voucher.number}</Button>}
          {can('cheques.manage') && actions.map((a) => <Button key={a.key} icon={a.icon} variant={a.danger ? 'ghost' : 'default'} onClick={() => setAction(a)}>{a.label}</Button>)}
        </div>
      </div>
      <div className="grid gap-4 px-5 pt-4" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <Sheet bodyClassName="px-4 py-2">
          <Kv label={t('المبلغ', 'Amount')}><span className="text-[16px] font-semibold"><Money value={cheque.amount} /></span></Kv>
          <Kv label={t('تاريخ الاستحقاق', 'Due date')}><span className={`num ${['in_portfolio', 'deposited', 'issued'].includes(s) && cheque.due_date <= today() ? 'neg font-semibold' : ''}`}>{date(cheque.due_date)}</span></Kv>
          <Kv label={t('تاريخ الإصدار', 'Issue date')}><span className="num">{date(cheque.issue_date)}</span></Kv>
          <Kv label={t('البنك', 'Bank')}>{cheque.bank_name ?? nameOf(cheque.cash_account)}</Kv>
          <Kv label={cheque.direction === 'received' ? t('العميل', 'Customer') : t('المورد', 'Supplier')}>{cheque.party ? <button className="link" onClick={() => navigate(`/parties/view/${cheque.party.id}`)}>{cheque.party.name}</button> : '—'}</Kv>
          {cheque.drawer_name && <Kv label={t('الساحب', 'Drawer')}>{cheque.drawer_name}</Kv>}
          {cheque.cash_account && <Kv label={t('حساب البنك', 'Bank account')}>{nameOf(cheque.cash_account)}</Kv>}
          {cheque.notes && <Kv label={t('ملاحظات', 'Notes')}>{cheque.notes}</Kv>}
        </Sheet>
        <Sheet title={t('سجل الشيك', 'History')}>
          <ol className="m-0 list-none p-0">
            {cheque.events.map((e: any) => (
              <li key={e.id} className="flex gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--rule)' }}>
                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: 'var(--ledger)' }} />
                <div className="flex-1">
                  <div className="font-medium">{statusLabel(e.event)}</div>
                  <div className="muted text-[12px]"><span className="num">{date(e.date)}</span>{e.cash_account ? ` · ${e.cash_account.name}` : ''}{e.user ? ` · ${e.user.name}` : ''}{e.note ? ` · ${e.note}` : ''}</div>
                </div>
                <span className="muted num text-[11px]">{datetime(e.created_at)}</span>
              </li>
            ))}
          </ol>
        </Sheet>
      </div>
      {action && <ActionDialog cheque={cheque} action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); invalidate('/cheques', '/cash-accounts', '/parties', '/documents', '/reports'); void refetch() }} />}
    </div>
  )
}

function ActionDialog({ cheque, action, onClose, onDone }: { cheque: any; action: Action; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [day, setDay] = useState(today())
  const [bank, setBank] = useState<number | null>(cheque.cash_account_id ?? null)
  const [supplier, setSupplier] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`${action.label} — ${cheque.number}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>{t('رجوع', 'Back')}</Button>
      <Button variant="primary" loading={busy} onClick={async () => {
        if (action.needs === 'bank' && !bank) return toast.error(t('اختر حساب البنك.', 'Choose the bank account.'))
        if (action.needs === 'supplier' && !supplier) return toast.error(t('اختر المورد.', 'Choose the supplier.'))
        setBusy(true)
        try {
          await api.post(`/cheques/${cheque.id}/${action.key}`, { date: day, cash_account_id: bank, party_id: supplier, note: note || null })
          toast.success(t('تم', 'Done'))
          onDone()
        } catch (e: any) {
          toast.error(e.message)
        } finally {
          setBusy(false)
        }
      }}>{t('تأكيد', 'Confirm')}</Button>
    </>}>
      <p className="muted mt-0 text-[13px]">{action.hint}</p>
      <div className="grid gap-3">
        <Field label={t('التاريخ', 'Date')}><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        {action.needs === 'bank' && <Field label={t('حساب البنك', 'Bank account')}><LookupSelect kind="cash_accounts" value={bank} filter={(c) => c.type === 'bank'} onChange={setBank} /></Field>}
        {action.needs === 'supplier' && <Field label={t('المورد', 'Supplier')}><PartyPicker role="supplier" value={supplier} onChange={(id) => setSupplier(id)} /></Field>}
        <Field label={t('ملاحظة', 'Note')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
