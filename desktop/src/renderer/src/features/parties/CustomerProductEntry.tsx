import { useEffect, type ReactNode } from 'react'
import { ProductPicker, LookupSelect } from '@/components/Pickers'
import { Button, ErrorBox, Field, Input, NumberInput, Segmented, Select } from '@/components/ui'
import { useApi } from '@/lib/query'
import { today } from '@/lib/format'
import { navigate } from '@/store/workspace'
import { useT } from '@/store/prefs'
import type { FormValues } from '@/features/forms/DynamicForm'

export interface ProductEntry {
  mode: 'existing' | 'new_sale'
  product_id: number | null
  profile_id: number | null
  serial_number: string
  purchased_on: string
  installed_on: string
  warranty_starts_on: string
  warranty_ends_on: string
  quantity: number
  unit_price: number
  warehouse_id: number | null
}

/** Each mode has a distinct payload so hidden controls cannot create unintended records. */
export function productEntryPayload(entry: ProductEntry, custom: FormValues, addressCustom?: FormValues): FormValues {
  const { form_key: _formKey, ...metadata } = custom
  const { form_key: _addressKey, ...addressMetadata } = addressCustom ?? {}
  const common = { mode: entry.mode, product_id: entry.product_id, purchased_on: entry.purchased_on || null, ...metadata }
  return entry.mode === 'existing'
    ? { ...common, profile_id: entry.profile_id, serial_number: entry.serial_number || null, installed_on: entry.installed_on || null, warranty_starts_on: entry.warranty_starts_on || null, warranty_ends_on: entry.warranty_ends_on || null, ...(addressCustom ? { address_form: addressMetadata } : {}) }
    : { ...common, quantity: entry.quantity, unit_price: entry.unit_price, warehouse_id: entry.warehouse_id }
}

export function CustomerProductEntry({ value, onChange, existingAllowed, saleAllowed, customFields, errors = {} }: {
  value: ProductEntry; onChange: (value: ProductEntry) => void; existingAllowed: boolean; saleAllowed: boolean
  customFields?: ReactNode; errors?: Record<string, string[]>
}) {
  const t = useT()
  const existing = value.mode === 'existing'
  const profiles = useApi<any>(existing ? '/maintenance/profiles' : null)
  const choices = (profiles.data?.data ?? []).filter((profile: any) => profile.active && profile.product_id === value.product_id)
  const defaultProfile = choices[0]?.id
  useEffect(() => {
    if (existing && value.product_id && !value.profile_id && defaultProfile) onChange({ ...value, profile_id: defaultProfile })
  }, [existing, value, defaultProfile, onChange])
  const set = (patch: Partial<ProductEntry>) => onChange({ ...value, ...patch })
  const error = (key: string) => errors[`product_entry.${key}`]?.[0]
  return <div className="grid gap-3">
    {existingAllowed && saleAllowed && <Segmented value={value.mode} onChange={(mode) => set({ mode, purchased_on: mode === 'new_sale' && !value.purchased_on ? today() : value.purchased_on })} options={[
      { value: 'existing', label: t('فلتر يمتلكه العميل', 'Filter already owned') },
      { value: 'new_sale', label: t('بيع جديد — مسودة فاتورة', 'New sale — invoice draft') },
    ]} />}
    <p className="muted text-[12px]">{existing ? t('تُحفظ بيانات الفلتر مع العميل. سجل تاريخ التركيب الفعلي لبدء مواعيد تغيير الشمعات.', 'The filter is saved with the customer. Enter the actual installation date to start replacement reminders.') : t('تُحفظ فاتورة مرتبطة بالعميل. راجعها ورحّلها لتسجيل البيع وحركة المخزون والتحصيل.', 'A linked invoice draft will open after saving. Review and post it to record the sale, stock movement and payment.')}</p>
    <Field label={t('المنتج', 'Product')} error={error('product_id')}><ProductPicker type={existing ? 'stock' : undefined} warehouseId={value.warehouse_id} value={value.product_id} onChange={(id, product) => set({ product_id: id, profile_id: null, unit_price: Number(product?.sale_price ?? 0) })} /></Field>
    {existing ? <>
      {profiles.error && <ErrorBox error={profiles.error} />}
      <Field label={t('برنامج تغيير الشمعات', 'Replacement schedule')} error={error('profile_id')}><Select value={value.profile_id ?? ''} placeholder={t('اختر البرنامج', 'Choose schedule')} options={choices.map((profile: any) => ({ value: profile.id, label: `${profile.name} · v${profile.version}` }))} onChange={(event) => set({ profile_id: Number(event.target.value) || null })} /></Field>
      {value.product_id && !profiles.isLoading && !profiles.error && !choices.length && <div className="flex flex-wrap items-center gap-2 text-[12px]"><span>{t('أضف برنامج الصيانة لهذا الطراز أولاً.', 'Add a replacement schedule for this model first.')}</span><Button size="sm" onClick={() => navigate('/service/profiles')}>{t('برامج الصيانة', 'Replacement schedules')}</Button></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('الرقم المسلسل (إن وجد)', 'Serial number (if applicable)')} error={error('serial_number')}><Input dir="ltr" value={value.serial_number} onChange={(event) => set({ serial_number: event.target.value })} /></Field>
        <Field label={t('تاريخ الشراء (إن عُرف)', 'Purchase date (if known)')} error={error('purchased_on')}><Input type="date" value={value.purchased_on} onChange={(event) => set({ purchased_on: event.target.value })} /></Field>
        <Field label={t('تاريخ التركيب الفعلي (إن عُرف)', 'Actual installation date (if known)')} error={error('installed_on')}><Input type="date" value={value.installed_on} onChange={(event) => set({ installed_on: event.target.value })} /></Field>
      </div>
      <details open={Boolean(error('warranty_starts_on') || error('warranty_ends_on')) || undefined}><summary className="muted cursor-pointer text-[12px]">{t('مدة الضمان', 'Warranty dates')}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{(['warranty_starts_on', 'warranty_ends_on'] as const).map((key) => <Field key={key} label={key === 'warranty_starts_on' ? t('بداية الضمان', 'Warranty starts') : t('نهاية الضمان', 'Warranty ends')} error={error(key)}><Input type="date" value={value[key]} onChange={(event) => set({ [key]: event.target.value })} /></Field>)}</div></details>
    </> : <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('الكمية', 'Quantity')} error={error('quantity')}><NumberInput value={value.quantity} onChange={(quantity) => set({ quantity })} /></Field>
      <Field label={t('سعر الوحدة', 'Unit price')} error={error('unit_price')}><NumberInput value={value.unit_price} onChange={(unit_price) => set({ unit_price })} /></Field>
      <Field label={t('مخزن البيع', 'Sale warehouse')} error={error('warehouse_id')}><LookupSelect kind="warehouses" value={value.warehouse_id} onChange={(warehouse_id) => set({ warehouse_id })} filter={(warehouse) => !warehouse.is_transit} /></Field>
      <Field label={t('تاريخ الفاتورة', 'Invoice date')} error={error('purchased_on')}><Input type="date" value={value.purchased_on} onChange={(event) => set({ purchased_on: event.target.value })} /></Field>
    </div>}
    {customFields}
  </div>
}
