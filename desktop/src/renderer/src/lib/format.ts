const moneyFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtyFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Accounting style: digits are Latin, negatives in parentheses when asked. */
export function money(value: unknown, opts: { paren?: boolean; blankZero?: boolean } = {}): string {
  const n = toNumber(value)
  if (opts.blankZero && Math.abs(n) < 0.005) return ''
  if (opts.paren && n < 0) return `(${moneyFormat.format(Math.abs(n))})`
  return moneyFormat.format(n)
}

export function qty(value: unknown): string {
  return qtyFormat.format(toNumber(value))
}

export function int(value: unknown): string {
  return intFormat.format(toNumber(value))
}

export function percent(value: unknown, digits = 1): string {
  if (value === null || value === undefined) return '—'
  return `${toNumber(value).toFixed(digits)}%`
}

export function date(value: unknown): string {
  if (!value) return ''
  const s = String(value).slice(0, 10)
  const [y, m, d] = s.split('-')
  return y && m && d ? `${d}/${m}/${y}` : s
}

export function datetime(value: unknown): string {
  if (!value) return ''
  const s = String(value).replace('T', ' ')
  return `${date(s.slice(0, 10))} ${s.slice(11, 16)}`
}

/** ERP date-only defaults follow the company's Cairo business day, including DST. */
export function today(instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Calendar arithmetic is independent of a workstation's timezone and DST transitions. */
export function addDays(iso: string, days: number): string {
  const value = new Date(`${iso}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function startOfMonth(): string {
  return today().slice(0, 8) + '01'
}

export function startOfYear(): string {
  return today().slice(0, 5) + '01-01'
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
