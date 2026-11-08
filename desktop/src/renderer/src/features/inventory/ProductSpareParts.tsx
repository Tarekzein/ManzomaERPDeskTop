import { Plus, Trash2 } from 'lucide-react'
import { Button, Check, Field, FormSection, NumberInput } from '@/components/ui'
import { ProductPicker } from '@/components/Pickers'
import { nameOf, useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'

export interface SparePartRow {
  product_id: number | null
  quantity_per_unit: number | string
  code?: string
  name?: string
  name_en?: string
  unit_name?: string
  unit_name_en?: string
}

export function ProductSpareParts({ productId, enabled, rows, baseName, onChange, errors, disabled }: {
  productId?: number; enabled: boolean; rows: SparePartRow[]; baseName: string
  onChange: (enabled: boolean, rows: SparePartRow[]) => void
  errors: Record<string, string[]>; disabled: boolean
}) {
  const t = useT()
  const update = (index: number, patch: Partial<SparePartRow>) => onChange(enabled, rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  return <FormSection title={t('قطع الغيار المستخدمة عند البيع', 'Spare parts used when selling')}
    description={t('اختياري. تُخصم قطع الغيار بالإضافة إلى المنتج عند ترحيل فاتورة البيع، وتُسترد مع المرتجع. أدخل الكمية اللازمة لكل وحدة أساسية من المنتج.', 'Optional. Parts are deducted in addition to the product when a sales invoice is posted and restored on returns. Enter the quantity needed per base unit of the product.')}>
    <Check disabled={disabled} checked={enabled} onChange={value => onChange(value, value ? rows : [])}
      label={t('استهلاك قطع الغيار تلقائياً عند البيع', 'Automatically consume spare parts when sold')} />
    {errors.spare_parts?.[0] && <p role="alert" className="neg mt-2">{errors.spare_parts[0]}</p>}
    {enabled && <div className="mt-4 grid gap-3">
      {rows.length === 0 && <p className="muted m-0">{t('أضف قطعة غيار وحدد الكمية المطلوبة.', 'Add a spare part and its required quantity.')}</p>}
      {rows.map((row, i) => <div key={i} className="grid grid-cols-1 items-end gap-3 rounded-md border border-[var(--rule)] p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <Field label={t('قطعة الغيار', 'Spare part')} error={errors[`spare_parts.${i}.product_id`]?.[0]}>
          <ProductPicker value={row.product_id} initialLabel={row.name ? `${row.code ?? ''} · ${nameOf(row)}` : undefined}
            type="stock" recipePart excludeId={productId} disabled={disabled}
            onChange={(id, part) => update(i, { product_id: id, code: part?.code, name: part?.name, name_en: part?.name_en,
              unit_name: part?.base_unit?.name, unit_name_en: part?.base_unit?.name_en })} />
        </Field>
        <Field label={t(`الكمية لكل ${baseName}`, `Quantity per ${baseName}`)}
          hint={nameOf({ name: row.unit_name, name_en: row.unit_name_en })}
          error={errors[`spare_parts.${i}.quantity_per_unit`]?.[0]}>
          <NumberInput value={row.quantity_per_unit} disabled={disabled} min={0} onChange={quantity => update(i, { quantity_per_unit: quantity })} />
        </Field>
        {!disabled && <Button variant="ghost" icon={Trash2} onClick={() => onChange(enabled, rows.filter((_, index) => index !== i))}
          aria-label={t('حذف قطعة الغيار', 'Remove spare part')} />}
      </div>)}
      {!disabled && <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Plus} onClick={() => onChange(enabled, [...rows, { product_id: null, quantity_per_unit: 1 }])}>{t('إضافة قطعة غيار', 'Add spare part')}</Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('/inventory/products/new', { newTab: true })}>{t('إنشاء صنف لقطعة غيار', 'Create a spare-part item')}</Button>
      </div>}
      <p className="muted m-0 text-[12px]">{t('اختر أصنافاً مخزنية بدون تتبع مسلسل أو مكونات خاصة بها. مثال: ٥ مسامير لكل منتج تعني خصم ١٠ مسامير عند بيع منتجين.', 'Choose stock items without serial tracking or their own recipes. Example: 5 screws per product deducts 10 screws when selling 2 products.')}</p>
    </div>}
  </FormSection>
}
