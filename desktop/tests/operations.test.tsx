import { mapImportRows } from '../src/renderer/src/lib/importMapping'
import { CustomerProductEntry, productEntryPayload, type ProductEntry } from '../src/renderer/src/features/parties/CustomerProductEntry'
import { apiDateTime } from '../src/renderer/src/features/forms/dateTime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MENU, QUICK_ACTIONS, matchRoute, menuItemVisible } from '../src/renderer/src/workspace/routes'
import { newRequestPath, requestVisitPath, serviceEditorDefaults, serviceLabel, unitPath } from '../src/renderer/src/features/service/workflow'
import { sourceLink } from '../src/renderer/src/lib/docTypes'
import Dashboard from '../src/renderer/src/features/dashboard/Dashboard'
import { DynamicForm } from '../src/renderer/src/features/forms/DynamicForm'
import { useSession } from '../src/renderer/src/store/session'
import { usePrefs } from '../src/renderer/src/store/prefs'

// This Electron renderer has no SSR entry point. Read current stores in component SSR tests.
vi.mock('../src/renderer/src/store/session', async (original) => {
  const actual = await original<typeof import('../src/renderer/src/store/session')>()
  return { ...actual, useSession: Object.assign((selector: any) => selector(actual.useSession.getState()), actual.useSession), useCan: () => (permissions: string | string[]) => (Array.isArray(permissions) ? permissions : [permissions]).some((permission) => actual.can(permission)) }
})
vi.mock('../src/renderer/src/store/prefs', async (original) => {
  const actual = await original<typeof import('../src/renderer/src/store/prefs')>()
  return { ...actual, usePrefs: Object.assign((selector: any) => selector(actual.usePrefs.getState()), actual.usePrefs), useT: () => (ar: string, en: string) => actual.usePrefs.getState().locale === 'ar' ? ar : en }
})

beforeEach(() => {
  usePrefs.setState({ locale: 'en' })
  useSession.setState({ user: { is_admin: false, permissions: [], roles: [] } as any })
})

describe('Daily water-filter workspace', () => {
  it('places all modules in the normal menu with no Advanced entry', () => {
    expect(MENU.map((group) => group.key)).toEqual(['home', 'customers', 'service', 'inventory', 'sales', 'purchases', 'crm', 'treasury', 'finance', 'system'])
    const paths = [...MENU.flatMap((group) => group.items), ...QUICK_ACTIONS].map((item) => item.path)
    for (const path of ['/crm/pipeline', '/finance/journals', '/forms/studio', '/service/profiles', '/service/reports', '/reports/overview']) expect(paths).toContain(path)
    expect(paths).not.toContain('/advanced')
    expect(matchRoute('/reports/overview')?.route.pattern).toBe('/reports/overview')
    expect(matchRoute('/finance/journals/7')).not.toBeNull()
  })
  it('carries customer, filter, address and installation context through the next step', () => {
    const path = newRequestPath(12, { id: 31, address_id: 9, status: 'pending_installation' })
    const query = matchRoute(path)!.query
    expect(serviceEditorDefaults(query)).toMatchObject({ party_id: 12, unit_id: 31, address_id: 9, type: 'installation' })
    expect(serviceEditorDefaults(matchRoute(requestVisitPath({ id: 7, party_id: 12 }))!.query)).toMatchObject({ request_id: 7, party_id: 12 })
    expect(matchRoute(unitPath(31, 12))!.query.get('open')).toBe('31')
    expect(requestVisitPath({ id: 7, party_id: 12, visits: [{ id: 19, status: 'draft' }] })).toBe('/service/visits?open=19')
    expect(apiDateTime('2026-10-26 09:00:00').toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(apiDateTime('2026-10-26T11:00:00+02:00').toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(sourceLink('service_visit', 44)).toBe('/service/visits?open=44')
    expect(serviceEditorDefaults(new URLSearchParams('party=-1&unit=bad'))).toMatchObject({ party_id: null, unit_id: null })
    const sold = new URLSearchParams({ product: '5', invoice_line: '8', serial: 'RO-001', purchased: '2026-10-26' })
    expect(serviceEditorDefaults(sold)).toMatchObject({ product_id: 5, invoice_line_id: 8, serial_number: 'RO-001', purchased_on: '2026-10-26' })
  })
  it('renders actionable daily queues without business charts or accounting totals', () => {
    useSession.setState({ user: { is_admin: true, permissions: [], roles: ['admin'] } as any })
    const client = new QueryClient()
    client.setQueryData(['/operations/today', {}], { service: { visits_today: 1, late_visits: 0, due_week: 3, overdue: 2, awaiting_installation: 1, awaiting_scheduling: 1, visits: [{ id: 3, status: 'scheduled', request: { party: { name: 'Cairo household' } }, technician: { name: 'Ahmed' }, scheduled_start: '2026-10-26T09:00:00Z' }], requests: [{ id: 8, party_id: 4, party: { name: 'Giza household' }, description: 'Replace membrane' }] }, stock: { low_stock: 2, alerts: [] } })
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>)
    expect(html).toContain('Cairo household')
    expect(html).toContain('Replace membrane')
    expect(html).toContain('Schedule visit')
    expect(html).toContain('Replacements in 7 days')
    expect(html).not.toContain('Pipeline')
    expect(html).not.toContain('Stock at cost')
  })
  it('shows normal accounting links to permitted staff without an owner-only gate', () => {
    const journal = MENU.flatMap((group) => group.items).find((item) => item.path === '/finance/journals')!
    expect(menuItemVisible(journal, () => true)).toBe(true)
    expect(menuItemVisible(journal, () => false)).toBe(false)
  })
  it('keeps custom and required fields visible and puts optional domain controls in More details', () => {
    const fields = [
      { key: 'core.name', property: 'name', source: 'core' as const, type: 'text', label_ar: 'الاسم', label_en: 'Name', required: true },
      { key: 'core.tax_number', property: 'tax_number', source: 'core' as const, type: 'text', label_ar: 'الضريبة', label_en: 'Tax number' },
      { key: 'landmark', type: 'text', label_ar: 'العلامة', label_en: 'Landmark' },
    ]
    const schema = { form_key: 'customers', entity_type: 'parties', version: 1, fields, layout: { sections: [{ key: 'main', label_ar: 'البيانات', label_en: 'Details', columns: 2, fields: fields.map((field) => field.key) }] } }
    const render = (errors = {}) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DynamicForm formKey="customers" schema={schema} value={{ 'core.name': 'Home', 'core.tax_number': '123', landmark: 'School' }} onChange={() => undefined} primaryCoreFields={['core.name']} errors={errors} /></QueryClientProvider>)
    const html = render()
    expect(html.indexOf('Landmark')).toBeLessThan(html.indexOf('<details'))
    expect(html.indexOf('Tax number')).toBeGreaterThan(html.indexOf('<details'))
    expect(html).toContain('value="123"')
    const invalid = render({ tax_number: ['Invalid registration'] })
    expect(invalid).toContain('Invalid registration')
    expect(invalid).not.toContain('<details')
    expect(serviceLabel('in_progress')).toEqual(['جارٍ التنفيذ', 'In progress'])
  })
})


describe('Customer and product entry', () => {
  const entry: ProductEntry = { mode: 'existing', product_id: 5, profile_id: 8, serial_number: 'RO-123', purchased_on: '2026-01-15', installed_on: '2026-01-31', warranty_starts_on: '', warranty_ends_on: '2027-01-31', quantity: 1, unit_price: 1000, warehouse_id: 2 }
  it('preserves related unit/custom values and excludes invoice-only fields from existing-filter registration', () => {
    const payload = productEntryPayload(entry, { form_key: 'customer-units', custom_fields: { kitchen: 'Main' }, form_version: 2, lock_version: 0 }, { form_key: 'party-addresses', custom_fields: { gate: '2' }, form_version: 1 })
    expect(payload).toMatchObject({ product_id: 5, profile_id: 8, serial_number: 'RO-123', installed_on: '2026-01-31', custom_fields: { kitchen: 'Main' }, address_form: { custom_fields: { gate: '2' } } })
    expect(payload).not.toHaveProperty('warehouse_id')
    expect(payload).not.toHaveProperty('form_key')
    expect(payload.address_form).not.toHaveProperty('form_key')
    const pending = productEntryPayload({ ...entry, installed_on: '' }, {})
    expect(pending.installed_on).toBeNull()
  })
  it('switching to a new sale excludes hidden serial and installation values and retains invoice metadata', () => {
    const payload = productEntryPayload({ ...entry, mode: 'new_sale' }, { form_key: 'sales_invoice', custom_fields: { source: 'Walk in' }, form_version: 3 }, { custom_fields: { gate: 'Hidden' } })
    expect(payload).toMatchObject({ mode: 'new_sale', product_id: 5, quantity: 1, unit_price: 1000, warehouse_id: 2, form_version: 3, custom_fields: { source: 'Walk in' } })
    for (const field of ['serial_number', 'installed_on', 'profile_id', 'address_form', 'form_key']) expect(payload).not.toHaveProperty(field)
  })
  it('shows linked filter details and errors, while the new-sale mode shows only its relevant inputs', () => {
    const client = new QueryClient()
    client.setQueryData(['/maintenance/profiles', {}], { data: [{ id: 8, product_id: 5, name: 'RO schedule', version: 1, active: true }] })
    const render = (value: ProductEntry) => renderToStaticMarkup(<QueryClientProvider client={client}><CustomerProductEntry value={value} onChange={() => undefined} existingAllowed saleAllowed errors={{ 'product_entry.serial_number': ['Already assigned'] }} /></QueryClientProvider>)
    const existing = render(entry)
    expect(existing).toContain('RO schedule')
    expect(existing).toContain('Actual installation date')
    expect(existing).toContain('Already assigned')
    expect(existing).toContain('value="RO-123"')
    const sale = render({ ...entry, mode: 'new_sale' })
    expect(sale).toContain('Sale warehouse')
    expect(sale).toContain('Unit price')
    expect(sale).not.toContain('value="RO-123"')
    expect(sale).not.toContain('Actual installation date')
  })
})


it('maps legacy import columns without leaking ignored columns or restoring an unmapped value', () => {
  const rows = [{ customer: 'C100', unit_code: 'OLD', identifier: 'UNIT-1', 'stage.sediment': '2026-10-01', ignored: 'legacy notes' }]
  expect(mapImportRows(rows, ['customer_code', 'unit_code'], { customer_code: 'customer', unit_code: 'identifier' }, true)).toEqual([{ customer_code: 'C100', unit_code: 'UNIT-1', 'stage.sediment': '2026-10-01' }])
  expect(mapImportRows(rows, ['unit_code'], { unit_code: '' })).toEqual([{}])
})
