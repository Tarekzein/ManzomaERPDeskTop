import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookOpenText, ChevronDown, ChevronLeft, ChevronRight, Download, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { exportCsv } from '@/lib/csv'
import { today } from '@/lib/format'
import { nameOf, usePrefs, useT } from '@/store/prefs'
import { can } from '@/store/session'
import { navigate } from '@/store/workspace'
import { Button, ErrorBox, Field, Input, Money, PageHeader, Pill, Spinner } from '@/components/ui'
import { Modal, confirmDialog } from '@/components/Dialogs'

export const ACCOUNT_TYPES: Record<string, [string, string]> = {
  asset: ['أصول', 'Assets'],
  liability: ['خصوم', 'Liabilities'],
  equity: ['حقوق ملكية', 'Equity'],
  revenue: ['إيرادات', 'Revenue'],
  expense: ['مصروفات', 'Expenses'],
}

/** Chart of accounts as a tree with rolled-up balances. */
export default function Accounts() {
  const t = useT()
  const locale = usePrefs((s) => s.locale)
  const [asOf, setAsOf] = useState(today())
  const { data, isLoading, error } = useApi<any>('/accounts', { to: asOf })
  const accounts: any[] = data?.data ?? []
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const manage = can('accounts.manage')
  const Chevron = locale === 'ar' ? ChevronLeft : ChevronRight

  const { roots, children, depth } = useMemo(() => {
    const children = new Map<number | null, any[]>()
    accounts.forEach((a) => children.set(a.parent_id ?? null, [...(children.get(a.parent_id ?? null) ?? []), a]))
    const depth = new Map<number, number>()
    const walk = (list: any[], d: number) => list.forEach((a) => { depth.set(a.id, d); walk(children.get(a.id) ?? [], d + 1) })
    walk(children.get(null) ?? [], 0)
    return { roots: children.get(null) ?? [], children, depth }
  }, [accounts])

  // Visible rows: the tree in order, or every match when searching.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) return accounts.filter((a) => a.code.startsWith(q) || a.name.toLowerCase().includes(q) || (a.name_en ?? '').toLowerCase().includes(q))
    const out: any[] = []
    const walk = (list: any[]) => list.forEach((a) => { out.push(a); if (open.has(a.id)) walk(children.get(a.id) ?? []) })
    walk(roots)
    return out
  }, [accounts, search, open, roots, children])

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const expandAll = () => setOpen(new Set(accounts.filter((a) => a.is_group).map((a) => a.id)))

  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('دليل الحسابات', 'Chart of accounts')} actions={<>
        <Field label={t('الأرصدة حتى', 'Balances as of')}><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Button icon={FolderTree} onClick={() => (open.size ? setOpen(new Set()) : expandAll())}>{open.size ? t('طي الكل', 'Collapse all') : t('فتح الكل', 'Expand all')}</Button>
        <Button icon={Download} onClick={() => exportCsv('chart-of-accounts', accounts, [
          { header: 'code', value: (a: any) => a.code }, { header: 'name', value: (a: any) => a.name }, { header: 'name_en', value: (a: any) => a.name_en }, { header: 'type', value: (a: any) => a.type },
          { header: 'group', value: (a: any) => (a.is_group ? 1 : 0) }, { header: 'debit', value: (a: any) => a.debit }, { header: 'credit', value: (a: any) => a.credit }, { header: 'balance', value: (a: any) => a.balance },
        ])}>{t('تصدير', 'Export')}</Button>
        {manage && <Button variant="primary" icon={Plus} onClick={() => setEditing({ parent_id: null, type: 'asset', is_group: false, allow_manual: true, is_active: true, name: '', name_en: '' })}>{t('حساب جديد', 'New account')}</Button>}
      </>}>
        <Input className="mt-3 w-[300px]" placeholder={t('بحث بالكود أو الاسم', 'Search code or name')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </PageHeader>
      <div className="mx-5 mb-4 min-h-0 flex-1 overflow-auto rounded-lg sheet">
        <table className="ledger">
          <thead><tr><th>{t('الحساب', 'Account')}</th><th style={{ width: 110 }}>{t('النوع', 'Type')}</th><th className="amount" style={{ width: 130 }}>{t('مدين', 'Debit')}</th><th className="amount" style={{ width: 130 }}>{t('دائن', 'Credit')}</th><th className="amount" style={{ width: 140 }}>{t('الرصيد', 'Balance')}</th><th style={{ width: 110 }} /></tr></thead>
          <tbody>
            {rows.map((a) => {
              const d = search ? 0 : depth.get(a.id) ?? 0
              const kids = children.get(a.id)?.length ?? 0
              return (
                <tr key={a.id} className={a.is_group ? 'font-semibold' : ''} onDoubleClick={() => (a.is_group ? toggle(a.id) : navigate(`/finance/ledger/${a.id}`))} style={{ opacity: a.is_active ? 1 : 0.55 }}>
                  <td>
                    <span className="inline-flex items-center gap-1.5" style={{ paddingInlineStart: d * 20 }}>
                      {a.is_group && kids > 0 ? <button className="btn btn-ghost btn-sm btn-icon" onClick={() => toggle(a.id)} aria-label={t('فتح', 'Expand')}>{open.has(a.id) ? <ChevronDown size={14} /> : <Chevron size={14} />}</button> : <span style={{ width: 28 }} />}
                      <span className="num muted">{a.code}</span> {nameOf(a)}
                      {a.system_key && <Pill tone="brand">{t('نظامي', 'System')}</Pill>}
                      {!a.allow_manual && !a.is_group && <Pill>{t('آلي فقط', 'Automatic only')}</Pill>}
                    </span>
                  </td>
                  <td className="muted text-[12px]">{t(...(ACCOUNT_TYPES[a.type] ?? [a.type, a.type]))}</td>
                  <td className="amount"><Money value={a.debit} className={Number(a.debit) ? '' : 'muted'} /></td>
                  <td className="amount"><Money value={a.credit} className={Number(a.credit) ? '' : 'muted'} /></td>
                  <td className="amount"><Money value={a.balance} paren colored /></td>
                  <td>
                    <span className="flex justify-end gap-0.5">
                      <Button size="sm" variant="ghost" icon={BookOpenText} onClick={() => navigate(`/finance/ledger/${a.id}`)} aria-label={t('دفتر الأستاذ', 'Ledger')} />
                      {manage && a.is_group && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing({ parent_id: a.id, type: a.type, is_group: false, allow_manual: true, is_active: true, name: '', name_en: '' })} aria-label={t('حساب فرعي', 'Sub-account')} />}
                      {manage && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(a)} aria-label={t('تعديل', 'Edit')} />}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {editing && <AccountForm account={editing} accounts={accounts} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AccountForm({ account, accounts, onClose }: { account: any; accounts: any[]; onClose: () => void }) {
  const t = useT()
  const custom = useDynamicFields('accounts', account)
  const [form, setForm] = useState({ ...account, name_en: account.name_en ?? '', description: account.description ?? '', code: account.id ? account.code : '' })
  const [busy, setBusy] = useState(false)
  const parent = accounts.find((a) => a.id === form.parent_id)
  const save = async () => {
    setBusy(true)
    try {
      const body = { ...custom.payload(), parent_id: form.parent_id, code: form.code || null, name: form.name, name_en: form.name_en || null, type: parent?.type ?? form.type, is_group: form.is_group, allow_manual: form.allow_manual, is_active: form.is_active, description: form.description || null }
      if (account.id) await api.put(`/accounts/${account.id}`, body)
      else await api.post('/accounts', body)
      invalidate('/accounts', '/lookups')
      toast.success(t('تم حفظ الحساب', 'Account saved'))
      onClose()
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={account.id ? t('تعديل حساب', 'Edit account') : t('حساب جديد', 'New account')} onClose={onClose} footer={<>
      {account.id && !account.system_key && <Button variant="ghost" icon={Trash2} className="me-auto" onClick={async () => {
        if (!(await confirmDialog({ title: t('حذف الحساب؟', 'Delete this account?'), danger: true, confirmLabel: t('حذف', 'Delete') }))) return
        try { await api.del(`/accounts/${account.id}`); invalidate('/accounts'); onClose() } catch (e: any) { toast.error(e.message) }
      }}>{t('حذف', 'Delete')}</Button>}
      <Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
      <Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length} onClick={save}>{t('حفظ', 'Save')}</Button>
    </>}>
      {custom.renderRecord(form, (next) => { const selected = accounts.find((a) => a.id === next.parent_id); setForm({ ...next, ...(selected ? { type: selected.type } : {}) }) }, DOMAIN_FORM_WIDGETS)}
    </Modal>
  )
}
