/**
 * Amount in words for printed invoices and vouchers (التفقيط).
 * Arabic follows common Egyptian commercial usage: "فقط … جنيه مصري … لا غير".
 */
const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']
const scales = [
  { one: 'ألف', two: 'ألفان', few: 'آلاف', many: 'ألف' },
  { one: 'مليون', two: 'مليونان', few: 'ملايين', many: 'مليون' },
  { one: 'مليار', two: 'ملياران', few: 'مليارات', many: 'مليار' },
]

function below1000(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(hundreds[h])
  if (r) {
    if (r < 20) parts.push(ones[r])
    else {
      const o = r % 10
      const t = Math.floor(r / 10)
      parts.push(o ? `${ones[o]} و${tens[t]}` : tens[t])
    }
  }
  return parts.join(' و')
}

export function arabicNumber(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'صفر'
  const groups: number[] = []
  while (n > 0) {
    groups.push(n % 1000)
    n = Math.floor(n / 1000)
  }
  const parts: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (!g) continue
    if (i === 0) {
      parts.push(below1000(g))
      continue
    }
    const s = scales[i - 1]
    if (g === 1) parts.push(s.one)
    else if (g === 2) parts.push(s.two)
    else if (g <= 10) parts.push(`${below1000(g)} ${s.few}`)
    else parts.push(`${below1000(g)} ${s.many}`)
  }
  return parts.join(' و')
}

const currencies: Record<string, { ar: [string, string]; en: [string, string] }> = {
  EGP: { ar: ['جنيه مصري', 'قرش'], en: ['Egyptian pounds', 'piastres'] },
  SAR: { ar: ['ريال سعودي', 'هللة'], en: ['Saudi riyals', 'halalas'] },
  AED: { ar: ['درهم إماراتي', 'فلس'], en: ['UAE dirhams', 'fils'] },
  USD: { ar: ['دولار أمريكي', 'سنت'], en: ['US dollars', 'cents'] },
  EUR: { ar: ['يورو', 'سنت'], en: ['euros', 'cents'] },
}

export function amountInArabic(amount: number, currency = 'EGP'): string {
  const c = currencies[currency] ?? { ar: [currency, ''], en: [currency, ''] }
  const whole = Math.floor(Math.abs(amount))
  const fraction = Math.round((Math.abs(amount) - whole) * 100)
  let text = `فقط ${arabicNumber(whole)} ${c.ar[0]}`
  if (fraction > 0) text += ` و${arabicNumber(fraction)} ${c.ar[1]}`
  return `${text} لا غير`
}

const enOnes = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const enTens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function enBelow1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  const parts: string[] = []
  if (h) parts.push(`${enOnes[h]} hundred`)
  if (r) parts.push(r < 20 ? enOnes[r] : `${enTens[Math.floor(r / 10)]}${r % 10 ? '-' + enOnes[r % 10] : ''}`)
  return parts.join(' and ')
}

export function englishNumber(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'zero'
  const names = ['', ' thousand', ' million', ' billion']
  const parts: string[] = []
  let i = 0
  while (n > 0) {
    const g = n % 1000
    if (g) parts.unshift(enBelow1000(g) + names[i])
    n = Math.floor(n / 1000)
    i++
  }
  return parts.join(', ')
}

export function amountInEnglish(amount: number, currency = 'EGP'): string {
  const c = currencies[currency] ?? { ar: [currency, ''], en: [currency, ''] }
  const whole = Math.floor(Math.abs(amount))
  const fraction = Math.round((Math.abs(amount) - whole) * 100)
  const text = `${englishNumber(whole)} ${c.en[0]}${fraction ? ` and ${englishNumber(fraction)} ${c.en[1]}` : ''} only`
  return text.charAt(0).toUpperCase() + text.slice(1)
}
