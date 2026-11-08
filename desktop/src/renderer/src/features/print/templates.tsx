import { amountInArabic, amountInEnglish } from '@/lib/words'
import { date, money, qty, toNumber } from '@/lib/format'
import { docLabel, METHODS, STOCK_DOCS, VOUCHER_KINDS, statusLabel } from '@/lib/docTypes'
import { nameOf, tr } from '@/store/prefs'
import { setting } from '@/store/session'

export function CustomPrintFields({ record }: { record: any }) {
  if (!record?.custom_print_fields?.length) return null
  return <dl style={{ marginTop: 8 }}>{record.custom_print_fields.map((field: any) => <div key={field.key} style={{ display: 'flex', gap: 8 }}><dt>{tr(field.label_ar, field.label_en)}:</dt><dd style={{ margin: 0 }}>{Array.isArray(field.value) ? field.value.join(', ') : typeof field.value === 'boolean' ? tr(field.value ? 'نعم' : 'لا', field.value ? 'Yes' : 'No') : String(field.value ?? '')}</dd></div>)}</dl>
}

function Company() {
  const logo = setting<string | null>('company.logo', null)
  return (
    <div className="co" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {logo && setting<boolean>('print.show_logo', true) !== false && <img src={logo} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />}
      <div>
        <h1>{tr(setting('company.name', ''), setting('company.name_en', '') || setting('company.name', ''))}</h1>
        {setting('company.address') && <div className="muted">{setting('company.address')}</div>}
        <div className="muted">
          {setting('company.phone') && <span>{tr('ت: ', 'Tel: ')}<span className="num">{setting('company.phone')}</span> </span>}
          {setting('company.tax_number') && <span> · {tr('رقم التسجيل الضريبي: ', 'Tax no.: ')}<span className="num">{setting('company.tax_number')}</span></span>}
          {setting('company.commercial_register') && <span> · {tr('س.ت: ', 'CR: ')}<span className="num">{setting('company.commercial_register')}</span></span>}
        </div>
      </div>
    </div>
  )
}

function Words({ amount, currency }: { amount: number; currency: string }) {
  return <div className="words">{tr(amountInArabic(amount, currency), amountInEnglish(amount, currency))}</div>
}

/** A4 sales or purchase document. */
export function TradeDocA4({ doc }: { doc: any }) {
  const currency = doc.currency ?? 'EGP'
  const isInvoice = doc.type === 'sales_invoice' || doc.type === 'purchase_invoice'
  const party = doc.party ?? {}
  const showTax = doc.lines?.some((l: any) => toNumber(l.tax_rate) > 0)
  const hasDiscount = doc.lines?.some((l: any) => toNumber(l.total_discount) > 0)
  return (
    <div>
      <div className="head">
        <Company />
        <div className="title">
          <h2>{docLabel(doc.type)}{doc.type === 'sales_invoice' && toNumber(doc.tax_total) > 0 ? tr(' ضريبية', ' (tax)') : ''}</h2>
          <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>{doc.number}</div>
          {doc.status === 'void' && <div className="stamp">{tr('ملغاة', 'VOID')}</div>}
        </div>
      </div>
      <div className="meta">
        <div><b>{doc.type.startsWith('sales') ? tr('العميل', 'Customer') : tr('المورد', 'Supplier')}</b><span>{nameOf(party)} <span className="num muted">({party.code})</span></span></div>
        <div><b>{tr('التاريخ', 'Date')}</b><span className="num">{date(doc.date)}</span></div>
        {party.tax_number && <div><b>{tr('الرقم الضريبي', 'Tax no.')}</b><span className="num">{party.tax_number}</span></div>}
        {doc.due_date && isInvoice && <div><b>{tr('تاريخ الاستحقاق', 'Due date')}</b><span className="num">{date(doc.due_date)}</span></div>}
        {(party.address || party.city) && <div><b>{tr('العنوان', 'Address')}</b><span>{[party.address, party.city].filter(Boolean).join('، ')}</span></div>}
        {doc.valid_until && doc.type === 'sales_quotation' && <div><b>{tr('صالح حتى', 'Valid until')}</b><span className="num">{date(doc.valid_until)}</span></div>}
        {(party.phone || party.mobile) && <div><b>{tr('الهاتف', 'Phone')}</b><span className="num">{party.mobile || party.phone}</span></div>}
        {doc.salesperson && <div><b>{tr('المندوب', 'Salesperson')}</b><span>{doc.salesperson.name}</span></div>}
        {doc.reference && <div><b>{tr('المرجع', 'Reference')}</b><span className="num">{doc.reference}</span></div>}
        {doc.warehouse && <div><b>{tr('المخزن', 'Warehouse')}</b><span>{nameOf(doc.warehouse)}</span></div>}
        {doc.source && <div><b>{tr('مرتبط بـ', 'Based on')}</b><span className="num">{doc.source.number}</span></div>}
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }}>#</th>
            <th style={{ width: 80 }}>{tr('الكود', 'Code')}</th>
            <th>{tr('الصنف', 'Item')}</th>
            <th style={{ width: 60 }}>{tr('الوحدة', 'Unit')}</th>
            <th className="r" style={{ width: 60 }}>{tr('الكمية', 'Qty')}</th>
            <th className="r" style={{ width: 80 }}>{tr('السعر', 'Price')}</th>
            {hasDiscount && <th className="r" style={{ width: 70 }}>{tr('الخصم', 'Discount')}</th>}
            {showTax && <th className="r" style={{ width: 50 }}>{tr('ض.ق.م', 'VAT')}</th>}
            <th className="r" style={{ width: 95 }}>{tr('الإجمالي', 'Amount')}</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines?.map((l: any, i: number) => (
            <tr key={l.id ?? i}>
              <td className="num">{i + 1}</td>
              <td className="num">{l.product?.code}</td>
              <td>{l.description || nameOf(l.product)}{l.batch?.batch_no ? <span className="muted"> · {tr('تشغيلة', 'Batch')} {l.batch.batch_no}</span> : null}</td>
              <td>{nameOf(l.product_unit?.unit)}</td>
              <td className="r num">{qty(l.quantity)}</td>
              <td className="r num">{money(l.unit_price)}</td>
              {hasDiscount && <td className="r num">{toNumber(l.total_discount) ? money(l.total_discount) : ''}</td>}
              {showTax && <td className="r num">{toNumber(l.tax_rate) ? `${toNumber(l.tax_rate)}%` : '—'}</td>}
              <td className="r num">{money(doc.price_includes_tax ? l.line_total : toNumber(l.net_amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="totals">
        <tbody>
          <tr><td>{tr('الإجمالي قبل الخصم', 'Subtotal')}</td><td className="r num">{money(doc.gross_total)}</td></tr>
          {toNumber(doc.discount_total) > 0 && <tr><td>{tr('الخصم', 'Discount')}</td><td className="r num">({money(doc.discount_total)})</td></tr>}
          <tr><td>{tr('صافي قبل الضريبة', 'Net before tax')}</td><td className="r num">{money(doc.net_total)}</td></tr>
          {toNumber(doc.tax_total) > 0 && <tr><td>{tr('ضريبة القيمة المضافة', 'VAT')}</td><td className="r num">{money(doc.tax_total)}</td></tr>}
          <tr className="grand"><td>{tr('الإجمالي', 'Total')} ({currency})</td><td className="r num">{money(doc.total)}</td></tr>
          {toNumber(doc.wht_amount) > 0 && <tr><td>{tr('ضريبة الخصم والإضافة', 'Withholding tax')} ({toNumber(doc.wht_rate)}%)</td><td className="r num">({money(doc.wht_amount)})</td></tr>}
          {toNumber(doc.wht_amount) > 0 && <tr><td><b>{tr('الصافي المستحق', 'Net payable')}</b></td><td className="r num"><b>{money(doc.balance_due)}</b></td></tr>}
          {isInvoice && toNumber(doc.paid_amount) > 0 && <tr><td>{tr('المدفوع', 'Paid')}</td><td className="r num">{money(doc.paid_amount)}</td></tr>}
          {isInvoice && toNumber(doc.paid_amount) > 0 && <tr><td><b>{tr('المتبقي', 'Balance')}</b></td><td className="r num"><b>{money(doc.outstanding)}</b></td></tr>}
        </tbody>
      </table>
      <CustomPrintFields record={doc} />
      <Words amount={toNumber(doc.balance_due) || toNumber(doc.total)} currency={currency} />
      {doc.notes && <p><b>{tr('ملاحظات: ', 'Notes: ')}</b>{doc.notes}</p>}
      {doc.terms && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{doc.terms}</p>}
      <div className="sign">
        <div>{doc.type.startsWith('sales') ? tr('توقيع المستلم', 'Received by') : tr('أمين المخزن', 'Storekeeper')}</div>
        <div>{tr('المحاسب', 'Accountant')}</div>
        <div>{tr('المدير', 'Manager')}</div>
      </div>
      {doc.type === 'sales_invoice' && setting('sales.invoice_footer') && <div className="foot">{setting('sales.invoice_footer')}</div>}
      <div className="foot num">{doc.creator?.name ? tr('أعدّه: ', 'Prepared by: ') + doc.creator.name + ' · ' : ''}{new Date().toLocaleString('en-GB')}</div>
    </div>
  )
}

/** 80 mm thermal receipt for counter sales. */
export function Receipt({ doc, cash }: { doc: any; cash?: { tendered?: number } }) {
  const change = cash?.tendered ? Math.max(0, cash.tendered - toNumber(doc.total)) : 0
  return (
    <div className="receipt">
      <h3 style={{ fontSize: 14 }}>{tr(setting('company.name', ''), setting('company.name_en', '') || setting('company.name', ''))}</h3>
      {setting('print.receipt_header') && <div>{setting('print.receipt_header')}</div>}
      {setting('company.tax_number') && <div className="num">{tr('ر.ض: ', 'Tax: ')}{setting('company.tax_number')}</div>}
      <div className="line" />
      <div>{docLabel(doc.type)} <span className="num">{doc.number}</span></div>
      <div className="num">{date(doc.date)} {new Date().toTimeString().slice(0, 5)}</div>
      <div>{nameOf(doc.party)}</div>
      <div className="line" />
      <table>
        <tbody>
          {doc.lines?.map((l: any, i: number) => (
            <tr key={i}>
              <td style={{ textAlign: 'start' }}>
                {l.description || nameOf(l.product)}
                <div className="muted"><span className="num">{qty(l.quantity)} × {money(l.unit_price)}</span></div>
              </td>
              <td className="r num" style={{ verticalAlign: 'bottom' }}>{money(doc.price_includes_tax ? l.line_total : l.net_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="line" />
      <table>
        <tbody>
          {toNumber(doc.discount_total) > 0 && <tr><td style={{ textAlign: 'start' }}>{tr('الخصم', 'Discount')}</td><td className="r num">{money(doc.discount_total)}</td></tr>}
          {toNumber(doc.tax_total) > 0 && <tr><td style={{ textAlign: 'start' }}>{tr('ض.ق.م', 'VAT')}</td><td className="r num">{money(doc.tax_total)}</td></tr>}
          <tr className="tot"><td style={{ textAlign: 'start' }}>{tr('الإجمالي', 'Total')}</td><td className="r num">{money(doc.total)}</td></tr>
          {toNumber(doc.paid_amount) > 0 && <tr><td style={{ textAlign: 'start' }}>{tr('المدفوع', 'Paid')}</td><td className="r num">{money(doc.paid_amount)}</td></tr>}
          {change > 0 && <tr><td style={{ textAlign: 'start' }}>{tr('الباقي للعميل', 'Change')}</td><td className="r num">{money(change)}</td></tr>}
          {toNumber(doc.outstanding) > 0 && <tr><td style={{ textAlign: 'start' }}>{tr('آجل', 'On account')}</td><td className="r num">{money(doc.outstanding)}</td></tr>}
        </tbody>
      </table>
      <div className="line" />
      <CustomPrintFields record={doc} />
      <div>{setting('print.receipt_footer') || tr('شكراً لزيارتكم', 'Thank you for your visit')}</div>
      {setting('sales.invoice_footer') && <div className="muted" style={{ fontSize: 9 }}>{setting('sales.invoice_footer')}</div>}
    </div>
  )
}

/** Receipt or payment voucher (A5). */
export function VoucherPrint({ voucher }: { voucher: any }) {
  const kind = voucher.type === 'payment' && !voucher.party_id ? 'expense' : voucher.type
  const meta = VOUCHER_KINDS[kind as keyof typeof VOUCHER_KINDS]
  const currency = setting('company.currency', 'EGP')
  const who = voucher.party ? nameOf(voucher.party) : voucher.payee || nameOf(voucher.account)
  return (
    <div>
      <div className="head">
        <Company />
        <div className="title">
          <h2>{tr(meta.ar, meta.en)}</h2>
          <div className="num" style={{ fontWeight: 700 }}>{voucher.number}</div>
          {voucher.status === 'void' && <div className="stamp">{tr('ملغي', 'VOID')}</div>}
        </div>
      </div>
      <div className="meta">
        <div><b>{tr('التاريخ', 'Date')}</b><span className="num">{date(voucher.date)}</span></div>
        <div><b>{tr('المبلغ', 'Amount')}</b><span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{money(voucher.amount)} {currency}</span></div>
        <div><b>{voucher.type === 'receipt' ? tr('استلمنا من', 'Received from') : voucher.type === 'transfer' ? tr('إلى', 'To') : tr('صرفنا إلى', 'Paid to')}</b><span>{voucher.type === 'transfer' ? nameOf(voucher.to_cash_account) : who}</span></div>
        <div><b>{tr('طريقة الدفع', 'Method')}</b><span>{tr(...(METHODS[voucher.method] ?? [voucher.method, voucher.method]))}</span></div>
        {voucher.cash_account && <div><b>{tr('الخزينة/البنك', 'Cash/bank')}</b><span>{nameOf(voucher.cash_account)}</span></div>}
        {voucher.cheque && <div><b>{tr('الشيك', 'Cheque')}</b><span className="num">{voucher.cheque.number} · {voucher.cheque.bank_name} · {date(voucher.cheque.due_date)}</span></div>}
        {toNumber(voucher.tax_amount) > 0 && <div><b>{tr('منها ضريبة', 'Incl. VAT')}</b><span className="num">{money(voucher.tax_amount)}</span></div>}
        {voucher.reference && <div><b>{tr('المرجع', 'Reference')}</b><span className="num">{voucher.reference}</span></div>}
      </div>
      <Words amount={toNumber(voucher.amount)} currency={currency} />
      {voucher.description && <p><b>{tr('وذلك عن: ', 'For: ')}</b>{voucher.description}</p>}
      {voucher.allocations?.length > 0 && (
        <table style={{ marginTop: 6 }}>
          <thead><tr><th>{tr('الفاتورة', 'Invoice')}</th><th>{tr('التاريخ', 'Date')}</th><th className="r">{tr('المبلغ المسدد', 'Amount settled')}</th></tr></thead>
          <tbody>{voucher.allocations.map((a: any) => <tr key={a.id}><td className="num">{a.document?.number}</td><td className="num">{date(a.document?.date)}</td><td className="r num">{money(a.amount)}</td></tr>)}</tbody>
        </table>
      )}
      <CustomPrintFields record={voucher} />
      <div className="sign">
        <div>{voucher.type === 'receipt' ? tr('المستلم (أمين الخزينة)', 'Received by (cashier)') : tr('المستلم', 'Received by')}</div>
        <div>{tr('المحاسب', 'Accountant')}</div>
        <div>{tr('المدير', 'Manager')}</div>
      </div>
    </div>
  )
}

/** Statement of account for a customer or supplier. */
export function StatementPrint({ data }: { data: any }) {
  return (
    <div>
      <div className="head">
        <Company />
        <div className="title">
          <h2>{tr('كشف حساب', 'Statement of account')}</h2>
          <div className="num">{date(data.from)} — {date(data.to)}</div>
        </div>
      </div>
      <div className="meta">
        <div><b>{tr('الحساب', 'Account')}</b><span>{nameOf(data.party)} <span className="num muted">({data.party.code})</span></span></div>
        <div><b>{tr('الرصيد الختامي', 'Closing balance')}</b><span className="num" style={{ fontWeight: 700 }}>{money(data.closing_balance, { paren: true })}</span></div>
      </div>
      <table>
        <thead><tr><th style={{ width: 70 }}>{tr('التاريخ', 'Date')}</th><th style={{ width: 110 }}>{tr('المرجع', 'Ref.')}</th><th>{tr('البيان', 'Description')}</th><th className="r" style={{ width: 85 }}>{tr('مدين', 'Debit')}</th><th className="r" style={{ width: 85 }}>{tr('دائن', 'Credit')}</th><th className="r" style={{ width: 95 }}>{tr('الرصيد', 'Balance')}</th></tr></thead>
        <tbody>
          <tr><td /><td /><td><b>{tr('رصيد أول المدة', 'Opening balance')}</b></td><td /><td /><td className="r num">{money(data.opening_balance, { paren: true })}</td></tr>
          {data.lines.map((l: any, i: number) => (
            <tr key={i}><td className="num">{date(l.date)}</td><td className="num">{l.reference}</td><td>{l.description}</td><td className="r num">{money(l.debit, { blankZero: true })}</td><td className="r num">{money(l.credit, { blankZero: true })}</td><td className="r num">{money(l.balance, { paren: true })}</td></tr>
          ))}
          <tr><td /><td /><td><b>{tr('الإجمالي', 'Totals')}</b></td><td className="r num"><b>{money(data.total_debit)}</b></td><td className="r num"><b>{money(data.total_credit)}</b></td><td className="r num" style={{ borderBottom: '3px double #111' }}><b>{money(data.closing_balance, { paren: true })}</b></td></tr>
        </tbody>
      </table>
      <p className="muted">{tr('الرصيد الموجب مستحق لنا، والرصيد بين قوسين مستحق لكم. يرجى المراجعة وإبلاغنا بأي ملاحظات خلال 15 يوماً.', 'A positive balance is due to us; a balance in brackets is due to you. Please review and tell us of any difference within 15 days.')}</p>
    </div>
  )
}

/** Stock documents. A count sheet leaves the counted column blank for counting by hand. */
export function StockDocPrint({ doc, blankCount }: { doc: any; blankCount?: boolean }) {
  const meta = STOCK_DOCS[doc.type as keyof typeof STOCK_DOCS]
  return (
    <div>
      <div className="head">
        <Company />
        <div className="title">
          <h2>{tr(meta.ar, meta.en)}</h2>
          <div className="num" style={{ fontWeight: 700 }}>{doc.number}</div>
          <div>{statusLabel(doc.status)}</div>
        </div>
      </div>
      <div className="meta">
        <div><b>{tr('التاريخ', 'Date')}</b><span className="num">{date(doc.date)}</span></div>
        <div><b>{doc.type === 'transfer' ? tr('من مخزن', 'From') : tr('المخزن', 'Warehouse')}</b><span>{nameOf(doc.warehouse)}</span></div>
        {doc.to_warehouse && <div><b>{tr('إلى مخزن', 'To')}</b><span>{nameOf(doc.to_warehouse)}</span></div>}
        {doc.notes && <div><b>{tr('ملاحظات', 'Notes')}</b><span>{doc.notes}</span></div>}
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }}>#</th><th style={{ width: 80 }}>{tr('الكود', 'Code')}</th><th>{tr('الصنف', 'Item')}</th><th style={{ width: 70 }}>{tr('التشغيلة', 'Batch')}</th>
            {doc.type === 'count' ? <><th className="r" style={{ width: 70 }}>{tr('رصيد النظام', 'System')}</th><th className="r" style={{ width: 80 }}>{tr('المعدود', 'Counted')}</th></> : <th className="r" style={{ width: 70 }}>{tr('الكمية', 'Qty')}</th>}
            {doc.type === 'transfer' && <th className="r" style={{ width: 80 }}>{tr('المستلم', 'Received')}</th>}
          </tr>
        </thead>
        <tbody>
          {doc.lines?.map((l: any, i: number) => (
            <tr key={l.id ?? i}>
              <td className="num">{i + 1}</td><td className="num">{l.product?.code}</td><td>{nameOf(l.product)} <span className="muted">{nameOf(l.product_unit?.unit ?? l.product?.base_unit)}</span></td><td className="num">{l.batch?.batch_no ?? l.batch_no ?? ''}</td>
              {doc.type === 'count' ? <><td className="r num">{qty(l.system_quantity)}</td><td className="r num">{blankCount ? '' : l.counted_quantity !== null ? qty(l.counted_quantity) : ''}</td></> : <td className="r num">{l.direction === 'out' ? '-' : ''}{qty(l.quantity)}</td>}
              {doc.type === 'transfer' && <td className="r num">{l.received_quantity !== null && l.received_quantity !== undefined ? qty(l.received_quantity) : ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sign"><div>{tr('أمين المخزن', 'Storekeeper')}</div><div>{doc.type === 'transfer' ? tr('المستلم', 'Received by') : tr('المراجع', 'Checked by')}</div><div>{tr('المدير', 'Manager')}</div></div>
      <CustomPrintFields record={doc} />
    </div>
  )
}

export interface PrintColumn {
  header: string
  value: (row: any) => string
  align?: 'end'
  width?: number
}

/** Any report as a printable table. */
export function TablePrint({ title, subtitle, columns, rows, totals }: { title: string; subtitle?: string; columns: PrintColumn[]; rows: any[]; totals?: (string | null)[] }) {
  return (
    <div>
      <div className="head">
        <Company />
        <div className="title"><h2>{title}</h2>{subtitle && <div className="num">{subtitle}</div>}</div>
      </div>
      <table>
        <thead><tr>{columns.map((c, i) => <th key={i} className={c.align === 'end' ? 'r' : undefined} style={{ width: c.width }}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{columns.map((c, j) => <td key={j} className={c.align === 'end' ? 'r num' : undefined}>{c.value(r)}</td>)}</tr>)}
          {totals && <tr>{totals.map((v, j) => <td key={j} className={columns[j]?.align === 'end' ? 'r num' : undefined} style={{ fontWeight: 700, borderBottom: v ? '3px double #111' : undefined }}>{v ?? ''}</td>)}</tr>}
        </tbody>
      </table>
    </div>
  )
}
