import { useQueries } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qty, toNumber } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { ErrorBox, Money, Spinner } from '@/components/ui'
import type { DocLine } from './LineGrid'

interface ComponentRow {
  product_id: number
  name: string
  name_en?: string
  code: string
  quantity?: number | string
  quantity_per_unit: number | string
  unit_name?: string
  unit_name_en?: string
  batch_no?: string
  on_hand?: number
  cost_amount?: number | string
}

/** Inventory details stay outside customer-facing invoice lines and print templates. */
export function SparePartsPanel({ lines, warehouseId, status, isReturn }: {
  lines: DocLine[]; warehouseId: number | null; status: string; isReturn: boolean
}) {
  const t = useT()
  const actual = status === 'posted' || status === 'void'
  const ids = [...new Set(lines.filter(l => l.product_id).map(l => l.product_id!))]
  const queries = useQueries({ queries: ids.map(id => ({
    queryKey: [`/products/${id}/price`, { warehouse_id: warehouseId, kind: 'sale' }],
    queryFn: () => api.get(`/products/${id}/price`, { warehouse_id: warehouseId, kind: 'sale' }),
    enabled: !actual && !isReturn,
  })) })
  const rows = lines.flatMap(line => {
    const components: ComponentRow[] = actual ? line.components ?? [] : isReturn ? line.source_components ?? []
      : queries[ids.indexOf(line.product_id!)]?.data?.data?.spare_parts ?? []
    const unit = line.product?.units?.find((u: any) => u.id === line.product_unit_id)
    const baseQuantity = toNumber(line.quantity) * toNumber(unit?.factor ?? 1)
    return components.map((part, index) => ({ ...part, key: `${line.key}:${index}`, parent: nameOf(line.product),
      required: actual ? toNumber(part.quantity) : isReturn
        ? Number((toNumber(part.quantity) * baseQuantity / Math.max(toNumber(line.source_base_quantity), 0.0001)).toFixed(4))
        : Number((toNumber(part.quantity_per_unit) * baseQuantity).toFixed(4)),
    }))
  })
  const totals = new Map<number, number>()
  rows.forEach(row => totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + row.required))
  const loading = !actual && !isReturn && queries.some(q => q.isPending)
  const failure = !actual && !isReturn ? queries.find(q => q.error) : undefined
  if (!rows.length && !loading && !failure) return null
  const showCost = actual && rows.some(row => row.cost_amount !== undefined)
  return <section className="mx-5 mb-5 rounded-lg border border-[var(--rule)] p-3" aria-label={t('قطع الغيار التلقائية', 'Automatic spare parts')}>
    <h3 className="m-0 mb-2 text-[14px] font-semibold">{actual
      ? isReturn ? t('قطع الغيار المستردة', 'Restored spare parts') : t('قطع الغيار المستهلكة', 'Consumed spare parts')
      : isReturn ? t('قطع الغيار المتوقع استردادها', 'Expected spare-part restoration') : t('قطع الغيار المطلوبة عند ترحيل الفاتورة', 'Spare parts required when invoiced')}</h3>
    {loading && <Spinner />}
    {failure && <ErrorBox error={failure.error} onRetry={() => { void Promise.all(queries.map(q => q.refetch())) }} />}
    {rows.length > 0 && <div className="overflow-x-auto"><table className="ledger w-full">
      <thead><tr><th>{t('المنتج', 'Product')}</th><th>{t('قطعة الغيار', 'Spare part')}</th><th className="amount">{t('الكمية', 'Quantity')}</th>
        {!actual && !isReturn && <th className="amount">{t('رصيد المخزن', 'Warehouse stock')}</th>}
        {showCost && <th className="amount">{t('التكلفة', 'Cost')}</th>}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}>
        <td>{row.parent}</td><td><span className="num muted">{row.code}</span> {nameOf(row)}{row.batch_no && <span className="num muted"> · {row.batch_no}</span>}</td>
        <td className="amount"><span className="num">{qty(row.required)}</span> {nameOf({ name: row.unit_name, name_en: row.unit_name_en })}</td>
        {!actual && !isReturn && <td className={`amount ${warehouseId && (totals.get(row.product_id) ?? 0) > toNumber(row.on_hand) ? 'neg' : ''}`}>
          <span className="num">{qty(row.on_hand)}</span>{warehouseId && (totals.get(row.product_id) ?? 0) > toNumber(row.on_hand) && <span className="ms-2">{t('غير كافٍ', 'Insufficient')}</span>}
        </td>}
        {showCost && <td className="amount"><Money value={row.cost_amount} /></td>}
      </tr>)}</tbody>
    </table></div>}
    <p className="muted mb-0 mt-2 text-[12px]">{status === 'void'
      ? t('تم عكس هذه الحركات عند إلغاء المستند.', 'These movements were reversed when the document was voided.')
      : actual ? t('هذه الكميات مسجلة من الحركات الفعلية للمستند.', 'These quantities are recorded from the document’s actual stock movements.')
        : isReturn ? t('التقدير حسب الفاتورة الأصلية. تُسوّى فروق التقريب عند الترحيل.', 'Estimated from the original invoice. Rounding remainders are settled when posted.')
          : t('تُخصم قطع الغيار بالإضافة إلى المنتج عند ترحيل فاتورة البيع فقط. يُراجع الرصيد والوصفة مجدداً عند الترحيل.', 'Parts are deducted in addition to the product only when a sales invoice is posted. Stock and the recipe are checked again when posting.')}</p>
    {!actual && !isReturn && !warehouseId && <p className="warn mb-0 mt-1 text-[12px]">{t('اختر المخزن لعرض رصيده؛ الرصيد المعروض حالياً إجمالي.', 'Choose a warehouse to see its stock; the current balance is a total.')}</p>}
  </section>
}
