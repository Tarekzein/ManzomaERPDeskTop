import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, CheckCheck, ExternalLink, Printer, Save, Trash2, Wand2 } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { METHODS, VOUCHER_KINDS } from '@/lib/docTypes'
import { date, money, round2, today, toNumber } from '@/lib/format'
import { amountInArabic, amountInEnglish } from '@/lib/words'
import { nameOf, tr, usePrefs, useT } from '@/store/prefs'
import { can, currency, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { AccountPicker, LookupSelect, PartyPicker } from '@/components/Pickers'
import { Button, ErrorBox, Field, Input, Kv, Money, NumberInput, Segmented, Select, Sheet, Spinner } from '@/components/ui'
import { confirmDialog, reasonDialog } from '@/components/Dialogs'
import { Stamp } from '@/components/Status'
import { printElement } from '@/features/print/printService'
import { VoucherPrint } from '@/features/print/templates'

type Kind = keyof typeof VOUCHER_KINDS

/**
 * Receipts, payments, expenses and cash transfers. Party vouchers settle
 * open invoices (manually or oldest first); cheques go to the portfolio.
 */
export default function VoucherEditor() {
  const t = useT()
  const tab = useTab()
  const locale = usePrefs((s) => s.locale)
  const id = tab.params.id
  const lookups = useSession((s) => s.lookups)
  const user = useSession((s) => s.user)
  const { data, isLoading, error, refetch } = useApi<any>(id ? `/vouchers/${id}` : null)
  const voucher = data?.data
  const kind: Kind = voucher ? (voucher.type === 'payment' && !voucher.party_id ? 'expense' : voucher.type) : tab.params.kind === 'any' ? 'receipt' : (tab.params.kind as Kind)
  const custom = useDynamicFields(`voucher_${kind}`, voucher)
  const meta = VOUCHER_KINDS[kind]
  const editable = !voucher || voucher.status === 'draft'
  const needsAccounts = kind === 'expense'
  const { data: accountsData } = useApi<any>(needsAccounts ? '/accounts' : null)
  const cashAccounts: any[] = lookups?.cash_accounts ?? []
  const banks = cashAccounts.filter((c) => c.type === 'bank')

  const [form, setForm] = useState<any>(() => ({
    date: today(), party_id: tab.query.get('party') ? Number(tab.query.get('party')) : null, party_account: null, account_id: null, cost_center_id: null,
    cash_account_id: user?.default_cash_account_id ?? cashAccounts[0]?.id ?? null, to_cash_account_id: null,
    amount: Number(tab.query.get('amount') ?? 0) || 0, tax_rate_id: null, method: 'cash', payee: '', reference: '', description: '',
  }))
  const [cheque, setCheque] = useState({ number: '', bank_name: '', due_date: today(), drawer_name: '', cash_account_id: banks[0]?.id ?? null })
  const [party, setParty] = useState<any>(null)
  const [partyBalance, setPartyBalance] = useState<number | null>(null)
  const [invoices, setInvoices] = useState<any[]>([])
  const [alloc, setAlloc] = useState<Record<number, number>>({})
  const [allocMode, setAllocMode] = useState<'auto' | 'manual' | 'none'>(tab.query.get('invoice') ? 'manual' : 'auto')
  const [busy, setBusy] = useState(false)
  const set = (p: any) => { setForm((f: any) => ({ ...f, ...p })); tab.setDirty(true) }
  useTabTitle(voucher ? `${tr(meta.ar, meta.en)} ${voucher.number.startsWith('D-') ? t('مسودة', 'draft') : voucher.number}` : undefined)

  useEffect(() => {
    if (!voucher) return
    setForm({
      date: voucher.date?.slice(0, 10), party_id: voucher.party_id, party_account: null, account_id: voucher.account_id, cost_center_id: voucher.cost_center_id,
      cash_account_id: voucher.cash_account_id, to_cash_account_id: voucher.to_cash_account_id, amount: toNumber(voucher.amount), tax_rate_id: voucher.tax_rate_id,
      method: voucher.method, payee: voucher.payee ?? '', reference: voucher.reference ?? '', description: voucher.description ?? '',
    })
    setParty(voucher.party)
  }, [voucher])

  // Which control account the party side hits: customers → AR, suppliers → AP.
  const partyAccount: 'ar' | 'ap' = form.party_account ?? (party ? (kind === 'receipt' ? (party.is_customer ? 'ar' : 'ap') : (party.is_supplier ? 'ap' : 'ar')) : kind === 'receipt' ? 'ar' : 'ap')

  useEffect(() => {
    if (!form.party_id || kind === 'expense' || kind === 'transfer') { setInvoices([]); return }
    api.get(`/parties/${form.party_id}`).then((r) => { setParty(r.data); setPartyBalance(toNumber(r.summary?.balance)) }).catch(() => undefined)
    if (!editable) return
    api.get(`/parties/${form.party_id}/open-invoices`, { type: partyAccount === 'ar' ? 'sales_invoice' : 'purchase_invoice' }).then((r) => {
      setInvoices(r.data)
      const pre = Number(tab.query.get('invoice'))
      if (pre) setAlloc({ [pre]: Math.min(toNumber(tab.query.get('amount')) || Infinity, toNumber(r.data.find((i: any) => i.id === pre)?.balance_due) - toNumber(r.data.find((i: any) => i.id === pre)?.paid_amount)) })
    })
  }, [form.party_id, partyAccount, editable])

  // Oldest-first allocation, used for the automatic preview and to prefill manual mode.
  const oldestFirst = useMemo(() => {
    let left = toNumber(form.amount)
    const out: Record<number, number> = {}
    for (const inv of invoices) {
      if (left <= 0) break
      const open = round2(toNumber(inv.balance_due) - toNumber(inv.paid_amount))
      const take = Math.min(open, left)
      if (take > 0) out[inv.id] = round2(take)
      left = round2(left - take)
    }
    return out
  }, [invoices, form.amount])
  const preview = allocMode === 'auto' ? oldestFirst : alloc
  const allocated = round2(Object.values(preview).reduce((s, v) => s + toNumber(v), 0))
  const unallocated = round2(toNumber(form.amount) - allocated)

  const vat = lookups?.tax_rates?.find((r: any) => r.id === form.tax_rate_id)
  const taxAmount = vat ? round2(form.amount - form.amount / (1 + toNumber(vat.rate) / 100)) : 0

  const body = (post: boolean) => ({
    ...custom.payload(),
    type: kind === 'expense' ? 'payment' : kind,
    date: form.date,
    party_id: kind === 'expense' || kind === 'transfer' ? null : form.party_id,
    party_account: kind === 'receipt' || kind === 'payment' ? partyAccount : null,
    account_id: kind === 'expense' ? form.account_id : null,
    cost_center_id: form.cost_center_id,
    cash_account_id: form.method === 'cheque' && kind !== 'transfer' ? null : form.cash_account_id,
    to_cash_account_id: kind === 'transfer' ? form.to_cash_account_id : null,
    amount: toNumber(form.amount),
    tax_rate_id: kind === 'expense' ? form.tax_rate_id : null,
    method: kind === 'transfer' ? 'bank_transfer' : form.method,
    payee: form.payee || null,
    reference: form.reference || null,
    description: form.description || null,
    post,
    ...(form.method === 'cheque' && kind !== 'transfer' ? { cheque: { ...cheque, cash_account_id: kind === 'receipt' ? null : cheque.cash_account_id } } : {}),
    ...(form.party_id && (kind === 'receipt' || kind === 'payment') ? (allocMode === 'auto' ? { auto_allocate: true } : allocMode === 'manual' ? { allocations: Object.entries(alloc).filter(([, v]) => toNumber(v) > 0).map(([document_id, amount]) => ({ document_id: Number(document_id), amount })) } : {}) : {}),
  })

  const validate = (): boolean => {
    if (!(toNumber(form.amount) > 0)) { toast.error(t('أدخل المبلغ.', 'Enter the amount.')); return false }
    if ((kind === 'receipt' || kind === 'payment') && !form.party_id) { toast.error(kind === 'receipt' ? t('اختر العميل.', 'Choose the customer.') : t('اختر المورد.', 'Choose the supplier.')); return false }
    if (kind === 'expense' && !form.account_id) { toast.error(t('اختر بند المصروف.', 'Choose the expense account.')); return false }
    if (kind === 'transfer' && (!form.to_cash_account_id || form.to_cash_account_id === form.cash_account_id)) { toast.error(t('اختر خزينة مختلفة للتحويل إليها.', 'Choose a different account to transfer to.')); return false }
    if (form.method === 'cheque' && kind !== 'transfer' && (!cheque.number || !cheque.due_date)) { toast.error(t('أدخل رقم الشيك وتاريخ استحقاقه.', 'Enter the cheque number and due date.')); return false }
    if (allocMode === 'manual' && allocated - toNumber(form.amount) > 0.001) { toast.error(t('المبالغ الموزعة أكبر من مبلغ السند.', 'Allocated amounts exceed the voucher amount.')); return false }
    return true
  }

  const save = async (post: boolean) => {
    if (!validate()) return
    if (post && !(await confirmDialog({ title: t('ترحيل السند؟', 'Post this voucher?'), message: `${money(form.amount)} ${currency()} — ${locale === 'ar' ? amountInArabic(toNumber(form.amount), currency()) : amountInEnglish(toNumber(form.amount), currency())}` }))) return
    setBusy(true)
    try {
      const r = id ? await api.put(`/vouchers/${id}`, body(post)) : await api.post('/vouchers', body(post))
      custom.acceptSaved(r.data)
      tab.setDirty(false)
      invalidate('/vouchers', '/cash-accounts', '/parties', '/documents', '/reports', '/cheques')
      toast.success(post ? t('تم ترحيل السند', 'Voucher posted') : t('تم حفظ المسودة', 'Draft saved'))
      if (post && r.data.status === 'posted' && can('vouchers.manage')) {
        void printElement(<VoucherPrint voucher={r.data} />, { paper: 'A5', title: r.data.number })
      }
      if (!id) tab.replace(`/finance/vouchers/${kind}/${r.data.id}`)
      else void refetch()
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (id && isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const words = toNumber(form.amount) > 0 ? (locale === 'ar' ? amountInArabic(toNumber(form.amount), currency()) : amountInEnglish(toNumber(form.amount), currency())) : ''

  return (
    <div className="pb-8">

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--rule)' }}>
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[18px] font-semibold">{tr(meta.ar, meta.en)} {voucher && !voucher.number.startsWith('D-') && <span className="num muted">{voucher.number}</span>}</h1>
          {voucher && <Stamp status={voucher.status} postedAt={voucher.posted_at} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {voucher?.cheque && <Button icon={ExternalLink} onClick={() => navigate(`/finance/cheques/${voucher.cheque.id}`)}>{t('الشيك', 'Cheque')} {voucher.cheque.number}</Button>}
          {voucher?.journal_entry_id && can('finance.reports') && <Button variant="ghost" onClick={() => navigate(`/finance/journals/${voucher.journal_entry_id}`)}>{t('القيد', 'Entry')}</Button>}
          {voucher && voucher.status !== 'draft' && <Button icon={Printer} onClick={() => printElement(<VoucherPrint voucher={voucher} />, { paper: 'A5', title: voucher.number })}>{t('طباعة', 'Print')}</Button>}
          {editable && voucher && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog({ title: t('حذف المسودة؟', 'Delete this draft?'), danger: true })) { await api.del(`/vouchers/${voucher.id}`); invalidate('/vouchers'); tab.close() } }} aria-label={t('حذف', 'Delete')} />}
          {editable && <Button icon={Save} loading={busy} onClick={() => save(false)} kbd="Ctrl+S">{t('حفظ مسودة', 'Save draft')}</Button>}
          {editable && can('vouchers.post') && <Button variant="primary" icon={CheckCheck} loading={busy} onClick={() => save(true)} kbd="F9">{t('ترحيل', 'Post')}</Button>}
          {voucher?.status === 'posted' && can('vouchers.void') && <Button variant="ghost" icon={Ban} onClick={async () => {
            const reason = await reasonDialog({ title: t('إلغاء السند', 'Void voucher'), message: t('سيتم عكس القيد وإلغاء توزيع المبلغ على الفواتير.', 'The entry is reversed and invoice allocations are removed.') })
            if (!reason) return
            try { await api.post(`/vouchers/${voucher.id}/void`, { reason }); invalidate('/vouchers', '/cash-accounts', '/parties', '/documents', '/reports', '/cheques'); void refetch() } catch (e: any) { toast.error(e.message) }
          }}>{t('إلغاء السند', 'Void')}</Button>}
        </div>
      </div>
      {voucher?.status === 'void' && <div className="mx-5 mt-4 sheet p-3 text-[13px] neg">{t('سبب الإلغاء', 'Void reason')}: {voucher.void_reason}</div>}

      <div className="grid gap-4 px-5 pt-4" style={{ gridTemplateColumns: kind === 'receipt' || kind === 'payment' ? 'minmax(0,1.3fr) minmax(0,1fr)' : 'minmax(0, 720px)' }}>
        <div className="grid content-start gap-4">
          <Sheet bodyClassName="grid grid-cols-2 gap-3 p-4">
            <div className="col-span-full">{custom.renderRecord(form, set, DOMAIN_FORM_WIDGETS, !editable)}{words && <p className="muted text-[12px]">{words}</p>}</div>

            {(kind === 'receipt' || kind === 'payment') && <>
              <Field label={kind === 'receipt' ? t('استلمنا من', 'Received from') : t('صرفنا إلى', 'Paid to')} className="col-span-2">
                <PartyPicker value={form.party_id} disabled={!editable} autoFocus={!id && !form.party_id} initialLabel={nameOf(party)} role={kind === 'receipt' ? undefined : undefined} onChange={(pid, p) => { set({ party_id: pid, party_account: null }); setParty(p); setAlloc({}) }} />
              </Field>
              {party?.is_customer && party?.is_supplier && editable && (
                <Field label={t('على حساب', 'Against')} className="col-span-2"><Segmented value={partyAccount} onChange={(v) => set({ party_account: v })} options={[{ value: 'ar', label: t('حساب العميل', 'Customer account') }, { value: 'ap', label: t('حساب المورد', 'Supplier account') }]} /></Field>
              )}
            </>}

            {kind === 'expense' && <>
              <Field label={t('بند المصروف', 'Expense account')} className="col-span-2"><AccountPicker accounts={accountsData?.data} value={form.account_id} filter={(a) => a.type === 'expense' && a.allow_manual} onChange={(aid) => set({ account_id: aid })} /></Field>
              <Field label={t('المستفيد', 'Payee')}><Input value={form.payee} disabled={!editable} onChange={(e) => set({ payee: e.target.value })} /></Field>
              <Field label={t('ضريبة القيمة المضافة', 'VAT')} hint={taxAmount ? `${t('منها ضريبة', 'Incl. VAT')} ${money(taxAmount)}` : t('المبلغ شامل الضريبة', 'Amount includes VAT')}>
                <Select value={form.tax_rate_id ?? ''} disabled={!editable} onChange={(e) => set({ tax_rate_id: e.target.value ? Number(e.target.value) : null })} placeholder={t('بدون ضريبة', 'No VAT')} options={(lookups?.tax_rates ?? []).filter((r: any) => r.type === 'vat').map((r: any) => ({ value: r.id, label: nameOf(r) }))} />
              </Field>
            </>}

            {kind === 'transfer' ? <>
              <Field label={t('من', 'From')}><LookupSelect kind="cash_accounts" value={form.cash_account_id} allowEmpty={false} onChange={(v) => set({ cash_account_id: v })} /></Field>
              <Field label={t('إلى', 'To')}><LookupSelect kind="cash_accounts" value={form.to_cash_account_id} filter={(c) => c.id !== form.cash_account_id} onChange={(v) => set({ to_cash_account_id: v })} /></Field>
            </> : <>
              <Field label={t('طريقة الدفع', 'Method')}><Select value={form.method} disabled={!editable} onChange={(e) => set({ method: e.target.value })} options={Object.entries(METHODS).map(([value, [ar, en]]) => ({ value, label: tr(ar, en) }))} /></Field>
              {form.method !== 'cheque' && <Field label={form.method === 'cash' ? t('الخزينة', 'Cash box') : t('الحساب', 'Account')}><LookupSelect kind="cash_accounts" value={form.cash_account_id} allowEmpty={false} filter={(c) => (form.method === 'cash' ? c.type === 'cash' : true)} onChange={(v) => set({ cash_account_id: v })} /></Field>}
            </>}

            {form.method === 'cheque' && kind !== 'transfer' && editable && (
              <div className="col-span-2 grid grid-cols-2 gap-3 rounded-md p-3" style={{ background: 'var(--sheet-2)', border: '1px dashed var(--rule-strong)' }}>
                <Field label={t('رقم الشيك', 'Cheque no.')}><Input value={cheque.number} onChange={(e) => setCheque({ ...cheque, number: e.target.value })} dir="ltr" /></Field>
                <Field label={t('تاريخ الاستحقاق', 'Due date')}><Input type="date" value={cheque.due_date} onChange={(e) => setCheque({ ...cheque, due_date: e.target.value })} /></Field>
                {kind === 'receipt' ? <>
                  <Field label={t('البنك المسحوب عليه', 'Drawn on bank')}><Input value={cheque.bank_name} onChange={(e) => setCheque({ ...cheque, bank_name: e.target.value })} /></Field>
                  <Field label={t('اسم الساحب', 'Drawer')}><Input value={cheque.drawer_name} placeholder={nameOf(party)} onChange={(e) => setCheque({ ...cheque, drawer_name: e.target.value })} /></Field>
                </> : (
                  <Field label={t('من حسابنا في بنك', 'From our bank account')} className="col-span-2"><LookupSelect kind="cash_accounts" value={cheque.cash_account_id} filter={(c) => c.type === 'bank'} onChange={(v) => setCheque({ ...cheque, cash_account_id: v })} /></Field>
                )}
                <div className="col-span-2 muted text-[12px]">{kind === 'receipt' ? t('يدخل الشيك حافظة الشيكات ولا يؤثر على البنك حتى يتم تحصيله.', 'The cheque goes to the portfolio and reaches the bank only when collected.') : t('يُسجّل الشيك كأوراق دفع حتى يُصرف من البنك.', 'The cheque is held as notes payable until it clears the bank.')}</div>
              </div>
            )}
            {voucher?.cheque && !editable && <Kv label={t('الشيك', 'Cheque')}><span className="num">{voucher.cheque.number} · {voucher.cheque.bank_name} · {date(voucher.cheque.due_date)}</span></Kv>}

            {kind !== 'transfer' && <Field label={t('مركز التكلفة', 'Cost centre')}><LookupSelect kind="cost_centers" value={form.cost_center_id} onChange={(v) => set({ cost_center_id: v })} /></Field>}
          </Sheet>
        </div>

        {(kind === 'receipt' || kind === 'payment') && (
          <div className="grid content-start gap-4">
            {party && partyBalance !== null && (
              <Sheet bodyClassName="px-4 py-2">
                <Kv label={t('الرصيد الحالي (مدين +)', 'Current balance (debit +)')}><Money value={partyBalance} paren colored /></Kv>
                {editable && toNumber(form.amount) > 0 && <Kv label={t('الرصيد بعد السند', 'Balance after')}><Money value={partyBalance + (kind === 'receipt' ? -1 : 1) * toNumber(form.amount)} paren colored /></Kv>}
              </Sheet>
            )}
            <Sheet title={t('سداد الفواتير', 'Settle invoices')} actions={editable && invoices.length > 0 && <Segmented value={allocMode} onChange={(v) => { setAllocMode(v); if (v === 'manual' && !Object.keys(alloc).length) setAlloc(oldestFirst) }} options={[{ value: 'auto', label: t('الأقدم أولاً', 'Oldest first') }, { value: 'manual', label: t('يدوي', 'Manual') }, { value: 'none', label: t('دفعة مقدمة', 'On account') }]} />}>
              {!editable ? (
                voucher?.allocations?.length ? (
                  <table className="ledger"><tbody>{voucher.allocations.map((a: any) => (
                    <tr key={a.id} className="cursor-pointer" onClick={() => navigate(`/docs/${a.document.type}/${a.document.id}`)}><td className="num">{a.document.number}</td><td className="num muted">{date(a.document.date)}</td><td className="amount"><Money value={a.amount} /></td></tr>
                  ))}</tbody></table>
                ) : <div className="muted p-4 text-[13px]">{t('لم يوزع على فواتير (دفعة على الحساب).', 'Not allocated to invoices (payment on account).')}</div>
              ) : !form.party_id ? <div className="muted p-4 text-[13px]">{t('اختر الطرف لعرض فواتيره المفتوحة.', 'Choose the party to see open invoices.')}</div> : invoices.length === 0 ? <div className="muted p-4 text-[13px]">{t('لا توجد فواتير مفتوحة. سيسجل المبلغ دفعة على الحساب.', 'No open invoices. The amount is recorded on account.')}</div> : (
                <>
                  <table className="ledger">
                    <thead><tr><th>{t('الفاتورة', 'Invoice')}</th><th>{t('الاستحقاق', 'Due')}</th><th className="amount">{t('المتبقي', 'Open')}</th><th className="amount" style={{ width: 130 }}>{t('يسدد', 'Settle')}</th></tr></thead>
                    <tbody>
                      {invoices.map((inv) => {
                        const open = round2(toNumber(inv.balance_due) - toNumber(inv.paid_amount))
                        const late = inv.due_date && inv.due_date < today()
                        return (
                          <tr key={inv.id}>
                            <td className="num">{inv.number}</td>
                            <td className={`num ${late ? 'neg' : 'muted'}`}>{date(inv.due_date)}</td>
                            <td className="amount"><Money value={open} /></td>
                            <td>{allocMode === 'manual' ? (
                              <div className="flex items-center gap-1">
                                <NumberInput small value={alloc[inv.id] ?? ''} onChange={(v) => setAlloc({ ...alloc, [inv.id]: Math.min(v, open) })} />
                                <button className="btn btn-ghost btn-sm btn-icon" title={t('سداد كامل', 'Settle in full')} onClick={() => setAlloc({ ...alloc, [inv.id]: open })}><Wand2 size={12} /></button>
                              </div>
                            ) : <span className="num block text-end">{preview[inv.id] ? money(preview[inv.id]) : '—'}</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 text-[13px]" style={{ borderTop: '1px solid var(--rule)' }}>
                    <Kv label={t('موزع على فواتير', 'Allocated')}><Money value={allocMode === 'none' ? 0 : allocated} /></Kv>
                    <Kv label={t('على الحساب', 'On account')}><Money value={allocMode === 'none' ? form.amount : unallocated} className={unallocated < 0 ? 'neg' : ''} /></Kv>
                    {allocMode === 'manual' && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAlloc(oldestFirst)}>{t('توزيع تلقائي على الأقدم', 'Fill oldest first')}</Button>}
                  </div>
                </>
              )}
            </Sheet>
          </div>
        )}
      </div>
    </div>
  )
}
