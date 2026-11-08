import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { percent } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { Button, Check, ErrorBox, Field, Input, Pill, Sheet, Spinner } from '@/components/ui'
import { Modal } from '@/components/Dialogs'

export const PERMISSION_LABELS: Record<string, [string, string]> = {
  'forms.manage': ['تخصيص النماذج والحقول', 'Customize forms and fields'],
  'service.view': ['عرض خدمة الفلاتر', 'View filter service'], 'service.view_all': ['عرض جميع العملاء والزيارات', 'View all service customers and visits'],
  'service.manage': ['تسجيل الأجهزة والطلبات والزيارات', 'Manage customer filters, requests and visits'], 'service.complete': ['إكمال الزيارات وخصم القطع', 'Complete visits and consume parts'],
  'service.correct': ['تصحيح الزيارات المكتملة', 'Correct completed visits'], 'service.settings': ['إعداد برامج الصيانة والقوالب', 'Manage schedules and templates'],
  'service.free': ['اعتماد الخدمة المجانية والضمان', 'Approve free and warranty work'], 'service.reports': ['عرض تقارير الصيانة', 'View service reports'],
  'settings.manage': ['تعديل الإعدادات', 'Change settings'], 'users.manage': ['إدارة المستخدمين والصلاحيات', 'Manage users and roles'], 'audit.view': ['عرض سجل العمليات', 'View audit log'], 'backup.manage': ['النسخ الاحتياطي', 'Backups'],
  'customers.view': ['عرض العملاء', 'View customers'], 'customers.manage': ['إضافة وتعديل العملاء', 'Add and edit customers'],
  'suppliers.view': ['عرض الموردين', 'View suppliers'], 'suppliers.manage': ['إضافة وتعديل الموردين', 'Add and edit suppliers'],
  'crm.view': ['عرض المتابعة', 'View CRM'], 'crm.manage': ['إضافة عملاء محتملين وصفقات وأنشطة', 'Add leads, deals and activities'], 'crm.view_all': ['رؤية صفقات كل المندوبين', 'See every rep’s deals'], 'crm.settings': ['إعدادات المتابعة (المراحل والمصادر)', 'CRM settings (stages, sources)'],
  'products.view': ['عرض الأصناف', 'View items'], 'products.manage': ['إضافة وتعديل الأصناف', 'Add and edit items'], 'stock.view': ['عرض الأرصدة وكارت الصنف', 'View stock and item cards'], 'stock.adjust': ['التسويات وبضاعة أول المدة', 'Adjustments and opening stock'], 'stock.transfer': ['التحويلات المخزنية', 'Stock transfers'], 'stock.count': ['الجرد', 'Stock counts'], 'stock.allow_negative': ['البيع بدون رصيد', 'Sell without stock'], 'inventory.view_cost': ['رؤية تكلفة المخزون', 'See stock cost'],
  'sales.quotations': ['عروض الأسعار', 'Quotations'], 'sales.orders': ['أوامر البيع', 'Sales orders'], 'sales.invoices': ['إنشاء فواتير المبيعات', 'Create sales invoices'], 'sales.invoices.post': ['ترحيل فواتير المبيعات', 'Post sales invoices'], 'sales.invoices.void': ['إلغاء فواتير مرحلة', 'Void posted invoices'], 'sales.returns': ['مرتجعات المبيعات', 'Sales returns'], 'sales.view_cost': ['رؤية التكلفة والربح في المبيعات', 'See cost and profit on sales'], 'sales.override_credit': ['تجاوز حد الائتمان والتأخير', 'Override credit and overdue blocks'], 'sales.override_price': ['البيع بأقل من الحد الأدنى للسعر', 'Sell below minimum price'], 'sales.override_discount': ['تجاوز حد الخصم', 'Exceed discount limit'], 'sales.reports': ['تقارير المبيعات', 'Sales reports'], 'pricing.manage': ['قوائم الأسعار', 'Price lists'],
  'purchases.orders': ['أوامر الشراء', 'Purchase orders'], 'purchases.receipts': ['أذون الاستلام', 'Goods receipts'], 'purchases.invoices': ['إنشاء فواتير المشتريات', 'Create purchase invoices'], 'purchases.invoices.post': ['ترحيل فواتير المشتريات', 'Post purchase invoices'], 'purchases.invoices.void': ['إلغاء فواتير مشتريات مرحلة', 'Void posted purchase invoices'], 'purchases.returns': ['مرتجعات المشتريات', 'Purchase returns'], 'purchases.reports': ['تقارير المشتريات', 'Purchase reports'],
  'accounts.manage': ['دليل الحسابات والخزائن', 'Chart of accounts and cash accounts'], 'journals.manage': ['إنشاء القيود اليدوية', 'Create manual entries'], 'journals.post': ['ترحيل وعكس القيود', 'Post and reverse entries'], 'finance.reports': ['التقارير المالية', 'Financial reports'], 'fiscal.manage': ['السنوات المالية والإقفال', 'Fiscal years and closing'], 'taxes.manage': ['إعداد الضرائب', 'Tax setup'],
  'treasury.view': ['عرض الخزينة', 'View treasury'], 'vouchers.manage': ['سندات القبض والصرف', 'Receipts and payments'], 'vouchers.post': ['ترحيل السندات', 'Post vouchers'], 'vouchers.void': ['إلغاء السندات', 'Void vouchers'], 'expenses.manage': ['المصروفات', 'Expenses'], 'cheques.manage': ['إدارة الشيكات', 'Manage cheques'], 'treasury.all_accounts': ['رؤية كل الخزائن', 'See every cash account'],
}
const GROUP_LABELS: Record<string, [string, string]> = {
  forms: ['تخصيص النماذج', 'Form customization'], service: ['خدمة الفلاتر', 'Filter service'], settings: ['النظام', 'System'], customers: ['العملاء', 'Customers'], suppliers: ['الموردون', 'Suppliers'], crm: ['متابعة العملاء', 'CRM'], inventory: ['المخزون', 'Inventory'],
  sales: ['المبيعات', 'Sales'], purchases: ['المشتريات', 'Purchasing'], finance: ['الحسابات', 'Accounting'], treasury: ['الخزينة', 'Treasury'],
}

// ─── Users ─────────────────────────────────────────────────────────────
export function Users() {
  const t = useT()
  const { data, isLoading, error } = useApi<any>('/users', { per_page: 0 })
  const { data: rolesData } = useApi<any>('/roles')
  const [editing, setEditing] = useState<any | null>(null)
  const roleLabel = (name: string) => {
    const r = rolesData?.data?.find((x: any) => x.name === name)
    return r ? t(r.label, r.label_en) : name
  }
  return (
    <Sheet title={t('المستخدمون', 'Users')} actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing({ is_active: true, locale: 'ar', roles: [], max_discount_percent: 0, commission_rate: 0, is_salesperson: false })}>{t('مستخدم جديد', 'New user')}</Button>}>
      {isLoading ? <Spinner /> : error ? <ErrorBox error={error} /> : (
        <table className="ledger">
          <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('اسم الدخول', 'Username')}</th><th>{t('الدور', 'Role')}</th><th>{t('الفرع', 'Branch')}</th><th className="amount">{t('حد الخصم', 'Discount limit')}</th><th>{t('الحالة', 'Status')}</th><th style={{ width: 50 }} /></tr></thead>
          <tbody>
            {data.data.map((u: any) => (
              <tr key={u.id} onDoubleClick={() => setEditing(u)} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                <td className="font-medium">{u.name} {u.is_salesperson && <Pill tone="brand">{t('مندوب', 'Rep')}</Pill>}</td>
                <td className="num">{u.username}</td>
                <td>{u.roles?.map((r: any) => roleLabel(r.name)).join('، ')}</td>
                <td>{nameOf(u.branch)}</td>
                <td className="amount num">{percent(u.max_discount_percent ?? 0, 0)}</td>
                <td>{u.is_active ? <Pill tone="green">{t('نشط', 'Active')}</Pill> : <Pill tone="red">{t('موقوف', 'Disabled')}</Pill>}</td>
                <td><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(u)} aria-label={t('تعديل', 'Edit')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <UserForm user={editing} roles={rolesData?.data ?? []} onClose={() => setEditing(null)} />}
    </Sheet>
  )
}

function UserForm({ user, roles, onClose }: { user: any; roles: any[]; onClose: () => void }) {
  const t = useT()
  const custom = useDynamicFields('users', user)
  const refresh = useSession((s) => s.refreshLookups)
  const [form, setForm] = useState<any>({ ...user, email: user.email ?? '', phone: user.phone ?? '', password: '', roles: user.roles?.map((r: any) => (typeof r === 'string' ? r : r.name)) ?? [] })
  const [busy, setBusy] = useState(false)
  const set = (p: any) => setForm((f: any) => ({ ...f, ...p }))
  const save = async () => {
    setBusy(true)
    try {
      const body = { ...custom.payload(),
        name: form.name, username: form.username, email: form.email || null, phone: form.phone || null, password: form.password || null, locale: form.locale,
        branch_id: form.branch_id ?? null, default_warehouse_id: form.default_warehouse_id ?? null, default_cash_account_id: form.default_cash_account_id ?? null,
        max_discount_percent: form.max_discount_percent ?? 0, is_salesperson: Boolean(form.is_salesperson), commission_rate: form.commission_rate ?? 0, is_active: Boolean(form.is_active), roles: form.roles,
      }
      if (user.id) await api.put(`/users/${user.id}`, body)
      else await api.post('/users', body)
      invalidate('/users', '/roles')
      await refresh()
      toast.success(t('تم حفظ المستخدم', 'User saved'))
      onClose()
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={user.id ? `${t('تعديل', 'Edit')} ${user.name}` : t('مستخدم جديد', 'New user')} size="wide" onClose={() => { if (!busy) onClose() }} footer={<><Button disabled={busy} onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('حفظ', 'Save')}</Button></>}>
      {custom.renderRecord(form, setForm, DOMAIN_FORM_WIDGETS, busy, ['core.name', 'core.username', 'core.email', 'core.phone', 'core.locale'])}
      <div className="mt-4 max-w-md"><Field label={user.id ? t('كلمة مرور جديدة', 'New password') : t('كلمة المرور', 'Password')} hint={user.id ? t('اتركها فارغة للإبقاء عليها', 'Leave empty to keep') : t('6 أحرف على الأقل', 'At least 6 characters')}><Input disabled={busy} type="password" value={form.password} onChange={(event) => set({ password: event.target.value })} autoComplete="new-password" /></Field></div>
      <div className="mt-4">
        <div className="mb-2 text-[13px] font-semibold">{t('الأدوار', 'Roles')}</div>
        <div className="flex flex-wrap gap-4">{roles.map((r) => <Check key={r.id} checked={form.roles.includes(r.name)} onChange={(v) => set({ roles: v ? [...form.roles, r.name] : form.roles.filter((x: string) => x !== r.name) })} label={t(r.label, r.label_en)} />)}</div>
      </div>
      <div className="mt-4"><Check checked={Boolean(form.is_active)} onChange={(v) => set({ is_active: v })} label={t('الحساب نشط (إيقافه يسجل خروجه فوراً)', 'Account active (disabling signs the user out)')} /></div>
    </Modal>
  )
}

// ─── Roles ─────────────────────────────────────────────────────────────
export function Roles() {
  const t = useT()
  const { data, isLoading, error } = useApi<any>('/roles')
  const [selected, setSelected] = useState<any | null>(null)
  useEffect(() => {
    if (!selected && data?.data?.length) setSelected(data.data.find((r: any) => r.name !== 'admin') ?? data.data[0])
  }, [data])
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: '240px minmax(0,1fr)' }}>
      <Sheet title={t('الأدوار', 'Roles')} actions={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setSelected({ name: '', label: '', label_en: '', permissions: [], isNew: true })} aria-label={t('دور جديد', 'New role')} />}>
        <ul className="m-0 list-none p-1">
          {data.data.map((r: any) => (
            <li key={r.id}>
              <button className={`option w-full rounded-md border-0 text-start ${selected?.id === r.id ? 'active' : ''}`} style={{ background: selected?.id === r.id ? 'var(--ledger-soft)' : 'transparent' }} onClick={() => setSelected(r)}>
                <div className="flex items-center justify-between gap-2"><span>{t(r.label, r.label_en)}</span><span className="muted num text-[11px]">{r.users_count}</span></div>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      {selected && <RoleEditor key={selected.id ?? 'new'} role={selected} catalog={data.catalog} onSaved={(roles) => setSelected(roles.find((r: any) => r.name === selected.name) ?? null)} />}
    </div>
  )
}

function RoleEditor({ role, catalog, onSaved }: { role: any; catalog: Record<string, string[]>; onSaved: (roles: any[]) => void }) {
  const t = useT()
  const custom = useDynamicFields('roles', role)
  const [identity, setIdentity] = useState<Record<string, unknown>>({ name: role.name })
  const name = String(identity.name ?? '')
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions))
  const [busy, setBusy] = useState(false)
  const isAdmin = role.name === 'admin'
  const toggle = (p: string, on: boolean) => setPerms((s) => { const n = new Set(s); if (on) n.add(p); else n.delete(p); return n })
  return (
    <Sheet title={<span className="inline-flex items-center gap-2"><ShieldCheck size={15} />{role.isNew ? t('دور جديد', 'New role') : t(role.label, role.label_en)}</span>} actions={!isAdmin && <Button size="sm" variant="primary" loading={busy} onClick={async () => {
      setBusy(true)
      try {
        const body = { ...custom.payload(), name, permissions: [...perms] }
        const r = role.isNew ? await api.post('/roles', body) : await api.put(`/roles/${role.id}`, body)
        custom.acceptSaved(r.data.find((saved: any) => role.id ? saved.id === role.id : saved.name === name))
        invalidate('/roles')
        toast.success(t('تم حفظ الدور', 'Role saved'))
        onSaved(r.data)
      } catch (e: any) {
        custom.capture(e)
        toast.error(e.message)
      } finally {
        setBusy(false)
      }
    }}>{t('حفظ', 'Save')}</Button>}>
      {isAdmin ? <div className="muted p-4">{t('مدير النظام لديه كل الصلاحيات ولا يمكن تعديله.', 'The administrator has every permission and cannot be changed.')}</div> : (
        <div className="p-4">
          {custom.renderRecord(identity, (next) => setIdentity({ ...next, name: String(next.name ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '') }), DOMAIN_FORM_WIDGETS, busy)}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {Object.entries(catalog).map(([group, list]) => {
              const all = list.every((p) => perms.has(p))
              return (
                <div key={group} className="rounded-md p-3" style={{ border: '1px solid var(--rule)' }}>
                  <div className="mb-2 flex items-center justify-between"><b className="text-[13px]">{t(...(GROUP_LABELS[group] ?? [group, group]))}</b><button className="link text-[12px]" onClick={() => list.forEach((p) => toggle(p, !all))}>{all ? t('إلغاء الكل', 'None') : t('الكل', 'All')}</button></div>
                  <div className="grid gap-1.5">{list.map((p) => <Check key={p} checked={perms.has(p)} onChange={(v) => toggle(p, v)} label={<span className="text-[13px]">{t(...(PERMISSION_LABELS[p] ?? [p, p]))}</span>} />)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Sheet>
  )
}
