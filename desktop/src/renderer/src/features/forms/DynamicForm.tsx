import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/query'
import { usePrefs, useT } from '@/store/prefs'
import { Button, Check, ErrorBox, Field, Input, Select, Spinner, Textarea } from '@/components/ui'

export type FormValues = Record<string, unknown>
export interface DynamicField {
  id?: number
  property?: string
  source?: 'core'
  widget?: string
  protected?: boolean
  conditionable?: boolean
  create_only?: boolean
  lock_on_edit?: boolean
  lock_if?: string
  disable_when?: DynamicField['condition_json']
  direction?: 'ltr' | 'rtl'
  party_role?: 'customer' | 'supplier'
  value_type?: 'number'
  key: string
  type: string
  label_ar: string
  label_en: string
  required?: boolean
  writable?: boolean
  default_json?: unknown
  options_json?: { value: string | number; label_ar: string; label_en: string }[]
  condition_json?: { field: string; operator: string; value?: unknown } | null
  usage_flags_json?: Record<string, boolean>
}
export interface FormLayout { engine_version?: number; core_version?: number; sections: { key: string; label_ar: string; label_en: string; columns: number; tab?: string; fields: string[] }[] }
export interface FormSchema { form_key: string; entity_type: string; version: number; core_fields?: DynamicField[]; fields: DynamicField[]; layout: FormLayout }
interface RecordMetadata { id?: number; custom_fields?: FormValues; lock_version?: number; updated_at?: string }

export function visible(field: DynamicField, values: FormValues): boolean {
  const rule = field.condition_json
  if (!rule) return true
  const value = values[rule.field] ?? null
  const equals = (option: unknown) => typeof option === 'number' && (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) ? Number(value) === option : value === option
  if (rule.operator === 'equals') return equals(rule.value)
  if (rule.operator === 'not_equals') return !equals(rule.value)
  if (rule.operator === 'in') return Array.isArray(rule.value) && rule.value.some(equals)
  return rule.operator === 'not_empty' && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
}

/** A single field/layout renderer shared by existing and new record editors. */
export interface FormWidgetProps { field: DynamicField; value: unknown; values: FormValues; onChange: (value: unknown) => void; disabled: boolean; recordId?: number; error?: string }
export type FormWidgets = Record<string, (props: FormWidgetProps) => ReactNode>
const NO_WIDGETS: FormWidgets = {}

export function DynamicForm({ formKey, recordId, value, onChange, onSubmit, schema: supplied, errors = {}, readOnly = false, children, widgets = NO_WIDGETS, primaryCoreFields }: {
  formKey: string; recordId?: number; value: FormValues; onChange: (values: FormValues) => void
  onSubmit?: () => void; schema?: FormSchema; errors?: Record<string, string[]>; readOnly?: boolean; children?: ReactNode; widgets?: FormWidgets; primaryCoreFields?: string[]
}) {
  const t = useT()
  const locale = usePrefs((s) => s.locale)
  const query = useApi<FormSchema>(supplied ? null : `/forms/${formKey}`)
  const schema = supplied ?? query.data
  const [tab, setTab] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const errorKey = JSON.stringify(errors)
  useEffect(() => {
    if (!schema || !Object.keys(errors).length) return
    const invalid = schema.layout.sections.find((section) => section.fields.some((key) => {
      const field = schema.fields.find((item) => item.key === key)
      return errors[key]?.length || errors[field?.property ?? '']?.length || errors[`custom_fields.${key}`]?.length
    }))
    if (invalid?.tab) setTab(invalid.tab)
    const frame = requestAnimationFrame(() => {
      const input = [...(root.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? [])].find((element) => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
      input?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [errorKey, schema?.version])
  if (!supplied && query.isLoading) return <Spinner />
  if (query.error) return <ErrorBox error={query.error} onRetry={() => void query.refetch()} />
  if (!schema) return null
  const fields = new Map(schema.fields.map((field) => [field.key, field]))
  const tabs = [...new Set(schema.layout.sections.map((s) => s.tab).filter((v): v is string => Boolean(v)))]
  const selected = tabs.includes(tab) ? tab : tabs[0]
  return <div ref={root} className="dynamic-form grid gap-4" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && onSubmit) { event.preventDefault(); onSubmit() }
  }}>
    {children}
    {tabs.length > 0 && <div role="tablist" className="flex gap-2">{tabs.map((key) => <Button key={key} role="tab" aria-selected={key === selected} onClick={() => setTab(key)}>{key}</Button>)}</div>}
    {schema.layout.sections.filter((section) => !section.tab || section.tab === selected).map((section) => {
      const shown = section.fields.map((key) => fields.get(key)).filter((field): field is DynamicField => Boolean(field && !(field.create_only && recordId) && visible(field, value)))
      if (!shown.length) return null
      const errorOf = (field: DynamicField) => errors[field.source === 'core' ? field.property ?? field.key : `custom_fields.${field.key}`]?.[0] ?? errors[field.key]?.[0]
      const primary = (field: DynamicField) => !primaryCoreFields || field.source !== 'core' || primaryCoreFields.includes(field.key) || field.required || Boolean(errorOf(field))
      const main = shown.filter(primary)
      const extra = shown.filter((field) => !primary(field))
      const columns = Math.max(1, Math.min(4, section.columns))
      const controls = (items: DynamicField[]) => <div className="dynamic-form-grid" data-columns={columns} style={{ '--form-columns': columns } as CSSProperties}>{items.map((field) => {
        const error = errorOf(field)
        const disabled = readOnly || field.writable === false || (field.disable_when ? visible({ ...field, condition_json: field.disable_when }, value) : false)
        const update = (next: unknown) => onChange({ ...value, [field.key]: next })
        const Widget = field.widget ? widgets[field.widget] : undefined
        return <div key={field.key}>{field.widget ? Widget ? <Widget field={field} value={value[field.key]} values={value} onChange={update} disabled={disabled} recordId={recordId} error={error} /> : <p role="alert">{t('عنصر غير متاح: ', 'Unavailable control: ')}{field.label_ar} / {field.label_en}</p> : <DynamicInput field={field} value={value[field.key]} disabled={disabled} formKey={formKey} recordId={recordId} error={error} onChange={update} />}</div>
      })}</div>
      if (!main.length) return <details key={section.key} className="form-optional-section">
        <summary>{locale === 'ar' ? section.label_ar : section.label_en}</summary>
        {controls(extra)}
      </details>
      return <fieldset key={section.key} className="form-fieldset">
        <legend>{locale === 'ar' ? section.label_ar : section.label_en}</legend>
        {main.length > 0 && controls(main)}
        {extra.length > 0 && <details className="form-more"><summary>{t('تفاصيل إضافية', 'More details')}</summary>{controls(extra)}</details>}
      </fieldset>
    })}
    {onSubmit && !readOnly && <Button variant="primary" onClick={onSubmit}>{t('حفظ', 'Save')}</Button>}
  </div>
}

function DynamicInput({ field, value, onChange, disabled, formKey, recordId, error }: {
  field: DynamicField; value: unknown; onChange: (value: unknown) => void; disabled?: boolean; formKey: string; recordId?: number; error?: string
}) {
  const t = useT()
  const id = useId()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const label = t(field.label_ar, field.label_en) + (field.required ? ' *' : '')
  const options = (field.options_json ?? []).map((option) => ({ value: option.value, label: t(option.label_ar, option.label_en) }))
  if (field.type === 'checkbox') return <div><Check label={label} checked={Boolean(value)} disabled={disabled} onChange={onChange} />{error && <small className="error">{error}</small>}</div>
  if (field.type === 'multi_select') return <fieldset className="field"><legend>{label}</legend>{options.map((option) => <Check key={option.value} label={option.label} disabled={disabled}
    checked={Array.isArray(value) && value.includes(option.value)} onChange={(checked) => onChange(checked ? [...(Array.isArray(value) ? value : []), option.value] : (Array.isArray(value) ? value : []).filter((v) => v !== option.value))} />)}{error && <small className="error">{error}</small>}</fieldset>
  if (field.type === 'file' || field.type === 'image') return <Field label={label} error={error || uploadError}>
    <Input type="file" disabled={disabled || uploading} accept={field.type === 'image' ? 'image/png,image/jpeg,image/webp' : '.png,.jpg,.jpeg,.webp,.pdf,.csv,.txt'} onChange={async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      setUploading(true); setUploadError('')
      try {
        const data = new FormData(); data.append('form_key', formKey); data.append('field_key', field.key); if (recordId) data.append('entity_id', String(recordId)); data.append('file', file)
        const result = await api.upload('/attachments', data); onChange(result.data.id)
      } catch (failure) { setUploadError(failure instanceof Error ? failure.message : String(failure)) }
      finally { setUploading(false) }
    }} />
    {value ? <Button size="sm" onClick={async () => {
      try {
        const blob = await api.download(`/attachments/${value}`); const url = URL.createObjectURL(blob)
        const link = document.createElement('a'); link.href = url; link.download = `attachment-${value}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (failure) { setUploadError(failure instanceof Error ? failure.message : String(failure)) }
    }}>{t('تنزيل المرفق', 'Download attachment')} #{String(value)}</Button> : null}
  </Field>
  return <Field label={label} error={error}>
    {field.type === 'long_text' ? <Textarea id={id} value={String(value ?? '')} disabled={disabled} required={field.required} onChange={(event) => onChange(event.target.value)} />
      : field.type === 'dropdown' ? <Select id={id} value={String(value ?? '')} disabled={disabled} required={field.required} options={options} placeholder="—" onChange={(event) => onChange(event.target.value === '' ? null : field.value_type === 'number' ? Number(event.target.value) : event.target.value)} />
        : <Input id={id} type={field.type === 'datetime' ? 'datetime-local' : field.type === 'color' ? 'color' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : ['number', 'decimal'].includes(field.type) ? 'number' : 'text'}
          step={field.type === 'decimal' ? 'any' : field.type === 'number' ? 1 : undefined} value={String(value ?? '')} disabled={disabled} required={field.required}
          dir={field.direction ?? (['number', 'decimal', 'date', 'email', 'phone'].includes(field.type) ? 'ltr' : undefined)}
          onChange={(event) => onChange(event.target.value === '' ? null : ['number', 'decimal'].includes(field.type) ? Number(event.target.value) : event.target.value)} />}
  </Field>
}

export function recordFormValues(core: FormValues, custom: FormValues): FormValues {
  return { ...custom, ...Object.fromEntries(Object.entries(core).map(([key, value]) => [`core.${key}`, value])) }
}

export function splitRecordValues(schema: FormSchema, value: FormValues, core: FormValues): { core: FormValues; custom: FormValues } {
  return { core: { ...core, ...Object.fromEntries((schema.core_fields ?? []).map((field) => [field.property ?? field.key, value[field.key]])) },
    custom: Object.fromEntries(schema.fields.filter((field) => Object.hasOwn(value, field.key)).map((field) => [field.key, value[field.key]])) }
}

export function writableCustomValues(schema: FormSchema, values: FormValues): FormValues {
  return Object.fromEntries(schema.fields.filter((field) => field.writable !== false && Object.hasOwn(values, field.key)).map((field) => [field.key, values[field.key]]))
}

export function withNewRecordDefaults(schema: FormSchema, values: FormValues): FormValues {
  const defaults = Object.fromEntries(schema.fields.filter((field) => field.default_json != null && !Object.hasOwn(values, field.key)).map((field) => [field.key, field.default_json]))
  return Object.keys(defaults).length ? { ...defaults, ...values } : values
}

export function savedLockVersion(current: number, saved?: RecordMetadata | null, recordId?: number): number {
  return saved && Number.isInteger(saved.lock_version) && saved.lock_version! >= current && (!recordId || saved.id === recordId) ? saved.lock_version! : current
}

/** Keep custom-field payloads local to an editor, never in a global current-form store. */
export function useDynamicFields(formKey: string, record?: RecordMetadata | null, enabled = true) {
  const t = useT()
  const schema = useApi<FormSchema>(enabled ? `/forms/${formKey}` : null)
  const [values, setValues] = useState<FormValues>(() => ({ ...record?.custom_fields }))
  const lockVersion = useRef(record?.lock_version ?? 0)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  // A background refetch must not erase a draft or advance its concurrency baseline.
  // Reset only when this editor switches records/forms; successful saves explicitly acknowledge their returned lock version.
  useEffect(() => {
    setValues({ ...record?.custom_fields }); lockVersion.current = record?.lock_version ?? 0; setErrors({})
  }, [record?.id, formKey])
  useEffect(() => {
    if (!record?.id && schema.data) setValues((current) => withNewRecordDefaults(schema.data!, current))
  }, [record?.id, schema.data, formKey])
  return {
    values, setValues, schema,
    acceptSaved: (saved?: RecordMetadata | null) => { lockVersion.current = savedLockVersion(lockVersion.current, saved, record?.id) },
    payload: () => {
      if (schema.error) throw schema.error
      if (!schema.data) throw new Error('Wait for the form definition to load.')
      return { form_key: formKey, custom_fields: writableCustomValues(schema.data, values), form_version: schema.data.version, lock_version: lockVersion.current }
    },
    renderRecord: (core: FormValues, changeCore: (values: FormValues) => void, widgets: FormWidgets = NO_WIDGETS, readOnly = false, primaryCoreFields?: string[]) => {
      if (!schema.data) return schema.error ? <ErrorBox error={schema.error} /> : <Spinner />
      const definition = schema.data
      if (!definition.core_fields?.length) return <ErrorBox error={new Error(t('حدّث الخادم لدعم هذا النموذج قبل الحفظ.', 'Update the server to support this form before saving.'))} />
      return <DynamicForm formKey={formKey} recordId={record?.id} value={recordFormValues(core, values)} onChange={(next) => { const split = splitRecordValues(definition, next, core); changeCore(split.core); setValues(split.custom) }} schema={{ ...definition, fields: [...(definition.core_fields ?? []).map((field) => ({ ...field, writable: field.writable !== false && !(field.lock_on_edit && record?.id) && !(field.lock_if && record && (record as Record<string, unknown>)[field.lock_if]) })), ...definition.fields] }} errors={errors} readOnly={readOnly} widgets={widgets} primaryCoreFields={primaryCoreFields} />
    },
    capture: (error: unknown, prefix = '') => { if (error instanceof ApiError) setErrors(prefix ? Object.fromEntries(Object.entries(error.errors ?? {}).filter(([key]) => key.startsWith(prefix + '.')).map(([key, messages]) => [key.slice(prefix.length + 1), messages])) : error.errors ?? {}) },
    render: (readOnly = false) => <DynamicForm formKey={formKey} recordId={record?.id} value={values} onChange={setValues} schema={schema.data} errors={errors} readOnly={readOnly} />,
  }
}
