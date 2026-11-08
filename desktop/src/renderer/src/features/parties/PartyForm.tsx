import { CustomerProductEntry, productEntryPayload, type ProductEntry } from './CustomerProductEntry'
import { can, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { ApiError } from '@/lib/api'
import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/query'
import { toNumber, today } from '@/lib/format'
import { useT } from '@/store/prefs'
import { Modal } from '@/components/Dialogs'
import { Button, Check, ErrorBox, Sheet } from '@/components/ui'

export function PartyForm({ party, role, onClose, onSaved }: { party?: any; role?: 'customer' | 'supplier'; onClose: () => void; onSaved?: (p: any) => void }) {
  const t = useT()
  const custom = useDynamicFields(role === 'supplier' || (party?.is_supplier && !party?.is_customer) ? 'suppliers' : 'customers', party)
  const [form, setForm] = useState<any>(() => ({
    code: party?.code ?? '',
    is_customer: party ? party.is_customer : role !== 'supplier',
    is_supplier: party ? party.is_supplier : role === 'supplier',
    kind: party?.kind ?? (role === 'supplier' ? 'company' : 'individual'),
    name: party?.name ?? '',
    name_en: party?.name_en ?? '',
    tax_number: party?.tax_number ?? '',
    commercial_register: party?.commercial_register ?? '',
    national_id: party?.national_id ?? '',
    phone: party?.phone ?? '',
    mobile: party?.mobile ?? '',
    email: party?.email ?? '',
    city: party?.city ?? '',
    address: party?.address ?? '',
    payment_terms_days: party?.payment_terms_days ?? 0,
    credit_limit: party?.credit_limit ?? null,
    price_list_id: party?.price_list_id ?? null,
    salesperson_id: party?.salesperson_id ?? null,
    subject_to_wht: party?.subject_to_wht ?? false,
    wht_rate: toNumber(party?.wht_rate ?? 1),
    notes: party?.notes ?? '',
    is_active: party?.is_active ?? true,
    tags: party?.tags?.map((x: any) => x.name) ?? [],
    contacts: party?.contacts ?? [],
    opening_balance: 0,
    opening_date: today(),
  }))
  const existingAllowed = can('service.manage') && can('service.view_all') && can('service.view')
  const saleAllowed = can('sales.invoices') && (can('products.view') || can('stock.view'))
  const [includeProduct, setIncludeProduct] = useState(false)
  const [entry, setEntry] = useState<ProductEntry>(() => ({ mode: existingAllowed ? 'existing' : 'new_sale', product_id: null, profile_id: null, serial_number: '', purchased_on: existingAllowed ? '' : today(), installed_on: '', warranty_starts_on: '', warranty_ends_on: '', quantity: 1, unit_price: 0, warehouse_id: useSession.getState().user?.default_warehouse_id ?? null }))
  const wantsProduct = !party && Boolean(form.is_customer) && includeProduct
  const existingEntry = wantsProduct && entry.mode === 'existing'
  const hasAddress = Boolean(form.city?.trim() || form.address?.trim())
  const unitFields = useDynamicFields('customer-units', null, existingEntry)
  const addressFields = useDynamicFields('party-addresses', null, existingEntry && hasAddress)
  const invoiceFields = useDynamicFields('sales_invoice', null, wantsProduct && !existingEntry)
  const relatedReady = !wantsProduct || (existingEntry ? Boolean(unitFields.schema.data && (!hasAddress || addressFields.schema.data)) : Boolean(invoiceFields.schema.data))
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const productEntry = wantsProduct ? productEntryPayload(entry, existingEntry ? unitFields.payload() : invoiceFields.payload(), existingEntry && hasAddress ? addressFields.payload() : undefined) : undefined
      const body = { ...form, ...(productEntry ? { product_entry: productEntry } : {}), ...custom.payload(), code: form.code || null, credit_limit: form.credit_limit == null ? null : toNumber(form.credit_limit), opening_balance: party ? undefined : form.opening_balance || null }
      const r = party ? await api.put(`/parties/${party.id}`, body) : await api.post('/parties', body)
      invalidate('/parties', '/customer-units', '/maintenance', '/documents', '/reports')
      toast.success(t('تم الحفظ', 'Saved'))
      onSaved?.(r.data)
      onClose()
      if (r.product_entry_result?.invoice_id) navigate(`/docs/sales_invoice/${r.product_entry_result.invoice_id}`)
    } catch (e: any) {
      setError(e)
      custom.capture(e)
      unitFields.capture(e, 'product_entry')
      invoiceFields.capture(e, 'product_entry')
      addressFields.capture(e, 'product_entry.address_form')
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={party ? t('تعديل ', 'Edit ') + party.name : form.is_supplier && !form.is_customer ? t('مورد جديد', 'New supplier') : t('عميل جديد', 'New customer')}
      onClose={onClose}
      busy={busy}
      size="wide"
      footer={<><Button disabled={busy} onClick={onClose}>{t('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!custom.schema.data?.core_fields?.length || !relatedReady} onClick={save}>{wantsProduct ? existingEntry ? t('حفظ العميل والفلتر', 'Save customer and filter') : t('حفظ وفتح الفاتورة', 'Save and open invoice') : t('حفظ', 'Save')}</Button></>}
    >
      {error ? <ErrorBox error={error} /> : null}
      {custom.renderRecord(form, setForm, DOMAIN_FORM_WIDGETS, false, ['core.name', 'core.mobile', 'core.phone', 'core.city', 'core.address', 'core.notes'])}
      {!party && form.is_customer && (existingAllowed || saleAllowed) && <Sheet title={t('المنتج المرتبط بالعميل', 'Customer’s product')} bodyClassName="grid gap-3 p-3">
        <Check label={t('تسجيل منتج مع العميل (اختياري)', 'Record a product with this customer (optional)')} checked={includeProduct} onChange={setIncludeProduct} />
        {wantsProduct && <CustomerProductEntry value={entry} onChange={setEntry} existingAllowed={existingAllowed} saleAllowed={saleAllowed} errors={error instanceof ApiError ? error.errors : {}} customFields={existingEntry ? <>{unitFields.render()}{hasAddress && addressFields.render()}</> : invoiceFields.render()} />}
      </Sheet>}
    </Modal>
  )
}
