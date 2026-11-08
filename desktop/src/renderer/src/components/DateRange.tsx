import { addDays, startOfMonth, startOfYear, today } from '@/lib/format'
import { useT } from '@/store/prefs'

export interface Range {
  from: string
  to: string
}

export function lastMonth(): Range {
  const d = new Date()
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  const last = new Date(d.getFullYear(), d.getMonth(), 0)
  const iso = (x: Date) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  return { from: iso(first), to: iso(last) }
}

export function DateRange({ value, onChange, presets = true }: { value: Range; onChange: (r: Range) => void; presets?: boolean }) {
  const t = useT()
  const options: { key: string; label: string; range: () => Range }[] = [
    { key: 'today', label: t('اليوم', 'Today'), range: () => ({ from: today(), to: today() }) },
    { key: '7', label: t('7 أيام', '7 days'), range: () => ({ from: addDays(today(), -6), to: today() }) },
    { key: 'month', label: t('هذا الشهر', 'This month'), range: () => ({ from: startOfMonth(), to: today() }) },
    { key: 'last', label: t('الشهر الماضي', 'Last month'), range: lastMonth },
    { key: 'year', label: t('هذه السنة', 'This year'), range: () => ({ from: startOfYear(), to: today() }) },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" className="input w-[140px]" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label={t('من', 'From')} />
      <span className="muted">←</span>
      <input type="date" className="input w-[140px]" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label={t('إلى', 'To')} />
      {presets && (
        <select className="select w-auto" value="" onChange={(e) => { const o = options.find((x) => x.key === e.target.value); if (o) onChange(o.range()) }} aria-label={t('فترة سريعة', 'Quick range')}>
          <option value="">{t('فترة…', 'Period…')}</option>
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      )}
    </div>
  )
}
