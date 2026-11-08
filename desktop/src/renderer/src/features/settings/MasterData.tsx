import { CustomFieldFilters } from '@/features/forms/CustomFieldFilters'
import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields, type FormSchema } from '@/features/forms/DynamicForm'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { percent } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { Button, ErrorBox, Input, Pill, Sheet, Spinner } from '@/components/ui'
import { Modal, confirmDialog } from '@/components/Dialogs'

export interface FieldDef {
  key: string
  ar: string
  en: string
  type?: 'text' | 'number' | 'bool' | 'select' | 'color' | 'branch' | 'user' | 'category'
  options?: { value: string; label: string }[]
  required?: boolean
  ltr?: boolean
  list?: boolean
}

export interface ResourceDef {
  resource: string
  ar: string
  en: string
  hint?: [string, string]
  fields: FieldDef[]
  defaults?: Record<string, any>
}

const NAME: FieldDef[] = [{ key: 'name', ar: 'الاسم', en: 'Name', required: true, list: true }, { key: 'name_en', ar: 'الاسم بالإنجليزية', en: 'English name', ltr: true, list: true }]
const CODE: FieldDef = { key: 'code', ar: 'الكود', en: 'Code', required: true, ltr: true, list: true }
const ACTIVE: FieldDef = { key: 'is_active', ar: 'نشط', en: 'Active', type: 'bool', list: true }

export const RESOURCES: Record<string, ResourceDef> = {
  branches: { resource: 'branches', ar: 'الفروع', en: 'Branches', fields: [CODE, ...NAME, { key: 'phone', ar: 'الهاتف', en: 'Phone', ltr: true }, { key: 'address', ar: 'العنوان', en: 'Address' }, { key: 'eta_branch_code', ar: 'كود الفرع لدى المصلحة', en: 'Tax authority branch code', ltr: true }, ACTIVE], defaults: { is_active: true } },
  warehouses: { resource: 'warehouses', ar: 'المخازن', en: 'Warehouses', fields: [CODE, ...NAME, { key: 'branch_id', ar: 'الفرع', en: 'Branch', type: 'branch', list: true }, { key: 'keeper_id', ar: 'أمين المخزن', en: 'Storekeeper', type: 'user', list: true }, { key: 'kind', ar: 'النوع', en: 'Kind', type: 'select', options: [{ value: 'store', label: 'Store' }, { value: 'van', label: 'Van' }], list: true }, { key: 'technician_id', ar: 'الفني', en: 'Technician', type: 'user', list: true }, { key: 'address', ar: 'العنوان', en: 'Address' }, ACTIVE], defaults: { is_active: true, kind: 'store' } },
  units: { resource: 'units', ar: 'وحدات القياس', en: 'Units of measure', fields: [...NAME, { key: 'allow_fraction', ar: 'تقبل الكسور (كجم، متر…)', en: 'Allows fractions (kg, m…)', type: 'bool', list: true }] },
  categories: { resource: 'categories', ar: 'مجموعات الأصناف', en: 'Item categories', fields: [CODE, ...NAME, { key: 'parent_id', ar: 'المجموعة الرئيسية', en: 'Parent category', type: 'category', list: true }] },
  brands: { resource: 'brands', ar: 'العلامات التجارية', en: 'Brands', fields: [{ key: 'name', ar: 'الاسم', en: 'Name', required: true, list: true }] },
  'price-lists': { resource: 'price-lists', ar: 'قوائم الأسعار', en: 'Price lists', hint: ['مثل: جملة، نصف جملة، موزعين. تُحدد أسعارها من شاشة الصنف وتُربط بالعميل.', 'E.g. wholesale or distributors. Prices are set on each item and the list is assigned to customers.'], fields: [...NAME, ACTIVE], defaults: { is_active: true } },
  'cost-centers': { resource: 'cost-centers', ar: 'مراكز التكلفة', en: 'Cost centres', hint: ['لتحليل المصروفات والإيرادات حسب القسم أو المشروع أو الفرع.', 'Analyse income and expenses by department, project or site.'], fields: [CODE, ...NAME, ACTIVE], defaults: { is_active: true } },
  'tax-rates': { resource: 'tax-rates', ar: 'الضرائب', en: 'Tax rates', fields: [...NAME, { key: 'type', ar: 'النوع', en: 'Type', type: 'select', options: [{ value: 'vat', label: 'VAT' }, { value: 'wht', label: 'WHT' }], list: true }, { key: 'rate', ar: 'النسبة %', en: 'Rate %', type: 'number', required: true, list: true }, { key: 'eta_type', ar: 'نوع الضريبة (المصلحة)', en: 'ETA tax type', ltr: true }, { key: 'eta_subtype', ar: 'النوع الفرعي (المصلحة)', en: 'ETA subtype', ltr: true }, { key: 'is_default', ar: 'افتراضي', en: 'Default', type: 'bool', list: true }, ACTIVE], defaults: { type: 'vat', rate: 14, is_active: true } },
  'crm-stages': { resource: 'crm-stages', ar: 'مراحل الصفقات', en: 'Deal stages', fields: [...NAME, { key: 'probability', ar: 'احتمال الفوز %', en: 'Win probability %', type: 'number', list: true }, { key: 'sort_order', ar: 'الترتيب', en: 'Order', type: 'number', list: true }, { key: 'color', ar: 'اللون', en: 'Colour', type: 'color', list: true }, { key: 'is_won', ar: 'مرحلة فوز', en: 'Won stage', type: 'bool', list: true }, { key: 'is_lost', ar: 'مرحلة خسارة', en: 'Lost stage', type: 'bool', list: true }], defaults: { probability: 20, sort_order: 10, color: '#5b63d6' } },
  'crm-sources': { resource: 'crm-sources', ar: 'مصادر العملاء', en: 'Lead sources', fields: NAME },
  'crm-lost-reasons': { resource: 'crm-lost-reasons', ar: 'أسباب خسارة الصفقات', en: 'Lost reasons', fields: NAME },
  tags: { resource: 'tags', ar: 'الوسوم', en: 'Tags', fields: [{ key: 'name', ar: 'الاسم', en: 'Name', required: true, list: true }, { key: 'color', ar: 'اللون', en: 'Colour', type: 'color', list: true }], defaults: { color: '#485e8b' } },
}

/** List + edit dialog for one small master table. */
export function MasterData({ def }: { def: ResourceDef }) {
  return <MasterDataContent key={def.resource} def={def} />
}

function MasterDataContent({ def }: { def: ResourceDef }) {
  const t = useT()
  const refresh = useSession((s) => s.refreshLookups)
  const lookups = useSession((s) => s.lookups)
  const schema = useApi<FormSchema>(`/forms/${def.resource}`)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Record<string, string>>({})
  useEffect(() => { const timer = setTimeout(() => { setTerm(search); setPage(1) }, 250); return () => clearTimeout(timer) }, [search])
  const { data, isLoading, error } = useApi<any>(`/master/${def.resource}`, { search: term, page, per_page: 50, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '').map(([key, value]) => [`custom[${key}]`, value])) })
  const extraColumns = (schema.data?.fields ?? []).filter((field) => field.usage_flags_json?.list)
  const [editing, setEditing] = useState<any | null>(null)
  const rows: any[] = data?.data ?? []
  const listFields = def.fields.filter((f) => f.list)

  const show = (row: any, f: FieldDef) => {
    const v = row[f.key]
    if (f.type === 'bool') return v ? <Pill tone="green">{t('نعم', 'Yes')}</Pill> : <span className="muted">—</span>
    if (f.type === 'color') return v ? <span className="inline-block size-4 rounded" style={{ background: v, border: '1px solid var(--rule)' }} /> : null
    if (f.type === 'branch') return nameOf(row.branch ?? lookups?.branches.find((b: any) => b.id === v))
    if (f.type === 'user') return row.keeper?.name ?? lookups?.users.find((u: any) => u.id === v)?.name ?? ''
    if (f.type === 'category') return nameOf(row.parent)
    if (f.key === 'rate' || f.key === 'probability') return <span className="num">{percent(v, 0)}</span>
    if (f.type === 'select') return f.options?.find((o) => o.value === v)?.label ?? v
    return <span className={f.ltr ? 'num' : ''}>{v}</span>
  }

  const remove = async (r: any) => {
    if (!(await confirmDialog({ title: t('حذف السجل؟', 'Delete this record?'), danger: true, confirmLabel: t('حذف', 'Delete') }))) return
    try {
      await api.del(`/master/${def.resource}/${r.id}`)
      invalidate(`/master/${def.resource}`)
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <Sheet title={t(def.ar, def.en)} actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing({ ...(def.defaults ?? {}) })}>{t('إضافة', 'Add')}</Button>}>
      {def.hint && <p className="muted m-0 px-4 pt-3 text-[13px]">{t(...def.hint)}</p>}
      <div className="flex flex-wrap items-end gap-3 p-3"><Input className="w-[240px]" aria-label={t('بحث', 'Search')} placeholder={t('بحث بالاسم أو الحقول الإضافية', 'Search names or custom fields')} value={search} onChange={(event) => setSearch(event.target.value)} /><CustomFieldFilters fields={schema.data?.fields ?? []} value={filters} onChange={(next) => { setFilters(next); setPage(1) }} /></div>
      {isLoading ? <Spinner /> : error ? <ErrorBox error={error} /> : rows.length === 0 ? <div className="muted p-4">{t('لا توجد بيانات بعد', 'Nothing here yet')}</div> : (
        <table className="ledger">
          <thead><tr>{listFields.map((f) => <th key={f.key}>{t(f.ar, f.en)}</th>)}{extraColumns.map((field) => <th key={field.key}>{t(field.label_ar, field.label_en)}</th>)}<th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onDoubleClick={() => setEditing(r)}>
                {listFields.map((f) => <td key={f.key}>{show(r, f)}</td>)}{extraColumns.map((field) => <td key={field.key}>{Array.isArray(r.custom_fields?.[field.key]) ? r.custom_fields[field.key].join(', ') : String(r.custom_fields?.[field.key] ?? '')}</td>)}
                <td>
                  <span className="flex justify-end gap-0.5">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(r)} aria-label={t('تعديل', 'Edit')} />
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove(r)} aria-label={t('حذف', 'Delete')} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.last_page > 1 && <div className="flex items-center justify-between p-3"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</Button><span>{page} / {data.last_page}</span><Button disabled={page >= data.last_page} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</Button></div>}
      {editing && <RecordForm def={def} row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); invalidate(`/master/${def.resource}`); await refresh() }} />}
    </Sheet>
  )
}

function RecordForm({ def, row, onClose, onSaved }: { def: ResourceDef; row: any; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const custom = useDynamicFields(def.resource, row)
  const blankOf = (f: FieldDef) => (f.type === 'bool' ? false : f.type === 'number' ? 0 : f.type && ['branch', 'user', 'category'].includes(f.type) ? null : '')
  const [form, setForm] = useState<any>(() => Object.fromEntries(def.fields.map((f) => [f.key, row[f.key] ?? blankOf(f)])))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const body = { ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])), ...custom.payload() }
      if (row.id) await api.put(`/master/${def.resource}/${row.id}`, body)
      else await api.post(`/master/${def.resource}`, body)
      toast.success(t('تم الحفظ', 'Saved'))
      onSaved()
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`${t(def.ar, def.en)} — ${row.id ? t('تعديل', 'Edit') : t('جديد', 'New')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length} onClick={save}>{t('حفظ', 'Save')}</Button></>}>
      {custom.renderRecord(form, setForm, DOMAIN_FORM_WIDGETS)}
    </Modal>
  )
}
