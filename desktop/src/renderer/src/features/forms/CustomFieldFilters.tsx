import { useT } from '@/store/prefs'
import type { DynamicField } from './DynamicForm'

export function CustomFieldFilters({ fields, value, onChange }: { fields: DynamicField[]; value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  const t = useT()
  return <>{fields.filter((field) => field.usage_flags_json?.filter).map((field) => <label key={field.key} className="text-[12px]"><span>{t(field.label_ar, field.label_en)}</span>
    {['checkbox', 'dropdown', 'multi_select'].includes(field.type) ? <select className="input w-[160px]" value={value[field.key] ?? ''} onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}><option value="">—</option>{field.type === 'checkbox' ? <><option value="1">{t('نعم', 'Yes')}</option><option value="0">{t('لا', 'No')}</option></> : field.options_json?.map((option) => <option key={option.value} value={option.value}>{t(option.label_ar, option.label_en)}</option>)}</select>
      : <input className="input w-[160px]" type={field.type === 'date' ? 'date' : ['number', 'decimal'].includes(field.type) ? 'number' : 'text'} step={field.type === 'decimal' ? 'any' : undefined} value={value[field.key] ?? ''} onChange={(event) => onChange({ ...value, [field.key]: event.target.value })} />}
  </label>)}</>
}
