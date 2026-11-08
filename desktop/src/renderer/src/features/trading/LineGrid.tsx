import type { SparePartRow } from '../inventory/ProductSpareParts'
import { useEffect, useRef, useState } from 'react'
import { ScanBarcode, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { money, qty, toNumber } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { ProductPicker } from '@/components/Pickers'
import { Input, NumberInput } from '@/components/ui'

export interface DocLine {
  key: string
  components?: (SparePartRow & { quantity: number | string; batch_no?: string; cost_amount?: number | string })[]
  source_components?: (SparePartRow & { quantity: number | string; batch_no?: string; cost_amount?: number | string })[]
  source_base_quantity?: number | string
  id?: number
  product_id: number | null
  product?: any
  product_unit_id: number | null
  description?: string | null
  quantity: number
  unit_price: number
  discount_percent: number
  discount_amount: number
  tax_rate_id: number | null
  batch_id?: number | null
  batch_no?: string | null
  expiry_date?: string | null
  serial_numbers?: string[]
  source_line_id?: number | null
  /** Hints from the price lookup. */
  on_hand?: number
  last_price?: number | null
  avg_cost?: number
  /** Return lines carry the original amounts; quantities are capped. */
  max_quantity?: number
}

export const newLine = (): DocLine => ({ key: Math.random().toString(36).slice(2), product_id: null, product_unit_id: null, quantity: 1, unit_price: 0, discount_percent: 0, discount_amount: 0, tax_rate_id: null })

/**
 * Keyboard-driven line entry: scan or search an item, Enter moves along the
 * row, Enter on the last cell starts a new line.
 */
export function LineGrid({ lines, setLines, readOnly, kind, partyId, priceListId, warehouseId, isReturn, computed, showCost }: {
  lines: DocLine[]
  setLines: (fn: (lines: DocLine[]) => DocLine[]) => void
  readOnly: boolean
  kind: 'sale' | 'purchase'
  partyId: number | null
  priceListId: number | null
  warehouseId: number | null
  isReturn: boolean
  computed: { total: number; net: number }[]
  showCost: boolean
}) {
  const t = useT()
  const taxRates = useSession((s) => s.lookups?.tax_rates ?? []).filter((r: any) => r.type === 'vat')
  const table = useRef<HTMLTableElement>(null)
  const [scan, setScan] = useState('')
  const [batches, setBatches] = useState<Record<number, any[]>>({})
  const trackBatches = lines.some((l) => l.product?.track_batches)

  const update = (key: string, patch: Partial<DocLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const loadPrice = async (line: DocLine, productId: number, unitId: number | null) => {
    try {
      const r = await api.get(`/products/${productId}/price`, { product_unit_id: unitId, price_list_id: priceListId, party_id: partyId, warehouse_id: warehouseId, kind })
      const unit = line.product?.units?.find((u: any) => u.id === unitId)
      const factor = toNumber(unit?.factor ?? 1)
      update(line.key, {
        unit_price: r.data.unit_price,
        on_hand: r.data.on_hand,
        avg_cost: r.data.estimated_sale_cost ?? r.data.avg_cost,
        last_price: r.data.last ? r.data.last.unit_price_per_base * factor : null,
      })
    } catch {
      // keep the typed price
    }
  }

  const pickProduct = (line: DocLine, product: any) => {
    if (!product) return
    const units = product.units ?? []
    const unit = units.find((u: any) => (kind === 'sale' ? u.is_default_sale : u.is_default_purchase)) ?? units.find((u: any) => u.unit_id === product.base_unit_id) ?? units[0]
    const next: DocLine = { ...line, product_id: product.id, product, product_unit_id: unit?.id ?? null, tax_rate_id: product.tax_rate_id ?? null, unit_price: toNumber(unit?.sale_price ?? product.sale_price) }
    setLines((ls) => {
      const updated = ls.map((l) => (l.key === line.key ? next : l))
      return updated[updated.length - 1].product_id ? [...updated, newLine()] : updated
    })
    void loadPrice(next, product.id, next.product_unit_id)
    if (product.track_batches && kind === 'sale') void loadBatches(product.id)
    setTimeout(() => focusCell(line.key, 'qty'), 30)
  }

  const loadBatches = async (productId: number) => {
    if (batches[productId]) return
    const r = await api.get(`/products/${productId}/batches`)
    setBatches((b) => ({ ...b, [productId]: r.data }))
  }

  useEffect(() => {
    if (kind !== 'sale') return
    lines.filter((l) => l.product?.track_batches && l.product_id).forEach((l) => void loadBatches(l.product_id!))
  }, [lines.length])

  const focusCell = (key: string, cell: string) => {
    const selector = cell === 'product' ? `[data-line="${key}"][data-cell="product-wrap"] input` : `[data-line="${key}"][data-cell="${cell}"]`
    table.current?.querySelector<HTMLElement>(selector)?.focus()
  }

  const order = ['product', 'unit', 'qty', 'price', 'disc', 'tax']
  const onEnter = (e: React.KeyboardEvent, line: DocLine, cell: string) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const i = order.indexOf(cell)
    if (i < order.length - 1) focusCell(line.key, order[i + 1])
    else {
      const index = lines.findIndex((l) => l.key === line.key)
      const nextLine = lines[index + 1]
      if (nextLine) focusCell(nextLine.key, 'product')
      else {
        const fresh = newLine()
        setLines((ls) => [...ls, fresh])
        setTimeout(() => focusCell(fresh.key, 'product'), 30)
      }
    }
  }

  /** Barcode scanners type the code and press Enter. */
  const onScan = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = scan.trim()
    if (!code) return
    setScan('')
    try {
      const r = await api.get(`/products/scan/${encodeURIComponent(code)}`)
      const product = r.data.product
      const unitId = r.data.product_unit_id
      const existing = lines.find((l) => l.product_id === product.id && l.product_unit_id === unitId && !l.source_line_id)
      if (existing) {
        update(existing.key, { quantity: toNumber(existing.quantity) + 1 })
        return
      }
      const line: DocLine = { ...newLine(), product_id: product.id, product, product_unit_id: unitId, tax_rate_id: product.tax_rate_id ?? null, unit_price: toNumber(product.sale_price) }
      setLines((ls) => {
        const withoutEmpty = ls.filter((l) => l.product_id)
        return [...withoutEmpty, line, newLine()]
      })
      void loadPrice(line, product.id, unitId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      {!readOnly && !isReturn && (
        <form onSubmit={onScan} className="flex items-center gap-2 px-3 pt-3">
          <div className="relative w-[320px]">
            <ScanBarcode size={15} className="absolute inset-y-0 start-2.5 my-auto muted" />
            <input className="input ps-8" placeholder={t('امسح الباركود هنا ثم Enter', 'Scan a barcode here, then Enter')} value={scan} onChange={(e) => setScan(e.target.value)} aria-label={t('باركود', 'Barcode')} />
          </div>
          <span className="muted text-[12px]">{t('Enter للانتقال بين الخانات، Enter في آخر خانة يضيف سطراً جديداً', 'Enter moves between cells; Enter on the last cell adds a line')}</span>
        </form>
      )}
      <div className="overflow-x-auto p-3">
        <table ref={table} className="ledger grid-lines">
          <thead>
            <tr>
              <th style={{ width: 32 }}>#</th>
              <th style={{ minWidth: 260 }}>{t('الصنف', 'Item')}</th>
              <th style={{ width: 110 }}>{t('الوحدة', 'Unit')}</th>
              {trackBatches && <th style={{ width: kind === 'purchase' ? 230 : 160 }}>{t('التشغيلة', 'Batch')}</th>}
              <th className="amount" style={{ width: 90 }}>{t('الكمية', 'Qty')}</th>
              <th className="amount" style={{ width: 110 }}>{t('السعر', 'Price')}</th>
              <th className="amount" style={{ width: 80 }}>{t('خصم %', 'Disc. %')}</th>
              <th style={{ width: 120 }}>{t('الضريبة', 'Tax')}</th>
              <th className="amount" style={{ width: 120 }}>{t('الإجمالي', 'Amount')}</th>
              {!readOnly && <th style={{ width: 36 }} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const units = line.product?.units ?? []
              const c = computed[index]
              const belowCost = showCost && kind === 'sale' && line.avg_cost && toNumber(line.unit_price) > 0 && units.length > 0 && toNumber(line.unit_price) / toNumber(units.find((u: any) => u.id === line.product_unit_id)?.factor ?? 1) < toNumber(line.avg_cost)
              const short = kind === 'sale' && !isReturn && line.product?.type === 'stock' && line.on_hand !== undefined && toNumber(line.quantity) * toNumber(units.find((u: any) => u.id === line.product_unit_id)?.factor ?? 1) > toNumber(line.on_hand)
              return (
                <tr key={line.key} className={!line.product_id ? 'new-line' : undefined}>
                  <td className="num muted">{line.product_id ? index + 1 : ''}</td>
                  <td>
                    {readOnly || isReturn || line.source_line_id ? (
                      <div className="px-2">
                        <div>{line.description || nameOf(line.product)}</div>
                        <div className="num muted text-[11px]">{line.product?.code}</div>
                      </div>
                    ) : (
                      <div data-line={line.key} data-cell="product-wrap">
                        <ProductPicker
                          value={line.product_id}
                          initialLabel={line.product ? nameOf(line.product) : undefined}
                          onChange={(_, p) => pickProduct(line, p)}
                          small
                          warehouseId={warehouseId}
                        />
                      </div>
                    )}
                    {line.product_id && !readOnly && (line.on_hand !== undefined || line.last_price) && (
                      <div className="flex gap-3 px-2 text-[11px] muted">
                        {line.product?.type === 'stock' && line.on_hand !== undefined && <span className={short ? 'neg' : ''}>{t('المتاح', 'On hand')}: <span className="num">{qty(line.on_hand)}</span></span>}
                        {line.last_price ? <span>{t('آخر سعر لهذا الطرف', 'Last price to this party')}: <span className="num">{money(line.last_price)}</span></span> : null}
                        {belowCost ? <span className="neg">{t('أقل من التكلفة', 'Below cost')}</span> : null}
                      </div>
                    )}
                  </td>
                  <td>
                    {readOnly || isReturn ? (
                      <span className="px-2">{nameOf(units.find((u: any) => u.id === line.product_unit_id)?.unit)}</span>
                    ) : (
                      <select
                        className="select input-sm"
                        data-line={line.key}
                        data-cell="unit"
                        value={line.product_unit_id ?? ''}
                        disabled={!line.product_id}
                        onKeyDown={(e) => onEnter(e, line, 'unit')}
                        onChange={(e) => {
                          const unitId = Number(e.target.value)
                          const unit = units.find((u: any) => u.id === unitId)
                          update(line.key, { product_unit_id: unitId, unit_price: toNumber(unit?.sale_price ?? toNumber(line.product?.sale_price) * toNumber(unit?.factor ?? 1)) })
                          if (line.product_id) void loadPrice({ ...line, product_unit_id: unitId }, line.product_id, unitId)
                        }}
                      >
                        {units.map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {nameOf(u.unit)}
                            {toNumber(u.factor) !== 1 ? ` (${qty(u.factor)})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {trackBatches && (
                    <td>
                      {!line.product?.track_batches ? null : readOnly || isReturn ? (
                        <span className="num px-2">{line.batch_no}</span>
                      ) : kind === 'purchase' ? (
                        <div className="flex gap-1">
                          <input className="input input-sm" placeholder={t('رقم التشغيلة', 'Batch no.')} value={line.batch_no ?? ''} onChange={(e) => update(line.key, { batch_no: e.target.value })} />
                          <input className="input input-sm" type="date" value={line.expiry_date ?? ''} onChange={(e) => update(line.key, { expiry_date: e.target.value })} aria-label={t('تاريخ الصلاحية', 'Expiry date')} />
                        </div>
                      ) : (
                        <select className="select input-sm" value={line.batch_id ?? ''} onChange={(e) => update(line.key, { batch_id: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">{t('تلقائي (الأقرب انتهاءً)', 'Auto (first to expire)')}</option>
                          {(batches[line.product_id!] ?? []).filter((b) => toNumber(b.on_hand) > 0).map((b) => (
                            <option key={b.id} value={b.id}>{b.batch_no} · {b.expiry_date ?? '—'} · {qty(b.on_hand)}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                  <td>
                    {readOnly ? (
                      <span className="num block px-2 text-end">{qty(line.quantity)}</span>
                    ) : (
                      <NumberInput small data-line={line.key} data-cell="qty" value={line.quantity} onChange={(v) => update(line.key, { quantity: line.max_quantity !== undefined ? Math.min(v, line.max_quantity) : v })} onKeyDown={(e) => onEnter(e, line, 'qty')} disabled={!line.product_id} className={short ? 'neg' : undefined} />
                    )}
                    {line.max_quantity !== undefined && !readOnly && <div className="num muted px-2 text-end text-[10px]">{t('حد أقصى', 'max')} {qty(line.max_quantity)}</div>}
                  </td>
                  <td>
                    {readOnly || isReturn ? (
                      <span className="num block px-2 text-end">{money(line.unit_price)}</span>
                    ) : (
                      <NumberInput small data-line={line.key} data-cell="price" value={line.unit_price} onChange={(v) => update(line.key, { unit_price: v })} onKeyDown={(e) => onEnter(e, line, 'price')} disabled={!line.product_id} className={belowCost ? 'neg' : undefined} />
                    )}
                  </td>
                  <td>
                    {readOnly || isReturn ? (
                      <span className="num block px-2 text-end">{toNumber(line.discount_percent) ? `${toNumber(line.discount_percent)}%` : ''}</span>
                    ) : (
                      <NumberInput small data-line={line.key} data-cell="disc" value={line.discount_percent} onChange={(v) => update(line.key, { discount_percent: Math.min(Math.max(v, 0), 100), discount_amount: 0 })} onKeyDown={(e) => onEnter(e, line, 'disc')} disabled={!line.product_id} />
                    )}
                  </td>
                  <td>
                    {readOnly || isReturn ? (
                      <span className="px-2">{nameOf(taxRates.find((r: any) => r.id === line.tax_rate_id)) || '—'}</span>
                    ) : (
                      <select className="select input-sm" data-line={line.key} data-cell="tax" value={line.tax_rate_id ?? ''} onKeyDown={(e) => onEnter(e, line, 'tax')} onChange={(e) => update(line.key, { tax_rate_id: e.target.value ? Number(e.target.value) : null })} disabled={!line.product_id}>
                        <option value="">{t('بدون', 'None')}</option>
                        {taxRates.map((r: any) => <option key={r.id} value={r.id}>{nameOf(r)}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="amount num font-medium">{line.product_id && c ? money(c.total) : ''}</td>
                  {!readOnly && (
                    <td>
                      {line.product_id && (
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((l) => l.key !== line.key)))} aria-label={t('حذف السطر', 'Remove line')} tabIndex={-1}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {lines.filter((line) => line.product?.track_serials).map((line) => <div key={`serial-${line.key}`} className="flex items-center gap-3 px-3 py-2">
        <label className="text-[12px]">{line.product?.name} · {t('الأرقام المسلسلة (مفصولة بفواصل)', 'Serial numbers (comma separated)')}</label>
        <Input disabled={readOnly} value={(line.serial_numbers ?? []).join(', ')} dir="ltr" onChange={(event) => setLines((rows) => rows.map((row) => row.key === line.key ? { ...row, serial_numbers: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } : row))} />
      </div>)}
    </div>
  )
}
