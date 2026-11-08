import { useState, type ReactNode } from 'react'
import { Download, Printer } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, money, percent, startOfMonth, startOfYear, today, toNumber } from '@/lib/format'
import { docLabel } from '@/lib/docTypes'
import { exportCsv, type CsvColumn } from '@/lib/csv'
import { nameOf, useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'
import { DateRange } from '@/components/DateRange'
import { Button, Check, ErrorBox, Field, Input, Money, PageHeader, Select, Sheet, Spinner } from '@/components/ui'
import { printElement } from '@/features/print/printService'
import { TablePrint, type PrintColumn } from '@/features/print/templates'

/** Trial balance, income statement, balance sheet, cash movement, VAT and aging. */
export default function FinanceReports() {
  const { params } = useTab()
  switch (params.report) {
    case 'trial-balance': return <TrialBalance />
    case 'income-statement': return <IncomeStatement />
    case 'balance-sheet': return <BalanceSheet />
    case 'cash-flow': return <CashFlow />
    case 'vat': return <Vat />
    case 'aging-receivable': return <Aging kind="receivable" />
    case 'aging-payable': return <Aging kind="payable" />
    default: return <ErrorBox error={new Error('Unknown report')} />
  }
}

function Frame({ title, subtitle, controls, onPrint, onExport, children, loading, error }: { title: string; subtitle?: ReactNode; controls?: ReactNode; onPrint?: () => void; onExport?: () => void; children: ReactNode; loading: boolean; error: unknown }) {
  const t = useT()
  return (
    <div className="pb-10">
      <PageHeader title={title} subtitle={subtitle} actions={<>
        {controls}
        {onExport && <Button icon={Download} onClick={onExport} disabled={loading}>{t('تصدير', 'Export')}</Button>}
        {onPrint && <Button icon={Printer} onClick={onPrint} disabled={loading}>{t('طباعة', 'Print')}</Button>}
      </>} />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} /> : children}
    </div>
  )
}

function print(title: string, subtitle: string, rows: any[], columns: PrintColumn[], totals?: (string | null)[]) {
  void printElement(<TablePrint title={title} subtitle={subtitle} rows={rows} columns={columns} totals={totals} />, { paper: 'A4', title })
}
function csv(name: string, rows: any[], columns: CsvColumn<any>[]) {
  void exportCsv(name, rows, columns)
}

// ─── Trial balance ─────────────────────────────────────────────────────
function TrialBalance() {
  const t = useT()
  const [range, setRange] = useState({ from: startOfYear(), to: today() })
  const [level, setLevel] = useState('')
  const [showZero, setShowZero] = useState(false)
  const { data, isLoading, error } = useApi<any>('/reports/finance/trial-balance', { ...range, level, show_zero: showZero ? 1 : undefined })
  const title = t('ميزان المراجعة', 'Trial balance')
  const sub = `${date(range.from)} — ${date(range.to)}`
  const balanced = data && Math.abs(toNumber(data.totals.closing_debit) - toNumber(data.totals.closing_credit)) < 0.01
  const cols: PrintColumn[] = [
    { header: t('الحساب', 'Account'), value: (r) => `${r.code} ${nameOf(r)}` },
    { header: t('رصيد أول مدين', 'Opening Dr'), value: (r) => money(r.opening_debit, { blankZero: true }), align: 'end' }, { header: t('رصيد أول دائن', 'Opening Cr'), value: (r) => money(r.opening_credit, { blankZero: true }), align: 'end' },
    { header: t('حركة مدين', 'Period Dr'), value: (r) => money(r.period_debit, { blankZero: true }), align: 'end' }, { header: t('حركة دائن', 'Period Cr'), value: (r) => money(r.period_credit, { blankZero: true }), align: 'end' },
    { header: t('رصيد مدين', 'Closing Dr'), value: (r) => money(r.closing_debit, { blankZero: true }), align: 'end' }, { header: t('رصيد دائن', 'Closing Cr'), value: (r) => money(r.closing_credit, { blankZero: true }), align: 'end' },
  ]
  return (
    <Frame title={title} subtitle={data && (balanced ? <span style={{ color: 'var(--ledger)' }}>{t('الميزان متوازن', 'In balance')}</span> : <span className="neg">{t('الميزان غير متوازن', 'Out of balance')}</span>)} loading={isLoading} error={error}
      controls={<>
        <DateRange value={range} onChange={setRange} />
        <Select className="w-auto" value={level} onChange={(e) => setLevel(e.target.value)} placeholder={t('كل المستويات', 'All levels')} options={[1, 2, 3, 4].map((l) => ({ value: l, label: t(`حتى المستوى ${l}`, `Up to level ${l}`) }))} />
        <Check checked={showZero} onChange={setShowZero} label={t('إظهار الأرصدة الصفرية', 'Show zero balances')} />
      </>}
      onPrint={() => print(title, sub, data.rows, cols, ['', ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => money(data.totals[k]))])}
      onExport={() => csv('trial-balance', data.rows, [{ header: 'code', value: (r) => r.code }, { header: 'name', value: (r) => r.name }, ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => ({ header: k, value: (r: any) => r[k] }))])}>
      {data && (
        <div className="mx-5 sheet overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr><th rowSpan={2}>{t('الحساب', 'Account')}</th><th colSpan={2} className="text-center">{t('أول المدة', 'Opening')}</th><th colSpan={2} className="text-center">{t('حركة الفترة', 'Period')}</th><th colSpan={2} className="text-center">{t('آخر المدة', 'Closing')}</th></tr>
              <tr>{[0, 1, 2].flatMap((i) => [<th key={`d${i}`} className="amount">{t('مدين', 'Dr')}</th>, <th key={`c${i}`} className="amount">{t('دائن', 'Cr')}</th>])}</tr>
            </thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.id} className={r.is_group ? 'font-semibold' : 'cursor-pointer'} onDoubleClick={() => navigate(`/finance/ledger/${r.id}`)}>
                  <td><span style={{ paddingInlineStart: (r.level ?? 0) * 16 }} className="inline-block"><span className="num muted">{r.code}</span> {nameOf(r)}</span></td>
                  {['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => <td key={k} className="amount num">{money(r[k], { blankZero: true })}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total-row"><td>{t('الإجمالي', 'Total')}</td>{['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => <td key={k} className="amount"><Money value={data.totals[k]} /></td>)}</tr>
            </tfoot>
          </table>
        </div>
      )}
    </Frame>
  )
}

// ─── Income statement ──────────────────────────────────────────────────
function IncomeStatement() {
  const t = useT()
  const [range, setRange] = useState({ from: startOfYear(), to: today() })
  const { data, isLoading, error } = useApi<any>('/reports/finance/income-statement', range)
  const title = t('قائمة الدخل', 'Income statement')
  const sub = `${date(range.from)} — ${date(range.to)}`
  const flat = () => data ? [
    ...data.net_sales.lines.map((l: any) => ({ label: `${l.code} ${nameOf(l)}`, amount: l.amount })), { label: t('صافي المبيعات', 'Net sales'), amount: data.net_sales.total, bold: true },
    ...data.cost_of_sales.lines.map((l: any) => ({ label: `${l.code} ${nameOf(l)}`, amount: -l.amount })), { label: t('مجمل الربح', 'Gross profit'), amount: data.gross_profit, bold: true },
    ...data.operating_expenses.groups.flatMap((g: any) => g.lines.map((l: any) => ({ label: `${l.code} ${nameOf(l)}`, amount: -l.amount }))), { label: t('إجمالي المصروفات', 'Total expenses'), amount: -data.operating_expenses.total, bold: true },
    ...data.other_income.lines.map((l: any) => ({ label: `${l.code} ${nameOf(l)}`, amount: l.amount })), { label: t('صافي الربح', 'Net profit'), amount: data.net_profit, bold: true },
  ] : []
  return (
    <Frame title={title} loading={isLoading} error={error} controls={<DateRange value={range} onChange={setRange} />}
      onPrint={() => print(title, sub, flat(), [{ header: t('البند', 'Line'), value: (r) => (r.bold ? `■ ${r.label}` : r.label) }, { header: t('المبلغ', 'Amount'), value: (r) => money(r.amount, { paren: true }), align: 'end' }])}
      onExport={() => csv('income-statement', flat(), [{ header: 'line', value: (r) => r.label }, { header: 'amount', value: (r) => r.amount }])}>
      {data && (
        <div className="mx-auto max-w-[760px] px-5">
          <div className="sheet">
            <Statement>
              <Section title={t('المبيعات', 'Sales')} lines={data.net_sales.lines} />
              <Subtotal label={t('صافي المبيعات', 'Net sales')} value={data.net_sales.total} />
              <Section title={t('تكلفة المبيعات', 'Cost of sales')} lines={data.cost_of_sales.lines} negative />
              <Subtotal label={t('مجمل الربح', 'Gross profit')} value={data.gross_profit} note={data.gross_margin !== null ? `${percent(data.gross_margin)} ${t('من المبيعات', 'of sales')}` : undefined} />
              {data.operating_expenses.groups.map((g: any) => <Section key={g.group?.id ?? 'x'} title={nameOf(g.group) || t('مصروفات', 'Expenses')} lines={g.lines} negative total={g.total} />)}
              <Subtotal label={t('إجمالي المصروفات', 'Total expenses')} value={-data.operating_expenses.total} />
              {data.other_income.lines.length > 0 && <Section title={t('إيرادات أخرى', 'Other income')} lines={data.other_income.lines} />}
              <tr className="total-row text-[15px]"><td>{t('صافي الربح (الخسارة)', 'Net profit (loss)')}{data.net_margin !== null && <span className="muted ms-2 text-[12px] font-normal">{percent(data.net_margin)}</span>}</td><td className="amount"><Money value={data.net_profit} paren colored /></td></tr>
            </Statement>
          </div>
        </div>
      )}
    </Frame>
  )
}

function Statement({ children }: { children: ReactNode }) {
  return <table className="ledger statement"><tbody>{children}</tbody></table>
}
function Section({ title, lines, negative, total }: { title: string; lines: any[]; negative?: boolean; total?: number }) {
  return (
    <>
      <tr className="section-head"><td colSpan={2}>{title}</td></tr>
      {lines.map((l) => (
        <tr key={l.id} className="cursor-pointer" onDoubleClick={() => navigate(`/finance/ledger/${l.id}`)}>
          <td style={{ paddingInlineStart: 28 }}><span className="num muted">{l.code}</span> {nameOf(l)}</td>
          <td className="amount"><Money value={negative ? -l.amount : l.amount} paren /></td>
        </tr>
      ))}
      {total !== undefined && lines.length > 1 && <tr><td style={{ paddingInlineStart: 28 }} className="muted">{title}</td><td className="amount" style={{ borderTop: '1px solid var(--rule-strong)' }}><Money value={-total} paren /></td></tr>}
    </>
  )
}
function Subtotal({ label, value, note }: { label: string; value: number; note?: string }) {
  return <tr className="subtotal"><td>{label}{note && <span className="muted ms-2 text-[12px] font-normal">{note}</span>}</td><td className="amount"><Money value={value} paren colored /></td></tr>
}

// ─── Balance sheet ─────────────────────────────────────────────────────
function BalanceSheet() {
  const t = useT()
  const [asOf, setAsOf] = useState(today())
  const { data, isLoading, error } = useApi<any>('/reports/finance/balance-sheet', { as_of: asOf })
  const title = t('الميزانية العمومية', 'Balance sheet')
  const side = (label: string, block: any) => (
    <>
      <tr className="section-head"><td colSpan={2}>{label}</td></tr>
      {block.rows.filter((r: any) => Math.abs(toNumber(r.amount)) > 0.004).map((r: any) => (
        <tr key={r.id} className={r.is_group ? 'font-semibold' : 'cursor-pointer'} onDoubleClick={() => !r.is_group && navigate(`/finance/ledger/${r.id}`)}>
          <td style={{ paddingInlineStart: 12 + (r.level ?? 0) * 16 }}><span className="num muted">{r.code}</span> {nameOf(r)}</td>
          <td className="amount">{r.is_group ? <span className="muted"><Money value={r.amount} paren /></span> : <Money value={r.amount} paren />}</td>
        </tr>
      ))}
    </>
  )
  const flat = () => data ? ['assets', 'liabilities', 'equity'].flatMap((k) => data[k].rows.filter((r: any) => !r.is_group && Math.abs(toNumber(r.amount)) > 0.004).map((r: any) => ({ section: k, label: `${r.code} ${nameOf(r)}`, amount: r.amount }))) : []
  return (
    <Frame title={title} subtitle={data && (data.balanced ? <span style={{ color: 'var(--ledger)' }}>{t('الأصول = الخصوم + حقوق الملكية', 'Assets = liabilities + equity')}</span> : <span className="neg">{t('الميزانية غير متوازنة', 'Does not balance')}</span>)} loading={isLoading} error={error}
      controls={<Field label={t('في تاريخ', 'As of')}><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>}
      onPrint={() => print(title, date(asOf), flat(), [{ header: t('البند', 'Line'), value: (r) => r.label }, { header: t('المبلغ', 'Amount'), value: (r) => money(r.amount, { paren: true }), align: 'end' }], [t('إجمالي الأصول', 'Total assets'), money(data.assets.total)])}
      onExport={() => csv('balance-sheet', flat(), [{ header: 'section', value: (r) => r.section }, { header: 'line', value: (r) => r.label }, { header: 'amount', value: (r) => r.amount }])}>
      {data && (
        <div className="grid gap-4 px-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="sheet self-start">
            <Statement>
              {side(t('الأصول', 'Assets'), data.assets)}
              <tr className="total-row"><td>{t('إجمالي الأصول', 'Total assets')}</td><td className="amount"><Money value={data.assets.total} paren /></td></tr>
            </Statement>
          </div>
          <div className="sheet self-start">
            <Statement>
              {side(t('الخصوم', 'Liabilities'), data.liabilities)}
              <Subtotal label={t('إجمالي الخصوم', 'Total liabilities')} value={data.liabilities.total} />
              {side(t('حقوق الملكية', 'Equity'), data.equity)}
              <tr><td style={{ paddingInlineStart: 12 }}>{t('أرباح (خسائر) الفترة غير المرحلة', 'Current-period profit (not yet closed)')}</td><td className="amount"><Money value={data.unclosed_profit} paren colored /></td></tr>
              <Subtotal label={t('إجمالي حقوق الملكية', 'Total equity')} value={toNumber(data.equity.total) + toNumber(data.unclosed_profit)} />
              <tr className="total-row"><td>{t('إجمالي الخصوم وحقوق الملكية', 'Total liabilities and equity')}</td><td className="amount"><Money value={data.total_liabilities_equity} paren /></td></tr>
            </Statement>
          </div>
        </div>
      )}
    </Frame>
  )
}

// ─── Cash movement ─────────────────────────────────────────────────────
const CASH_CATEGORIES: Record<string, [string, string]> = {
  customers: ['متحصلات من العملاء', 'Collected from customers'],
  suppliers: ['مدفوعات للموردين', 'Paid to suppliers'],
  expenses: ['مصروفات', 'Expenses'],
  owners: ['الملاك (رأس مال ومسحوبات)', 'Owners (capital and drawings)'],
  other_income: ['إيرادات أخرى', 'Other income'],
  financing: ['تمويل والتزامات أخرى', 'Financing and other liabilities'],
  taxes: ['ضرائب', 'Taxes'],
  other: ['أخرى', 'Other'],
}
function CashFlow() {
  const t = useT()
  const [range, setRange] = useState({ from: startOfMonth(), to: today() })
  const { data, isLoading, error } = useApi<any>('/reports/finance/cash-flow', range)
  const title = t('حركة النقدية', 'Cash movement')
  const label = (k: string) => t(...(CASH_CATEGORIES[k] ?? [k, k]))
  return (
    <Frame title={title} subtitle={t('كل ما دخل وخرج من الخزائن والبنوك مصنفاً حسب الطرف الآخر.', 'Everything in and out of cash and banks, grouped by the other side.')} loading={isLoading} error={error} controls={<DateRange value={range} onChange={setRange} />}
      onPrint={() => print(title, `${date(range.from)} — ${date(range.to)}`, data.rows, [{ header: t('البند', 'Category'), value: (r) => label(r.category) }, { header: t('وارد', 'In'), value: (r) => money(r.in, { blankZero: true }), align: 'end' }, { header: t('منصرف', 'Out'), value: (r) => money(r.out, { blankZero: true }), align: 'end' }, { header: t('الصافي', 'Net'), value: (r) => money(r.net, { paren: true }), align: 'end' }], [t('الإجمالي', 'Total'), money(data.total_in), money(data.total_out), money(data.net, { paren: true })])}>
      {data && (
        <div className="mx-auto max-w-[820px] px-5">
          <div className="sheet">
            <table className="ledger">
              <thead><tr><th>{t('البند', 'Category')}</th><th className="amount">{t('وارد', 'In')}</th><th className="amount">{t('منصرف', 'Out')}</th><th className="amount">{t('الصافي', 'Net')}</th></tr></thead>
              <tbody>
                <tr className="font-semibold"><td>{t('رصيد أول الفترة', 'Opening balance')}</td><td /><td /><td className="amount"><Money value={data.opening} paren /></td></tr>
                {data.rows.map((r: any) => <tr key={r.category}><td>{label(r.category)}</td><td className="amount num">{money(r.in, { blankZero: true })}</td><td className="amount num">{money(r.out, { blankZero: true })}</td><td className="amount"><Money value={r.net} paren colored /></td></tr>)}
                <tr className="subtotal"><td>{t('صافي الحركة', 'Net movement')}</td><td className="amount"><Money value={data.total_in} /></td><td className="amount"><Money value={data.total_out} /></td><td className="amount"><Money value={data.net} paren colored /></td></tr>
              </tbody>
              <tfoot><tr className="total-row"><td>{t('رصيد آخر الفترة', 'Closing balance')}</td><td /><td /><td className="amount"><Money value={data.closing} paren /></td></tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </Frame>
  )
}

// ─── VAT return ────────────────────────────────────────────────────────
function Vat() {
  const t = useT()
  const [range, setRange] = useState({ from: startOfMonth(), to: today() })
  const { data, isLoading, error } = useApi<any>('/reports/finance/vat', range)
  const title = t('إقرار ضريبة القيمة المضافة', 'VAT return')
  const rows = data ? [
    { label: t('المبيعات', 'Sales'), ...data.sales, sign: 1 },
    { label: t('مردودات المبيعات', 'Sales returns'), ...data.sales_returns, sign: -1 },
    { label: t('المشتريات', 'Purchases'), ...data.purchases, sign: 1 },
    { label: t('مردودات المشتريات', 'Purchase returns'), ...data.purchase_returns, sign: -1 },
    { label: t('مصروفات خاضعة', 'Taxable expenses'), ...data.expenses, sign: 1 },
  ] : []
  return (
    <Frame title={title} loading={isLoading} error={error} controls={<DateRange value={range} onChange={setRange} />}
      onPrint={() => print(title, `${date(range.from)} — ${date(range.to)}`, data.documents, [{ header: t('المستند', 'Document'), value: (r) => `${docLabel(r.type)} ${r.number}` }, { header: t('التاريخ', 'Date'), value: (r) => date(r.date) }, { header: t('الطرف', 'Party'), value: (r) => r.party?.name ?? '' }, { header: t('رقم التسجيل', 'Tax no.'), value: (r) => r.party?.tax_number ?? '' }, { header: t('القيمة', 'Base'), value: (r) => money(r.net_total), align: 'end' }, { header: t('الضريبة', 'VAT'), value: (r) => money(r.tax_total), align: 'end' }], ['', '', '', t('الصافي المستحق', 'Net payable'), '', money(data.net_payable)])}
      onExport={() => csv('vat-documents', data.documents, [{ header: 'type', value: (r) => r.type }, { header: 'number', value: (r) => r.number }, { header: 'date', value: (r) => r.date }, { header: 'party', value: (r) => r.party?.name }, { header: 'tax_number', value: (r) => r.party?.tax_number }, { header: 'net', value: (r) => r.net_total }, { header: 'vat', value: (r) => r.tax_total }])}>
      {data && (
        <div className="grid gap-4 px-5">
          <div className="sheet figure-band">
            <div><div className="muted text-[12px]">{t('ضريبة المخرجات', 'Output VAT')}</div><div className="figure">{money(data.output_tax)}</div></div>
            <div><div className="muted text-[12px]">{t('ضريبة المدخلات', 'Input VAT')}</div><div className="figure">{money(data.input_tax)}</div></div>
            <div><div className="muted text-[12px]">{toNumber(data.net_payable) >= 0 ? t('صافي المستحق للمصلحة', 'Net payable') : t('رصيد دائن (مُرحّل)', 'Credit carried forward')}</div><div className="figure" style={{ color: toNumber(data.net_payable) > 0 ? 'var(--red)' : 'var(--ledger)' }}>{money(Math.abs(toNumber(data.net_payable)))}</div></div>
          </div>
          <Sheet>
            <table className="ledger">
              <thead><tr><th>{t('البند', 'Line')}</th><th className="amount">{t('القيمة قبل الضريبة', 'Base')}</th><th className="amount">{t('الضريبة', 'VAT')}</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="amount"><Money value={r.sign * r.base} paren /></td><td className="amount"><Money value={r.sign * r.tax} paren /></td></tr>)}</tbody>
            </table>
          </Sheet>
          <Sheet title={t('المستندات', 'Documents')}>
            <table className="ledger">
              <thead><tr><th>{t('المستند', 'Document')}</th><th>{t('التاريخ', 'Date')}</th><th>{t('الطرف', 'Party')}</th><th>{t('رقم التسجيل', 'Tax no.')}</th><th className="amount">{t('القيمة', 'Base')}</th><th className="amount">{t('الضريبة', 'VAT')}</th></tr></thead>
              <tbody>{data.documents.map((d: any) => (
                <tr key={d.id} className="cursor-pointer" onDoubleClick={() => navigate(`/docs/${d.type}/${d.id}`)}>
                  <td>{docLabel(d.type)} <span className="num">{d.number}</span></td><td className="num">{date(d.date)}</td><td>{d.party?.name}</td><td className="num muted">{d.party?.tax_number}</td>
                  <td className="amount"><Money value={d.net_total} /></td><td className="amount"><Money value={d.tax_total} /></td>
                </tr>
              ))}</tbody>
            </table>
          </Sheet>
        </div>
      )}
    </Frame>
  )
}

// ─── Aging ─────────────────────────────────────────────────────────────
function Aging({ kind }: { kind: 'receivable' | 'payable' }) {
  const t = useT()
  const [asOf, setAsOf] = useState(today())
  const { data, isLoading, error } = useApi<any>(`/reports/aging/${kind}`, { as_of: asOf })
  const title = kind === 'receivable' ? t('أعمار ديون العملاء', 'Receivables aging') : t('أعمار ديون الموردين', 'Payables aging')
  const buckets: [string, string][] = [['current', t('غير مستحق', 'Not due')], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90_plus', t('أكثر من 90', '90+')]]
  return (
    <Frame title={title} subtitle={t('الفواتير المفتوحة حسب عدد الأيام بعد تاريخ الاستحقاق.', 'Open invoices by days past their due date.')} loading={isLoading} error={error}
      controls={<Field label={t('في تاريخ', 'As of')}><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>}
      onPrint={() => print(title, date(asOf), data.rows, [{ header: kind === 'receivable' ? t('العميل', 'Customer') : t('المورد', 'Supplier'), value: (r) => nameOf(r.party) }, ...buckets.map(([k, l]) => ({ header: l, value: (r: any) => money(r[k], { blankZero: true }), align: 'end' as const })), { header: t('الإجمالي', 'Total'), value: (r) => money(r.outstanding), align: 'end' }], [t('الإجمالي', 'Total'), ...buckets.map(([k]) => money(data.totals[k])), money(data.totals.outstanding)])}
      onExport={() => csv(`aging-${kind}`, data.rows, [{ header: 'code', value: (r) => r.party?.code }, { header: 'name', value: (r) => r.party?.name }, { header: 'phone', value: (r) => r.party?.mobile ?? r.party?.phone }, ...buckets.map(([k]) => ({ header: k, value: (r: any) => r[k] })), { header: 'outstanding', value: (r) => r.outstanding }, { header: 'balance', value: (r) => r.balance }])}>
      {data && (
        <div className="grid gap-4 px-5">
          <div className="sheet figure-band">
            {buckets.map(([k, l]) => <div key={k}><div className="muted text-[12px]">{l}</div><div className="figure" style={{ color: k === 'd90_plus' && toNumber(data.totals[k]) > 0 ? 'var(--red)' : undefined }}>{money(data.totals[k])}</div></div>)}
            <div><div className="muted text-[12px]">{t('الإجمالي', 'Total')}</div><div className="figure">{money(data.totals.outstanding)}</div></div>
          </div>
          <div className="sheet overflow-x-auto">
            <table className="ledger">
              <thead><tr><th>{kind === 'receivable' ? t('العميل', 'Customer') : t('المورد', 'Supplier')}</th><th>{t('الهاتف', 'Phone')}</th>{buckets.map(([k, l]) => <th key={k} className="amount">{l}</th>)}<th className="amount">{t('إجمالي المفتوح', 'Open total')}</th><th className="amount">{t('رصيد الحساب', 'Account balance')}</th></tr></thead>
              <tbody>{data.rows.map((r: any) => (
                <tr key={r.party?.id} className="cursor-pointer" onDoubleClick={() => navigate(`/parties/view/${r.party.id}`)}>
                  <td><span className="num muted">{r.party?.code}</span> {nameOf(r.party)}{r.party?.credit_limit && toNumber(r.balance) > toNumber(r.party.credit_limit) ? <span className="neg ms-2 text-[11px]">{t('تجاوز الحد', 'Over limit')}</span> : null}</td>
                  <td className="num muted" dir="ltr">{r.party?.mobile ?? r.party?.phone}</td>
                  {buckets.map(([k]) => <td key={k} className={`amount num ${k === 'd90_plus' && toNumber(r[k]) > 0 ? 'neg' : ''}`}>{money(r[k], { blankZero: true })}</td>)}
                  <td className="amount font-semibold"><Money value={r.outstanding} /></td>
                  <td className="amount" title={toNumber(r.unallocated) ? t('الفرق = أرصدة افتتاحية أو دفعات غير موزعة', 'Difference = opening balances or unallocated payments') : undefined}><Money value={r.balance} paren /></td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="total-row"><td colSpan={2}>{t('الإجمالي', 'Total')}</td>{buckets.map(([k]) => <td key={k} className="amount"><Money value={data.totals[k]} /></td>)}<td className="amount"><Money value={data.totals.outstanding} /></td><td /></tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </Frame>
  )
}
