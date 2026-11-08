import { useState } from 'react'
import { Stamp } from 'lucide-react'
import { Modal } from '@/components/Dialogs'
import { Button, Check, Field, Input, NumberInput, Select } from '@/components/ui'
import { docLabel, METHODS, type TradeType } from '@/lib/docTypes'
import { money, today } from '@/lib/format'
import { nameOf, usePrefs, useT } from '@/store/prefs'
import { currency, useSession } from '@/store/session'

type PaymentMode = 'credit' | 'full' | 'partial'

/** Review the total and payment before using the existing document-posting workflow. */
export function PostDialog({ type, total, onClose, onPost, busy }: { type: TradeType; total: number; onClose: () => void; onPost: (options: any) => void; busy: boolean }) {
  const t = useT()
  const rtl = usePrefs((state) => state.locale === 'ar')
  const user = useSession((state) => state.user)
  const cashAccounts = useSession((state) => state.lookups?.cash_accounts ?? [])
  const isInvoice = type === 'sales_invoice' || type === 'purchase_invoice'
  const isReturn = type.endsWith('return')
  const [mode, setMode] = useState<PaymentMode>(type === 'sales_invoice' ? 'full' : 'credit')
  const [amount, setAmount] = useState(total)
  const [cashId, setCashId] = useState<number | null>(user?.default_cash_account_id ?? cashAccounts[0]?.id ?? null)
  const [method, setMethod] = useState('cash')
  const [tendered, setTendered] = useState(0)
  const [print, setPrint] = useState(type === 'sales_invoice')
  const [cheque, setCheque] = useState({ number: '', bank_name: '', due_date: today() })
  const [submitted, setSubmitted] = useState(false)
  const paying = mode === 'full' ? total : mode === 'partial' ? Math.max(0, Math.min(amount, total)) : 0
  const cashRequired = paying > 0 && !(method === 'cheque' && type === 'sales_invoice')
  const eligibleAccounts = cashAccounts.filter((account: any) => method === 'cheque' ? account.type === 'bank' : method === 'cash' ? account.type === 'cash' : true)
  const amountError = mode === 'partial' && (amount <= 0 || amount > total) ? t('أدخل مبلغاً أكبر من صفر ولا يتجاوز الإجمالي.', 'Enter an amount above zero and no greater than the total.') : null
  const cashError = cashRequired && !eligibleAccounts.some((account: any) => account.id === cashId) ? t('اختر الخزينة أو البنك الذي سُجلت به الدفعة.', 'Choose the cash or bank account for this payment.') : null
  const numberError = paying > 0 && method === 'cheque' && !cheque.number.trim() ? t('أدخل رقم الشيك.', 'Enter the cheque number.') : null
  const choices: { value: PaymentMode; label: string; hint: string }[] = isInvoice ? [
    { value: 'full', label: t('مدفوع بالكامل', 'Paid in full'), hint: t('تسجيل الدفعة الآن', 'Record payment now') },
    { value: 'partial', label: t('دفعة جزئية', 'Part payment'), hint: t('دفع جزء والباقي آجل', 'Pay part, collect the rest later') },
    { value: 'credit', label: t('آجل', 'On credit'), hint: t('التحصيل لاحقاً', 'Collect later') },
  ] : [
    { value: 'credit', label: t('رصيد دائن للحساب', 'Credit to account'), hint: t('بدون رد نقدي', 'No cash refund') },
    { value: 'full', label: t('رد نقدي بالكامل', 'Full cash refund'), hint: t('رد كامل المبلغ', 'Refund the full amount') },
    { value: 'partial', label: t('رد جزء نقداً', 'Part cash refund'), hint: t('والباقي رصيد للحساب', 'Keep the rest as account credit') },
  ]
  const submit = () => {
    setSubmitted(true)
    if (amountError || cashError || numberError) return
    if (isInvoice && paying > 0) onPost({ payment: { amount: paying, cash_account_id: method === 'cheque' && type === 'sales_invoice' ? null : cashId, method, cheque: method === 'cheque' ? cheque : undefined }, print, tendered })
    else if (isReturn && paying > 0) onPost({ refund: { amount: paying, cash_account_id: cashId, method: 'cash' } })
    else onPost({ print })
  }
  return <Modal title={t('مراجعة وترحيل ', 'Review and post ') + docLabel(type)} busy={busy} onClose={onClose} footer={<>
    <Button disabled={busy} onClick={onClose}>{t('رجوع', 'Back')}</Button>
    <Button variant="primary" icon={Stamp} loading={busy} onClick={submit}>{t('تأكيد الترحيل', 'Confirm posting')} <span className="num">{money(total)}</span></Button>
  </>}>
    <fieldset disabled={busy} className="m-0 grid min-w-0 gap-5 border-0 p-0">
      <div className="post-summary"><span>{t('صافي المبلغ المستحق', 'Net amount due')}</span><strong className="num">{money(total)} <span className="text-[12px] font-medium">{currency()}</span></strong></div>
      {(isInvoice || isReturn) && <>
        <div role="radiogroup" aria-label={t('حالة السداد', 'Payment status')} className="payment-options">{choices.map((choice, index) => <button key={choice.value} type="button" role="radio" aria-checked={mode === choice.value} className="payment-choice" tabIndex={mode === choice.value ? 0 : -1} onClick={() => setMode(choice.value)} onKeyDown={(event) => {
          const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' ? rtl ? -1 : 1 : event.key === 'ArrowLeft' ? rtl ? 1 : -1 : 0
          if (!step) return
          event.preventDefault()
          const next = (index + step + choices.length) % choices.length
          setMode(choices[next].value)
          const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
          buttons?.[next]?.focus()
        }}><strong>{choice.label}</strong><small>{choice.hint}</small></button>)}</div>
        {mode !== 'credit' && <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'partial' && <Field label={t('المبلغ المدفوع', 'Payment amount')} error={submitted ? amountError : null}><NumberInput autoFocus min={0} max={total} value={amount} onChange={setAmount} /></Field>}
          {isInvoice && <Field label={t('طريقة الدفع', 'Payment method')}><Select value={method} onChange={(event) => {
            const next = event.target.value
            setMethod(next)
            const allowed = cashAccounts.filter((account: any) => next === 'cheque' ? account.type === 'bank' : next === 'cash' ? account.type === 'cash' : true)
            if (!allowed.some((account: any) => account.id === cashId)) setCashId(allowed[0]?.id ?? null)
          }} options={Object.entries(METHODS).map(([key, labels]) => ({ value: key, label: t(...labels) }))} /></Field>}
          {(method !== 'cheque' || type === 'purchase_invoice') && <Field label={method === 'cheque' ? t('البنك المسحوب عليه', 'Drawn on bank') : t('الخزينة / البنك', 'Cash box / bank')} error={submitted ? cashError : null}><Select value={cashId ?? ''} placeholder={t('اختر الحساب', 'Choose account')} onChange={(event) => setCashId(Number(event.target.value) || null)} options={eligibleAccounts.map((account: any) => ({ value: account.id, label: nameOf(account) }))} /></Field>}
          {method === 'cheque' && <>
            <Field label={t('رقم الشيك', 'Cheque number')} error={submitted ? numberError : null}><Input value={cheque.number} onChange={(event) => setCheque({ ...cheque, number: event.target.value })} /></Field>
            <Field label={t('البنك', 'Bank')}><Input value={cheque.bank_name} onChange={(event) => setCheque({ ...cheque, bank_name: event.target.value })} /></Field>
            <Field label={t('تاريخ الاستحقاق', 'Due date')}><Input type="date" value={cheque.due_date} onChange={(event) => setCheque({ ...cheque, due_date: event.target.value })} /></Field>
          </>}
          {type === 'sales_invoice' && method === 'cash' && <Field label={t('المبلغ المستلم من العميل', 'Cash tendered')} hint={tendered > paying ? `${t('الباقي للعميل', 'Change')}: ${money(tendered - paying)}` : undefined}><NumberInput value={tendered} onChange={setTendered} /></Field>}
        </div>}
        {isInvoice && <div className="payment-balance"><span>{t('مدفوع الآن', 'Paid now')}: <strong className="num">{money(paying)}</strong></span><span>{t('المتبقي على الحساب', 'Remaining on account')}: <strong className="num">{money(Math.max(0, total - paying))}</strong></span></div>}
        {type === 'sales_invoice' && <Check checked={print} onChange={setPrint} label={t('طباعة إيصال حراري بعد الترحيل', 'Print a thermal receipt after posting')} />}
      </>}
      <p className="m-0 text-[12px] muted">{t('بعد الترحيل يُحفظ المستند نهائياً. يمكن التصحيح بالإلغاء أو المرتجع حسب الصلاحيات.', 'Posting finalizes the document. Authorized corrections use voids or returns.')}</p>
    </fieldset>
  </Modal>
}
