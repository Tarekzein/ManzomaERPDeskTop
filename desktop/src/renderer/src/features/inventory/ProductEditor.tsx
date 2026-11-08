import { ProductSpareParts } from './ProductSpareParts'
import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useRecoverableDraft } from '@/features/forms/useRecoverableDraft'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BookOpenText, Plus, Save, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { date, money, qty, today, toNumber } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { can, useSession } from '@/store/session'
import { navigate, useWorkspace } from '@/store/workspace'
import { useActiveTab, useTab, useTabTitle } from '@/workspace/TabContext'
import { Button, Check, ErrorBox, Field, FormSection, Input, Money, NumberInput, Pill, Segmented, Select, Spinner, Textarea } from '@/components/ui'
import { confirmDialog } from '@/components/Dialogs'
import { LookupSelect } from '@/components/Pickers'

interface UnitRow {
  unit_id: number | null
  factor: number
  barcode: string
  sale_price: number | null
  purchase_price: number | null
  is_default_sale: boolean
  is_default_purchase: boolean
  prices: Record<number, number | null>
  id?: number
}

type Tracking = 'none' | 'batches' | 'serials'

/**
 * Item card: what the item is, its prices and units, and how its stock is kept.
 * Everything a one-unit item needs is plain fields; extra units, price lists and
 * per-warehouse reorder levels only take space when they're used.
 */
export default function ProductEditor() {
  const t = useT()
  const tab = useTab()
  const id = tab.params.id
  const lookups = useSession((s) => s.lookups)
  const priceLists = lookups?.price_lists ?? []
  const { data, isLoading, error, refetch } = useApi<any>(id ? `/products/${id}` : null)
  const product = data?.data
  const custom = useDynamicFields('products', product)
  const manage = can('products.manage')
  const defaultVat = lookups?.tax_rates?.find((r: any) => r.type === 'vat' && r.is_default)?.id ?? null
  const pieceId = lookups?.units?.[0]?.id ?? null
  const dirty = useWorkspace((s) => s.tabs.find((x) => x.id === tab.tabId)?.dirty)
  const activeTab = useActiveTab()

  const [form, setForm] = useState<any>({ uses_spare_parts: false, spare_parts: [], initial_stock: { quantity: 0, warehouse_id: useSession.getState().user?.default_warehouse_id ?? lookups?.warehouses?.find((w: any) => !w.is_transit)?.id ?? null, date: today(), unit_cost: null, batch_no: '', expiry_date: '', serial_numbers: [] }, code: '', name: '', name_en: '', type: 'stock', category_id: null, brand_id: null, base_unit_id: pieceId, tax_rate_id: defaultVat, description: '', track_batches: false, track_serials: false, sale_price: 0, min_sale_price: 0, purchase_price: 0, reorder_level: 0, reorder_qty: 0, eta_code_type: '', eta_item_code: '', is_active: true })
  const [units, setUnits] = useState<UnitRow[]>([{ unit_id: pieceId, factor: 1, barcode: '', sale_price: null, purchase_price: null, is_default_sale: true, is_default_purchase: true, prices: {} }])
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const set = (p: any) => {
    setForm((f: any) => ({ ...f, ...p, ...(p.type && p.type !== 'stock' ? { uses_spare_parts: false, spare_parts: [], initial_stock: undefined } : {}) }))
    setErrors(old => Object.fromEntries(Object.entries(old).filter(([key]) => !Object.keys(p).some(field => key === field || key.startsWith(`${field}.`)))))
    tab.setDirty(true)
  }
  useTabTitle(product ? nameOf(product) : id ? undefined : t('صنف جديد', 'New item'))

  useEffect(() => {
    if (!product) return
    setForm({ ...product, eta_code_type: product.eta_code_type ?? '', eta_item_code: product.eta_item_code ?? '', description: product.description ?? '', name_en: product.name_en ?? '' })
    setUnits(product.units.map((u: any) => ({
      id: u.id, unit_id: u.unit_id, factor: toNumber(u.factor), barcode: u.barcode ?? '', sale_price: u.sale_price !== null ? toNumber(u.sale_price) : null,
      purchase_price: u.purchase_price !== null ? toNumber(u.purchase_price) : null, is_default_sale: u.is_default_sale, is_default_purchase: u.is_default_purchase,
      prices: Object.fromEntries(product.price_list_items.filter((p: any) => p.product_unit_id === u.id).map((p: any) => [p.price_list_id, toNumber(p.price)])),
    })))
  }, [product])

  // Keep the base unit row in step with the base unit picker.
  useEffect(() => {
    setUnits((rows) => {
      if (rows.some((r) => r.unit_id === form.base_unit_id)) return rows.map((r) => (r.unit_id === form.base_unit_id ? { ...r, factor: 1 } : r))
      const [first, ...rest] = rows
      return [{ ...first, unit_id: form.base_unit_id, factor: 1 }, ...rest]
    })
  }, [form.base_unit_id])

  const recovery = useRecoverableDraft(`product:${id ?? tab.tabId}`, { form, units, custom: custom.values }, (draft) => { setForm(draft.form); setUnits(draft.units); custom.setValues(draft.custom); tab.setDirty(true) }, !id || Boolean(product))

  const [warehouseSettings, setWarehouseSettings] = useState<Record<number, { reorder_level: number; reorder_qty: number }>>({})
  useEffect(() => { if (product?.warehouse_settings) setWarehouseSettings(Object.fromEntries(product.warehouse_settings.map((row: any) => [row.warehouse_id, { reorder_level: Number(row.reorder_level), reorder_qty: Number(row.reorder_qty) }]))) }, [product?.warehouse_settings])
  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const body = {
        ...form, ...custom.payload(), warehouse_settings: Object.entries(warehouseSettings).map(([warehouse_id, values]) => ({ warehouse_id: Number(warehouse_id), ...values })), code: form.code || null, eta_code_type: form.eta_code_type || null, eta_item_code: form.eta_item_code || null,
        uses_spare_parts: Boolean(form.uses_spare_parts),
        spare_parts: form.uses_spare_parts ? (form.spare_parts ?? []).map((row: any) => ({ product_id: row.product_id, quantity_per_unit: row.quantity_per_unit })) : [],
        initial_stock: !id && form.type === 'stock' && toNumber(form.initial_stock?.quantity) > 0 ? { ...form.initial_stock, unit_cost: form.initial_stock.unit_cost ?? toNumber(form.purchase_price), batch_no: form.initial_stock.batch_no || null, expiry_date: form.initial_stock.expiry_date || null } : undefined,
        units: units.filter((u) => u.unit_id).map((u) => ({ ...u, barcode: u.barcode || null, prices: u.prices })),
      }
      const r = id ? await api.put(`/products/${id}`, body) : await api.post('/products', body)
      custom.acceptSaved(r.data)
      invalidate('/products', '/stock', '/stock-documents', '/reports')
      setErrors({})
      tab.setDirty(false)
      await recovery.clear()
      toast.success(t('تم حفظ الصنف', 'Item saved'))
      if (!id) tab.replace(`/inventory/products/${r.data.id}`)
      else void refetch()
    } catch (e: any) {
      custom.capture(e)
      if (e instanceof ApiError) setErrors(e.errors ?? {})
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Ctrl+S saves, only in the visible tab.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!activeTab || !manage) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab, manage])

  if (id && isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={() => { void refetch() }} />

  const err = (key: string) => errors[key]?.[0]
  const unitName = (uid: number | null) => nameOf(lookups?.units?.find((u: any) => u.id === uid))
  const baseName = unitName(form.base_unit_id)
  const stock = form.type === 'stock'
  const baseIndex = Math.max(0, units.findIndex((u) => u.unit_id === form.base_unit_id))
  const base = units[baseIndex]
  const extra = units.map((u, i) => ({ u, i })).filter(({ i }) => i !== baseIndex)
  const updUnit = (i: number, p: Partial<UnitRow>) => {
    setUnits((rows) => rows.map((x, j) => (j === i ? { ...x, ...p } : x)))
    tab.setDirty(true)
  }
  const addUnit = () => {
    const free = lookups?.units?.find((x: any) => !units.some((u) => u.unit_id === x.id))?.id ?? null
    setUnits([...units, { unit_id: free, factor: 12, barcode: '', sale_price: null, purchase_price: null, is_default_sale: false, is_default_purchase: false, prices: {} }])
    tab.setDirty(true)
  }
  // A removed default hands its role back to the base unit.
  const removeUnit = (i: number) => {
    const rest = units.filter((_, j) => j !== i)
    const b = rest.findIndex((u) => u.unit_id === form.base_unit_id)
    setUnits(rest.map((u, j) => ({ ...u, is_default_sale: units[i].is_default_sale ? j === b : u.is_default_sale, is_default_purchase: units[i].is_default_purchase ? j === b : u.is_default_purchase })))
    tab.setDirty(true)
  }
  const defaultUnit = (key: 'is_default_sale' | 'is_default_purchase') => (
    <Select value={String(Math.max(0, units.findIndex((u) => u[key])))} onChange={(e) => { setUnits(units.map((u, j) => ({ ...u, [key]: j === Number(e.target.value) }))); tab.setDirty(true) }} options={units.map((u, j) => ({ value: String(j), label: unitName(u.unit_id) || '—' }))} />
  )
  const salePriceOf = (u: UnitRow) => (u === base ? toNumber(form.sale_price) : u.sale_price ?? toNumber(form.sale_price) * u.factor)

  // Users without cost access get the item without cost fields.
  const showPurchase = !product || product.purchase_price !== undefined
  const sale = toNumber(form.sale_price)
  const purchase = toNumber(form.purchase_price)
  const profitHint = showPurchase && sale > 0 && purchase > 0 ? (
    sale >= purchase
      ? <span>{form.uses_spare_parts ? t('قبل تكلفة قطع الغيار', 'Before spare-part cost') : t('الربح', 'Profit')} <span className="num">{money(sale - purchase)}</span> {t('لكل', 'per')} {baseName} (<span className="num">{(((sale - purchase) / sale) * 100).toFixed(1)}%</span>)</span>
      : <span className="neg">{t('أقل من سعر الشراء بـ', 'Below the purchase price by')} <span className="num">{money(purchase - sale)}</span></span>
  ) : undefined

  const tracking: Tracking = form.track_serials ? 'serials' : form.track_batches ? 'batches' : 'none'
  const balances: any[] = product?.balances ?? []
  const warehouses: any[] = [...(lookups?.warehouses ?? [])]
  balances.forEach((b) => { if (b.warehouse && !warehouses.some((w) => w.id === b.warehouse_id)) warehouses.push(b.warehouse) })
  const setReorder = (warehouseId: number, p: Partial<{ reorder_level: number; reorder_qty: number }>) => {
    setWarehouseSettings((old) => ({ ...old, [warehouseId]: { ...(old[warehouseId] ?? { reorder_level: 0, reorder_qty: 0 }), ...p } }))
    tab.setDirty(true)
  }
  const showCost = product?.avg_cost !== undefined
  const avgCost = toNumber(product?.avg_cost)
  const lowStock = product && toNumber(form.reorder_level) > 0 && toNumber(product.on_hand) <= toNumber(form.reorder_level)

  const remove = async () => {
    if (!(await confirmDialog({ title: t('حذف الصنف؟', 'Delete this item?'), message: t('إذا كان للصنف حركات سيتم إيقافه بدلاً من حذفه.', 'If the item has movements it is deactivated instead of deleted.'), danger: true, confirmLabel: t('حذف', 'Delete') }))) return
    try {
      await api.del(`/products/${product.id}`)
      invalidate('/products')
      tab.close()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="form-page pb-12">
      <header className="form-page-head">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="m-0 truncate text-[18px] font-semibold">{id ? nameOf(product) : form.name || t('صنف جديد', 'New item')}</h1>
          {product?.code && <span className="num muted text-[13px]">{product.code}</span>}
          {!stock && <Pill tone="brand">{t('خدمة', 'Service')}</Pill>}
          {!form.is_active && <Pill tone="red">{t('موقوف', 'Inactive')}</Pill>}
        </div>
        <div className="flex items-center gap-2">
          {dirty && manage && <span className="inline-flex items-center gap-1.5 text-[12px] warn"><span className="dot" style={{ background: 'var(--amber)' }} />{t('تعديلات غير محفوظة', 'Unsaved changes')}</span>}
          {product && can('stock.view') && <Button icon={BookOpenText} onClick={() => navigate(`/inventory/card/${product.id}`)}>{t('كارت الصنف', 'Item card')}</Button>}
          {manage && <Button variant="primary" icon={Save} loading={busy} onClick={save} title="Ctrl+S">{t('حفظ', 'Save')}</Button>}
        </div>
      </header>

      <fieldset disabled={!manage} className="m-0 min-w-0 border-0 p-0">
        <div className="mx-auto grid max-w-[1180px] gap-8 px-5 pt-5">
          {recovery.banner}

          {product && stock && (
            <div className="sheet figure-band">
              <div>
                <div className="figure-label">{t('الرصيد الحالي', 'On hand')}</div>
                <div className={lowStock ? 'figure neg' : 'figure'}>{qty(product.on_hand)} <span className="text-[13px] font-medium muted">{baseName}</span></div>
                {lowStock && <div className="neg text-[12px]">{t('وصل إلى حد الطلب', 'At or below reorder level')}</div>}
              </div>
              {showCost && <div><div className="figure-label">{t('متوسط التكلفة', 'Average cost')}</div><Money className="figure" value={avgCost} /></div>}
              {showCost && <div><div className="figure-label">{t('قيمة المخزون', 'Stock value')}</div><Money className="figure" value={avgCost * toNumber(product.on_hand)} /></div>}
              {showCost && !form.uses_spare_parts && toNumber(product.sale_price) > 0 && avgCost > 0 && <div><div className="figure-label">{t('هامش الربح', 'Margin')}</div><span className="figure num">{(((toNumber(product.sale_price) - avgCost) / toNumber(product.sale_price)) * 100).toFixed(1)}%</span></div>}
            </div>
          )}

          {custom.renderRecord(form, set, DOMAIN_FORM_WIDGETS, !manage)}

          <FormSection title={t('الأسعار والوحدات', 'Prices and units')} description={t('الأسعار هنا لوحدة واحدة من الوحدة الأساسية. الضريبة تُضاف في الفاتورة.', 'Prices are for one base unit. Tax is added on the invoice.')}>
            <div className="grid grid-cols-3 gap-x-3 gap-y-4">
              <Field label={t('الوحدة الأساسية', 'Base unit')} hint={stock ? t('أصغر وحدة يُحسب بها المخزون', 'The smallest unit stock is counted in') : undefined} error={err('base_unit_id')}><LookupSelect kind="units" value={form.base_unit_id} allowEmpty={false} onChange={(v) => set({ base_unit_id: v })} /></Field>
              <Field label={t('سعر البيع', 'Sale price')} hint={profitHint} error={err('sale_price')}><NumberInput value={form.sale_price} onChange={(v) => set({ sale_price: v })} /></Field>
              {showPurchase && <Field label={t('سعر الشراء', 'Purchase price')} hint={t('يتحدث تلقائياً مع كل فاتورة شراء', 'Updated by each purchase invoice')} error={err('purchase_price')}><NumberInput value={form.purchase_price} onChange={(v) => set({ purchase_price: v })} /></Field>}
              <Field label={t('الضريبة', 'Tax')} error={err('tax_rate_id')}><Select value={form.tax_rate_id ?? ''} onChange={(e) => set({ tax_rate_id: e.target.value ? Number(e.target.value) : null })} placeholder={t('بدون', 'None')} options={(lookups?.tax_rates ?? []).filter((r: any) => r.type === 'vat').map((r: any) => ({ value: r.id, label: nameOf(r) }))} /></Field>
              <Field label={t('أقل سعر بيع', 'Minimum sale price')} hint={t('البيع بأقل منه يحتاج صلاحية', 'Selling below it needs a permission')} error={err('min_sale_price')}><NumberInput value={form.min_sale_price} onChange={(v) => set({ min_sale_price: v })} /></Field>
              <Field label={t('الباركود', 'Barcode')} error={err(`units.${baseIndex}.barcode`)}><Input value={base?.barcode ?? ''} onChange={(e) => updUnit(baseIndex, { barcode: e.target.value })} dir="ltr" /></Field>
            </div>

            {(stock || extra.length > 0) && <div className="form-sub">
              <h4>{t('وحدات أكبر', 'Larger units')}</h4>
              {manage && <Button size="sm" variant="ghost" icon={Plus} onClick={addUnit}>{t('إضافة وحدة', 'Add unit')}</Button>}
            </div>}
            {extra.length === 0 ? (
              stock && <p className="muted m-0 text-[12.5px]">{t(`تبيع أو تشتري بالكرتونة أو العلبة؟ أضف الوحدة وكم ${baseName} تحتوي.`, `Sell or buy by the carton or pack? Add the unit and how many of the base unit (${baseName}) it holds.`)}</p>
            ) : (
              <>
                <div className="form-table overflow-x-auto">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>{t('الوحدة', 'Unit')}</th>
                        <th style={{ width: 150 }}>{t('تحتوي على', 'Holds')}</th>
                        <th>{t('الباركود', 'Barcode')}</th>
                        <th className="amount" style={{ width: 130 }}>{t('سعر البيع', 'Sale price')}</th>
                        {showPurchase && <th className="amount" style={{ width: 130 }}>{t('سعر الشراء', 'Purchase price')}</th>}
                        <th style={{ width: 44 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {extra.map(({ u, i }) => (
                        <tr key={i}>
                          <td style={{ minWidth: 120 }}><LookupSelect small kind="units" value={u.unit_id} onChange={(v) => updUnit(i, { unit_id: v })} allowEmpty={!u.unit_id} placeholder={t('اختر الوحدة', 'Choose unit')} /></td>
                          <td><div className="flex items-center gap-1.5"><NumberInput small value={u.factor} onChange={(v) => updUnit(i, { factor: v })} aria-label={t('تحتوي على', 'Holds')} /><span className="muted text-[12px] whitespace-nowrap">{baseName}</span></div></td>
                          <td style={{ minWidth: 140 }}><Input small value={u.barcode} onChange={(e) => updUnit(i, { barcode: e.target.value })} dir="ltr" aria-label={t('الباركود', 'Barcode')} /></td>
                          <td><NumberInput small value={u.sale_price ?? ''} placeholder={money(toNumber(form.sale_price) * u.factor)} onChange={(v) => updUnit(i, { sale_price: v || null })} aria-label={t('سعر البيع', 'Sale price')} /></td>
                          {showPurchase && <td><NumberInput small value={u.purchase_price ?? ''} placeholder={money(toNumber(form.purchase_price) * u.factor)} onChange={(v) => updUnit(i, { purchase_price: v || null })} aria-label={t('سعر الشراء', 'Purchase price')} /></td>}
                          <td>{manage && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeUnit(i)} aria-label={t('حذف الوحدة', 'Remove unit')} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted mt-2 mb-0 text-[12px]">{t('اترك السعر فارغاً ليُحسب من سعر الوحدة الأساسية × العدد.', 'Leave a price empty to use the base unit price × the quantity.')}</p>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Field label={t('الوحدة الافتراضية في البيع', 'Default unit when selling')}>{defaultUnit('is_default_sale')}</Field>
                  <Field label={t('الوحدة الافتراضية في الشراء', 'Default unit when buying')}>{defaultUnit('is_default_purchase')}</Field>
                </div>
              </>
            )}

            {priceLists.length > 0 && (
              <>
                <div className="form-sub">
                  <h4>{t('قوائم الأسعار', 'Price lists')}</h4>
                  <span className="muted text-[12px]">{t('اتركه فارغاً لاستخدام سعر البيع العادي', 'Leave empty to use the normal sale price')}</span>
                </div>
                <div className="form-table overflow-x-auto">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>{t('الوحدة', 'Unit')}</th>
                        {priceLists.map((pl: any) => <th key={pl.id} className="amount" style={{ width: 140 }}>{nameOf(pl)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {[base, ...extra.map(({ u }) => u)].filter((u) => u?.unit_id).map((u) => {
                        const i = units.indexOf(u)
                        return (
                          <tr key={i}>
                            <td className="font-medium">{unitName(u.unit_id)}</td>
                            {priceLists.map((pl: any) => <td key={pl.id}><NumberInput small value={u.prices[pl.id] ?? ''} placeholder={money(salePriceOf(u))} onChange={(v) => updUnit(i, { prices: { ...u.prices, [pl.id]: v || null } })} aria-label={`${nameOf(pl)} · ${unitName(u.unit_id)}`} /></td>)}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </FormSection>

          {stock && <ProductSpareParts productId={product?.id} enabled={Boolean(form.uses_spare_parts)} rows={form.spare_parts ?? []}
            baseName={baseName} disabled={!manage} errors={errors} onChange={(enabled, rows) => set({ uses_spare_parts: enabled, spare_parts: rows })} />}

          {!id && stock && can('stock.adjust') && <FormSection title={t('الرصيد الافتتاحي — اختياري', 'Initial stock — optional')}
            description={t('أدخل الكمية بالوحدة الأساسية. يُحفظ الرصيد مع الصنف في حركة افتتاحية. اترك صفراً لإنشاء الصنف بدون مخزون.', 'Enter the quantity in base units. Stock is saved with the item as an opening movement. Leave zero to create the item without stock.')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t(`الكمية (${baseName})`, `Quantity (${baseName})`)} error={err('initial_stock.quantity')}>
                <NumberInput min={0} value={form.initial_stock?.quantity ?? 0} onChange={quantity => set({ initial_stock: { ...form.initial_stock, quantity } })} />
              </Field>
              <Field label={t('المخزن', 'Warehouse')} error={err('initial_stock.warehouse_id')}>
                <LookupSelect kind="warehouses" value={form.initial_stock?.warehouse_id} filter={w => !w.is_transit && w.is_active !== false}
                  onChange={warehouse_id => set({ initial_stock: { ...form.initial_stock, warehouse_id } })} />
              </Field>
              <Field label={t('التاريخ', 'Date')} error={err('initial_stock.date')}>
                <Input type="date" value={form.initial_stock?.date ?? today()} max={today()} onChange={e => set({ initial_stock: { ...form.initial_stock, date: e.target.value } })} />
              </Field>
              <Field label={t('تكلفة الوحدة الأساسية', 'Base-unit cost')} hint={t('اتركها فارغة لاستخدام سعر الشراء', 'Leave empty to use the purchase price')} error={err('initial_stock.unit_cost')}>
                <NumberInput min={0} value={form.initial_stock?.unit_cost ?? ''} placeholder={String(form.purchase_price)}
                  onChange={unit_cost => set({ initial_stock: { ...form.initial_stock, unit_cost } })} />
              </Field>
              {form.track_batches && <>
                <Field label={t('رقم التشغيلة', 'Batch number')} error={err('initial_stock.batch_no')}><Input value={form.initial_stock?.batch_no ?? ''} onChange={e => set({ initial_stock: { ...form.initial_stock, batch_no: e.target.value } })} /></Field>
                <Field label={t('تاريخ الصلاحية', 'Expiry date')} error={err('initial_stock.expiry_date')}><Input type="date" value={form.initial_stock?.expiry_date ?? ''} onChange={e => set({ initial_stock: { ...form.initial_stock, expiry_date: e.target.value } })} /></Field>
              </>}
              {form.track_serials && <Field className="sm:col-span-2" label={t('الأرقام المسلسلة مفصولة بفواصل', 'Serial numbers separated by commas')} error={err('initial_stock.serial_numbers')}>
                <Input dir="ltr" value={(form.initial_stock?.serial_numbers ?? []).join(', ')} onChange={e => set({ initial_stock: { ...form.initial_stock, serial_numbers: e.target.value.split(/[,،]/).map((v: string) => v.trim()).filter(Boolean) } })} />
              </Field>}
            </div>
          </FormSection>}
          {id && stock && can('stock.adjust') && <div className="flex flex-wrap items-center gap-3"><span className="muted text-[12px]">{t('لتعديل الكمية بعد الإنشاء استخدم مستند مخزون.', 'To change quantities after creation, use a stock document.')}</span><Button onClick={() => navigate('/inventory/docs/adjustment/new')}>{t('تعديل المخزون', 'Adjust stock')}</Button></div>}

          {stock && (
            <FormSection title={t('المخزون', 'Stock')} description={t('كيف يُتابَع الصنف في المخازن، ومتى ننبهك لإعادة الطلب.', 'How the item is tracked, and when to remind you to reorder.')}>
              <div className="grid grid-cols-2 gap-3">
                <Field group label={t('التتبع', 'Tracking')} hint={tracking === 'batches' ? t('تُسجَّل التشغيلة وتاريخ الصلاحية مع كل استلام', 'A batch and expiry date are recorded with each receipt') : tracking === 'serials' ? t('لكل قطعة رقم مسلسل خاص بها', 'Each piece has its own serial number') : t('كمية فقط، بدون تشغيلات أو أرقام مسلسلة', 'Quantity only, no batches or serial numbers')}>
                  <Segmented block value={tracking} onChange={(v) => set({ track_batches: v === 'batches', track_serials: v === 'serials' })} options={[{ value: 'none', label: t('بدون', 'None') }, { value: 'batches', label: t('تشغيلات وصلاحية', 'Batches & expiry') }, { value: 'serials', label: t('أرقام مسلسلة', 'Serial numbers') }]} />
                </Field>
              </div>
              <div className="form-sub">
                <h4>{product ? t('الأرصدة وحد الطلب', 'Balances and reorder levels') : t('حد الطلب', 'Reorder levels')}</h4>
              </div>
              <div className="form-table overflow-x-auto">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>{t('المخزن', 'Warehouse')}</th>
                      {product && <th className="amount" style={{ width: 120 }}>{t('الرصيد', 'On hand')}</th>}
                      <th className="amount" style={{ width: 150 }}>{t('حد الطلب', 'Reorder level')}</th>
                      <th className="amount" style={{ width: 150 }}>{t('كمية الطلب', 'Reorder quantity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="font-semibold">{t('كل المخازن', 'All warehouses')}</td>
                      {product && <td className={lowStock ? 'amount neg font-semibold' : 'amount font-semibold'}>{qty(product.on_hand)}</td>}
                      <td><NumberInput small value={form.reorder_level} onChange={(v) => set({ reorder_level: v })} aria-label={t('حد الطلب', 'Reorder level')} /></td>
                      <td><NumberInput small value={form.reorder_qty} onChange={(v) => set({ reorder_qty: v })} aria-label={t('كمية الطلب', 'Reorder quantity')} /></td>
                    </tr>
                    {warehouses.map((w) => {
                      const rows = balances.filter((b) => b.warehouse_id === w.id)
                      return (
                        <tr key={w.id}>
                          <td>
                            {nameOf(w)}
                            {rows.filter((b) => b.batch).map((b) => <div key={b.id} className="num muted text-[11.5px]">{b.batch.batch_no} · {date(b.batch.expiry_date)} · {qty(b.quantity)}</div>)}
                          </td>
                          {product && <td className="amount">{qty(rows.reduce((sum, b) => sum + toNumber(b.quantity), 0))}</td>}
                          <td><NumberInput small value={warehouseSettings[w.id]?.reorder_level ?? 0} onChange={(v) => setReorder(w.id, { reorder_level: v })} aria-label={`${t('حد الطلب', 'Reorder level')} · ${nameOf(w)}`} /></td>
                          <td><NumberInput small value={warehouseSettings[w.id]?.reorder_qty ?? 0} onChange={(v) => setReorder(w.id, { reorder_qty: v })} aria-label={`${t('كمية الطلب', 'Reorder quantity')} · ${nameOf(w)}`} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted mt-2 mb-0 text-[12px]">{t('ننبهك عندما يصل الرصيد إلى حد الطلب، وكمية الطلب هي الكمية المقترحة للشراء. اترك 0 لإيقاف التنبيه.', 'You are alerted when the balance reaches the reorder level; the reorder quantity is the suggested purchase. Leave 0 for no alert.')}</p>
            </FormSection>
          )}

          <FormSection title={t('تفاصيل أخرى', 'More details')} description={t('اختيارية: وصف الصنف، وكوده في منظومة الفاتورة الإلكترونية.', 'Optional: a description, and the item code for e-invoicing.')}>
            <div className="grid grid-cols-3 gap-x-3 gap-y-4">
              <Field label={t('الوصف', 'Description')} className="col-span-3" error={err('description')}><Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
              <Field label={t('نوع كود الفاتورة الإلكترونية', 'E-invoice code type')} error={err('eta_code_type')}><Select value={form.eta_code_type} onChange={(e) => set({ eta_code_type: e.target.value })} placeholder="—" options={[{ value: 'GS1', label: 'GS1' }, { value: 'EGS', label: 'EGS' }]} /></Field>
              <Field label={t('كود الصنف لدى المصلحة', 'Item code at the tax authority')} className="col-span-2" error={err('eta_item_code')}><Input value={form.eta_item_code} onChange={(e) => set({ eta_item_code: e.target.value })} dir="ltr" /></Field>
            </div>
            <div className="form-sub items-center">
              <Check checked={form.is_active} onChange={(v) => set({ is_active: v })} label={t('نشط — يظهر في القوائم والفواتير', 'Active — shown in lists and on invoices')} />
              {product && manage && <Button size="sm" variant="danger" icon={Trash2} onClick={remove}>{t('حذف الصنف', 'Delete item')}</Button>}
            </div>
          </FormSection>
        </div>
      </fieldset>
    </div>
  )
}
