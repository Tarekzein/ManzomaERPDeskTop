import { localizeMessage } from '@shared/localizeMessage'
import { DOMAIN_FORM_WIDGETS } from './DomainFormWidgets'
import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus, Save } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { useT } from '@/store/prefs'
import { Button, Check, ErrorBox, Field, Input, PageHeader, Select, Sheet, Textarea } from '@/components/ui'
import { DynamicForm, type DynamicField, type FormLayout } from './DynamicForm'

interface FormEntry { label_ar?: string; label_en?: string; core_field_count?: number; form_key: string; entity_type: string; version: number; core_fields: DynamicField[] }
interface Draft { id: number; version: number; layout_json: FormLayout }
const TYPES = ['text', 'long_text', 'number', 'decimal', 'date', 'dropdown', 'multi_select', 'checkbox', 'file', 'image', 'phone', 'email']

export default function FormStudio() {
  const t = useT()
  const { data, error } = useApi<{ data: FormEntry[] }>('/admin/forms')
  const [selected, setSelected] = useState('customers')
  const entry = data?.data.find((form) => form.form_key === selected)
  return <div className="grid gap-4 p-5">
    <PageHeader title={t('مصمم النماذج', 'Form Studio')} subtitle={t('حقول إضافية وتخطيطات لكل شركة. قواعد الترحيل والأمان محمية.', 'Company-specific fields and layouts. Posting and security rules remain protected.')} />
    {error && <ErrorBox error={error} />}
    <Field label={t('النموذج', 'Form')}><Select value={selected} onChange={(event) => setSelected(event.target.value)} options={(data?.data ?? []).map((form) => ({ value: form.form_key, label: `${t(form.label_ar ?? form.form_key, form.label_en ?? form.form_key)} · v${form.version}` }))} /></Field>
    {entry && <StudioEditor key={entry.form_key} entry={entry} />}
  </div>
}

function StudioEditor({ entry }: { entry: FormEntry }) {
  const t = useT()
  const { data, refetch } = useApi<{ data: DynamicField[] }>(`/admin/custom-fields/${entry.entity_type}`)
  const { data: roles } = useApi<{ data: { name: string; label?: string; label_en?: string }[] }>('/roles')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [layout, setLayout] = useState<FormLayout>({ sections: [] })
  const [preview, setPreview] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [dragged, setDragged] = useState<{ section: number; field: string } | null>(null)
  const blank = { key: '', type: 'text', label_ar: '', label_en: '', required: false, active: true, allForms: false, maxLength: '', options: '', defaultText: '', min: '', max: '', read: [] as string[], write: [] as string[], conditionField: '', conditionOperator: 'equals', conditionValue: '', flags: { list: false, filter: false, search: false, report: false, print: false } }
  const [field, setField] = useState(blank)
  const [editingId, setEditingId] = useState<number | null>(null)
  const set = (patch: Partial<typeof blank>) => setField((old) => ({ ...old, ...patch }))
  const fields = (data?.data ?? []).filter((f) => { const item = f as DynamicField & { active?: boolean; applicable_forms_json?: string[] }; return item.active !== false && (!item.applicable_forms_json?.length || item.applicable_forms_json.includes(entry.form_key)) })
  const layoutFields = [...(entry.core_fields ?? []), ...fields]
  const conditionFields = layoutFields.filter((f) => f.conditionable !== false)
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation() } catch (failure) { setError(failure) } finally { setBusy(false) }
  }
  const openDraft = async () => {
    const result = await api.post(`/admin/forms/${entry.form_key}/draft`)
    setDraft(result.data); setLayout(result.data.layout_json)
  }
  const move = (section: number, key: string, direction: number) => setLayout((old) => ({ ...old, sections: old.sections.map((s, index) => {
    if (index !== section) return s
    const next = [...s.fields]; const at = next.indexOf(key); const target = at + direction
    if (target < 0 || target >= next.length) return s
    ;[next[at], next[target]] = [next[target], next[at]]
    return { ...s, fields: next }
  }) }))
  return <div className="grid gap-4">
    {error ? <ErrorBox error={error} /> : null}
    <p className="muted text-[13px]">{entry.core_fields?.length ? t('يمكن ترتيب الحقول الأساسية والحقول الإضافية معاً. تبقى جداول البنود وقواعد الحساب والأمان محمية.', 'Arrange primary and custom fields together. Line grids, calculations and security rules remain protected.') : t('الحقول الإضافية قابلة للتخصيص هنا؛ المدخلات الأساسية لهذا النموذج ما زالت ضمن المحرر المتخصص.', 'Customize additional fields here; this form keeps its primary controls in the specialized editor.')}</p>
    <Sheet title={t('إضافة حقل', 'Add field')} bodyClassName="grid gap-3 p-4">
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('المفتاح الثابت', 'Immutable key')}><Input disabled={editingId !== null} value={field.key} onChange={(event) => set({ key: event.target.value })} dir="ltr" placeholder="water_source" /></Field>
        <Field label={t('الاسم بالعربية', 'Arabic label')}><Input value={field.label_ar} onChange={(event) => set({ label_ar: event.target.value })} /></Field>
        <Field label={t('الاسم بالإنجليزية', 'English label')}><Input value={field.label_en} onChange={(event) => set({ label_en: event.target.value })} /></Field>
        <Field label={t('النوع', 'Type')}><Select disabled={editingId !== null} value={field.type} onChange={(event) => set({ type: event.target.value })} options={TYPES.map((type) => ({ value: type, label: localizeMessage(type, t('ar', 'en')) }))} /></Field>
        <Field label={t('القيمة الافتراضية', 'Default value')}><Input value={field.defaultText} onChange={(event) => set({ defaultText: event.target.value })} /></Field>
        <Check label={t('مطلوب', 'Required')} checked={field.required} onChange={(required) => set({ required })} />
        <Check label={t('لكل نماذج نفس الكيان', 'Apply to all forms of this entity')} checked={field.allForms} onChange={(allForms) => set({ allForms })} />
        {['text', 'long_text', 'phone'].includes(field.type) && <Field label={t('أقصى عدد أحرف', 'Maximum length')}><Input type="number" value={field.maxLength} onChange={(event) => set({ maxLength: event.target.value })} /></Field>}
        {['number', 'decimal'].includes(field.type) && <><Field label={t('أقل قيمة', 'Minimum')}><Input type="number" value={field.min} onChange={(event) => set({ min: event.target.value })} /></Field><Field label={t('أكبر قيمة', 'Maximum')}><Input type="number" value={field.max} onChange={(event) => set({ max: event.target.value })} /></Field></>}
      </div>
      {['dropdown', 'multi_select'].includes(field.type) && <Field label={t('الخيارات: قيمة | عربي | English، كل خيار بسطر', 'Options: value | Arabic | English, one per line')}><Textarea value={field.options} onChange={(event) => set({ options: event.target.value })} dir="ltr" /></Field>}
      <div className="flex flex-wrap gap-3">{Object.entries(field.flags).map(([flag, checked]) => <Check key={flag} label={t(...({ list: ['قوائم العرض', 'Lists'], filter: ['التصفية', 'Filters'], search: ['البحث', 'Search'], report: ['التقارير', 'Reports'], print: ['الطباعة', 'Printing'] } as Record<string, [string, string]>)[flag])} checked={checked} onChange={(value) => set({ flags: { ...field.flags, [flag]: value } })} />)}</div>
      <div className="grid grid-cols-2 gap-3">{(['read', 'write'] as const).map((access) => <fieldset key={access} className="rounded border p-3"><legend>{access === 'read' ? t('أدوار العرض (فارغ = الجميع)', 'Read roles (empty = all)') : t('أدوار التعديل (فارغ = الجميع)', 'Write roles (empty = all)')}</legend>
        <div className="flex flex-wrap gap-3">{roles?.data.map((role) => <Check key={role.name} label={t(role.label ?? role.name, role.label_en ?? role.name)} checked={field[access].includes(role.name)} onChange={(checked) => set({ [access]: checked ? [...field[access], role.name] : field[access].filter((name) => name !== role.name) })} />)}</div>
      </fieldset>)}</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('إظهار مشروط بالحقل', 'Show when field')}><Select value={field.conditionField} onChange={(event) => set({ conditionField: event.target.value })} placeholder="—" options={conditionFields.map((f) => ({ value: f.key, label: t(f.label_ar, f.label_en) }))} /></Field>
        <Field label={t('الشرط', 'Condition')}><Select value={field.conditionOperator} onChange={(event) => set({ conditionOperator: event.target.value })} options={['equals', 'not_equals', 'not_empty'].map((value) => ({ value, label: localizeMessage(value, t('ar', 'en')) }))} /></Field>
        <Field label={t('القيمة', 'Value')}><Input value={field.conditionValue} onChange={(event) => set({ conditionValue: event.target.value })} /></Field>
      </div>
      <Button icon={Plus} loading={busy} disabled={!field.key || !field.label_ar || !field.label_en} onClick={() => void run(async () => {
        let defaultValue: unknown = field.defaultText || null
        if (field.defaultText && ['number', 'decimal'].includes(field.type)) defaultValue = Number(field.defaultText)
        if (field.type === 'checkbox') defaultValue = field.defaultText === 'true'
        if (field.type === 'multi_select' && field.defaultText) defaultValue = field.defaultText.split(',').map((value) => value.trim())
        const options = field.options.split('\n').filter((line) => line.trim()).map((line) => { const [value, ar, en] = line.split('|').map((value) => value.trim()); return { value, label_ar: ar || value, label_en: en || value } })
        const payload = { key: field.key, type: field.type, label_ar: field.label_ar, label_en: field.label_en, required: field.required, default_json: defaultValue,
          applicable_forms_json: field.allForms ? [] : [entry.form_key],
          validation_json: { ...(field.maxLength !== '' ? { max_length: Number(field.maxLength) } : {}), ...(field.min !== '' ? { min: Number(field.min) } : {}), ...(field.max !== '' ? { max: Number(field.max) } : {}) }, options_json: options,
          role_access_json: { read: field.read, write: field.write }, usage_flags_json: field.flags,
          condition_json: field.conditionField ? { field: field.conditionField, operator: field.conditionOperator, value: conditionFields.find((f) => f.key === field.conditionField)?.type === 'checkbox' ? field.conditionValue === 'true' : ['number', 'decimal'].includes(conditionFields.find((f) => f.key === field.conditionField)?.type ?? '') ? Number(field.conditionValue) : field.conditionValue } : null, active: field.active }
        if (editingId) await api.put(`/admin/custom-fields/${entry.entity_type}/${editingId}`, payload)
        else await api.post(`/admin/custom-fields/${entry.entity_type}`, payload)
        setField(blank); setEditingId(null); await refetch(); toast.success(t('تمت إضافة الحقل. انشر التخطيط لتفعيله.', 'Field added. Publish the layout to activate it.'))
      })}>{editingId ? t('تحديث الحقل', 'Update field') : t('إضافة الحقل', 'Add field')}</Button>
      {editingId && <><Check label={t('نشط', 'Active')} checked={field.active} onChange={(active) => set({ active })} /><Button onClick={() => { setEditingId(null); setField(blank) }}>{t('إلغاء التعديل', 'Cancel edit')}</Button></>}
    </Sheet>
    <Sheet title={t('الحقول الحالية', 'Existing fields')} bodyClassName="grid gap-2 p-3">{(data?.data ?? []).map((existing) => <div key={existing.id} className="flex items-center justify-between gap-3"><span>{existing.key} · {t(existing.label_ar, existing.label_en)}</span><Button size="sm" onClick={() => {
      const item = existing as DynamicField & { active?: boolean; validation_json?: { min?: number; max?: number; max_length?: number }; applicable_forms_json?: string[]; role_access_json?: { read?: string[]; write?: string[] } }
      setEditingId(item.id ?? null)
      setField({ ...blank, key: item.key, type: item.type, label_ar: item.label_ar, label_en: item.label_en, required: Boolean(item.required), active: item.active !== false, allForms: !item.applicable_forms_json?.length, maxLength: item.validation_json?.max_length == null ? '' : String(item.validation_json.max_length),
        defaultText: item.default_json == null ? '' : Array.isArray(item.default_json) ? item.default_json.join(',') : String(item.default_json),
        options: (item.options_json ?? []).map((option) => `${option.value} | ${option.label_ar} | ${option.label_en}`).join('\n'),
        min: item.validation_json?.min == null ? '' : String(item.validation_json.min), max: item.validation_json?.max == null ? '' : String(item.validation_json.max),
        read: item.role_access_json?.read ?? [], write: item.role_access_json?.write ?? [], flags: { ...blank.flags, ...item.usage_flags_json },
        conditionField: item.condition_json?.field ?? '', conditionOperator: item.condition_json?.operator ?? 'equals', conditionValue: String(item.condition_json?.value ?? '') })
    }}>{t('تعديل / أرشفة', 'Edit / archive')}</Button></div>)}</Sheet>
    <FieldSummary formKey={entry.form_key} fields={fields} />
    <Sheet title={t('تخطيط النموذج', 'Form layout')} actions={<Button loading={busy} onClick={() => void run(openDraft)}>{t('فتح مسودة', 'Open draft')}</Button>} bodyClassName="grid gap-4 p-4">
      {draft && <>
        {layout.sections.map((section, index) => <section key={section.key} className="grid gap-2 rounded border p-3">
          <div className="grid grid-cols-4 gap-2">
            <Input aria-label={t('اسم القسم بالعربية', 'Arabic section name')} value={section.label_ar} onChange={(event) => setLayout({ ...layout, sections: layout.sections.map((s, i) => i === index ? { ...s, label_ar: event.target.value } : s) })} />
            <Input aria-label={t('اسم القسم بالإنجليزية', 'English section name')} value={section.label_en} onChange={(event) => setLayout({ ...layout, sections: layout.sections.map((s, i) => i === index ? { ...s, label_en: event.target.value } : s) })} />
            <Input aria-label={t('التبويب', 'Tab')} placeholder={t('التبويب', 'Tab')} value={section.tab ?? ''} onChange={(event) => setLayout({ ...layout, sections: layout.sections.map((s, i) => i === index ? { ...s, tab: event.target.value } : s) })} />
            <Select aria-label={t('عدد الأعمدة', 'Columns')} value={section.columns} options={[1, 2, 3, 4].map((value) => ({ value, label: String(value) }))} onChange={(event) => setLayout({ ...layout, sections: layout.sections.map((s, i) => i === index ? { ...s, columns: Number(event.target.value) } : s) })} />
          </div>
          {section.fields.map((key) => <div key={key} draggable onDragStart={() => setDragged({ section: index, field: key })} onDragOver={(event) => event.preventDefault()} onDrop={() => {
            if (!dragged || dragged.field === key) return
            setLayout((old) => ({ ...old, sections: old.sections.map((s, i) => {
              const next = s.fields.filter((f) => f !== dragged.field)
              if (i === index) next.splice(Math.max(0, next.indexOf(key)), 0, dragged.field)
              return { ...s, fields: next }
            }) })); setDragged(null)
          }} className="flex items-center gap-2 rounded p-2" style={{ background: 'var(--sheet-2)' }}>
            <span className="flex-1">{t(layoutFields.find((f) => f.key === key)?.label_ar ?? key, layoutFields.find((f) => f.key === key)?.label_en ?? key)} <small className="muted">{key}</small></span><Button icon={ArrowUp} size="sm" aria-label={t('لأعلى', 'Move up')} onClick={() => move(index, key, -1)} /><Button icon={ArrowDown} size="sm" aria-label={t('لأسفل', 'Move down')} onClick={() => move(index, key, 1)} />
            <Select aria-label={t("نقل إلى قسم", "Move to section")} value="" placeholder={t("نقل إلى قسم", "Move to section")} options={layout.sections.filter((s) => s.key !== section.key).map((s) => ({ value: s.key, label: t(s.label_ar, s.label_en) }))} onChange={(event) => { const target = event.target.value; if (target) setLayout((old) => ({ ...old, sections: old.sections.map((s) => ({ ...s, fields: s.key === target ? [...s.fields, key] : s.fields.filter((f) => f !== key) })) })) }} />
            <Button size="sm" disabled={Boolean(layoutFields.find((f) => f.key === key)?.protected || layoutFields.find((f) => f.key === key)?.required)} onClick={() => setLayout({ ...layout, sections: layout.sections.map((s, i) => i === index ? { ...s, fields: s.fields.filter((f) => f !== key) } : s) })}>{t('إخفاء', 'Hide')}</Button>
          </div>)}
          <Select value="" placeholder={t('إضافة حقل للقسم', 'Add field to section')} options={layoutFields.filter((f) => !layout.sections.some((s) => s.fields.includes(f.key))).map((f) => ({ value: f.key, label: t(f.label_ar, f.label_en) }))} onChange={(event) => { if (event.target.value) setLayout({ ...layout, sections: layout.sections.map((s, i) => i === index ? { ...s, fields: [...s.fields, event.target.value] } : s) }) }} />
        </section>)}
        <div className="flex gap-2"><Button icon={Plus} onClick={() => setLayout({ ...layout, sections: [...layout.sections, { key: crypto.randomUUID(), label_ar: 'قسم جديد', label_en: 'New section', columns: 2, fields: [] }] })}>{t('قسم', 'Section')}</Button>
          <Button icon={Save} variant="primary" loading={busy} onClick={() => void run(async () => {
            await api.put(`/admin/forms/${entry.form_key}/draft`, { layout: { ...layout, engine_version: 2 } }); await api.post(`/admin/forms/${entry.form_key}/publish`)
            invalidate('/forms', '/admin/forms'); setDraft(null); toast.success(t('تم نشر النموذج', 'Form published'))
          })}>{t('حفظ ونشر', 'Save and publish')}</Button></div>
        <DynamicForm formKey={entry.form_key} value={preview} onChange={setPreview} schema={{ form_key: entry.form_key, entity_type: entry.entity_type, version: draft.version, fields: layoutFields, layout }} widgets={DOMAIN_FORM_WIDGETS} />
      </>}
    </Sheet>
  </div>
}

function FieldSummary({ formKey, fields }: { formKey: string; fields: DynamicField[] }) {
  const t = useT()
  const [field, setField] = useState('')
  const [page, setPage] = useState(1)
  const report = useApi<any>(field ? `/reports/custom-fields/${formKey}` : null, { field, page })
  return <Sheet title={t('تقرير الحقول الإضافية', 'Custom-field summary')} bodyClassName="grid gap-3 p-4">
    <Select value={field} placeholder="—" options={fields.filter((item) => item.usage_flags_json?.report).map((item) => ({ value: item.key, label: t(item.label_ar, item.label_en) }))} onChange={(event) => { setField(event.target.value); setPage(1) }} />
    {report.error ? <ErrorBox error={report.error} /> : null}
    {report.data && <><p>{t('إجمالي القيم', 'Total values')}: {report.data.total_values}</p><table className="ledger"><thead><tr><th>{t('القيمة', 'Value')}</th><th>{t('السجلات', 'Records')}</th></tr></thead><tbody>{report.data.rows.data.map((row: any) => <tr key={String(row.value)}><td>{String(row.value)}</td><td>{row.records}</td></tr>)}</tbody></table>
      <div className="flex gap-3"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</Button><Button disabled={page >= report.data.rows.last_page} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</Button></div></>}
  </Sheet>
}
