import { TradeHeaderProvider, TRADE_FORM_WIDGETS } from './TradeFormWidgets'
import { PostDialog } from './PostDialog'
import { SparePartsPanel } from './SparePartsPanel'
import { RegisterSoldFilters } from '@/features/service/RegisterSoldFilters'
import { useRecoverableDraft } from '@/features/forms/useRecoverableDraft'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, Ban, Check, CheckCheck, FileStack, HandCoins, Printer, ReceiptText, Save, Send, Stamp as StampIcon, Trash2, Undo2, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { calculate } from '@/lib/calc'
import { addDays, date, money, today, toNumber } from '@/lib/format'
import { DOC_TYPES, docLabel, METHODS, type TradeType } from '@/lib/docTypes'
import { invalidate, useApi } from '@/lib/query'
import { commands } from '@/lib/platform'
import { nameOf, useT } from '@/store/prefs'
import { can, currency, setting, useCan, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useActiveTab, useTab, useTabTitle } from '@/workspace/TabContext'
import { Button, Check as Checkbox, ErrorBox, Field, Kv, Money, NumberInput, Pill, Spinner, Textarea } from '@/components/ui'
import { confirmDialog, reasonDialog } from '@/components/Dialogs'
import { StatusPill, Stamp } from '@/components/Status'
import { printElement } from '@/features/print/printService'
import { Receipt, TradeDocA4 } from '@/features/print/templates'
import { LineGrid, newLine, type DocLine } from './LineGrid'

interface Header {
  party_id: number | null
  party?: any
  date: string
  due_date: string | null
  valid_until: string | null
  warehouse_id: number | null
  salesperson_id: number | null
  price_list_id: number | null
  reference: string
  price_includes_tax: boolean
  invoice_discount_percent: number
  invoice_discount_amount: number
  notes: string
  terms: string
  source_id: number | null
  opportunity_id: number | null
  wht_rate: number
}

export default function DocumentEditor() {
  const t = useT()
  const tab = useTab()
  const activeTab = useActiveTab()
  const allowed = useCan()
  const type = tab.params.type as TradeType
  const meta = DOC_TYPES[type]
  const id = tab.params.id
  const isNew = !id
  const isSales = meta?.side === 'sales'
  const isReturn = type === 'sales_return' || type === 'purchase_return'
  const user = useSession((s) => s.user)

  const { data, isLoading, error, refetch } = useApi<any>(id ? `/documents/${type}/${id}` : null)
  const doc = data?.data
  const custom = useDynamicFields(type, doc)

  const blankHeader = (): Header => ({
    party_id: null, date: today(), due_date: null, valid_until: type === 'sales_quotation' ? addDays(today(), 15) : null,
    warehouse_id: user?.default_warehouse_id ?? null, salesperson_id: isSales && user?.is_salesperson ? user.id : null, price_list_id: null,
    reference: '', price_includes_tax: isSales ? Boolean(setting('sales.price_includes_tax', false)) : false,
    invoice_discount_percent: 0, invoice_discount_amount: 0, notes: '', terms: '', source_id: null, opportunity_id: null, wht_rate: 0,
  })
  const [header, setHeader] = useState<Header>(blankHeader)
  const [lines, setLinesState] = useState<DocLine[]>([newLine()])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [postOpen, setPostOpen] = useState(false)
  const [partyInfo, setPartyInfo] = useState<any>(null)
  const [justPosted, setJustPosted] = useState(false)

  const setLines = (fn: (l: DocLine[]) => DocLine[]) => {
    setLinesState(fn)
    setDirty(true)
  }
  const set = (patch: Partial<Header>) => {
    setHeader((h) => ({ ...h, ...patch }))
    setDirty(true)
  }

  // Load an existing document into the form.
  useEffect(() => {
    if (!doc) return
    setHeader({
      party_id: doc.party_id, party: doc.party, date: doc.date, due_date: doc.due_date, valid_until: doc.valid_until, warehouse_id: doc.warehouse_id,
      salesperson_id: doc.salesperson_id, price_list_id: doc.price_list_id, reference: doc.reference ?? '', price_includes_tax: doc.price_includes_tax,
      invoice_discount_percent: toNumber(doc.invoice_discount_percent), invoice_discount_amount: toNumber(doc.invoice_discount_amount), notes: doc.notes ?? '',
      terms: doc.terms ?? '', source_id: doc.source_id, opportunity_id: doc.opportunity_id, wht_rate: toNumber(doc.wht_rate),
    })
    const loaded: DocLine[] = doc.lines.map((l: any) => {
      const src = doc.source?.id ? l.source_line_id : null
      return {
        key: `l${l.id}`, id: l.id, components: l.components, source_components: l.source_line?.components, source_base_quantity: l.source_line?.base_quantity, serial_numbers: l.serial_numbers ?? [], product_id: l.product_id, product: l.product, product_unit_id: l.product_unit_id, description: l.description,
        quantity: toNumber(l.quantity), unit_price: toNumber(l.unit_price), discount_percent: toNumber(l.discount_percent), discount_amount: toNumber(l.discount_amount),
        tax_rate_id: l.tax_rate_id, batch_id: l.batch_id || null, batch_no: l.batch_no ?? l.batch?.batch_no, expiry_date: l.expiry_date, source_line_id: src,
        _net: toNumber(l.net_amount), _tax: toNumber(l.tax_amount), _gross: toNumber(l.gross_amount),
      } as DocLine
    })
    const editable = doc.status === 'draft' || (type === 'sales_quotation' && doc.status === 'sent')
    setLinesState(editable && !isReturn ? [...loaded, newLine()] : loaded)
    setDirty(false)
  }, [doc])

  // New documents opened from elsewhere: ?party= from an account, ?reorder=1 from the reorder report.
  useEffect(() => {
    if (!isNew) return
    const party = tab.query.get('party')
    if (party) setHeader((h) => ({ ...h, party_id: Number(party) }))
    if (tab.query.get('reorder') && type === 'purchase_order') {
      void (async () => {
        const rows: any[] = (await api.get('/stock/reorder')).data
        const products = await Promise.all(rows.filter((r) => toNumber(r.suggested) > 0).slice(0, 100).map((r) => api.get(`/products/${r.id}`).then((p) => ({ product: p.data, qty: toNumber(r.suggested) }))))
        const filled: DocLine[] = products.map(({ product, qty: q }) => ({
          ...newLine(), product_id: product.id, product, product_unit_id: product.units?.find((u: any) => u.unit_id === product.base_unit_id)?.id ?? null,
          quantity: q, unit_price: toNumber(product.purchase_price), tax_rate_id: product.tax_rate_id ?? null,
        }))
        if (filled.length) {
          setLinesState([...filled, newLine()])
          setDirty(true)
        }
      })()
    }
  }, [])

  useEffect(() => tab.setDirty(dirty), [dirty])
  useTabTitle(doc ? `${docLabel(type)} ${doc.number.startsWith('D-') ? t('مسودة', 'draft') : doc.number}` : isNew ? `${docLabel(type)} ${t('جديد', 'new')}` : undefined)

  // Customer/supplier summary for the side panel (balance, credit, overdue).
  useEffect(() => {
    if (!header.party_id) return setPartyInfo(null)
    api.get(`/parties/${header.party_id}`).then((r) => setPartyInfo(r)).catch(() => setPartyInfo(null))
  }, [header.party_id])

  const editable = !doc || doc.status === 'draft' || (type === 'sales_quotation' && doc.status === 'sent')
  const readOnly = !editable || !allowed(meta.permission)
  const activeLines = lines.filter((l) => l.product_id)
  const taxRates = useSession((s) => s.lookups?.tax_rates ?? [])

  const calc = useMemo(() => {
    const rateOf = (id: number | null) => toNumber(taxRates.find((r: any) => r.id === id)?.rate)
    return calculate(
      { price_includes_tax: header.price_includes_tax, invoice_discount_percent: header.invoice_discount_percent, invoice_discount_amount: header.invoice_discount_amount, wht_rate: header.wht_rate, wht_threshold: toNumber(setting('tax.wht_threshold', 0)) },
      lines.map((l: any) => {
        // Returns copy their share of the original line exactly.
        if (isReturn && l.source_line_id && l._srcBase) {
          const ratio = (toNumber(l.quantity) * toNumber(l._factor || 1)) / l._srcBase
          return { quantity: 0, unit_price: 0, fixed: { gross: l._srcGross * ratio, net: l._srcNet * ratio, tax: l._srcTax * ratio } }
        }
        if (isReturn && l.source_line_id && l._net !== undefined && !dirty) return { quantity: 0, unit_price: 0, fixed: { gross: l._gross, net: l._net, tax: l._tax } }
        return { quantity: l.product_id ? l.quantity : 0, unit_price: l.unit_price, discount_percent: l.discount_percent, discount_amount: l.discount_amount, tax_rate: rateOf(l.tax_rate_id) }
      }),
    )
  }, [lines, header, taxRates, isReturn, dirty])
  const totals = doc && !dirty ? { gross: toNumber(doc.gross_total), discount: toNumber(doc.discount_total), net: toNumber(doc.net_total), tax: toNumber(doc.tax_total), total: toNumber(doc.total), wht: toNumber(doc.wht_amount), balanceDue: toNumber(doc.balance_due) } : calc.totals

  // Returns: remember the original line amounts so edits keep the proportions.
  useEffect(() => {
    if (!isReturn || !doc?.source?.id) return
    api.get(`/documents/${doc.source.type}/${doc.source.id}`).then((r) => {
      const src = new Map<number, any>(r.data.lines.map((l: any) => [l.id, l]))
      setLinesState((ls) => ls.map((l) => {
        const s = l.source_line_id ? src.get(l.source_line_id) : null
        if (!s) return l
        const remaining = toNumber(s.quantity) - toNumber(s.processed_quantity) + (doc.status === 'draft' ? 0 : 0)
        return { ...l, _srcBase: toNumber(s.base_quantity), _srcNet: toNumber(s.net_amount), _srcTax: toNumber(s.tax_amount), _srcGross: toNumber(s.gross_amount), _factor: toNumber(s.factor), max_quantity: doc.status === 'draft' ? remaining : undefined } as any
      }))
    })
  }, [doc?.id, doc?.source?.id])

  const recovery = useRecoverableDraft(`document:${type}:${id ?? tab.tabId}`, { header, lines, custom: custom.values }, (draft) => { setHeader(draft.header); setLinesState(draft.lines); custom.setValues(draft.custom); setDirty(true) }, !readOnly && (!id || Boolean(doc)))

  const payload = () => ({
    party_id: header.party_id,
    date: header.date,
    due_date: header.due_date || null,
    valid_until: header.valid_until || null,
    warehouse_id: header.warehouse_id,
    salesperson_id: header.salesperson_id,
    price_list_id: header.price_list_id,
    reference: header.reference || null,
    price_includes_tax: header.price_includes_tax,
    invoice_discount_percent: header.invoice_discount_percent,
    invoice_discount_amount: header.invoice_discount_percent ? 0 : header.invoice_discount_amount,
    notes: header.notes || null,
    terms: header.terms || null,
    source_id: header.source_id,
    opportunity_id: header.opportunity_id,
    lines: activeLines.map((l) => ({
      id: l.id, serial_numbers: l.serial_numbers ?? [],
      product_id: l.product_id, product_unit_id: l.product_unit_id, description: l.description || null, quantity: l.quantity, unit_price: l.unit_price,
      discount_percent: l.discount_percent, discount_amount: l.discount_amount, tax_rate_id: l.tax_rate_id, batch_id: l.batch_id || null,
      batch_no: l.batch_no || null, expiry_date: l.expiry_date || null, source_line_id: l.source_line_id || null,
    })),
  })

  const validate = (): boolean => {
    if (!header.party_id) {
      toast.error(isSales ? t('اختر العميل.', 'Choose the customer.') : t('اختر المورد.', 'Choose the supplier.'))
      return false
    }
    if (activeLines.length === 0) {
      toast.error(t('أضف صنفاً واحداً على الأقل.', 'Add at least one item.'))
      return false
    }
    return true
  }

  const afterSave = (saved: any, message: string) => {
    custom.acceptSaved(saved)
    setDirty(false)
    tab.setDirty(false)
    invalidate(`/documents/${type}`, '/reports', '/parties', '/products', '/stock', '/cash-accounts', '/crm')
    toast.success(message)
    if (isNew) tab.replace(`/docs/${type}/${saved.id}`)
    else void refetch()
  }

  const save = async (post = false, options: any = {}) => {
    if (!validate()) return
    setSaving(true)
    try {
      const body = { ...payload(), ...custom.payload(), ...(post ? { post: true, ...options } : {}) }
      const result = isNew ? await api.post(`/documents/${type}`, body) : await api.put(`/documents/${type}/${id}`, body)
      if (post) setJustPosted(true)
      await recovery.clear()
      afterSave(result.data, post ? t(`تم ترحيل ${docLabel(type)} ${result.data.number}`, `${docLabel(type)} ${result.data.number} posted`) : t('تم الحفظ', 'Saved'))
      setPostOpen(false)
      if (post && type === 'sales_invoice' && options.print) void printElement(<Receipt doc={result.data} cash={{ tendered: options.tendered }} />, { paper: 'receipt80', title: result.data.number })
      return result.data
    } catch (e) {
      custom.capture(e)
      await handlePostError(e, (override) => save(post, { ...options, ...override }))
    } finally {
      setSaving(false)
    }
  }

  /** Offer a manager override when the credit check stops a sale. */
  const handlePostError = async (e: unknown, retry: (extra: any) => Promise<any>) => {
    if (e instanceof ApiError && ['credit_limit_exceeded', 'overdue_invoices'].includes(e.code ?? '') && e.context?.can_override) {
      const ok = await confirmDialog({ title: t('تجاوز حد الائتمان', 'Override credit control'), message: e.message + ' ' + t('هل تريد الترحيل على مسؤوليتك؟', 'Post anyway on your authority?'), confirmLabel: t('ترحيل مع التجاوز', 'Post with override'), danger: true })
      if (ok) return retry({ override_credit: true })
      return
    }
    toast.error(e instanceof Error ? e.message : String(e), { duration: 7000 })
  }

  const action = async (fn: () => Promise<any>, message: string, after?: (r: any) => void) => {
    setSaving(true)
    try {
      const r = await fn()
      custom.acceptSaved(r.data)
      invalidate(`/documents`, '/reports', '/parties', '/products', '/stock', '/crm')
      toast.success(message)
      after ? after(r) : void refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 7000 })
    } finally {
      setSaving(false)
    }
  }

  const convert = (target: TradeType) =>
    action(() => api.post(`/documents/${type}/${id}/convert`, { target }), t(`تم إنشاء ${docLabel(target)}`, `${docLabel(target)} created`), (r) => navigate(`/docs/${target}/${r.data.id}`))

  const voidDoc = async () => {
    const reason = await reasonDialog({ title: t(`إلغاء ${docLabel(type)} ${doc.number}`, `Void ${docLabel(type)} ${doc.number}`), message: t('سيتم عكس حركة المخزون والقيد المحاسبي. يبقى المستند ظاهراً بحالة ملغي.', 'Stock and the journal entry are reversed. The document stays visible as void.'), confirmLabel: t('إلغاء المستند', 'Void document') })
    if (reason) await action(() => api.post(`/documents/${type}/${id}/void`, { reason }), t('تم الإلغاء', 'Voided'))
  }

  const print = (paper: 'A4' | 'receipt80') => {
    const d = doc && !dirty ? doc : { ...doc, type, number: doc?.number ?? t('مسودة', 'Draft'), ...header, party: partyInfo?.data ?? header.party, lines: activeLines.map((l, i) => ({ ...l, ...calc.lines[i], net_amount: calc.lines[i]?.net, line_total: calc.lines[i]?.total, total_discount: calc.lines[i]?.discount, tax_rate: taxRates.find((r: any) => r.id === l.tax_rate_id)?.rate ?? 0, product_unit: l.product?.units?.find((u: any) => u.id === l.product_unit_id) })), gross_total: totals.gross, discount_total: totals.discount, net_total: totals.net, tax_total: totals.tax, total: totals.total, wht_amount: totals.wht, balance_due: totals.balanceDue, currency: currency() }
    void printElement(paper === 'A4' ? <TradeDocA4 doc={d} /> : <Receipt doc={d} />, { paper, title: d.number })
  }

  // Keyboard: Ctrl+S save, F9 post, Ctrl+P print (only in the visible tab).
  const handlers = useRef({ save, print, post: () => setPostOpen(true) })
  handlers.current = { save, print, post: () => (meta.postable ? setPostOpen(true) : save()) }
  useEffect(() => {
    if (!activeTab) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!readOnly) void handlers.current.save()
      } else if (e.key === 'F9' && !readOnly && meta.postable) {
        e.preventDefault()
        if (validate()) handlers.current.post()
      }
    }
    window.addEventListener('keydown', onKey)
    const off = commands.on((c) => {
      if (c === 'print') handlers.current.print('A4')
      if (c === 'new-document') navigate(`/docs/${type}/new`)
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
    }
  }, [activeTab, readOnly])

  if (!meta) return <ErrorBox error={t('نوع مستند غير معروف', 'Unknown document type')} />
  if (id && isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />

  const status = doc?.status ?? 'draft'
  const isInvoice = type === 'sales_invoice' || type === 'purchase_invoice'
  const party = partyInfo?.data
  const summary = partyInfo?.summary

  return (
    <div className="document-workspace flex min-h-full flex-col">
      {/* Title bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--rule)' }}>
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[18px] font-semibold">{docLabel(type)}</h1>
          {doc && <span className="num text-[15px] muted">{doc.number.startsWith('D-') ? t('رقم يُحدد عند الترحيل', 'number assigned on posting') : doc.number}</span>}
          <StatusPill status={status} />
          {doc?.payment_status && <StatusPill status={doc.payment_status} />}
          {dirty && <Pill tone="amber">{t('غير محفوظ', 'Unsaved')}</Pill>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <Button icon={Save} onClick={() => save()} loading={saving && !postOpen} kbd="Ctrl S">{t('حفظ', 'Save')}</Button>
              {meta.postable && allowed(meta.postPermission) && <Button variant="primary" icon={StampIcon} onClick={() => validate() && setPostOpen(true)} kbd="F9">{t('ترحيل', 'Post')}</Button>}
            </>
          )}
          {doc && status === 'draft' && allowed(meta.permission) && (
            <Button variant="ghost" icon={Trash2} onClick={async () => {
              if (await confirmDialog({ title: t('حذف المسودة؟', 'Delete this draft?'), danger: true, confirmLabel: t('حذف', 'Delete') })) {
                await action(() => api.del(`/documents/${type}/${id}`), t('تم الحذف', 'Deleted'), () => tab.close())
              }
            }} aria-label={t('حذف', 'Delete')} />
          )}
          {/* Quotation and order workflow */}
          {doc && type === 'sales_quotation' && status === 'draft' && <Button icon={Send} onClick={() => action(() => api.post(`/documents/${type}/${id}/send`), t('تم تعليم العرض كمرسل', 'Marked as sent'))}>{t('تم الإرسال', 'Mark sent')}</Button>}
          {doc && type === 'sales_quotation' && ['draft', 'sent'].includes(status) && <Button icon={X} onClick={() => action(() => api.post(`/documents/${type}/${id}/reject`), t('تم رفض العرض', 'Quotation rejected'))}>{t('مرفوض', 'Rejected')}</Button>}
          {doc && ['sales_order', 'purchase_order'].includes(type) && status === 'draft' && <Button variant="primary" icon={Check} onClick={() => action(() => api.post(`/documents/${type}/${id}/confirm`), t('تم التأكيد', 'Confirmed'))}>{t('تأكيد', 'Confirm')}</Button>}
          {doc && ['sales_order', 'purchase_order'].includes(type) && ['draft', 'confirmed'].includes(status) && <Button icon={Ban} onClick={() => action(() => api.post(`/documents/${type}/${id}/cancel`), t('تم الإلغاء', 'Cancelled'))}>{t('إلغاء الأمر', 'Cancel order')}</Button>}
          {doc && ['sales_order', 'purchase_order'].includes(type) && ['partially_invoiced', 'partially_received'].includes(status) && <Button icon={CheckCheck} onClick={() => action(() => api.post(`/documents/${type}/${id}/close`), t('تم إغلاق الأمر', 'Order closed'))}>{t('إغلاق المتبقي', 'Close remaining')}</Button>}
          {doc && !dirty && meta.conversions.filter((c) => allowed(DOC_TYPES[c].permission)).filter(() => (type === 'sales_quotation' ? ['draft', 'sent', 'accepted'].includes(status) : ['sales_order', 'purchase_order'].includes(type) ? ['confirmed', 'partially_invoiced', 'partially_received'].includes(status) : status === 'posted')).map((target) => (
            <Button key={target} icon={target.endsWith('return') ? Undo2 : ArrowLeftRight} onClick={() => convert(target)}>{t('إنشاء ', 'Create ') + docLabel(target)}</Button>
          ))}
          {doc && isInvoice && status === 'posted' && toNumber(doc.outstanding) > 0 && can('vouchers.manage') && (
            <Button icon={HandCoins} onClick={() => navigate(`/finance/vouchers/${isSales ? 'receipt' : 'payment'}/new?party=${doc.party_id}&invoice=${doc.id}&amount=${doc.outstanding}`)}>{isSales ? t('تحصيل', 'Receive payment') : t('سداد', 'Pay')}</Button>
          )}
          {doc?.service_visit_id && can('service.view') && <Button onClick={() => navigate(`/service/visits?open=${doc.service_visit_id}`)}>{t('زيارة الخدمة', 'Service visit')}</Button>}
          {doc?.party_id && allowed(isSales ? 'customers.view' : 'suppliers.view') && <Button onClick={() => navigate(`/parties/view/${doc.party_id}`)}>{isSales ? t('ملف العميل', 'Customer profile') : t('ملف المورد', 'Supplier profile')}</Button>}
          <Button icon={Printer} onClick={() => print('A4')} kbd="Ctrl P">{t('طباعة', 'Print')}</Button>
          {type === 'sales_invoice' && <Button icon={ReceiptText} onClick={() => print('receipt80')} aria-label={t('إيصال حراري', 'Thermal receipt')} />}
          {doc && status === 'posted' && meta.postable && allowed(type.startsWith('sales') ? 'sales.invoices.void' : 'purchases.invoices.void') && <Button variant="danger" icon={Ban} onClick={voidDoc}>{t('إلغاء', 'Void')}</Button>}
        </div>
      </div>

      <div className="document-layout">
        <div className="min-w-0">
          <div className="px-5 py-3">{recovery.banner}</div>
          {doc && type === 'sales_invoice' && status === 'posted' && can('service.manage') && can('service.view_all') && <div className="px-5 pb-3"><RegisterSoldFilters invoice={doc} /></div>}
          {/* Header fields */}
          <div className="relative grid grid-cols-4 gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--rule)' }}>
            <div className="col-span-full"><TradeHeaderProvider value={{ role: meta.partyRole, label: nameOf(header.party ?? partyInfo?.data), locked: isReturn || Boolean(header.source_id), autoFocus: isNew,
              onChange: (id, p) => set({ party_id: id, party: p, price_list_id: p?.price_list_id ?? null, salesperson_id: (isSales ? p?.salesperson_id : null) ?? header.salesperson_id, wht_rate: p?.subject_to_wht && isInvoice ? toNumber(p.wht_rate) : 0, due_date: p && isInvoice ? addDays(header.date, Number(p.payment_terms_days) || 0) : header.due_date }) }}>
              {custom.renderRecord({ ...header }, next => set(next as Partial<Header>), TRADE_FORM_WIDGETS, readOnly)}
            </TradeHeaderProvider></div>
            {doc?.source && (
              <Field label={t('مرتبط بـ', 'Based on')}>
                <button className="btn justify-start" onClick={() => navigate(`/docs/${doc.source.type}/${doc.source.id}`)}><FileStack size={14} />{docLabel(doc.source.type)} <span className="num">{doc.source.number}</span></button>
              </Field>
            )}
            {status !== 'draft' && (
              <div className="pointer-events-none absolute end-8 top-3">
                <Stamp status={status} paymentStatus={doc?.payment_status} postedAt={doc?.posted_at ?? doc?.voided_at} animate={justPosted} />
              </div>
            )}
          </div>

          <LineGrid lines={lines} setLines={setLines} readOnly={readOnly} kind={isSales ? 'sale' : 'purchase'} partyId={header.party_id} priceListId={header.price_list_id} warehouseId={header.warehouse_id} isReturn={isReturn} computed={calc.lines} showCost={can('sales.view_cost')} />

          {isSales && <SparePartsPanel lines={lines} warehouseId={header.warehouse_id} status={status} isReturn={isReturn} />}

          <div className="grid grid-cols-1 gap-4 px-5 pb-6 md:grid-cols-2">
            <div className="grid content-start gap-3">
              <Field label={t('ملاحظات', 'Notes')}>
                <Textarea value={header.notes} disabled={readOnly} onChange={(e) => set({ notes: e.target.value })} rows={2} />
              </Field>
              {['sales_quotation', 'sales_order', 'purchase_order'].includes(type) && (
                <Field label={t('الشروط', 'Terms')}>
                  <Textarea value={header.terms} disabled={readOnly} onChange={(e) => set({ terms: e.target.value })} rows={3} placeholder={t('مدة التوريد، طريقة الدفع، صلاحية العرض…', 'Delivery time, payment terms, validity…')} />
                </Field>
              )}
              {doc?.void_reason && <div className="rounded-md p-2" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>{t('سبب الإلغاء: ', 'Void reason: ')}{doc.void_reason}</div>}
            </div>
            <div className="grid content-start gap-2">
              {!readOnly && !isReturn && (
                <div className="flex items-end justify-end gap-2">
                  <Field label={t('خصم على الفاتورة %', 'Invoice discount %')}>
                    <NumberInput value={header.invoice_discount_percent} onChange={(v) => set({ invoice_discount_percent: Math.min(Math.max(v, 0), 100), invoice_discount_amount: 0 })} className="w-28" />
                  </Field>
                  <Field label={t('أو مبلغ', 'or amount')}>
                    <NumberInput value={header.invoice_discount_amount} onChange={(v) => set({ invoice_discount_amount: Math.max(v, 0), invoice_discount_percent: 0 })} className="w-32" />
                  </Field>
                  <Checkbox checked={header.price_includes_tax} onChange={(v) => set({ price_includes_tax: v })} label={t('الأسعار شاملة الضريبة', 'Prices include VAT')} />
                </div>
              )}
              <div className="totals-sheet ms-auto w-full max-w-[340px]">
                <span className="muted">{t('الإجمالي قبل الخصم', 'Subtotal')}</span><Money value={totals.gross} />
                {totals.discount > 0 && <><span className="muted">{t('الخصم', 'Discount')}</span><Money value={-totals.discount} paren /></>}
                <span className="muted">{t('الصافي قبل الضريبة', 'Net before tax')}</span><Money value={totals.net} />
                <span className="muted">{t('ضريبة القيمة المضافة', 'VAT')}</span><Money value={totals.tax} />
                <span className="grand">{t('الإجمالي', 'Total')}</span><Money value={totals.total} className="grand" currency={currency()} />
                {totals.wht > 0 && <><span className="muted">{t('خصم وإضافة', 'Withholding tax')} {header.wht_rate}%</span><Money value={-totals.wht} paren /></>}
                {totals.wht > 0 && <><span className="font-semibold">{t('الصافي المستحق', 'Net payable')}</span><Money value={totals.balanceDue} className="font-semibold" /></>}
                {doc && isInvoice && status === 'posted' && <><span className="muted">{t('المسدد', 'Paid')}</span><Money value={doc.paid_amount} /><span className="font-semibold">{t('المتبقي', 'Outstanding')}</span><Money value={doc.outstanding} className="font-semibold" colored /></>}
                {doc && can('sales.view_cost') && type === 'sales_invoice' && status === 'posted' && toNumber(doc.cost_total) > 0 && (
                  <><span className="muted">{t('مجمل الربح', 'Gross profit')}</span><span className="num">{money(toNumber(doc.net_total) - toNumber(doc.cost_total))} <span className="muted text-[11px]">({((1 - toNumber(doc.cost_total) / Math.max(toNumber(doc.net_total), 0.01)) * 100).toFixed(1)}%)</span></span></>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Side panel: who, credit, related documents */}
        <aside className="min-w-0 px-4 py-4" style={{ borderInlineStart: '1px solid var(--rule)', background: 'var(--sheet-2)' }}>
          {party ? (
            <div className="grid gap-1">
              <button className="text-start text-[15px] font-semibold hover:underline" onClick={() => navigate(`/parties/view/${party.id}`)}>{nameOf(party)}</button>
              <div className="num muted text-[12px]">{party.code}{party.mobile || party.phone ? ` · ${party.mobile || party.phone}` : ''}</div>
              <div className="mt-2">
                <Kv label={t('الرصيد الحالي', 'Current balance')}><Money value={summary?.balance} paren colored /></Kv>
                {party.credit_limit !== null && <Kv label={t('حد الائتمان', 'Credit limit')}><Money value={party.credit_limit} /></Kv>}
                {summary?.credit_available !== null && summary?.credit_available !== undefined && <Kv label={t('المتاح', 'Available')}><Money value={summary.credit_available} colored /></Kv>}
                {summary?.overdue_count > 0 && <Kv label={<span className="neg">{t('فواتير متأخرة', 'Overdue invoices')}</span>}><span className="neg num">{summary.overdue_count} · {money(summary.overdue_amount)}</span></Kv>}
                {toNumber(summary?.cheques_in_portfolio) > 0 && <Kv label={t('شيكات تحت التحصيل', 'Cheques pending')}><Money value={summary.cheques_in_portfolio} /></Kv>}
                {party.subject_to_wht && <Kv label={t('خصم وإضافة', 'Withholding')}><span className="num">{toNumber(party.wht_rate)}%</span></Kv>}
                {party.payment_terms_days > 0 && <Kv label={t('مدة السداد', 'Payment terms')}><span className="num">{party.payment_terms_days}</span> {t('يوم', 'days')}</Kv>}
              </div>
            </div>
          ) : (
            <div className="muted">{isSales ? t('اختر العميل لعرض رصيده وحد الائتمان.', 'Choose a customer to see their balance and credit limit.') : t('اختر المورد لعرض رصيده.', 'Choose a supplier to see their balance.')}</div>
          )}

          {doc?.children?.length > 0 && (
            <div className="mt-5">
              <div className="mb-1 text-[12px] font-semibold muted">{t('مستندات مرتبطة', 'Related documents')}</div>
              {doc.children.map((c: any) => (
                <button key={c.id} className="option w-full rounded-md" onClick={() => navigate(`/docs/${c.type}/${c.id}`)}>
                  <span>{docLabel(c.type)} <span className="num">{c.number.startsWith('D-') ? t('مسودة', 'draft') : c.number}</span></span>
                  <StatusPill status={c.status} />
                </button>
              ))}
            </div>
          )}

          {doc?.allocations?.length > 0 && (
            <div className="mt-5">
              <div className="mb-1 text-[12px] font-semibold muted">{t('التسويات', 'Settlements')}</div>
              {doc.allocations.map((a: any) => (
                <button key={a.id} className="option w-full rounded-md" onClick={() => a.voucher ? navigate(`/finance/vouchers/any/${a.voucher_id}`) : a.return_id && navigate(`/docs/${type === 'sales_invoice' ? 'sales_return' : 'purchase_return'}/${a.return_id}`)}>
                  <span>{a.voucher ? `${t('سند', 'Voucher')} ${a.voucher.number} · ${t(...(METHODS[a.voucher.method] ?? ['', '']))}` : `${t('مرتجع', 'Return')} ${a.return_document?.number ?? ''}`}</span>
                  <span className="num">{money(a.amount)}</span>
                </button>
              ))}
            </div>
          )}

          {doc && (
            <div className="mt-5 text-[11px] muted">
              {doc.creator?.name && <div>{t('أنشأه', 'Created by')} {doc.creator.name}</div>}
              {doc.posted_at && <div className="num">{t('رُحّل', 'Posted')} {date(doc.posted_at)}</div>}
            </div>
          )}
        </aside>
      </div>

      {postOpen && <PostDialog type={type} total={totals.balanceDue} onClose={() => setPostOpen(false)} busy={saving} onPost={(options) => save(true, options)} />}
    </div>
  )
}

