import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApi } from '@/lib/query'
import { nameOf, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { LookupSelect, UserSelect, PartyPicker } from '@/components/Pickers'
import { Button, Check, Field, Input, NumberInput, Select } from '@/components/ui'
import type { FormWidgetProps, FormWidgets } from './DynamicForm'

function LookupWidget({ field, value, disabled, onChange, recordId, error, values }: FormWidgetProps) {
  const t = useT()
  const kind = { branch: 'branches', category: 'categories', price_list: 'price_lists', crm_source: 'crm_sources', product_category: 'categories', brand: 'brands', warehouse: 'warehouses', stock_warehouse: 'warehouses', stock_to: 'warehouses', stock_category: 'categories', default_warehouse: 'warehouses', cash_account: 'cash_accounts' }[field.widget ?? ''] as 'branches' | 'categories' | 'price_lists' | 'crm_sources' | 'brands' | 'warehouses' | 'cash_accounts'
  return <Field label={t(field.label_ar, field.label_en)} error={error}><LookupSelect kind={kind} value={value == null || value === '' ? null : Number(value)} disabled={disabled} filter={field.widget === 'category' ? (row) => row.id !== recordId : field.widget === 'default_warehouse' ? row => !row.is_transit : field.widget === 'stock_to' ? row => row.id !== Number(values['core.warehouse_id']) : undefined} onChange={onChange} /></Field>
}
function UserWidget({ field, value, disabled, onChange, error }: FormWidgetProps) {
  const t = useT()
  return <Field label={t(field.label_ar, field.label_en)} error={error}><UserSelect disabled={disabled} salespeople={field.widget === 'salesperson'} value={value == null ? null : Number(value)} onChange={onChange} /></Field>
}
function TechnicianWidget({ field, value, disabled, onChange, error }: FormWidgetProps) {
  const t = useT(); const technicians = useSession((state) => state.lookups?.technicians)
  return <Field label={t(field.label_ar, field.label_en)} error={error}><Select disabled={disabled} value={String(value ?? '')} placeholder="—" options={(technicians ?? []).map((row) => ({ value: row.id, label: row.name }))} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} /></Field>
}
function CreditLimitWidget({ value, disabled, onChange, error }: FormWidgetProps) {
  const t = useT()
  return <fieldset><legend>{t('حد الائتمان', 'Credit limit')}</legend>{error && <small role="alert">{error}</small>}<div className="flex items-center gap-3"><Check label={t('تحديد حد', 'Set a limit')} checked={value != null} disabled={disabled} onChange={(checked) => onChange(checked ? 0 : null)} /><NumberInput value={Number(value ?? 0)} disabled={disabled || value == null} aria-label={t('قيمة حد الائتمان', 'Credit limit amount')} onChange={onChange} /></div></fieldset>
}
function TagsWidget({ field, value, disabled, onChange, error }: FormWidgetProps) {
  const t = useT(); const id = useId(); const tags = useSession((state) => state.lookups?.tags)
  return <Field label={t(field.label_ar, field.label_en)} hint={t('افصل بفاصلة', 'Separate with commas')} error={error}><Input disabled={disabled} list={id} value={Array.isArray(value) ? value.join('، ') : ''} onChange={(event) => onChange(event.target.value.split(/[,،]/).map((tag) => tag.trim()).filter(Boolean))} /><datalist id={id}>{tags?.map((tag: any) => <option key={tag.id} value={tag.name} />)}</datalist></Field>
}
function ContactsWidget({ field, value, disabled, onChange, error }: FormWidgetProps) {
  const t = useT(); const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[]
  return <fieldset className="grid gap-2"><legend>{t(field.label_ar, field.label_en)}</legend>{error && <p role="alert">{error}</p>}
    {rows.map((row, index) => <div key={String(row.id ?? index)} className="grid grid-cols-2 gap-2 rounded border p-2">{[['name','الاسم','Name'],['position','الوظيفة','Position'],['phone','الهاتف','Phone'],['email','البريد','Email']].map(([key, ar, en]) => <Field key={key} label={t(ar, en)}><Input disabled={disabled} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={String(row[key] ?? '')} onChange={(event) => onChange(rows.map((item, at) => at === index ? { ...item, [key]: event.target.value } : item))} /></Field>)}<Button disabled={disabled} size="sm" icon={Trash2} onClick={() => onChange(rows.filter((_, at) => at !== index))}>{t('حذف جهة الاتصال', 'Remove contact')}</Button></div>)}
    {!disabled && <Button icon={Plus} onClick={() => onChange([...rows, { name: '', position: '', phone: '', email: '' }])}>{t('إضافة جهة اتصال', 'Add contact')}</Button>}
  </fieldset>
}
function FollowUpWidget({ value, disabled, onChange, error }: FormWidgetProps) {
  const t = useT(); const data = value && typeof value === 'object' ? value as { title?: string; due_at?: string } : null
  return <fieldset className="grid gap-3 rounded border p-3"><Check label={t('حجز متابعة تالية', 'Book a follow-up')} checked={data !== null} disabled={disabled} onChange={(checked) => onChange(checked ? { title: '', due_at: '' } : null)} />{data && <><Field label={t('المطلوب', 'What needs doing')} error={error}><Input disabled={disabled} value={data.title ?? ''} onChange={(event) => onChange({ ...data, title: event.target.value })} /></Field><Field label={t('موعد المتابعة', 'Follow-up due')}><Input disabled={disabled} type="datetime-local" value={data.due_at ?? ''} onChange={(event) => onChange({ ...data, due_at: event.target.value })} /></Field></>}</fieldset>
}

function PartyWidget({ field, value, values, disabled, onChange, error }: FormWidgetProps) {
  const t = useT()
  if (values['core.lead_id']) return null
  const party = values['core.party'] as { name?: string; name_en?: string } | undefined
  return <Field label={t(field.label_ar, field.label_en)} error={error}><PartyPicker role={field.party_role ?? "customer"} disabled={disabled} value={value == null ? null : Number(value)} initialLabel={party ? nameOf(party) : undefined} onChange={onChange} /></Field>
}
function StageWidget({ field, value, disabled, onChange, error }: FormWidgetProps) {
  const t = useT(); const stages = useSession((state) => state.lookups?.crm_stages)
  return <Field label={t(field.label_ar, field.label_en)} error={error}><Select disabled={disabled} value={String(value ?? '')} placeholder="—" options={(stages ?? []).filter((row: any) => !row.is_lost).map((row: any) => ({ value: row.id, label: `${nameOf(row)} (${row.probability}%)` }))} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} /></Field>
}
function AccountParentWidget({ field, value, disabled, onChange, recordId, error }: FormWidgetProps) {
  const t = useT(); const accounts = useApi<{ data: { id: number; is_group: boolean; code: string; name: string; name_en?: string }[] }>('/accounts')
  return <Field label={t(field.label_ar, field.label_en)} error={error || (accounts.error ? String(accounts.error) : undefined)}><Select disabled={disabled || accounts.isLoading} value={String(value ?? '')} placeholder={t('بدون (حساب رئيسي)', 'None (top level)')} options={(accounts.data?.data ?? []).filter((row) => row.is_group && row.id !== recordId).map((row) => ({ value: row.id, label: `${row.code} ${nameOf(row)}` }))} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} /></Field>
}

/** Only application-owned React controls are registered; schemas cannot supply executable code. */
export const DOMAIN_FORM_WIDGETS: FormWidgets = {
  stock_warehouse: LookupWidget, stock_to: LookupWidget, stock_category: LookupWidget, trade_party: PartyWidget,
  party_customer: PartyWidget, crm_stage: StageWidget, account_parent: AccountParentWidget,
  warehouse: LookupWidget, default_warehouse: LookupWidget, cash_account: LookupWidget, product_category: LookupWidget, brand: LookupWidget,
  branch: LookupWidget, category: LookupWidget, price_list: LookupWidget, crm_source: LookupWidget,
  user: UserWidget, salesperson: UserWidget, technician: TechnicianWidget, credit_limit: CreditLimitWidget,
  tags: TagsWidget, contacts: ContactsWidget, follow_up: FollowUpWidget,
}
