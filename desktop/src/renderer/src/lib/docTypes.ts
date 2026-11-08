import { tr } from '@/store/prefs'

export type TradeType =
  | 'sales_quotation'
  | 'sales_order'
  | 'sales_invoice'
  | 'sales_return'
  | 'purchase_order'
  | 'purchase_receipt'
  | 'purchase_invoice'
  | 'purchase_return'

interface DocMeta {
  ar: string
  en: string
  pluralAr: string
  pluralEn: string
  side: 'sales' | 'purchases'
  permission: string
  postPermission: string
  /** Has an accounting/stock effect when posted. */
  postable: boolean
  partyRole: 'customer' | 'supplier'
  conversions: TradeType[]
}

export const DOC_TYPES: Record<TradeType, DocMeta> = {
  sales_quotation: { ar: 'عرض سعر', en: 'Quotation', pluralAr: 'عروض الأسعار', pluralEn: 'Quotations', side: 'sales', permission: 'sales.quotations', postPermission: 'sales.quotations', postable: false, partyRole: 'customer', conversions: ['sales_order', 'sales_invoice'] },
  sales_order: { ar: 'أمر بيع', en: 'Sales order', pluralAr: 'أوامر البيع', pluralEn: 'Sales orders', side: 'sales', permission: 'sales.orders', postPermission: 'sales.orders', postable: false, partyRole: 'customer', conversions: ['sales_invoice'] },
  sales_invoice: { ar: 'فاتورة مبيعات', en: 'Sales invoice', pluralAr: 'فواتير المبيعات', pluralEn: 'Sales invoices', side: 'sales', permission: 'sales.invoices', postPermission: 'sales.invoices.post', postable: true, partyRole: 'customer', conversions: ['sales_return'] },
  sales_return: { ar: 'مرتجع مبيعات', en: 'Sales return', pluralAr: 'مرتجعات المبيعات', pluralEn: 'Sales returns', side: 'sales', permission: 'sales.returns', postPermission: 'sales.returns', postable: true, partyRole: 'customer', conversions: [] },
  purchase_order: { ar: 'أمر شراء', en: 'Purchase order', pluralAr: 'أوامر الشراء', pluralEn: 'Purchase orders', side: 'purchases', permission: 'purchases.orders', postPermission: 'purchases.orders', postable: false, partyRole: 'supplier', conversions: ['purchase_receipt', 'purchase_invoice'] },
  purchase_receipt: { ar: 'إذن استلام', en: 'Goods receipt', pluralAr: 'أذون الاستلام', pluralEn: 'Goods receipts', side: 'purchases', permission: 'purchases.receipts', postPermission: 'purchases.receipts', postable: true, partyRole: 'supplier', conversions: ['purchase_invoice'] },
  purchase_invoice: { ar: 'فاتورة مشتريات', en: 'Purchase invoice', pluralAr: 'فواتير المشتريات', pluralEn: 'Purchase invoices', side: 'purchases', permission: 'purchases.invoices', postPermission: 'purchases.invoices.post', postable: true, partyRole: 'supplier', conversions: ['purchase_return'] },
  purchase_return: { ar: 'مرتجع مشتريات', en: 'Purchase return', pluralAr: 'مرتجعات المشتريات', pluralEn: 'Purchase returns', side: 'purchases', permission: 'purchases.returns', postPermission: 'purchases.returns', postable: true, partyRole: 'supplier', conversions: [] },
}

export function docLabel(type: string, plural = false): string {
  const m = DOC_TYPES[type as TradeType]
  if (!m) return type
  return plural ? tr(m.pluralAr, m.pluralEn) : tr(m.ar, m.en)
}

const STATUS: Record<string, [string, string, 'green' | 'red' | 'amber' | 'blue' | 'brand' | undefined]> = {
  draft: ['مسودة', 'Draft', undefined],
  sent: ['مرسل', 'Sent', 'blue'],
  accepted: ['مقبول', 'Accepted', 'green'],
  rejected: ['مرفوض', 'Rejected', 'red'],
  expired: ['منتهي', 'Expired', 'amber'],
  confirmed: ['مؤكد', 'Confirmed', 'blue'],
  partially_invoiced: ['مفوتر جزئياً', 'Partly invoiced', 'amber'],
  invoiced: ['مفوتر', 'Invoiced', 'green'],
  partially_received: ['مستلم جزئياً', 'Partly received', 'amber'],
  received: ['مستلم', 'Received', 'green'],
  posted: ['مرحّل', 'Posted', 'green'],
  void: ['ملغي', 'Void', 'red'],
  cancelled: ['ملغي', 'Cancelled', 'red'],
  closed: ['مغلق', 'Closed', undefined],
  reversed: ['معكوس', 'Reversed', 'red'],
  in_progress: ['جارٍ', 'In progress', 'blue'],
  in_transit: ['بالطريق', 'In transit', 'amber'],
  paid: ['مدفوع', 'Paid', 'green'],
  partial: ['مدفوع جزئياً', 'Partly paid', 'amber'],
  unpaid: ['غير مدفوع', 'Unpaid', 'red'],
  open: ['مفتوح', 'Open', 'blue'],
  won: ['تم الفوز', 'Won', 'green'],
  lost: ['خسارة', 'Lost', 'red'],
  new: ['جديد', 'New', 'blue'],
  contacted: ['تم التواصل', 'Contacted', 'brand'],
  qualified: ['مؤهل', 'Qualified', 'green'],
  unqualified: ['غير مؤهل', 'Unqualified', undefined],
  converted: ['تم التحويل', 'Converted', 'green'],
  done: ['تم', 'Done', 'green'],
  in_portfolio: ['في الحافظة', 'In portfolio', 'blue'],
  deposited: ['مودع بالبنك', 'Deposited', 'brand'],
  collected: ['محصّل', 'Collected', 'green'],
  bounced: ['مرتد', 'Bounced', 'red'],
  returned: ['مردود', 'Returned', 'amber'],
  endorsed: ['مظهّر', 'Endorsed', 'brand'],
  issued: ['صادر', 'Issued', 'blue'],
  cleared: ['منصرف', 'Cleared', 'green'],
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return ''
  const s = STATUS[status]
  return s ? tr(s[0], s[1]) : status
}

export function statusTone(status: string | null | undefined) {
  return status ? STATUS[status]?.[2] : undefined
}

export const VOUCHER_KINDS = {
  receipt: { ar: 'سند قبض', en: 'Receipt voucher', pluralAr: 'سندات القبض', pluralEn: 'Receipt vouchers' },
  payment: { ar: 'سند صرف', en: 'Payment voucher', pluralAr: 'سندات الصرف', pluralEn: 'Payment vouchers' },
  expense: { ar: 'مصروف', en: 'Expense', pluralAr: 'المصروفات', pluralEn: 'Expenses' },
  transfer: { ar: 'تحويل نقدية', en: 'Cash transfer', pluralAr: 'تحويلات النقدية', pluralEn: 'Cash transfers' },
} as const

export const METHODS: Record<string, [string, string]> = {
  cash: ['نقدي', 'Cash'],
  cheque: ['شيك', 'Cheque'],
  bank_transfer: ['تحويل بنكي', 'Bank transfer'],
  card: ['بطاقة', 'Card'],
  wallet: ['محفظة إلكترونية', 'Mobile wallet'],
}

export const STOCK_DOCS = {
  adjustment: { ar: 'تسوية مخزنية', en: 'Stock adjustment', pluralAr: 'التسويات المخزنية', pluralEn: 'Stock adjustments' },
  transfer: { ar: 'تحويل مخزني', en: 'Stock transfer', pluralAr: 'التحويلات المخزنية', pluralEn: 'Stock transfers' },
  count: { ar: 'جرد', en: 'Stock count', pluralAr: 'الجرد', pluralEn: 'Stock counts' },
  opening: { ar: 'بضاعة أول المدة', en: 'Opening stock', pluralAr: 'بضاعة أول المدة', pluralEn: 'Opening stock' },
} as const

export const ADJUSTMENT_REASONS: Record<string, [string, string]> = {
  damage: ['تالف', 'Damaged'],
  expiry: ['منتهي الصلاحية', 'Expired'],
  loss: ['فقد', 'Lost'],
  theft: ['سرقة', 'Theft'],
  gift: ['هدايا', 'Gifts'],
  sample: ['عينات', 'Samples'],
  internal_use: ['استخدام داخلي', 'Internal use'],
  correction: ['تصحيح', 'Correction'],
  found: ['زيادة', 'Surplus found'],
  other: ['أخرى', 'Other'],
}

/** Where a ledger or stock move came from, for drill-down links. */
export function sourceLink(sourceType: string | null | undefined, sourceId: number | null | undefined): string | null {
  if (!sourceType || !sourceId) return null
  if (sourceType in DOC_TYPES) return `/docs/${sourceType}/${sourceId}`
  if (sourceType === 'service_visit') return `/service/visits?open=${sourceId}`
  if (sourceType === 'voucher') return `/finance/vouchers/any/${sourceId}`
  if (sourceType === 'cheque') return `/finance/cheques/${sourceId}`
  const stock = sourceType.replace(/^stock_/, '').replace(/_(in|loss|void)$/, '')
  if (stock in STOCK_DOCS) return `/inventory/docs/${stock}/${sourceId}`
  return null
}

export function sourceLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return ''
  if (sourceType in DOC_TYPES) return docLabel(sourceType)
  const map: Record<string, [string, string]> = {
    service_visit: ['زيارة خدمة', 'Service visit'],
    voucher: ['سند', 'Voucher'],
    cheque: ['شيك', 'Cheque'],
    party_opening: ['رصيد افتتاحي', 'Opening balance'],
    accounts_opening: ['أرصدة افتتاحية', 'Opening balances'],
    fiscal_year: ['إقفال', 'Year close'],
    stock_adjustment: ['تسوية', 'Adjustment'],
    stock_opening: ['أول المدة', 'Opening stock'],
    stock_count: ['جرد', 'Count'],
    stock_transfer: ['تحويل', 'Transfer'],
    stock_transfer_in: ['استلام تحويل', 'Transfer in'],
    stock_transfer_loss: ['عجز تحويل', 'Transfer shortage'],
  }
  const m = map[sourceType]
  return m ? tr(m[0], m[1]) : sourceType
}
