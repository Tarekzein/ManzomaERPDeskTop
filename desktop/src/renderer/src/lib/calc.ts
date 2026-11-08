import { round2, toNumber } from './format'

export interface CalcLine {
  quantity: number
  unit_price: number
  discount_percent?: number
  discount_amount?: number
  tax_rate?: number
  fixed?: { gross: number; net: number; tax: number }
}

export interface CalcHeader {
  price_includes_tax?: boolean
  invoice_discount_percent?: number
  invoice_discount_amount?: number
  wht_rate?: number
  wht_threshold?: number
}

/**
 * Same arithmetic as the backend DocumentCalculator so the totals on screen
 * match what will be posted. The server recalculates on save.
 */
export function calculate(header: CalcHeader, lines: CalcLine[]) {
  const inclusive = Boolean(header.price_includes_tax)
  const prepared = lines.map((l) => {
    const rate = toNumber(l.tax_rate) / 100
    if (l.fixed) return { rate, after: toNumber(l.fixed.net), grossEntered: 0, fixed: l.fixed }
    const gross = toNumber(l.quantity) * toNumber(l.unit_price)
    let disc = toNumber(l.discount_amount) > 0 ? toNumber(l.discount_amount) : (gross * toNumber(l.discount_percent)) / 100
    disc = Math.min(Math.max(disc, 0), gross)
    return { rate, after: round2(gross - disc), grossEntered: round2(gross), fixed: undefined as CalcLine['fixed'] }
  })
  const sumAfter = round2(prepared.reduce((s, p) => s + p.after, 0))
  let invoiceDiscount = 0
  if (toNumber(header.invoice_discount_percent) > 0) invoiceDiscount = (sumAfter * toNumber(header.invoice_discount_percent)) / 100
  else if (toNumber(header.invoice_discount_amount) > 0) invoiceDiscount = toNumber(header.invoice_discount_amount)
  invoiceDiscount = round2(Math.min(Math.max(invoiceDiscount, 0), sumAfter))

  const allocatable = prepared.map((p, i) => ({ p, i })).filter(({ p }) => !p.fixed && p.after > 0)
  const base = allocatable.reduce((s, { p }) => s + p.after, 0)
  const alloc: Record<number, number> = {}
  let used = 0
  allocatable.forEach(({ p, i }, n) => {
    if (n === allocatable.length - 1) alloc[i] = round2(invoiceDiscount - used)
    else {
      alloc[i] = base > 0 ? round2((invoiceDiscount * p.after) / base) : 0
      used = round2(used + alloc[i])
    }
  })

  const out = prepared.map((p, i) => {
    let gross: number, net: number, tax: number
    if (p.fixed) {
      gross = round2(p.fixed.gross)
      net = round2(p.fixed.net)
      tax = round2(p.fixed.tax)
    } else if (inclusive) {
      const netIncl = round2(p.after - (alloc[i] ?? 0))
      net = round2(netIncl / (1 + p.rate))
      tax = round2(netIncl - net)
      gross = Math.max(round2(p.grossEntered / (1 + p.rate)), net)
    } else {
      gross = p.grossEntered
      net = round2(p.after - (alloc[i] ?? 0))
      tax = round2(net * p.rate)
    }
    return { gross, discount: round2(gross - net), net, tax, total: round2(net + tax) }
  })
  const sum = (k: keyof (typeof out)[number]) => round2(out.reduce((s, l) => s + l[k], 0))
  const totals = { gross: sum('gross'), discount: sum('discount'), net: sum('net'), tax: sum('tax'), total: sum('total') }
  const whtRate = toNumber(header.wht_rate)
  const wht = whtRate > 0 && totals.net >= toNumber(header.wht_threshold) ? round2((totals.net * whtRate) / 100) : 0
  return { lines: out, totals: { ...totals, wht, balanceDue: round2(totals.total - wht) } }
}
