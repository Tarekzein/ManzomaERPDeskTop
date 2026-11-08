import { today, addDays } from '../src/renderer/src/lib/format'
import { dateTimeInput, utcDateTime } from '../src/renderer/src/features/forms/dateTime'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DynamicForm, visible, recordFormValues, splitRecordValues, writableCustomValues, withNewRecordDefaults, savedLockVersion, type FormSchema } from '../src/renderer/src/features/forms/DynamicForm'

function render(schema: FormSchema, values: Record<string, unknown>, readOnly = false, errors: Record<string, string[]> = {}) {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DynamicForm formKey="customers" schema={schema} value={values} onChange={() => undefined} readOnly={readOnly} errors={errors} /></QueryClientProvider>)
}
const schema: FormSchema = {
  form_key: 'customers', entity_type: 'parties', version: 1,
  fields: [
    { key: 'source', type: 'dropdown', label_ar: 'المصدر', label_en: 'Source', options_json: [{ value: 'well', label_ar: 'بئر', label_en: 'Well' }, { value: 'tap', label_ar: 'حنفية', label_en: 'Tap' }] },
    { key: 'depth', type: 'decimal', label_ar: 'عمق البئر', label_en: 'Depth', required: true, condition_json: { field: 'source', operator: 'equals', value: 'well' } },
    { key: 'notes', type: 'long_text', label_ar: 'ملاحظات', label_en: 'Notes' },
  ],
  layout: { sections: [{ key: 'water', label_ar: 'المياه', label_en: 'Water', columns: 2, fields: ['source', 'depth', 'notes'] }] },
}

describe('Published form rendering', () => {
  it('renders only applicable controls and keeps conditional validation errors adjacent to the field', () => {
    const tap = render(schema, { source: 'tap' })
    expect(tap).toContain('المصدر'); expect(tap).not.toContain('عمق البئر')
    const well = render(schema, { source: 'well', depth: 12.5 }, false, { 'custom_fields.depth': ['Depth is required.'] })
    expect(well).toContain('عمق البئر *'); expect(well).toContain('value="12.5"'); expect(well).toContain('Depth is required.')
  })
  it('escapes administrator labels and customer text instead of evaluating markup', () => {
    const dangerous = structuredClone(schema); dangerous.fields[2].label_ar = '<script>alert(1)</script>'
    const html = render(dangerous, { source: 'tap', notes: '</textarea><img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x'); expect(html).toContain('&lt;script&gt;')
  })
  it('honors immutable record and field write restrictions', () => {
    const html = render(schema, { source: 'well', depth: 10 }, true)
    expect(html.match(/disabled=""/g)?.length).toBe(3)
    const restricted = structuredClone(schema); restricted.fields[2].writable = false
    expect(render(restricted, { source: 'tap' }).match(/disabled=""/g)?.length).toBe(1)
  })
})

describe('Core and custom record controls', () => {
  const recordSchema: FormSchema = {
    ...schema, core_fields: [
      { key: 'core.name', property: 'name', source: 'core', type: 'text', label_ar: 'الاسم', label_en: 'Name', required: true },
      { key: 'core.opening_balance', property: 'opening_balance', source: 'core', type: 'decimal', label_ar: 'رصيد افتتاحي', label_en: 'Opening balance', create_only: true },
    ],
    fields: [{ key: 'name', type: 'text', label_ar: 'اسم إضافي', label_en: 'Additional name' }],
    layout: { engine_version: 2, sections: [{ key: 'combined', label_ar: 'موحد', label_en: 'Combined', columns: 2, fields: ['name', 'core.name', 'core.opening_balance'] }] },
  }
  it('keeps identical custom and domain names in independent payloads and preserves relation data', () => {
    const core = { name: 'Household', contacts: [{ id: 7, name: 'Contact' }], opening_balance: 0 }
    const combined = recordFormValues(core, { name: 'Kitchen filter' })
    const changed = splitRecordValues(recordSchema, { ...combined, 'core.name': 'Updated household', name: 'Updated filter' }, core)
    expect(changed.core.name).toBe('Updated household')
    expect(changed.custom).toEqual({ name: 'Updated filter' })
    expect(changed.core.contacts).toEqual(core.contacts)
    expect(changed.core).not.toHaveProperty('core.name')
  })
  it('renders mixed layouts in published order and omits creation-only controls on edit', () => {
    const definition = { ...recordSchema, fields: [...recordSchema.core_fields!, ...recordSchema.fields] }
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DynamicForm formKey="customers" recordId={7} schema={definition} value={{ 'core.name': 'Household', name: 'Kitchen' }} onChange={() => undefined} /></QueryClientProvider>)
    expect(html.indexOf('اسم إضافي')).toBeLessThan(html.indexOf('الاسم'))
    expect(html).not.toContain('رصيد افتتاحي')
  })
  it('runs only the locally registered widget and fails visibly for an unknown widget', () => {
    const widgetSchema: FormSchema = { ...schema, fields: [{ key: 'contacts', widget: 'contacts', type: 'widget', label_ar: 'الجهات', label_en: 'Contacts' }], layout: { sections: [{ key: 'widgets', label_ar: 'البيانات', label_en: 'Details', columns: 1, fields: ['contacts'] }] } }
    const html = render(widgetSchema, {})
    expect(html).toContain('role="alert"'); expect(html).toContain('Contacts')
    const registered = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DynamicForm formKey="customers" schema={widgetSchema} value={{ contacts: ['A'] }} onChange={() => undefined} widgets={{ contacts: ({ value, disabled }) => <input aria-label="Registered contact" readOnly={disabled} value={String(value)} onChange={() => undefined} /> }} readOnly /></QueryClientProvider>)
    expect(registered).toContain('Registered contact'); expect(registered).toContain('readOnly=""'); expect(registered).not.toContain('role="alert"')
  })
})

describe('Operator date/time entry', () => {
  it('round-trips UTC timestamps through a local datetime control without shifting the stored instant', () => {
    for (const instant of ['2026-01-31T10:00:00.000Z', '2026-10-25T20:10:00.000Z']) expect(utcDateTime(dateTimeInput(instant))).toBe(instant)
  })
  it('rejects empty or invalid input before a mutation', () => {
    expect(() => utcDateTime('')).toThrow()
    expect(() => utcDateTime('not-a-date')).toThrow()
    expect(dateTimeInput('invalid')).toBe('')
  })
})


describe('Custom-field draft safety', () => {
  it('submits only active writable schema fields while keeping read-only values available for display', () => {
    const definition = { ...schema, fields: [{ ...schema.fields[0], key: 'editable' }, { ...schema.fields[2], key: 'view_only', writable: false }] }
    const draft = { editable: 'Tap', view_only: 'Private reference', archived: 'Historical' }
    expect(writableCustomValues(definition, draft)).toEqual({ editable: 'Tap' })
    expect(draft.view_only).toBe('Private reference')
  })
  it('applies new-record defaults without overwriting typed values or an explicitly cleared value', () => {
    const definition = { ...schema, fields: [{ ...schema.fields[2], key: 'notes', default_json: 'Default' }, { ...schema.fields[0], default_json: 'tap' }] }
    const draft = { notes: null, draft_only: 'Keep my entry' }
    expect(withNewRecordDefaults(definition, draft)).toEqual({ notes: null, source: 'tap', draft_only: 'Keep my entry' })
    expect(withNewRecordDefaults(definition, { notes: 'Typed value', source: 'well' })).toEqual({ notes: 'Typed value', source: 'well' })
  })
})


it('matches numeric conditions for decimal strings returned by an existing database', () => {
  const dependent = { key: 'note', type: 'text', label_ar: 'ملاحظة', label_en: 'Note', condition_json: { field: 'core.value', operator: 'equals', value: 100 } }
  expect(visible(dependent, { 'core.value': '100.0000' })).toBe(true)
  expect(visible(dependent, { 'core.value': '' })).toBe(false)
  expect(visible(dependent, { 'core.value': false })).toBe(false)
})


it('advances a draft baseline only for a successful save of that record', () => {
  expect(savedLockVersion(3, { id: 7, lock_version: 4 }, 7)).toBe(4)
  expect(savedLockVersion(3, { id: 8, lock_version: 9 }, 7)).toBe(3)
  expect(savedLockVersion(3, { id: 7 }, 7)).toBe(3)
  expect(savedLockVersion(3, { id: 7, lock_version: 2 }, 7)).toBe(3)
})


it('uses Cairo business dates at midnight and across daylight saving boundaries', () => {
  expect(today(new Date('2026-01-31T21:59:00Z'))).toBe('2026-01-31')
  expect(today(new Date('2026-01-31T22:00:00Z'))).toBe('2026-02-01')
  expect(today(new Date('2026-07-31T21:00:00Z'))).toBe('2026-08-01')
  expect(addDays('2026-04-23', 1)).toBe('2026-04-24')
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  expect(addDays('2026-10-29', 1)).toBe('2026-10-30')
})


it('keeps secondary groups compact but reveals a field with a validation error', () => {
  const secondary = { key: 'core.terms', property: 'terms', source: 'core' as const, type: 'text', label_ar: 'شروط السداد', label_en: 'Payment terms' }
  const definition: FormSchema = { ...schema, fields: [secondary], layout: { sections: [{ key: 'terms', label_ar: 'الشروط المالية', label_en: 'Financial terms', columns: 1, fields: [secondary.key] }] } }
  const markup = (errors = {}) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DynamicForm formKey="customers" schema={definition} value={{ 'core.terms': '' }} onChange={() => undefined} primaryCoreFields={['core.name']} errors={errors} /></QueryClientProvider>)
  expect(markup()).toContain('class="form-optional-section"')
  expect(markup()).toContain('<summary>الشروط المالية</summary>')
  expect(markup({ terms: ['Required correction'] })).not.toContain('class="form-optional-section"')
  expect(markup({ terms: ['Required correction'] })).toContain('Required correction')
})
