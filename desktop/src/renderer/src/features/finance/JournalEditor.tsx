import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCheck, ExternalLink, Plus, Printer, Save, Trash2, Undo2 } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { date, money, round2, today, toNumber } from '@/lib/format'
import { sourceLabel, sourceLink } from '@/lib/docTypes'
import { nameOf, useT } from '@/store/prefs'
import { can } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { AccountPicker, LookupSelect, PartyPicker } from '@/components/Pickers'
import { Button, ErrorBox, Input, Money, NumberInput, Sheet, Spinner } from '@/components/ui'
import { confirmDialog, reasonDialog } from '@/components/Dialogs'
import { Stamp } from '@/components/Status'
import { printElement } from '@/features/print/printService'
import { TablePrint } from '@/features/print/templates'
import { ENTRY_TYPES } from './Journals'

interface Line { key: string; account_id: number | null; debit: number; credit: number; party_id: number | null; party_label?: string; cost_center_id: number | null; description: string }
let seq = 0
const blank = (): Line => ({ key: `n${++seq}`, account_id: null, debit: 0, credit: 0, party_id: null, cost_center_id: null, description: '' })

/** Manual journal entry: balanced debits and credits, party on AR/AP lines. */
export default function JournalEditor() {
  const t = useT()
  const tab = useTab()
  const id = tab.params.id
  const { data, isLoading, error, refetch } = useApi<any>(id ? `/journals/${id}` : null)
  const { data: accountsData } = useApi<any>('/accounts')
  const accounts: any[] = accountsData?.data ?? []
  const entry = data?.data
  const custom = useDynamicFields('journals', entry)
  const manual = !entry || ((entry.type === 'manual' || entry.type === 'opening') && (!entry.source_type || ['party_opening', 'accounts_opening'].includes(entry.source_type)))
  const editable = (!entry || entry.status === 'draft') && manual && can('journals.manage')
  const [header, setHeader] = useState({ date: today(), description: '', reference: '' })
  const [lines, setLines] = useState<Line[]>([blank(), blank()])
  const [busy, setBusy] = useState(false)
  useTabTitle(entry ? `${t('قيد', 'Entry')} ${entry.number}` : undefined)

  useEffect(() => {
    if (!entry) return
    setHeader({ date: entry.date?.slice(0, 10), description: entry.description, reference: entry.reference ?? '' })
    setLines(entry.lines.map((l: any) => ({ key: `l${l.id}`, account_id: l.account_id, debit: toNumber(l.debit), credit: toNumber(l.credit), party_id: l.party_id, party_label: l.party?.name, cost_center_id: l.cost_center_id, description: l.description ?? '' })))
  }, [entry])

  const totals = useMemo(() => ({ debit: round2(lines.reduce((s, l) => s + toNumber(l.debit), 0)), credit: round2(lines.reduce((s, l) => s + toNumber(l.credit), 0)) }), [lines])
  const diff = round2(totals.debit - totals.credit)
  const controlIds = new Set(accounts.filter((a) => ['ar', 'ap', 'notes_receivable', 'notes_payable'].includes(a.system_key)).map((a) => a.id))
  const upd = (key: string, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l))); tab.setDirty(true) }

  const save = async (post: boolean) => {
    const active = lines.filter((l) => l.account_id && (toNumber(l.debit) || toNumber(l.credit)))
    if (!header.description.trim()) return toast.error(t('اكتب بيان القيد.', 'Enter a description.'))
    if (active.length < 2) return toast.error(t('القيد يحتاج سطرين على الأقل.', 'An entry needs at least two lines.'))
    if (post && diff !== 0) return toast.error(t('القيد غير متوازن.', 'The entry does not balance.'))
    setBusy(true)
    try {
      const body = { ...header, ...custom.payload(), reference: header.reference || null, post, lines: active.map((l) => ({ account_id: l.account_id, debit: toNumber(l.debit), credit: toNumber(l.credit), party_id: l.party_id, cost_center_id: l.cost_center_id, description: l.description || null })) }
      const r = id ? await api.put(`/journals/${id}`, body) : await api.post('/journals', body)
      custom.acceptSaved(r.data)
      tab.setDirty(false)
      invalidate('/journals', '/accounts', '/reports')
      toast.success(post ? t('تم ترحيل القيد', 'Entry posted') : t('تم حفظ المسودة', 'Draft saved'))
      if (!id) tab.replace(`/finance/journals/${r.data.id}`)
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
  const accountOf = (aid: number | null) => accounts.find((a) => a.id === aid)
  const link = entry ? sourceLink(entry.source_type, entry.source_id) : null

  return (
    <div className="pb-8">

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--rule)' }}>
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[18px] font-semibold">{entry ? <>{t('قيد يومية', 'Journal entry')} <span className="num muted">{entry.number}</span></> : t('قيد يومية جديد', 'New journal entry')}</h1>
          {entry && <Stamp status={entry.status} postedAt={entry.posted_at} />}
          {entry && <span className="muted text-[12px]">{t(...(ENTRY_TYPES[entry.type] ?? [entry.type, entry.type]))}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {link && <Button icon={ExternalLink} onClick={() => navigate(link)}>{sourceLabel(entry.source_type)} {entry.reference}</Button>}
          {entry?.reversal_of_id && <Button variant="ghost" onClick={() => navigate(`/finance/journals/${entry.reversal_of_id}`)}>{t('القيد الأصلي', 'Original entry')}</Button>}
          {entry?.reversed_by_id && <Button variant="ghost" onClick={() => navigate(`/finance/journals/${entry.reversed_by_id}`)}>{t('القيد العكسي', 'Reversing entry')}</Button>}
          {entry && <Button icon={Printer} onClick={() => printElement(<TablePrint title={`${t('قيد يومية', 'Journal entry')} ${entry.number}`} subtitle={`${date(entry.date)} — ${entry.description}`} rows={entry.lines} columns={[
            { header: t('الحساب', 'Account'), value: (l) => `${l.account?.code} ${nameOf(l.account)}` }, { header: t('الطرف', 'Party'), value: (l) => l.party?.name ?? '' }, { header: t('البيان', 'Description'), value: (l) => l.description ?? '' },
            { header: t('مدين', 'Debit'), value: (l) => (toNumber(l.debit) ? money(l.debit) : ''), align: 'end' }, { header: t('دائن', 'Credit'), value: (l) => (toNumber(l.credit) ? money(l.credit) : ''), align: 'end' },
          ]} totals={['', '', t('الإجمالي', 'Totals'), money(totals.debit), money(totals.credit)]} />, { paper: 'A4', title: entry.number })}>{t('طباعة', 'Print')}</Button>}
          {editable && entry && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog({ title: t('حذف المسودة؟', 'Delete this draft?'), danger: true })) { await api.del(`/journals/${entry.id}`); invalidate('/journals'); tab.close() } }} aria-label={t('حذف', 'Delete')} />}
          {editable && <Button icon={Save} loading={busy} onClick={() => save(false)}>{t('حفظ مسودة', 'Save draft')}</Button>}
          {editable && can('journals.post') && <Button variant="primary" icon={CheckCheck} loading={busy} disabled={diff !== 0} onClick={() => save(true)} kbd="F9">{t('ترحيل', 'Post')}</Button>}
          {entry?.status === 'posted' && manual && can('journals.post') && !entry.reversed_by_id && <Button icon={Undo2} onClick={async () => {
            const reason = await reasonDialog({ title: t('عكس القيد', 'Reverse entry'), message: t('سيتم إنشاء قيد عكسي بنفس المبالغ.', 'A reversing entry with the same amounts will be posted.') })
            if (!reason) return
            try { const r = await api.post(`/journals/${entry.id}/reverse`, { reason }); invalidate('/journals', '/accounts', '/reports'); navigate(`/finance/journals/${r.data.id}`) } catch (e: any) { toast.error(e.message) }
          }}>{t('عكس القيد', 'Reverse')}</Button>}
        </div>
      </div>
      {entry && !manual && <div className="mx-5 mt-4 sheet p-3 text-[13px] muted">{t('هذا القيد أنشأه مستند. لتعديله ألغِ المستند الأصلي أو أصدر مستنداً مقابلاً.', 'This entry was created by a document. To change it, void the source document or issue a counter-document.')}</div>}

      <div className="grid gap-4 px-5 pt-4">
        <Sheet bodyClassName="p-4">{custom.renderRecord({ ...header }, next => { setHeader(next as typeof header); tab.setDirty(true) }, DOMAIN_FORM_WIDGETS, !editable)}</Sheet>
        <Sheet>
          <table className="ledger grid-lines">
            <thead><tr><th style={{ width: 32 }}>#</th><th>{t('الحساب', 'Account')}</th><th style={{ width: 210 }}>{t('العميل/المورد', 'Customer/supplier')}</th><th style={{ width: 150 }}>{t('مركز التكلفة', 'Cost centre')}</th><th>{t('بيان السطر', 'Line description')}</th><th className="amount" style={{ width: 130 }}>{t('مدين', 'Debit')}</th><th className="amount" style={{ width: 130 }}>{t('دائن', 'Credit')}</th><th style={{ width: 34 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const acc = accountOf(l.account_id)
                const needsParty = l.account_id !== null && controlIds.has(l.account_id)
                return (
                  <tr key={l.key}>
                    <td className="num muted">{i + 1}</td>
                    <td style={{ minWidth: 240 }}>{editable ? <AccountPicker small accounts={accounts} value={l.account_id} filter={(a) => a.allow_manual} onChange={(aid) => upd(l.key, { account_id: aid })} /> : <span className="px-2"><span className="num muted">{acc?.code ?? l.account_id}</span> {nameOf(acc ?? entry?.lines?.[i]?.account)}</span>}</td>
                    <td>{editable ? (needsParty || l.party_id ? <PartyPicker value={l.party_id} initialLabel={l.party_label} onChange={(pid, p) => upd(l.key, { party_id: pid, party_label: p ? nameOf(p) : undefined })} placeholder={needsParty ? t('مطلوب', 'Required') : '—'} /> : <span className="muted px-2 text-[12px]">—</span>) : <span className="px-2">{l.party_label}</span>}</td>
                    <td>{editable ? <LookupSelect small kind="cost_centers" value={l.cost_center_id} onChange={(v) => upd(l.key, { cost_center_id: v })} /> : <span className="px-2">{entry?.lines?.[i]?.cost_center?.name ?? ''}</span>}</td>
                    <td>{editable ? <Input small value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} /> : <span className="px-2">{l.description}</span>}</td>
                    <td>{editable ? <NumberInput small value={l.debit || ''} onChange={(v) => upd(l.key, { debit: v, credit: v ? 0 : l.credit })} onFocus={() => { if (!l.debit && !l.credit && diff < 0) upd(l.key, { debit: -diff }) }} /> : <span className="num block px-2 text-end">{toNumber(l.debit) ? money(l.debit) : ''}</span>}</td>
                    <td>{editable ? <NumberInput small value={l.credit || ''} onChange={(v) => upd(l.key, { credit: v, debit: v ? 0 : l.debit })} onFocus={() => { if (!l.debit && !l.credit && diff > 0) upd(l.key, { credit: diff }) }} /> : <span className="num block px-2 text-end">{toNumber(l.credit) ? money(l.credit) : ''}</span>}</td>
                    <td>{editable && lines.length > 2 && <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={t('حذف', 'Remove')}><Trash2 size={13} /></button>}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td colSpan={5}>{editable && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setLines([...lines, blank()])}>{t('سطر', 'Line')}</Button>}</td>
                <td className="amount"><Money value={totals.debit} /></td>
                <td className="amount"><Money value={totals.credit} /></td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="flex items-center justify-end gap-2 px-4 py-2 text-[13px]" style={{ borderTop: '1px solid var(--rule)' }}>
            {diff === 0 ? <span style={{ color: 'var(--ledger)' }}>{t('القيد متوازن', 'Balanced')}</span> : <span className="neg">{t('فرق', 'Out of balance by')} <span className="num font-semibold">{money(Math.abs(diff))}</span> {diff > 0 ? t('(المدين أكبر)', '(debit side higher)') : t('(الدائن أكبر)', '(credit side higher)')}</span>}
          </div>
        </Sheet>
      </div>
    </div>
  )
}
