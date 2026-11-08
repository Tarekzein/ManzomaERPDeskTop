import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Archive, CalendarRange, Download, FolderOpen, Lock, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { date, datetime, money, round2, startOfYear, today, toNumber } from '@/lib/format'
import { isDesktop, platform } from '@/lib/platform'
import { useT } from '@/store/prefs'
import { can, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { DateRange } from '@/components/DateRange'
import { DataTable, Pager } from '@/components/DataTable'
import { AccountPicker, UserSelect } from '@/components/Pickers'
import { Button, ErrorBox, Field, Input, Money, NumberInput, Pill, Sheet, Spinner } from '@/components/ui'
import { Modal, confirmDialog } from '@/components/Dialogs'
import { StatusPill } from '@/components/Status'

// ─── Fiscal years and lock date ────────────────────────────────────────
export function FiscalSection() {
  const t = useT()
  const { data, isLoading, error, refetch } = useApi<any>('/fiscal-years')
  const [lock, setLock] = useState<string>('')
  const [adding, setAdding] = useState(false)
  useEffect(() => setLock(data?.lock_date ?? ''), [data?.lock_date])
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const manage = can('fiscal.manage')
  return (
    <div className="grid gap-4">
      <Sheet title={<span className="inline-flex items-center gap-2"><Lock size={15} />{t('تاريخ الإقفال', 'Lock date')}</span>}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <p className="muted m-0 basis-full text-[13px]">{t('لا يمكن تسجيل أو تعديل أي حركة بتاريخ يساوي أو يسبق هذا التاريخ. استخدمه بعد مراجعة كل شهر وإقرار الضريبة.', 'Nothing can be recorded or changed on or before this date. Set it after each month is reviewed and the VAT return is filed.')}</p>
          <Field label={t('مقفل حتى', 'Locked through')}><Input type="date" value={lock} disabled={!manage} onChange={(e) => setLock(e.target.value)} /></Field>
          {manage && <Button icon={Save} onClick={async () => {
            try { await api.put('/fiscal/lock-date', { lock_date: lock || null }); toast.success(t('تم الحفظ', 'Saved')); void refetch(); void useSession.getState().refreshLookups() } catch (e: any) { toast.error(e.message) }
          }}>{t('حفظ', 'Save')}</Button>}
          {manage && lock && <Button variant="ghost" onClick={() => setLock('')}>{t('إلغاء الإقفال', 'Clear')}</Button>}
        </div>
      </Sheet>
      <Sheet title={<span className="inline-flex items-center gap-2"><CalendarRange size={15} />{t('السنوات المالية', 'Fiscal years')}</span>} actions={manage && <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('سنة جديدة', 'New year')}</Button>}>
        {data.data.length === 0 ? <div className="muted p-4">{t('لا توجد سنوات مالية مسجلة.', 'No fiscal years yet.')}</div> : (
          <table className="ledger">
            <thead><tr><th>{t('السنة', 'Year')}</th><th>{t('من', 'From')}</th><th>{t('إلى', 'To')}</th><th>{t('الحالة', 'Status')}</th><th>{t('أُقفلت في', 'Closed on')}</th><th style={{ width: 180 }} /></tr></thead>
            <tbody>{data.data.map((y: any) => (
              <tr key={y.id}>
                <td className="font-medium">{y.name}</td><td className="num">{date(y.start_date)}</td><td className="num">{date(y.end_date)}</td>
                <td><StatusPill status={y.status} /></td><td className="num muted">{datetime(y.closed_at)}</td>
                <td className="text-end">
                  {y.closing_entry_id && <Button size="sm" variant="ghost" onClick={() => navigate(`/finance/journals/${y.closing_entry_id}`)}>{t('قيد الإقفال', 'Closing entry')}</Button>}
                  {manage && y.status === 'open' && <Button size="sm" onClick={async () => {
                    if (!(await confirmDialog({ title: t(`إقفال ${y.name}؟`, `Close ${y.name}?`), message: t('سيتم ترحيل أرصدة الإيرادات والمصروفات إلى الأرباح المحتجزة وقفل كل الحركات حتى نهاية السنة. لا يمكن التراجع.', 'Revenue and expense balances move to retained earnings and every transaction through year end is locked. This cannot be undone.'), danger: true, confirmLabel: t('إقفال السنة', 'Close year') }))) return
                    try { await api.post(`/fiscal-years/${y.id}/close`); toast.success(t('تم إقفال السنة', 'Year closed')); void refetch(); invalidate('/reports', '/accounts', '/journals') } catch (e: any) { toast.error(e.message) }
                  }}>{t('إقفال السنة', 'Close year')}</Button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Sheet>
      {adding && <NewYear onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void refetch() }} />}
    </div>
  )
}

function NewYear({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const custom = useDynamicFields('fiscal-years')
  const y = new Date().getFullYear()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>({ name: String(y), start_date: `${y}-01-01`, end_date: `${y}-12-31` })
  return (
    <Modal title={t('سنة مالية جديدة', 'New fiscal year')} onClose={() => { if (!busy) onClose() }} footer={<><Button disabled={busy} onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={async () => {
      setBusy(true)
      try { await api.post('/fiscal-years', { ...form, ...custom.payload() }); onSaved() } catch (e: any) { custom.capture(e); toast.error(e.message) } finally { setBusy(false) }
    }}>{t('حفظ', 'Save')}</Button></>}>
      {custom.renderRecord(form, setForm, undefined, busy)}
    </Modal>
  )
}

// ─── Opening balances ──────────────────────────────────────────────────
export function OpeningSection() {
  const t = useT()
  const { data } = useApi<any>('/accounts')
  const accounts: any[] = data?.data ?? []
  const [day, setDay] = useState(startOfYear())
  const [lines, setLines] = useState<{ key: number; account_id: number | null; debit: number; credit: number }[]>([{ key: 1, account_id: null, debit: 0, credit: 0 }])
  const [busy, setBusy] = useState(false)
  const totals = useMemo(() => ({ debit: round2(lines.reduce((s, l) => s + toNumber(l.debit), 0)), credit: round2(lines.reduce((s, l) => s + toNumber(l.credit), 0)) }), [lines])
  const control = new Set(accounts.filter((a) => ['ar', 'ap', 'inventory'].includes(a.system_key) || ['cash_group', 'bank_group'].includes(a.system_key)).map((a) => a.id))
  const upd = (key: number, p: any) => setLines((ls) => {
    const next = ls.map((l) => (l.key === key ? { ...l, ...p } : l))
    return next[next.length - 1].account_id ? [...next, { key: Date.now(), account_id: null, debit: 0, credit: 0 }] : next
  })
  return (
    <div className="grid gap-4">
      <Sheet title={t('من أين تبدأ؟', 'Where to start')} bodyClassName="grid gap-2 p-4 text-[13px]">
        <div>1. {t('أرصدة العملاء والموردين: من شاشة كل عميل/مورد ← "رصيد افتتاحي" (يسجل على حسابه مباشرة).', 'Customer and supplier balances: on each customer or supplier → "Opening balance" (posts to their account).')}</div>
        <div>2. {t('بضاعة أول المدة:', 'Opening stock:')} <button className="link" onClick={() => navigate('/inventory/docs/opening/new')}>{t('مستند بضاعة أول المدة', 'an opening stock document')}</button> {t('بالكميات والتكلفة لكل مخزن.', 'with quantities and cost per warehouse.')}</div>
        <div>3. {t('أرصدة الخزائن والبنوك والأصول ورأس المال: في الجدول بالأسفل. الفرق يُرحّل تلقائياً لحساب "أرصدة افتتاحية".', 'Cash, bank, assets and capital: in the table below. Any difference goes to the "Opening balances" equity account.')}</div>
      </Sheet>
      <Sheet title={t('أرصدة افتتاحية للحسابات', 'Account opening balances')} actions={<Field label={t('بتاريخ', 'As of')}><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>}>
        <table className="ledger grid-lines">
          <thead><tr><th>{t('الحساب', 'Account')}</th><th className="amount" style={{ width: 150 }}>{t('مدين', 'Debit')}</th><th className="amount" style={{ width: 150 }}>{t('دائن', 'Credit')}</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.key}>
              <td><AccountPicker small accounts={accounts} value={l.account_id} filter={(a) => !['ar', 'ap', 'inventory'].includes(a.system_key) && (a.type === 'asset' || a.type === 'liability' || a.type === 'equity') && !control.has(a.id)} onChange={(id) => upd(l.key, { account_id: id })} /></td>
              <td><NumberInput small value={l.debit || ''} onChange={(v) => upd(l.key, { debit: v, credit: v ? 0 : l.credit })} /></td>
              <td><NumberInput small value={l.credit || ''} onChange={(v) => upd(l.key, { credit: v, debit: v ? 0 : l.debit })} /></td>
              <td>{l.account_id && <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={t('حذف', 'Remove')}><Trash2 size={13} /></button>}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="total-row"><td>{t('الإجمالي', 'Total')} {totals.debit !== totals.credit && <span className="muted ms-2 text-[12px] font-normal">{t('الفرق إلى أرصدة افتتاحية', 'Difference to opening equity')}: {money(Math.abs(totals.debit - totals.credit))}</span>}</td><td className="amount"><Money value={totals.debit} /></td><td className="amount"><Money value={totals.credit} /></td><td /></tr></tfoot>
        </table>
        <div className="flex justify-end p-3">
          <Button variant="primary" icon={Save} loading={busy} disabled={!lines.some((l) => l.account_id && (l.debit || l.credit))} onClick={async () => {
            if (!(await confirmDialog({ title: t('ترحيل الأرصدة الافتتاحية؟', 'Post opening balances?') }))) return
            setBusy(true)
            try {
              const r = await api.post('/fiscal/opening-balances', { date: day, lines: lines.filter((l) => l.account_id && (l.debit || l.credit)).map(({ account_id, debit, credit }) => ({ account_id, debit, credit })) })
              invalidate('/accounts', '/journals', '/reports', '/cash-accounts')
              toast.success(t('تم ترحيل القيد الافتتاحي', 'Opening entry posted'))
              setLines([{ key: 1, account_id: null, debit: 0, credit: 0 }])
              if (r.data?.id) navigate(`/finance/journals/${r.data.id}`)
            } catch (e: any) {
              toast.error(e.message)
            } finally {
              setBusy(false)
            }
          }}>{t('ترحيل القيد الافتتاحي', 'Post opening entry')}</Button>
        </div>
      </Sheet>
    </div>
  )
}

// ─── Backups ───────────────────────────────────────────────────────────
export function BackupSection() {
  const t = useT()
  const { data, isLoading, error, refetch } = useApi<any>(can('backup.manage') ? '/backups' : null)
  const [busy, setBusy] = useState(false)
  const profile = useSession((s) => s.profile)
  const local = isDesktop && profile?.mode === 'local'
  return (
    <div className="grid gap-4">
      <Sheet title={<span className="inline-flex items-center gap-2"><Archive size={15} />{t('النسخ الاحتياطي', 'Backups')}</span>} actions={<div className="flex gap-2">
        {local && <Button size="sm" icon={FolderOpen} onClick={() => platform.backup.openFolder()}>{t('فتح المجلد', 'Open folder')}</Button>}
        {local && <Button size="sm" icon={Download} onClick={async () => { const r = await platform.backup.exportTo(); if (r.ok) toast.success(t('تم حفظ النسخة', 'Backup saved')); else if (r.error) toast.error(r.error) }}>{t('حفظ نسخة في…', 'Save a copy to…')}</Button>}
        {local && <Button size="sm" icon={RotateCcw} onClick={async () => {
          if (!(await confirmDialog({ title: t('استرجاع نسخة احتياطية؟', 'Restore a backup?'), message: t('ستُستبدل بيانات الشركة الحالية بالنسخة المختارة. تُحفظ نسخة من الحالية أولاً.', 'The current company data is replaced by the chosen backup. A copy of the current data is kept first.'), danger: true, confirmLabel: t('اختيار نسخة', 'Choose backup') }))) return
          const r = await platform.backup.restore()
          if (r.ok) { toast.success(t('تم الاسترجاع. أعد فتح الشركة.', 'Restored. Open the company again.')); void useSession.getState().close() } else if (r.error) toast.error(r.error)
        }}>{t('استرجاع', 'Restore')}</Button>}
        <Button size="sm" variant="primary" icon={Archive} loading={busy} onClick={async () => {
          setBusy(true)
          try { await api.post('/backups'); toast.success(t('تم إنشاء نسخة احتياطية', 'Backup created')); void refetch() } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
        }}>{t('نسخة الآن', 'Back up now')}</Button>
      </div>}>
        <p className="muted m-0 px-4 pt-3 text-[13px]">{local ? t('تُنشأ نسخة تلقائياً عند إغلاق البرنامج ويُحتفظ بآخر النسخ حسب إعدادات سطح المكتب. احفظ نسخة خارج الجهاز بانتظام.', 'A backup is made automatically when the app closes and the latest ones are kept per your desktop settings. Keep a copy off this computer regularly.') : t('النسخ على الخادم. نزّل نسخة واحفظها في مكان آمن.', 'Backups live on the server. Download one and keep it somewhere safe.')}</p>
        {isLoading ? <Spinner /> : error ? <ErrorBox error={error} /> : (
          <table className="ledger">
            <thead><tr><th>{t('الملف', 'File')}</th><th>{t('التاريخ', 'Date')}</th><th className="amount">{t('الحجم', 'Size')}</th><th style={{ width: 60 }} /></tr></thead>
            <tbody>{(data?.data ?? []).map((b: any) => (
              <tr key={b.file}>
                <td className="num">{b.file}</td><td className="num">{datetime(b.created_at)}</td><td className="amount num">{(b.size / 1024 / 1024).toFixed(2)} MB</td>
                <td><Button size="sm" variant="ghost" icon={Download} onClick={async () => {
                  try {
                    const blob = await api.download(`/backups/${encodeURIComponent(b.file)}`)
                    const reader = new FileReader()
                    reader.onload = () => void platform.files.save({ defaultName: b.file, content: String(reader.result).split(',')[1], encoding: 'base64' })
                    reader.readAsDataURL(blob)
                  } catch (e: any) { toast.error(e.message) }
                }} aria-label={t('تنزيل', 'Download')} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Sheet>
    </div>
  )
}

// ─── Audit log ─────────────────────────────────────────────────────────
const ACTIONS: Record<string, [string, string]> = {
  created: ['إنشاء', 'Created'], updated: ['تعديل', 'Updated'], deleted: ['حذف', 'Deleted'], posted: ['ترحيل', 'Posted'], voided: ['إلغاء', 'Voided'],
  login: ['دخول', 'Signed in'], logout: ['خروج', 'Signed out'], login_failed: ['محاولة دخول فاشلة', 'Failed sign-in'], settings: ['إعدادات', 'Settings'],
  override: ['تجاوز صلاحية', 'Override'], received: ['استلام', 'Received'], count_started: ['بدء جرد', 'Count started'], closed: ['إقفال', 'Closed'],
}
export function AuditSection() {
  const t = useT()
  const [range, setRange] = useState({ from: today(), to: today() })
  const [user, setUser] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading, error } = useApi<any>('/audit-logs', { ...range, user_id: user, search, page, per_page: 50 })
  return (
    <Sheet title={t('سجل العمليات', 'Audit log')}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <DateRange value={range} onChange={(r) => { setRange(r); setPage(1) }} />
        <div className="w-44"><UserSelect value={user} onChange={(v) => { setUser(v); setPage(1) }} placeholder={t('كل المستخدمين', 'All users')} /></div>
        <Input className="w-[220px]" placeholder={t('بحث', 'Search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      {error ? <ErrorBox error={error} /> : (
        <>
          <DataTable rows={data?.data} loading={isLoading} compact columns={[
            { key: 'created_at', header: t('الوقت', 'Time'), width: 150, render: (r: any) => <span className="num">{datetime(r.created_at)}</span> },
            { key: 'user', header: t('المستخدم', 'User'), width: 140, render: (r: any) => r.user?.name ?? '—' },
            { key: 'action', header: t('العملية', 'Action'), width: 140, render: (r: any) => <Pill tone={r.action === 'override' || r.action === 'login_failed' || r.action === 'voided' ? 'red' : undefined}>{t(...(ACTIONS[r.action] ?? [r.action, r.action]))}</Pill> },
            { key: 'type', header: t('السجل', 'Record'), width: 160, render: (r: any) => <span className="muted">{r.auditable_type ? `${r.auditable_type.split('\\').pop()} #${r.auditable_id}` : ''}</span> },
            { key: 'description', header: t('التفاصيل', 'Details'), render: (r: any) => r.description },
            { key: 'ip', header: 'IP', width: 110, render: (r: any) => <span className="num muted">{r.ip_address}</span> },
          ]} />
          {data?.last_page > 1 && <Pager page={page} lastPage={data.last_page} total={data.total} onPage={setPage} />}
        </>
      )}
    </Sheet>
  )
}

