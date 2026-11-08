import { StockHeaderProvider, STOCK_FORM_WIDGETS } from './StockFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, CheckCheck, ClipboardList, PackageCheck, Plus, Printer, Save, Send, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { STOCK_DOCS } from '@/lib/docTypes'
import { date, money, qty, today, toNumber } from '@/lib/format'
import { nameOf, tr, useT } from '@/store/prefs'
import { can, useSession } from '@/store/session'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { Button, ErrorBox, Field, Input, Money, NumberInput, Select, Sheet, Spinner, Check } from '@/components/ui'
import { Modal, confirmDialog, reasonDialog } from '@/components/Dialogs'
import { ProductPicker } from '@/components/Pickers'
import { Stamp } from '@/components/Status'
import { printElement } from '@/features/print/printService'
import { StockDocPrint } from '@/features/print/templates'

type DocType = keyof typeof STOCK_DOCS
const PERMS: Record<DocType, string> = { adjustment: 'stock.adjust', opening: 'stock.adjust', transfer: 'stock.transfer', count: 'stock.count' }

interface Line {
  key: string
  id?: number
  serial_numbers?: string[]
  product_id: number | null
  product: any
  product_unit_id: number | null
  quantity: number
  direction: 'in' | 'out'
  unit_cost: number | null
  batch_id: number | null
  batch_no: string
  expiry_date: string
  system_quantity: number | null
  counted_quantity: number | null
  received_quantity?: number | null
  notes: string
}

let seq = 0
const blank = (direction: 'in' | 'out' = 'out'): Line => ({ key: `n${++seq}`, product_id: null, product: null, product_unit_id: null, quantity: 0, direction, unit_cost: null, batch_id: null, batch_no: '', expiry_date: '', system_quantity: null, counted_quantity: null, notes: '' })

/** Adjustments, opening stock, two-step transfers and stock counts. */
export default function StockDocEditor() {
  const t = useT()
  const tab = useTab()
  const type = tab.params.type as DocType
  const id = tab.params.id
  const meta = STOCK_DOCS[type]
  const lookups = useSession((s) => s.lookups)
  const user = useSession((s) => s.user)
  const warehouses = (lookups?.warehouses ?? []).filter((w: any) => !w.is_transit)
  const { data, isLoading, error, refetch } = useApi<any>(id ? `/stock-documents/${type}/${id}` : null)
  const doc = data?.data
  const custom = useDynamicFields(`stock_${type}`, doc)
  const editable = !doc || doc.status === 'draft' || (type === 'count' && doc.status === 'in_progress')
  const manage = can(PERMS[type])
  const showCost = can('inventory.view_cost')

  const [header, setHeader] = useState<any>({ date: today(), warehouse_id: user?.default_warehouse_id ?? warehouses[0]?.id ?? null, to_warehouse_id: null, reason: type === 'adjustment' ? 'damage' : '', notes: '' })
  const [lines, setLines] = useState<Line[]>([blank(type === 'opening' ? 'in' : 'out')])
  const [batches, setBatches] = useState<Record<number, any[]>>({})
  const [busy, setBusy] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [countFilter, setCountFilter] = useState<'all' | 'uncounted' | 'diff'>('all')
  useTabTitle(doc ? `${tr(meta.ar, meta.en)} ${doc.number}` : undefined)

  const loadBatches = async (productId: number) => {
    if (batches[productId]) return
    const r = await api.get(`/products/${productId}/batches`)
    setBatches((b) => ({ ...b, [productId]: r.data }))
  }

  useEffect(() => {
    if (!doc) return
    setHeader({ date: doc.date?.slice(0, 10), warehouse_id: doc.warehouse_id, to_warehouse_id: doc.to_warehouse_id, reason: doc.reason ?? '', notes: doc.notes ?? '' })
    setLines(doc.lines.map((l: any) => ({
      key: `l${l.id}`, id: l.id, serial_numbers: l.serial_numbers ?? [], product_id: l.product_id, product: { ...l.product, units: l.product_unit ? [l.product_unit] : [] }, product_unit_id: l.product_unit_id,
      quantity: Math.abs(toNumber(l.quantity)), direction: l.direction ?? 'in', unit_cost: l.unit_cost !== null ? toNumber(l.unit_cost) * toNumber(l.factor || 1) : null,
      batch_id: l.batch_id || null, batch_no: l.batch?.batch_no ?? l.batch_no ?? '', expiry_date: l.batch?.expiry_date ?? l.expiry_date ?? '',
      system_quantity: l.system_quantity !== null ? toNumber(l.system_quantity) : null, counted_quantity: l.counted_quantity !== null ? toNumber(l.counted_quantity) : null,
      received_quantity: l.received_quantity !== null ? toNumber(l.received_quantity) : null, notes: l.notes ?? '',
    })).concat(editable && type !== 'count' ? [blank(type === 'opening' ? 'in' : 'out')] : []))
    doc.lines.filter((l: any) => l.product?.track_batches).forEach((l: any) => void loadBatches(l.product_id))
  }, [doc])

  const setH = (p: any) => { setHeader((h: any) => ({ ...h, ...p })); tab.setDirty(true) }
  const update = (key: string, p: Partial<Line>) => {
    setLines((rows) => {
      const next = rows.map((l) => (l.key === key ? { ...l, ...p } : l))
      if (type !== 'count' && next[next.length - 1].product_id) next.push(blank(type === 'opening' ? 'in' : 'out'))
      return next
    })
    tab.setDirty(true)
  }
  const pickProduct = async (key: string, product: any) => {
    if (!product) return update(key, { product_id: null, product: null })
    // The picker returns a summary; fetch units for the unit selector.
    const full = product.units ? product : (await api.get(`/products/${product.id}`)).data
    const base = full.units?.find((u: any) => u.unit_id === full.base_unit_id)
    update(key, { product_id: full.id, product: full, product_unit_id: base?.id ?? null, unit_cost: type === 'opening' || type === 'adjustment' ? (full.purchase_price !== undefined ? toNumber(full.purchase_price) : null) : null })
    if (full.track_batches) void loadBatches(full.id)
  }

  const body = () => ({
    ...header, ...custom.payload(),
    to_warehouse_id: type === 'transfer' ? header.to_warehouse_id : null,
    reason: type === 'adjustment' ? header.reason : null,
    lines: lines.filter((l) => l.product_id).map((l) => ({
      id: l.id, serial_numbers: l.serial_numbers ?? [], product_id: l.product_id, product_unit_id: l.product_unit_id, quantity: l.quantity, direction: l.direction,
      unit_cost: l.unit_cost ?? undefined, batch_id: l.batch_id ?? undefined, batch_no: l.batch_no || undefined, expiry_date: l.expiry_date || undefined,
      system_quantity: l.system_quantity, counted_quantity: l.counted_quantity, notes: l.notes || undefined,
    })),
  })

  const save = async (): Promise<any> => {
    setBusy(true)
    try {
      const r = id ? await api.put(`/stock-documents/${type}/${id}`, body()) : await api.post(`/stock-documents/${type}`, body())
      custom.acceptSaved(r.data)
      tab.setDirty(false)
      invalidate('/stock-documents', '/stock', '/products')
      if (!id) tab.replace(`/inventory/docs/${type}/${r.data.id}`)
      else void refetch()
      return r.data
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const act = async (action: string, extra: any = {}, saveFirst = true) => {
    const saved = saveFirst && editable ? await save() : doc
    if (!saved) return
    setBusy(true)
    try {
      const result = await api.post(`/stock-documents/${type}/${saved.id}/${action}`, extra)
      custom.acceptSaved(result.data)
      invalidate('/stock-documents', '/stock', '/products', '/reports')
      toast.success(t('تم', 'Done'))
      if (id) void refetch()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const visible = useMemo(() => lines.filter((l) => {
    if (type !== 'count' || countFilter === 'all') return true
    if (countFilter === 'uncounted') return l.counted_quantity === null
    return l.counted_quantity !== null && Math.abs(toNumber(l.counted_quantity) - toNumber(l.system_quantity)) > 0.0001
  }), [lines, countFilter, type])

  if (id && isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const counted = lines.filter((l) => l.counted_quantity !== null).length
  const unitName = (l: Line) => nameOf(l.product?.units?.find((u: any) => u.id === l.product_unit_id)?.unit ?? l.product?.base_unit)
  const incoming = (l: Line) => type === 'opening' || (type === 'adjustment' && l.direction === 'in')

  return (
    <div className="pb-8">

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--rule)' }}>
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[18px] font-semibold">{tr(meta.ar, meta.en)} {doc && <span className="num muted">{doc.number}</span>}</h1>
          {doc && <Stamp status={doc.status} postedAt={doc.posted_at} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {doc && <Button icon={Printer} onClick={() => printElement(<StockDocPrint doc={doc} />, { paper: 'A4', title: doc.number })}>{t('طباعة', 'Print')}</Button>}
          {doc && type === 'count' && doc.status === 'in_progress' && <Button icon={ClipboardList} onClick={() => printElement(<StockDocPrint doc={doc} blankCount />, { paper: 'A4', title: doc.number })}>{t('ورقة الجرد', 'Count sheet')}</Button>}
          {manage && editable && <Button icon={Save} loading={busy} onClick={async () => { if (await save()) toast.success(t('تم الحفظ', 'Saved')) }} kbd="Ctrl+S">{t('حفظ', 'Save')}</Button>}
          {manage && type === 'count' && doc?.status === 'draft' && <Button icon={ClipboardList} loading={busy} onClick={() => act('start', { category_id: header.category_id ?? null })}>{t('بدء الجرد', 'Start count')}</Button>}
          {manage && editable && type === 'transfer' && <>
            <Button icon={Send} loading={busy} variant="primary" onClick={async () => { if (await confirmDialog({ title: t('إرسال التحويل؟', 'Send this transfer?'), message: t('ستخرج البضاعة من مخزن الإرسال وتبقى في الطريق حتى يؤكد المخزن المستلم.', 'Goods leave the source warehouse and stay in transit until the destination confirms receipt.') })) void act('post') }}>{t('إرسال', 'Send')}</Button>
            <Button icon={CheckCheck} loading={busy} onClick={async () => { if (await confirmDialog({ title: t('تحويل مباشر؟', 'Direct transfer?'), message: t('يتم الإرسال والاستلام في خطوة واحدة.', 'Sends and receives in one step.') })) void act('post', { direct: true }) }}>{t('تحويل مباشر', 'Direct')}</Button>
          </>}
          {manage && editable && type !== 'transfer' && (type !== 'count' || doc?.status === 'in_progress') && <Button variant="primary" icon={CheckCheck} loading={busy} kbd="F9" onClick={async () => {
            const msg = type === 'count' ? t(`تم عدّ ${counted} من ${lines.length} بند. البنود غير المعدودة لن تتغير.`, `${counted} of ${lines.length} lines counted. Uncounted lines stay unchanged.`) : t('سيتم تحديث المخزون والقيود.', 'Stock and the ledger will be updated.')
            if (await confirmDialog({ title: t('ترحيل المستند؟', 'Post this document?'), message: msg })) void act('post')
          }}>{t('ترحيل', 'Post')}</Button>}
          {manage && doc?.status === 'in_transit' && <Button variant="primary" icon={PackageCheck} onClick={() => setReceiving(true)}>{t('تأكيد الاستلام', 'Confirm receipt')}</Button>}
          {manage && doc && editable && <Button variant="ghost" icon={Ban} onClick={async () => { if (await confirmDialog({ title: t('إلغاء المستند؟', 'Cancel this document?'), danger: true })) void act('cancel', {}, false) }}>{t('إلغاء', 'Cancel')}</Button>}
          {manage && doc?.status === 'posted' && type !== 'transfer' && <Button variant="ghost" icon={Ban} onClick={async () => { const reason = await reasonDialog({ title: t('إلغاء مستند مرحل', 'Void a posted document'), message: t('سيتم عكس حركة المخزون والقيد.', 'Stock moves and the journal entry are reversed.') }); if (reason) void act('void', { reason }, false) }}>{t('إلغاء الترحيل', 'Void')}</Button>}
        </div>
      </div>

      <div className="grid gap-4 px-5 pt-4">
        <Sheet bodyClassName="p-4"><StockHeaderProvider value={{ warehouseLocked: type === 'count' && doc?.status === 'in_progress', showCategory: editable && doc?.status !== 'in_progress' }}>
          {custom.renderRecord(header, setH, STOCK_FORM_WIDGETS, !editable || !manage)}
        </StockHeaderProvider></Sheet>

        {type === 'count' && doc?.status === 'in_progress' && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="muted text-[13px]">{t('تم عدّ', 'Counted')} <b className="num">{counted}</b> / <span className="num">{lines.length}</span></div>
            <div className="w-48"><Select small value={countFilter} onChange={(e) => setCountFilter(e.target.value as any)} options={[{ value: 'all', label: t('كل البنود', 'All lines') }, { value: 'uncounted', label: t('غير المعدود', 'Not counted') }, { value: 'diff', label: t('الفروقات فقط', 'Differences only') }]} /></div>
            <Button size="sm" variant="ghost" onClick={() => { setLines(lines.map((l) => (l.counted_quantity === null ? { ...l, counted_quantity: l.system_quantity ?? 0 } : l))); tab.setDirty(true) }}>{t('اعتبر غير المعدود مطابقاً', 'Mark uncounted as matching')}</Button>
          </div>
        )}
        {type === 'count' && doc?.status === 'draft' && lines.filter((l) => l.product_id).length === 0 && (
          <div className="sheet p-4 muted">{t('احفظ ثم اضغط "بدء الجرد" لتحميل الأصناف وأرصدتها الحالية في المخزن، ثم أدخل الكميات المعدودة.', 'Save, then press "Start count" to load the items with their current balances, and enter what you count.')}</div>
        )}

        <Sheet>
          <div className="overflow-x-auto">
            <table className="ledger grid-lines">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>{t('الصنف', 'Item')}</th>
                  <th style={{ width: 110 }}>{t('الوحدة', 'Unit')}</th>
                  {lines.some((l) => l.product?.track_batches) && <th style={{ width: 210 }}>{t('التشغيلة', 'Batch')}</th>}
                  {type === 'adjustment' && <th style={{ width: 110 }}>{t('الاتجاه', 'Direction')}</th>}
                  {type === 'count' ? <>
                    <th className="amount" style={{ width: 110 }}>{t('رصيد النظام', 'System qty')}</th>
                    <th className="amount" style={{ width: 120 }}>{t('المعدود', 'Counted')}</th>
                    <th className="amount" style={{ width: 100 }}>{t('الفرق', 'Difference')}</th>
                  </> : <th className="amount" style={{ width: 110 }}>{t('الكمية', 'Qty')}</th>}
                  {type === 'transfer' && doc && doc.status !== 'draft' && <th className="amount" style={{ width: 100 }}>{t('المستلم', 'Received')}</th>}
                  {showCost && type !== 'transfer' && type !== 'count' && <th className="amount" style={{ width: 120 }}>{t('تكلفة الوحدة', 'Unit cost')}</th>}
                  {showCost && type !== 'transfer' && type !== 'count' && <th className="amount" style={{ width: 120 }}>{t('القيمة', 'Value')}</th>}
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {visible.map((l, i) => {
                  const diff = l.counted_quantity !== null ? toNumber(l.counted_quantity) - toNumber(l.system_quantity) : null
                  const tracked = l.product?.track_batches
                  return (
                    <tr key={l.key}>
                      <td className="num muted">{i + 1}</td>
                      <td style={{ minWidth: 240 }}>{editable && type !== 'count' ? <ProductPicker small type="stock" value={l.product_id} initialLabel={l.product ? `${l.product.code} — ${nameOf(l.product)}` : undefined} warehouseId={header.warehouse_id} onChange={(_, p) => void pickProduct(l.key, p)} /> : <span className="px-2"><span className="num muted">{l.product?.code}</span> {nameOf(l.product)}</span>}</td>
                      <td>{editable && type !== 'count' && l.product?.units?.length > 1 ? <select className="select input-sm" value={l.product_unit_id ?? ''} onChange={(e) => update(l.key, { product_unit_id: Number(e.target.value) })}>{l.product.units.map((u: any) => <option key={u.id} value={u.id}>{nameOf(u.unit)}</option>)}</select> : <span className="px-2 muted">{unitName(l)}</span>}</td>
                      {lines.some((x) => x.product?.track_batches) && <td>{!tracked ? null : editable && type !== 'count' ? (incoming(l) ? (
                        <div className="flex gap-1"><input className="input input-sm" placeholder={t('رقم التشغيلة', 'Batch no.')} value={l.batch_no} onChange={(e) => update(l.key, { batch_no: e.target.value })} /><input className="input input-sm" type="date" value={l.expiry_date} onChange={(e) => update(l.key, { expiry_date: e.target.value })} /></div>
                      ) : (
                        <select className="select input-sm" value={l.batch_id ?? ''} onChange={(e) => update(l.key, { batch_id: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">{t('تلقائي (الأقرب انتهاءً)', 'Auto (earliest expiry)')}</option>
                          {(batches[l.product_id!] ?? []).filter((b) => toNumber(b.on_hand) > 0).map((b) => <option key={b.id} value={b.id}>{b.batch_no} · {b.expiry_date ?? '—'} · {qty(b.on_hand)}</option>)}
                        </select>
                      )) : <span className="num px-2">{l.batch_no}{l.expiry_date ? <span className="muted"> · {date(l.expiry_date)}</span> : null}</span>}</td>}
                      {type === 'adjustment' && <td>{editable ? <select className="select input-sm" value={l.direction} onChange={(e) => update(l.key, { direction: e.target.value as 'in' | 'out' })}><option value="out">{t('نقص (صرف)', 'Decrease')}</option><option value="in">{t('زيادة (إضافة)', 'Increase')}</option></select> : <span className={`px-2 ${l.direction === 'out' ? 'neg' : ''}`}>{l.direction === 'out' ? t('نقص', 'Decrease') : t('زيادة', 'Increase')}</span>}</td>}
                      {type === 'count' ? <>
                        <td className="amount"><span className="num muted">{l.system_quantity !== null ? qty(l.system_quantity) : '—'}</span></td>
                        <td>{editable && doc?.status === 'in_progress' ? <NumberInput small value={l.counted_quantity ?? ''} onChange={(v) => update(l.key, { counted_quantity: Number.isFinite(v) ? v : null })} onBlur={(e) => { if (e.currentTarget.value === '') update(l.key, { counted_quantity: null }) }} /> : <span className="num block px-2 text-end">{l.counted_quantity !== null ? qty(l.counted_quantity) : ''}</span>}</td>
                        <td className="amount">{diff === null ? '' : <span className={`num font-medium ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : 'muted'}`}>{diff > 0 ? '+' : ''}{qty(diff)}</span>}</td>
                      </> : <td>{editable ? <NumberInput small value={l.quantity || ''} onChange={(v) => update(l.key, { quantity: v })} /> : <span className="num block px-2 text-end">{qty(l.quantity)}</span>}</td>}
                      {type === 'transfer' && doc && doc.status !== 'draft' && <td className="amount"><span className={`num ${l.received_quantity !== null && l.received_quantity !== undefined && l.received_quantity < l.quantity ? 'neg' : ''}`}>{l.received_quantity !== null && l.received_quantity !== undefined ? qty(l.received_quantity) : '—'}</span></td>}
                      {showCost && type !== 'transfer' && type !== 'count' && <td>{editable && incoming(l) ? <NumberInput small value={l.unit_cost ?? ''} onChange={(v) => update(l.key, { unit_cost: v })} /> : <span className="num block px-2 text-end muted">{l.unit_cost !== null ? money(l.unit_cost) : t('متوسط', 'Avg.')}</span>}</td>}
                      {showCost && type !== 'transfer' && type !== 'count' && <td className="amount">{l.unit_cost !== null && l.quantity ? <Money value={l.unit_cost * l.quantity} /> : ''}</td>}
                      <td>{editable && type !== 'count' && l.product_id && <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={t('حذف', 'Remove')}><Trash2 size={13} /></button>}</td>
                    </tr>
                  )
                })}
              </tbody>
              {showCost && doc && toNumber(doc.total_cost) !== 0 && (
                <tfoot><tr><td colSpan={20} className="amount"><span className="muted">{t('قيمة المستند', 'Document value')}:</span> <Money value={doc.total_cost} colored={type === 'count'} /></td></tr></tfoot>
              )}
            </table>
          </div>
          {editable && type !== 'count' && <div className="p-2"><Button size="sm" variant="ghost" icon={Plus} onClick={() => setLines([...lines, blank(type === 'opening' ? 'in' : 'out')])}>{t('سطر', 'Line')}</Button></div>}
        </Sheet>
      </div>
      <div className="grid gap-2 px-5">{lines.filter((line) => line.product?.track_serials).map((line) => <Field key={`serial-${line.key}`} label={`${line.product.name} · ${t('الأرقام المسلسلة', 'Serial numbers')}`}><Input disabled={!editable} value={(line.serial_numbers ?? []).join(', ')} onChange={(event) => update(line.key, { serial_numbers: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} dir="ltr" /></Field>)}</div>
      {receiving && doc && <ReceiveDialog doc={doc} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); invalidate('/stock-documents', '/stock', '/products'); void refetch() }} />}
    </div>
  )
}

function ReceiveDialog({ doc, onClose, onDone }: { doc: any; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [rows, setRows] = useState<Record<number, number>>(() => Object.fromEntries(doc.lines.map((l: any) => [l.id, toNumber(l.quantity)])))
  const [serials, setSerials] = useState<Record<number, string[]>>(() => Object.fromEntries(doc.lines.map((line: any) => [line.id, line.serial_numbers ?? []])))
  const [day, setDay] = useState(today())
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState(true)
  const short = doc.lines.some((l: any) => rows[l.id] < toNumber(l.quantity))
  return (
    <Modal title={`${t('استلام التحويل', 'Receive transfer')} ${doc.number}`} onClose={onClose} size="wide" footer={<>
      <Button onClick={onClose}>{t('رجوع', 'Back')}</Button>
      <Button variant="primary" icon={PackageCheck} loading={busy} onClick={async () => {
        setBusy(true)
        try {
          await api.post(`/stock-documents/transfer/${doc.id}/receive`, { date: day, lines: doc.lines.map((l: any) => ({ id: l.id, received_quantity: rows[l.id], serial_numbers: serials[l.id] })) })
          toast.success(t('تم تأكيد الاستلام', 'Receipt confirmed'))
          onDone()
        } catch (e: any) {
          toast.error(e.message)
        } finally {
          setBusy(false)
        }
      }}>{t('تأكيد الاستلام', 'Confirm receipt')}</Button>
    </>}>
      <div className="mb-3 flex items-end gap-4">
        <Field label={t('تاريخ الاستلام', 'Received on')}><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Check checked={all} onChange={(v) => { setAll(v); if (v) setRows(Object.fromEntries(doc.lines.map((l: any) => [l.id, toNumber(l.quantity)]))) }} label={t('تم استلام كل الكميات', 'Everything arrived')} />
      </div>
      <table className="ledger grid-lines">
        <thead><tr><th>{t('الصنف', 'Item')}</th><th className="amount">{t('المرسل', 'Sent')}</th><th className="amount" style={{ width: 140 }}>{t('المستلم فعلاً', 'Actually received')}</th></tr></thead>
        <tbody>{doc.lines.map((l: any) => (
          <tr key={l.id}>
            <td>{nameOf(l.product)} <span className="muted">{nameOf(l.product_unit?.unit)}</span></td>
            <td className="amount"><span className="num">{qty(l.quantity)}</span></td>
            <td><NumberInput small disabled={all} value={rows[l.id]} onChange={(v) => setRows({ ...rows, [l.id]: Math.min(v, toNumber(l.quantity)) })} /></td>
          </tr>
        ))}</tbody>
      </table>
      {doc.lines.filter((line: any) => line.serial_numbers?.length).map((line: any) => <Field key={line.id} label={`${nameOf(line.product)} · ${t('المسلسلات المستلمة', 'Received serials')}`}><Input value={(serials[line.id] ?? []).join(', ')} disabled={all} dir="ltr" onChange={(event) => setSerials((old) => ({ ...old, [line.id]: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) }))} /></Field>)}
      {short && <div className="mt-3 text-[13px]" style={{ color: 'var(--red)' }}>{t('سيتم تسجيل العجز كخسارة في حساب فروقات المخزون.', 'The shortage will be written off to the inventory adjustment account.')}</div>}
    </Modal>
  )
}
