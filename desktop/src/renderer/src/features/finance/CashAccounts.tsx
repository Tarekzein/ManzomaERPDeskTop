import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, BookOpenText, HandCoins, Landmark, Pencil, Plus, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { toNumber } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { can, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { Button, ErrorBox, Money, PageHeader, Pill, Sheet, Spinner } from '@/components/ui'
import { Modal } from '@/components/Dialogs'

/** Cash boxes and bank accounts with live balances. */
export default function CashAccounts() {
  const t = useT()
  const { data, isLoading, error } = useApi<any>('/cash-accounts')
  const [editing, setEditing] = useState<any | null>(null)
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const rows: any[] = data.data
  const cash = rows.filter((r) => r.type === 'cash')
  const banks = rows.filter((r) => r.type === 'bank')
  const sum = (list: any[]) => list.reduce((s, r) => s + toNumber(r.balance), 0)

  const group = (title: string, list: any[], icon: typeof Wallet) => {
    const Icon = icon
    return (
      <Sheet title={<span className="inline-flex items-center gap-2"><Icon size={15} />{title}</span>} actions={<span className="num font-semibold">{<Money value={sum(list)} />}</span>}>
        {list.length === 0 ? <div className="muted p-4">{t('لا يوجد', 'None yet')}</div> : (
          <table className="ledger">
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="cursor-pointer" onDoubleClick={() => navigate(`/finance/treasury/${r.id}`)} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                  <td style={{ width: 70 }} className="num muted">{r.code}</td>
                  <td>
                    <div className="font-medium">{nameOf(r)}</div>
                    <div className="muted text-[12px]">{[r.bank_name, r.account_number, r.custodian?.name ? `${t('العهدة', 'Custodian')}: ${r.custodian.name}` : null, nameOf(r.branch)].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={{ width: 90 }}>{r.allow_negative && <Pill tone="amber">{t('يسمح بالسالب', 'Overdraft')}</Pill>}</td>
                  <td className="amount" style={{ width: 150 }}><span className="text-[15px]"><Money value={r.balance} colored /></span> <span className="muted text-[11px]">{r.currency}</span></td>
                  <td style={{ width: 90 }}>
                    <span className="flex justify-end gap-0.5">
                      <Button size="sm" variant="ghost" icon={BookOpenText} onClick={() => navigate(`/finance/treasury/${r.id}`)} aria-label={t('الحركة', 'Statement')} />
                      {can('accounts.manage') && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(r)} aria-label={t('تعديل', 'Edit')} />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Sheet>
    )
  }

  return (
    <div className="pb-8">
      <PageHeader title={t('الخزائن والبنوك', 'Cash & banks')} actions={<>
        {can('vouchers.manage') && <Button icon={HandCoins} onClick={() => navigate('/finance/vouchers/receipt/new')}>{t('سند قبض', 'Receipt')}</Button>}
        {can('vouchers.manage') && <Button icon={Wallet} onClick={() => navigate('/finance/vouchers/payment/new')}>{t('سند صرف', 'Payment')}</Button>}
        {can('vouchers.manage') && <Button icon={ArrowLeftRight} onClick={() => navigate('/finance/vouchers/transfer/new')}>{t('تحويل', 'Transfer')}</Button>}
        {can('accounts.manage') && <Button variant="primary" icon={Plus} onClick={() => setEditing({ type: 'cash', code: '', name: '', name_en: '', currency: 'EGP', allow_negative: false, is_active: true })}>{t('خزينة أو بنك', 'Cash box or bank')}</Button>}
      </>} />
      <div className="mx-5 sheet figure-band">
        <div><div className="muted text-[12px]">{t('النقدية بالخزائن', 'Cash on hand')}</div><div className="figure">{<Money value={sum(cash)} />}</div></div>
        <div><div className="muted text-[12px]">{t('أرصدة البنوك', 'Bank balances')}</div><div className="figure">{<Money value={sum(banks)} />}</div></div>
        <div><div className="muted text-[12px]">{t('الإجمالي', 'Total')}</div><div className="figure">{<Money value={sum(rows)} />}</div></div>
      </div>
      <div className="grid gap-4 px-5 pt-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {group(t('الخزائن', 'Cash boxes'), cash, Wallet)}
        {group(t('البنوك', 'Banks'), banks, Landmark)}
      </div>
      {editing && <CashAccountForm row={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function CashAccountForm({ row, onClose }: { row: any; onClose: () => void }) {
  const t = useT()
  const custom = useDynamicFields('cash-accounts', row)
  const refresh = useSession((s) => s.refreshLookups)
  const [form, setForm] = useState({ ...row, name_en: row.name_en ?? '', bank_name: row.bank_name ?? '', account_number: row.account_number ?? '', iban: row.iban ?? '' })
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={row.id ? t('تعديل', 'Edit') : t('خزينة أو حساب بنكي جديد', 'New cash box or bank account')} onClose={onClose} footer={<>
      <Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
      <Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length} onClick={async () => {
        setBusy(true)
        try {
          const body = { ...custom.payload(), type: form.type, code: form.code, name: form.name, name_en: form.name_en || null, branch_id: form.branch_id ?? null, currency: form.currency?.toUpperCase() || null, bank_name: form.bank_name || null, account_number: form.account_number || null, iban: form.iban || null, custodian_id: form.custodian_id ?? null, allow_negative: form.allow_negative, is_active: form.is_active }
          if (row.id) await api.put(`/cash-accounts/${row.id}`, body)
          else await api.post('/cash-accounts', body)
          invalidate('/cash-accounts', '/accounts')
          await refresh()
          toast.success(t('تم الحفظ', 'Saved'))
          onClose()
        } catch (e: any) {
      custom.capture(e)
          toast.error(e.message)
        } finally {
          setBusy(false)
        }
      }}>{t('حفظ', 'Save')}</Button>
    </>}>
      {custom.renderRecord(form, setForm, DOMAIN_FORM_WIDGETS)}
    </Modal>
  )
}
