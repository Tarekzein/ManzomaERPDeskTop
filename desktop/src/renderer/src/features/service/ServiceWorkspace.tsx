import { AutomationStatus } from './AutomationStatus'
import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { VisitCorrections } from './VisitCorrections'
import { apiDateTime, dateTimeInput } from '@/features/forms/dateTime'
import { newRequestPath, requestVisitPath, serviceEditorDefaults, serviceLabel } from './workflow'
import { AddressEditor, ScheduleCorrection, TemplateManager } from './ServiceTools'
import { useRecoverableDraft } from '@/features/forms/useRecoverableDraft'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Plus, Printer, RefreshCw, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { date, today } from '@/lib/format'
import { useT, nameOf } from '@/store/prefs'
import { can, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'
import { Modal, confirmDialog } from '@/components/Dialogs'
import { PartyPicker, ProductPicker } from '@/components/Pickers'
import { Button, Check, ErrorBox, Field, Input, NumberInput, PageHeader, Select, Sheet, Spinner, Textarea } from '@/components/ui'
import { useDynamicFields, type FormValues } from '@/features/forms/DynamicForm'
import { printElement } from '@/features/print/printService'
import { ServiceReportPrint, UnitLabelPrint } from './ServicePrint'
import { RequestPicker, UnitPicker } from './ServicePickers'
import { serviceContext, serviceCsv } from './queueCsv'
import { useCsvExport } from '@/lib/useCsvExport'
import { Pager } from '@/components/DataTable'
import { CustomFieldFilters } from '@/features/forms/CustomFieldFilters'
import type { FormSchema } from '@/features/forms/DynamicForm'

type Kind = 'units' | 'profiles' | 'requests' | 'visits'
const PATHS = { units: '/customer-units', profiles: '/maintenance/profiles', requests: '/service-requests', visits: '/service-visits' }
const FORM_KEYS = { units: 'customer-units', profiles: 'maintenance-profiles', requests: 'service-requests', visits: 'service-visits' }
const LABELS: Record<string, [string, string]> = { units: ['أجهزة العملاء', 'Customer filters'], profiles: ['برامج الصيانة', 'Maintenance profiles'], requests: ['طلبات الخدمة', 'Service requests'], visits: ['زيارات الفنيين', 'Technician visits'], due: ['الصيانة المستحقة', 'Maintenance due'], followups: ['متابعة العملاء', 'Customer follow-up'], reports: ['تقارير الصيانة', 'Service reports'] }
const STATUSES: Record<string, string[]> = { units: ['pending_installation', 'active', 'paused', 'retired', 'returned'], requests: ['open', 'completed', 'cancelled', 'reversed'], visits: ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled', 'reversed'], followups: ['open', 'contacted', 'booked'] }

export default function ServiceWorkspace() {
  const t = useT()
  const { params, query, replace } = useTab()
  const section = params.section || 'due'
  const coordinator = can('service.manage') && can('service.view_all')
  const [when, setWhen] = useState(query.get('when') || (section === 'visits' ? 'all' : 'week'))
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('')
  const [owner, setOwner] = useState('')
  const download = useCsvExport()
  const [customFilters, setCustomFilters] = useState<Record<string, string>>({})
  const schema = useApi<FormSchema>(section in FORM_KEYS ? `/forms/${FORM_KEYS[section as Kind]}` : null)
  const customColumns = (schema.data?.fields ?? []).filter(field => field.usage_flags_json?.list)
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setPage(1) }, 250); return () => clearTimeout(timer) }, [search])
  const [editing, setEditing] = useState<{ kind: Kind; record?: any } | null>(() => {
    if (!(section in PATHS)) return null
    if (query.get('new') === '1' && (section === 'profiles' ? can('service.settings') : coordinator)) return { kind: section as Kind }
    const id = Number(query.get('open'))
    return id > 0 && ['units', 'visits'].includes(section) ? { kind: section as Kind, record: { id } } : null
  })
  const [reportFilters, setReportFilters] = useState<Record<string, string>>({})
  const reportLookups = useSession(state => state.lookups)
  const path = section === 'due' ? '/maintenance/due' : section === 'followups' ? '/maintenance/followups' : section === 'reports' ? '/reports/maintenance' : PATHS[section as Kind]
  const filters = { ...(section === 'reports' ? reportFilters : {}), ...Object.fromEntries(Object.entries(customFilters).filter(([, value]) => value !== '').map(([key, value]) => [`custom[${key}]`, value])), when, search: debounced, status: status || undefined, owner_id: section === 'followups' ? owner || undefined : undefined, party_id: query.get('party') || undefined }
  const { data, isLoading, isFetching, error, refetch } = useApi<any>(path ?? null, { ...filters, page, per_page: 50 })
  const rows: any[] = data?.data ?? []
  const closeEditor = () => {
    setEditing(null)
    void refetch()
    if (query.has('new') || query.has('open')) {
      const keep = new URLSearchParams()
      for (const key of ['party', 'when']) if (query.get(key)) keep.set(key, query.get(key)!)
      replace(`/service/${section}${keep.size ? `?${keep}` : ''}`)
    }
  }
  return <div className="grid gap-4 p-5">
    <PageHeader title={t(...(LABELS[section] ?? LABELS.due))} actions={<>
      {section !== 'reports' && path && <Button icon={Download} disabled={search !== debounced || (section in FORM_KEYS && !schema.data)} loading={Boolean(download.progress)} onClick={() => void download.start(path, filters, `service-${section}`, [...serviceCsv(section, t), ...customColumns.map(field => ({ header: t(field.label_ar, field.label_en), value: (row: any) => Array.isArray(row.custom_fields?.[field.key]) ? row.custom_fields[field.key].join(', ') : row.custom_fields?.[field.key] }))])}>{t('تصدير النتائج', 'Export results')}</Button>}
      <Button variant="ghost" icon={RefreshCw} loading={isFetching} onClick={() => void refetch()} aria-label={t('تحديث القائمة', 'Refresh list')} />
      {query.get('party') && can('customers.view') && <Button onClick={() => navigate(`/parties/view/${query.get('party')}`)}>{t('ملف العميل', 'Customer profile')}</Button>}
      {section in PATHS && (section === 'profiles' ? can('service.settings') : coordinator) && <Button icon={Plus} variant="primary" onClick={() => setEditing({ kind: section as Kind })}>{section === 'units' ? t('تسجيل فلتر', 'Register filter') : section === 'visits' ? t('حدد زيارة', 'Schedule visit') : t('إضافة', 'New')}</Button>}
    </>} />
    {section !== 'reports' && <div className="service-queue-filters">
      <Field label={t('البحث في السجلات', 'Search records')}><div className="relative"><Search size={15} className="absolute start-3 top-3 muted" /><Input type="search" className="ps-9" maxLength={190} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('العميل، الهاتف، كود الفلتر أو المسلسل…', 'Customer, phone, unit code or serial…')} /></div></Field>
      {STATUSES[section] && <Field label={t('الحالة', 'Status')}><Select value={status} placeholder={t('كل الحالات', 'All statuses')} options={STATUSES[section].map(value => ({ value, label: t(...serviceLabel(value)) }))} onChange={event => { setStatus(event.target.value); setPage(1) }} /></Field>}
      {section === 'followups' && <Field label={t('مسؤول المتابعة', 'Follow-up owner')}><Select value={owner} placeholder={t('كل المسؤولين', 'All owners')} options={[{ value: 'me', label: t('المسندة إليّ', 'Assigned to me') }, { value: 'unassigned', label: t('بدون مسؤول', 'Unassigned') }]} onChange={event => { setOwner(event.target.value); setPage(1) }} /></Field>}
      <CustomFieldFilters fields={schema.data?.fields ?? []} value={customFilters} onChange={value => { setCustomFilters(value); setPage(1) }} />
      <div className="flex flex-wrap items-center gap-2 self-end pb-1"><span className="muted text-[12px]" role="status">{t('النتائج: ', 'Results: ')}{data?.total ?? rows.length}</span>{(search || status || owner || Object.values(customFilters).some(Boolean)) && <Button size="sm" onClick={() => { setSearch(''); setDebounced(''); setStatus(''); setOwner(''); setCustomFilters({}); setPage(1) }}>{t('مسح التصفية', 'Clear filters')}</Button>}</div>
    </div>}
    {download.progress && <div className="flex flex-wrap items-center gap-3" role="status"><span className="muted">{t('جارٍ تجهيز كل النتائج المطابقة: ', 'Preparing all matching results: ')}{download.progress.loaded}{download.progress.total !== undefined ? ` / ${download.progress.total}` : ''}</span><Button size="sm" onClick={download.cancel}>{t('إلغاء التصدير', 'Cancel export')}</Button></div>}
    {download.error ? <ErrorBox error={download.error} /> : null}
    {schema.error ? <ErrorBox error={schema.error} onRetry={() => void schema.refetch()} /> : null}
    {['due', 'followups'].includes(section) && <div className="flex flex-wrap gap-2"><Button variant={section === 'due' ? 'primary' : 'default'} onClick={() => navigate('/service/due')}>{t('مواعيد تغيير الشمعات', 'Replacement reminders')}</Button>{coordinator && <Button variant={section === 'followups' ? 'primary' : 'default'} onClick={() => navigate('/service/followups')}>{t('الاتصال بالعملاء', 'Customer follow-up')}</Button>}</div>}
    {section === 'followups' && can('service.settings') && <details><summary className="cursor-pointer muted">{t('قوالب الرسائل', 'Message templates')}</summary><TemplateManager /></details>}
    {section === 'due' && <Select aria-label={t('موعد الصيانة', 'Maintenance period')} value={when} onChange={(event) => { setWhen(event.target.value); setPage(1) }} options={[{ value: 'week', label: t('خلال ٧ أيام', 'Next 7 days') }, { value: 'overdue', label: t('متأخر', 'Overdue') }, { value: 'review', label: t('بانتظار التركيب / مراجعة التاريخ', 'Awaiting installation / date review') }]} />}
    {section === 'visits' && <Select aria-label={t('موعد الزيارة', 'Visit period')} value={when} onChange={(event) => { setWhen(event.target.value); setPage(1) }} options={[{ value: 'all', label: t('كل الزيارات', 'All visits') }, { value: 'today', label: t('اليوم', 'Today') }, { value: 'late', label: t('زيارات سابقة لم تكتمل', 'Earlier unfinished visits') }]} />}
    {section === 'reports' && <Sheet title={t('فترة التقرير', 'Report period')} bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {(['from', 'to'] as const).map(key => <Field key={key} label={key === 'from' ? t('من تاريخ', 'From date') : t('إلى تاريخ', 'To date')}><Input type="date" value={reportFilters[key] ?? ''} onChange={event => setReportFilters(old => ({ ...old, [key]: event.target.value }))} /></Field>)}
      <Field label={t('الفني', 'Technician')}><Select value={reportFilters.technician_id ?? ''} placeholder={t('الكل', 'All')} options={(reportLookups?.technicians ?? []).map(user => ({ value: user.id, label: user.name }))} onChange={event => setReportFilters(old => ({ ...old, technician_id: event.target.value }))} /></Field>
      <Field label={t('المخزن / السيارة', 'Warehouse / van')}><Select value={reportFilters.warehouse_id ?? ''} placeholder={t('الكل', 'All')} options={(reportLookups?.warehouses ?? []).map(warehouse => ({ value: warehouse.id, label: nameOf(warehouse) }))} onChange={event => setReportFilters(old => ({ ...old, warehouse_id: event.target.value }))} /></Field>
    </Sheet>}
    {error ? <ErrorBox error={error} onRetry={() => void refetch()} /> : isLoading ? <Spinner /> : section === 'reports' ? <ServiceMetrics data={data} /> : <Sheet bodyClassName="overflow-auto">
      <table className="ledger"><thead><tr><th>{t('العميل / الفلتر', 'Customer / filter')}</th><th>{t('الهاتف', 'Phone')}</th><th>{t('التفاصيل', 'Details')}</th><th>{t('الحالة / الموعد', 'Status / appointment')}</th>{customColumns.map(field => <th key={field.key}>{t(field.label_ar, field.label_en)}</th>)}<th>{t('الإجراء', 'Action')}</th></tr></thead><tbody>
        {rows.map((row) => {
          const { unit, party } = serviceContext(row)
          return <tr key={row.id}>
            <td>{party && can('customers.view') ? <button type="button" className="link font-semibold" onClick={() => navigate(`/parties/view/${party.id}`)}>{nameOf(party)}</button> : nameOf(party) || row.name || row.unit_code}<div className="muted text-[11px]">{['requests', 'visits'].includes(section) ? `#${row.id} · ` : ''}{row.unit_code ?? unit?.unit_code ?? row.request?.unit?.unit_code}</div></td>
            <td className="num">{party?.mobile || party?.phone || '—'}</td>
            <td>{nameOf(row.product) || row.request?.description || row.description || (row.label_ar ? t(row.label_ar, row.label_en) : row.schedule ? t(row.schedule.label_ar, row.schedule.label_en) : '')}{row.technician && <div className="muted">{row.technician.name}</div>}</td>
            <td>{row.next_due_on || row.due_on ? date(row.next_due_on ?? row.due_on) : row.status ? t(...serviceLabel(row.status)) : `v${row.version}`}{row.scheduled_start && <div className="num muted">{apiDateTime(row.scheduled_start).toLocaleString(undefined, { timeZone: 'Africa/Cairo' })}</div>}</td>{customColumns.map(field => <td key={field.key}>{Array.isArray(row.custom_fields?.[field.key]) ? row.custom_fields[field.key].join(', ') : String(row.custom_fields?.[field.key] ?? '')}</td>)}<td><div className="flex flex-wrap gap-2">
              {section in PATHS && <Button size="sm" onClick={() => setEditing({ kind: section as Kind, record: row })}>{t('فتح', 'Open')}</Button>}
              {section === 'due' && <Button size="sm" onClick={() => setEditing({ kind: 'units', record: row.unit })}>{t('الفلتر', 'Filter')}</Button>}
              {section === 'due' && coordinator && unit && <Button size="sm" onClick={() => navigate(newRequestPath(unit.party_id, unit))}>{t('طلب زيارة', 'Request visit')}</Button>}
              {section === 'requests' && coordinator && !['completed', 'cancelled'].includes(row.status) && <Button size="sm" onClick={() => navigate(requestVisitPath(row))}>{row.visits?.some((visit: any) => visit.status !== 'cancelled') ? t('الزيارات', 'Visits') : t('حدد زيارة', 'Schedule visit')}</Button>}
              {section === 'followups' && <ContactForm row={row} onSaved={() => void refetch()} />}
            </div></td>
          </tr>
        })}
      </tbody></table>
      {!rows.length && <p className="muted p-4">{search || status || owner || Object.values(customFilters).some(Boolean) ? t('لا توجد نتائج مطابقة. غيّر البحث أو امسح التصفية.', 'No matching results. Change your search or clear the filters.') : section === 'due' ? t('لا توجد صيانة مستحقة في الفترة المختارة.', 'No maintenance due in this period.') : t('لا توجد سجلات. استخدم زر الإضافة للبدء.', 'No records. Use New to get started.')}</p>}
      {data?.last_page > 1 && <Pager page={data.current_page ?? page} lastPage={data.last_page} total={data.total} onPage={setPage} />}
    </Sheet>}
    {editing && <ServiceEditor key={`${editing.kind}-${editing.record?.id ?? 'new'}`} kind={editing.kind} initial={editing.record} onClose={closeEditor} />}
  </div>
}

function ServiceMetrics({ data }: { data: any }) {
  const t = useT()
  return <div className="grid gap-4"><AutomationStatus /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['due_week', 'خلال ٧ أيام', 'Due in 7 days'], ['overdue', 'متأخر', 'Overdue'], ['needs_review', 'بانتظار التركيب', 'Awaiting installation'], ['open_followups', 'متابعات مفتوحة', 'Open follow-ups']].map(([key, ar, en]) => <Sheet key={key} title={t(ar, en)} bodyClassName="figure p-4">{data?.[key] ?? 0}</Sheet>)}</div>
    {!!data?.unassigned_followups && <p role="status" className="error">{t('متابعات تحتاج مسؤولاً: ', 'Follow-ups needing an owner: ')}{data.unassigned_followups}</p>}
    <p className="muted">{t('آخر فحص', 'Last scan')}: {data?.last_scan ?? '—'} · {t('مهام معلقة / فاشلة', 'Pending / failed jobs')}: {data?.pending_jobs ?? 0} / {data?.failed_jobs ?? 0}</p>
    <p className="muted">{t('العائد بعد القطع لا يشمل أجور الفني أو الانتقال. مؤشرات الصيانة أعلاه للحالة الحالية؛ الجدول حسب الفترة المختارة.', 'Contribution after parts excludes labor and travel. Maintenance counters above show current status; the table uses the selected period.')}</p>
    <table className="ledger"><thead><tr><th>{t('الفني', 'Technician')}</th><th>{t('الزيارات', 'Visits')}</th><th>{t('مكتملة', 'Completed')}</th><th>{t('تكلفة القطع', 'Parts cost')}</th><th>{t('إيراد القطع', 'Parts revenue')}</th><th>{t('إيراد الخدمات', 'Service revenue')}</th><th>{t('العائد بعد القطع', 'Contribution after parts')}</th></tr></thead><tbody>{data?.technicians?.map((tech: any) => <tr key={tech.id}><td>{tech.name}</td><td>{tech.visits}</td><td>{tech.completed}</td><td>{tech.net_parts_cost}</td><td>{tech.parts_revenue}</td><td>{tech.service_revenue}</td><td>{tech.contribution_after_parts}</td></tr>)}</tbody></table>
  </div>
}

function ServiceEditor({ kind, initial, onClose }: { kind: Kind; initial?: any; onClose: () => void }) {
  const t = useT()
  const detail = useApi<any>(initial?.id && ['units', 'visits'].includes(kind) ? `${PATHS[kind]}/${initial.id}` : null)
  if (initial?.id && ['units', 'visits'].includes(kind) && detail.isLoading) return <Modal title={t('تحميل', 'Loading')} onClose={onClose}><Spinner /></Modal>
  if (detail.error) return <Modal title={t('خطأ', 'Error')} onClose={onClose}><ErrorBox error={detail.error} /></Modal>
  return <LoadedServiceEditor key={`${detail.data?.data?.updated_at ?? ''}`} kind={kind} record={detail.data?.data ?? initial} onClose={onClose} />
}

function LoadedServiceEditor({ kind, record, onClose }: { kind: Kind; record?: any; onClose: () => void }) {
  const t = useT()
  const lookups = useSession((s) => s.lookups)
  const { query, tabId } = useTab()
  const profiles = useApi<any>(kind === 'units' ? '/maintenance/profiles' : null)
  const [values, setValues] = useState<FormValues>(() => ({ unit_code: `WF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, party_id: query.get('party') ? Number(query.get('party')) : null, product_id: null, profile_id: null, notes: '', type: 'maintenance', priority: 'normal', description: '', request_id: null,
    warehouse_id: useSession.getState().user?.default_warehouse_id ?? lookups?.warehouses[0]?.id, technician_id: null, name: '', report: '', ...serviceEditorDefaults(query), ...record, serial_number: record?.serial?.serial_number ?? record?.serial_number ?? query.get('serial') ?? '', scheduled_start: localDateTime(record?.scheduled_start), scheduled_end: localDateTime(record?.scheduled_end) }))
  useEffect(() => {
    if (kind !== 'units' || record?.id || values.profile_id || !values.product_id) return
    const profile = profiles.data?.data?.find((row: any) => row.active && row.product_id === Number(values.product_id))
    if (profile) setValues((old) => old.profile_id ? old : { ...old, profile_id: profile.id })
  }, [kind, record?.id, values.product_id, values.profile_id, profiles.data])
  const requestDetail = useApi<any>(kind === 'visits' && values.request_id ? '/service-requests' : null, { id: Number(values.request_id), per_page: 1 })
  const selectedRequest = requestDetail.data?.data?.[0] ?? (record?.request_id === Number(values.request_id) ? record?.request : undefined)
  const relatedUnitId = kind === 'visits' ? selectedRequest?.unit_id : kind === 'requests' ? values.unit_id : null
  const unitDetail = useApi<any>(relatedUnitId ? `/customer-units/${relatedUnitId}` : null)
  const addresses = useApi<any>(['units', 'requests'].includes(kind) && values.party_id ? `/parties/${values.party_id}/addresses` : null)
  const [stages, setStages] = useState<any[]>(record?.stages ?? [{ stage_key: '', label_ar: '', label_en: '', replacement_product_id: null, interval_count: 3, interval_unit: 'months' }])
  const [parts, setParts] = useState<any[]>(record?.parts ?? [])
  const [actions, setActions] = useState<any[]>(record?.stage_actions ?? [])
  const [installedOn, setInstalledOn] = useState(today())
  const [completedOn, setCompletedOn] = useState(today())
  const [confirmInstallation, setConfirmInstallation] = useState(false)
  const [completionKey] = useState(() => crypto.randomUUID())
  const [services, setServices] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const custom = useDynamicFields(FORM_KEYS[kind], record)
  const recovery = useRecoverableDraft(`service:${kind}:${record?.id ?? `new:${tabId}`}`, { values, stages, parts, actions, custom: custom.values }, (draft) => { setValues(draft.values); setStages(draft.stages); setParts(draft.parts); setActions(draft.actions); custom.setValues(draft.custom) }, !['completed', 'cancelled', 'reversed'].includes(record?.status))
  const final = (kind === 'visits' && ['completed', 'cancelled', 'reversed'].includes(record?.status)) || !can(kind === 'profiles' ? 'service.settings' : 'service.manage')
  const set = (patch: FormValues) => setValues((old) => ({ ...old, ...patch }))
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(null); try { await operation(); invalidate('/operations', '/parties', '/service', '/customer-units', '/maintenance', '/reports', '/stock', '/products', '/crm', '/documents') } catch (failure) { custom.capture(failure); setError(failure) } finally { setBusy(false) } }
  const visitPayload = () => ({ ...values, ...custom.payload(), parts, stage_actions: actions.map((action) => ({ ...action, replaced_on: completedOn })), scheduled_start: values.scheduled_start ? new Date(String(values.scheduled_start)).toISOString() : null, scheduled_end: values.scheduled_end ? new Date(String(values.scheduled_end)).toISOString() : null })
  const save = async () => {
    const payload: any = { ...values, ...custom.payload() }
    if (kind === 'profiles') payload.stages = stages
    if (kind === 'visits') Object.assign(payload, visitPayload(), { schedule: !record?.id && Boolean(values.scheduled_start && values.scheduled_end) })
    if (record?.id && kind === 'units') { await api.put(`${PATHS[kind]}/${record.id}`, { notes: values.notes, status: values.status === 'pending_installation' ? undefined : values.status, ...custom.payload() }); await recovery.clear(); onClose(); return }
    if (record?.id && kind === 'profiles') return
    const result = await (record?.id && kind === 'visits' ? api.put(`${PATHS[kind]}/${record.id}`, payload) : api.post(PATHS[kind], payload))
    await recovery.clear(); toast.success(t('تم الحفظ', 'Saved')); onClose()
    if (kind === 'requests') navigate(requestVisitPath(result.data))
    if (kind === 'visits' && !record?.id) navigate(`/service/visits?open=${result.data.id}`)
  }
  return <Modal size="xl" title={`${t(...LABELS[kind])}${record?.id ? ` #${record.id}` : ''}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('إغلاق', 'Close')}</Button>{!final && !(record?.id && ['profiles', 'requests'].includes(kind)) && <Button variant="primary" loading={busy} onClick={() => void run(save)}>{kind === 'requests' || (kind === 'visits' && !record?.id && values.scheduled_start && values.scheduled_end) ? t('حفظ وتحديد زيارة', 'Save and schedule visit') : t('حفظ', 'Save')}</Button>}</>}>
    <div className="grid gap-4">
      {error ? <ErrorBox error={error} /> : null}
      {recovery.banner}
      {kind === 'units' && record && <div className="flex flex-wrap items-center gap-3"><strong>{record.unit_code} · {t(...serviceLabel(record.status))}</strong>{can('customers.view') && <Button onClick={() => navigate(`/parties/view/${record.party_id}`)}>{t('ملف العميل', 'Customer profile')}</Button>}{can('service.manage') && can('service.view_all') && <Button onClick={() => { onClose(); navigate(newRequestPath(record.party_id, record)) }}>{t('طلب خدمة لهذا الفلتر', 'Service this filter')}</Button>}<Button icon={Printer} onClick={() => void run(async () => { const qr = await QRCode.toDataURL(`manzoma:unit:${record.unit_code}`, { width: 240, margin: 2 }); await printElement(<UnitLabelPrint unit={record} qr={qr} />, { paper: 'A5', title: record.unit_code }) })}>{t('طباعة بطاقة الجهاز', 'Print unit label')}</Button>
        {record.status === 'pending_installation' && can('service.manage') && <><Input type="date" value={installedOn} onChange={(event) => setInstalledOn(event.target.value)} /><Button loading={busy} onClick={() => void run(async () => { await api.post(`/customer-units/${record.id}/install`, { installed_on: installedOn }); onClose() })}>{t('تأكيد التركيب', 'Confirm installation')}</Button></>}
      </div>}
      {!record?.id && ['units', 'requests'].includes(kind) && <Field label={t('العميل', 'Customer')}><PartyPicker role="customer" value={values.party_id ? Number(values.party_id) : null} onChange={(id) => set({ party_id: id, unit_id: null, address_id: null })} /></Field>}
      {!record?.id && ['units', 'profiles'].includes(kind) && <Field label={t('طراز الفلتر', 'Filter model')}><ProductPicker value={values.product_id ? Number(values.product_id) : null} onChange={(id) => set({ product_id: id, profile_id: profiles.data?.data?.find((profile: any) => profile.product_id === id)?.id ?? null })} /></Field>}
      {kind === 'units' && !record?.id && <Field label={t('برنامج الصيانة', 'Maintenance profile')}><Select value={String(values.profile_id ?? '')} placeholder={t('اختر برنامج الصيانة', 'Choose replacement schedule')} onChange={(event) => set({ profile_id: Number(event.target.value) })} options={(profiles.data?.data ?? []).filter((row: any) => row.product_id === Number(values.product_id)).map((row: any) => ({ value: row.id, label: `${row.name} v${row.version}` }))} /></Field>}
      {!record?.id && ['units', 'requests'].includes(kind) && <Field label={t('موقع الخدمة', 'Service location')}><Select value={String(values.address_id ?? '')} placeholder="—" options={(addresses.data?.data ?? []).map((address: any) => ({ value: address.id, label: address.label }))} onChange={(event) => set({ address_id: event.target.value ? Number(event.target.value) : null })} /></Field>}
      {!record?.id && ['units', 'requests'].includes(kind) && values.party_id && <AddressEditor partyId={Number(values.party_id)} onSaved={(id) => set({ address_id: id })} />}
      {kind === 'requests' && !record?.id && <><Field label={t('الجهاز', 'Installed unit')} hint={t('اختياري لطلب عام. اختيار الفلتر يربط موقعه بالطلب.', 'Optional for a general request. Choosing a filter also selects its service location.')}><UnitPicker value={values.unit_id ? Number(values.unit_id) : null} partyId={values.party_id ? Number(values.party_id) : null} initialLabel={unitDetail.data?.data?.unit_code} onChange={(id, unit) => set({ unit_id: id, address_id: unit?.address_id ?? null })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label={t('نوع الطلب', 'Request type')}><Select value={String(values.type)} options={['installation', 'maintenance', 'repair', 'complaint'].map((value) => ({ value, label: t(...serviceLabel(value)) }))} onChange={(event) => set({ type: event.target.value })} /></Field><Field label={t('الأولوية', 'Priority')}><Select value={String(values.priority)} options={['low', 'normal', 'high'].map((value) => ({ value, label: t(...serviceLabel(value)) }))} onChange={(event) => set({ priority: event.target.value })} /></Field></div></>}
      {kind === 'visits' && <div className="grid grid-cols-3 gap-3">
        <Field label={t('طلب الخدمة', 'Service request')}><RequestPicker disabled={final} value={values.request_id ? Number(values.request_id) : null} partyId={query.get('party') ? Number(query.get('party')) : undefined} initialLabel={selectedRequest ? `#${selectedRequest.id} · ${nameOf(selectedRequest.party)}` : values.request_id ? `#${values.request_id}` : undefined} onChange={id => { if (id !== Number(values.request_id)) { setActions([]); setConfirmInstallation(false) } set({ request_id: id }) }} /></Field>
        <Field label={t('الفني', 'Technician')}><Select disabled={final} value={String(values.technician_id ?? '')} placeholder="—" options={(lookups?.technicians ?? []).map((user: any) => ({ value: user.id, label: user.name }))} onChange={(event) => { const id = Number(event.target.value); const van = lookups?.warehouses.find((warehouse: any) => warehouse.kind === 'van' && warehouse.technician_id === id); const store = lookups?.warehouses.find((warehouse: any) => warehouse.id === Number(values.warehouse_id) && warehouse.kind !== 'van') ?? lookups?.warehouses.find((warehouse: any) => warehouse.kind !== 'van' && !warehouse.is_transit); set({ technician_id: id, warehouse_id: van?.id ?? store?.id ?? null }) }} /></Field>
        <Field label={t('مخزن القطع / السيارة', 'Parts warehouse / van')}><Select disabled={final} value={String(values.warehouse_id ?? '')} options={(lookups?.warehouses ?? []).filter((warehouse: any) => warehouse.kind !== 'van' || warehouse.technician_id === Number(values.technician_id)).map((warehouse: any) => ({ value: warehouse.id, label: nameOf(warehouse) }))} onChange={(event) => set({ warehouse_id: Number(event.target.value) })} /></Field>
        {(['scheduled_start', 'scheduled_end'] as const).map((key) => <Field key={key} label={key === 'scheduled_start' ? t('بداية الموعد', 'Appointment start (local time)') : t('نهاية الموعد', 'Appointment end (local time)')}><Input disabled={final} type="datetime-local" value={String(values[key] ?? '').slice(0, 16)} onChange={(event) => set({ [key]: event.target.value || null })} /></Field>)}
      </div>}
      {custom.renderRecord(values, setValues, DOMAIN_FORM_WIDGETS, final || Boolean(record?.id && ['profiles', 'requests'].includes(kind)))}
      {kind === 'profiles' && <Sheet title={t('مراحل الفلتر', 'Filter stages')} bodyClassName="grid gap-3 p-3">{stages.map((stage, index) => <div key={index} className="grid grid-cols-3 gap-2">
        <Input disabled={Boolean(record)} aria-label={t('مفتاح المرحلة', 'Stage key')} placeholder="stage_1" value={stage.stage_key} onChange={(event) => setStages(stages.map((row, i) => i === index ? { ...row, stage_key: event.target.value } : row))} />
        <Input disabled={Boolean(record)} aria-label={t('اسم المرحلة بالعربية', 'Arabic stage label')} placeholder="العربية" value={stage.label_ar} onChange={(event) => setStages(stages.map((row, i) => i === index ? { ...row, label_ar: event.target.value } : row))} />
        <Input disabled={Boolean(record)} aria-label={t('اسم المرحلة بالإنجليزية', 'English stage label')} placeholder={t('الإنجليزية', 'English')} value={stage.label_en} onChange={(event) => setStages(stages.map((row, i) => i === index ? { ...row, label_en: event.target.value } : row))} />
        <ProductPicker disabled={Boolean(record)} value={stage.replacement_product_id} onChange={(id) => setStages(stages.map((row, i) => i === index ? { ...row, replacement_product_id: id } : row))} />
        <NumberInput disabled={Boolean(record)} aria-label={t('الفاصل', 'Interval')} value={stage.interval_count} onChange={(count) => setStages(stages.map((row, i) => i === index ? { ...row, interval_count: count } : row))} />
        <Select disabled={Boolean(record)} value={stage.interval_unit} options={[{ value: 'months', label: t('شهور', 'Months') }, { value: 'days', label: t('أيام', 'Days') }]} onChange={(event) => setStages(stages.map((row, i) => i === index ? { ...row, interval_unit: event.target.value } : row))} />
      </div>)}{!record && <Button icon={Plus} onClick={() => setStages([...stages, { stage_key: '', label_ar: '', label_en: '', replacement_product_id: null, interval_count: 3, interval_unit: 'months' }])}>{t('مرحلة', 'Stage')}</Button>}</Sheet>}
      {kind === 'units' && record?.installed_on && can('service.manage') && <Field label={t('حالة الجهاز', 'Unit status')}><Select value={String(values.status)} options={['active', 'paused', 'retired', 'returned'].map((value) => ({ value, label: t(...serviceLabel(value)) }))} onChange={(event) => set({ status: event.target.value })} /></Field>}
      {kind === 'units' && record?.schedules?.length > 0 && can('service.settings') && <ScheduleCorrection unit={record} onSaved={onClose} />}
      {kind === 'units' && record?.schedules && <table className="ledger"><thead><tr><th>{t('المرحلة', 'Stage')}</th><th>{t('آخر استبدال', 'Last replacement')}</th><th>{t('الاستحقاق القادم', 'Next due')}</th></tr></thead><tbody>{record.schedules.map((stage: any) => <tr key={stage.id}><td>{t(stage.label_ar, stage.label_en)}</td><td>{stage.last_replaced_on}</td><td>{stage.next_due_on}</td></tr>)}</tbody></table>}
      {kind === 'visits' && <>
        <details><summary className="cursor-pointer muted">{t('الصور والتوقيع', 'Photos and signed report')}</summary><Sheet title={t('المرفقات', 'Attachments')} bodyClassName="grid gap-3 p-3">
          {!final && <>{[false, true].map((signature) => <Field key={String(signature)} label={signature ? t('رفع توقيع / تقرير موقع', 'Upload signature / signed report') : t('رفع صورة الزيارة', 'Upload visit photo')}><Input type="file" accept={signature ? '.pdf,image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp'} disabled={busy} onChange={async (event) => {
            const file = event.target.files?.[0]; if (!file) return
            await run(async () => { const body = new FormData(); body.append('form_key', 'service-visits'); if (record?.id) body.append('entity_id', String(record.id)); body.append('file', file)
              const result = await api.upload('/attachments', body)
              set({ attachment_ids: [...(Array.isArray(values.attachment_ids) ? values.attachment_ids : []), result.data.id], ...(signature ? { signature_attachment_id: result.data.id } : {}) })
              toast.success(t('تم رفع المرفق. احفظ الزيارة لربطه.', 'Attachment uploaded. Save the visit to link it.'))
            })
          }} /></Field>)}</>}
          {(record?.attachments ?? []).map((attachment: any) => <Button key={attachment.id} size="sm" onClick={() => void run(async () => { const blob = await api.download(`/attachments/${attachment.id}`); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = attachment.original_name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) })}>{attachment.original_name}</Button>)}
        </Sheet></details>
        <Sheet title={t('القطع المستخدمة فعلياً', 'Actual parts used')} bodyClassName="grid gap-3 p-3">{parts.map((part, index) => <div key={index} className="grid grid-cols-4 gap-2">
          <ProductPicker type="stock" warehouseId={values.warehouse_id ? Number(values.warehouse_id) : null} disabled={final} value={part.product_id} initialLabel={part.product?.name} onChange={(id, product) => setParts(parts.map((row, i) => i === index ? { ...row, product_id: id, unit_price: Number(product?.sale_price ?? 0), track_serials: product?.track_serials } : row))} />
          <NumberInput disabled={final} aria-label={t('الكمية', 'Quantity')} value={part.quantity} onChange={(quantity) => setParts(parts.map((row, i) => i === index ? { ...row, quantity } : row))} />
          <NumberInput disabled={final} aria-label={t('سعر البيع', 'Sale price')} value={part.unit_price} onChange={(unit_price) => setParts(parts.map((row, i) => i === index ? { ...row, unit_price } : row))} />
          <Select disabled={final} value={part.billing} options={['billable', 'free', 'warranty'].map((value) => ({ value, label: t(...serviceLabel(value)) }))} onChange={(event) => setParts(parts.map((row, i) => i === index ? { ...row, billing: event.target.value } : row))} />
          {(part.track_serials || part.product?.track_serials) && <Input disabled={final} aria-label={t('الأرقام المسلسلة، مفصولة بفواصل', 'Serial numbers, comma separated')} value={(part.serial_numbers ?? []).join(', ')} onChange={(event) => setParts(parts.map((row, i) => i === index ? { ...row, serial_numbers: event.target.value.split(',').map((number) => number.trim()).filter(Boolean) } : row))} />}
          {part.billing !== 'billable' && <Input disabled={final} aria-label={t('سبب المجانية', 'Free work reason')} value={part.free_reason ?? ''} onChange={(event) => setParts(parts.map((row, i) => i === index ? { ...row, free_reason: event.target.value } : row))} />}
          {!final && <Button onClick={() => setParts(parts.filter((_, i) => i !== index))}>{t('حذف', 'Remove')}</Button>}
        </div>)}{!final && <Button icon={Plus} onClick={() => setParts([...parts, { product_id: null, quantity: 1, unit_price: 0, billing: 'billable' }])}>{t('قطعة', 'Part')}</Button>}</Sheet>
        {(unitDetail.data?.data?.schedules ?? record?.request?.unit?.schedules ?? []).map((stage: any) => <Check key={stage.id} disabled={final} label={t('تم استبدال ', 'Replaced ') + t(stage.label_ar, stage.label_en)} checked={actions.some((action) => action.schedule_id === stage.id && action.action === 'replace')} onChange={(checked) => setActions(checked ? [...actions, { schedule_id: stage.id, action: 'replace', replaced_on: completedOn }] : actions.filter((action) => action.schedule_id !== stage.id))} />)}
        {!final && record?.request?.type === 'installation' && record.request.unit?.status === 'pending_installation' && <Check label={t('أؤكد تركيب الفلتر في تاريخ إكمال الزيارة وبدء مواعيد الشمعات', 'Confirm installation on the completion date and start replacement reminders')} checked={confirmInstallation} onChange={setConfirmInstallation} />}
        {!final && record && <div className="flex flex-wrap items-center gap-3">
          {['draft', 'scheduled'].includes(record.status) && <Button loading={busy} onClick={() => void run(async () => { await saveDraftForCompletion(); await api.post(`/service-visits/${record.id}/transition`, { status: record.status === 'draft' ? 'scheduled' : 'in_progress' }); onClose() })}>{record.status === 'draft' ? t('جدولة', 'Schedule') : t('بدء', 'Start')}</Button>}
          <Input aria-label={t('تاريخ إكمال الزيارة', 'Visit completion date')} type="date" value={completedOn} onChange={(event) => setCompletedOn(event.target.value)} />
          <Button variant="primary" disabled={record.status === 'draft'} loading={busy} onClick={async () => {
            if (!await confirmDialog({ title: t('مراجعة إكمال الزيارة', 'Review visit completion'), message: `${t('تاريخ التنفيذ: ', 'Work date: ')}${completedOn} · ${t('بنود القطع: ', 'Part lines: ')}${parts.length} · ${t('مراحل مستبدلة: ', 'Replaced stages: ')}${actions.filter(action => action.action === 'replace').length}. ${t('ستُخصم القطع المسجلة فعلياً وتتحدث مواعيد الاستبدال. راجع الكميات والتقرير قبل المتابعة.', 'Recorded parts will leave stock and replacement dates will advance. Review quantities and the report before continuing.')}`, confirmLabel: t('إكمال وخصم القطع مرة واحدة', 'Complete and consume parts once') })) return
            void run(async () => { await saveDraftForCompletion(); await api.postOnce(`/service-visits/${record.id}/complete`, { completed_on: completedOn, confirm_installation: confirmInstallation }, completionKey); onClose() })
          }}>{t('إكمال وخصم القطع', 'Complete and consume parts')}</Button>
        </div>}
        {record && ['completed', 'reversed'].includes(record.status) && <VisitCorrections visit={record} onSaved={onClose} onBusy={setBusy} />}
        {record?.status === 'completed' && <>
          <Button icon={Printer} onClick={() => void printElement(<ServiceReportPrint visit={record} />, { paper: 'A4', title: `Service-${record.id}` })}>{t('طباعة تقرير الزيارة', 'Print visit report')}</Button>
          {can('sales.invoices') && <Sheet title={t('الفاتورة والخدمات', 'Invoice and services')} bodyClassName="grid gap-3 p-3">{services.map((line, index) => <div key={index} className="flex gap-2"><ProductPicker type="service" value={line.product_id} onChange={(id, product) => setServices(services.map((row, i) => i === index ? { ...row, product_id: id, unit_price: Number(product?.sale_price ?? 0) } : row))} /><NumberInput aria-label={t('سعر الخدمة', 'Service price')} value={line.unit_price} onChange={(unit_price) => setServices(services.map((row, i) => i === index ? { ...row, unit_price } : row))} /></div>)}
            <Button onClick={() => setServices([...services, { product_id: null, quantity: 1, unit_price: 0 }])}>{t('إضافة خدمة', 'Add service')}</Button><Button loading={busy} onClick={() => void run(async () => { const result = await api.post(`/service-visits/${record.id}/invoice`, { services }); onClose(); navigate(`/docs/sales_invoice/${result.data.id}`) })}>{t('فتح الفاتورة', 'Open invoice')}</Button>
          </Sheet>}
        </>}
      </>}
    </div>
  </Modal>

  async function saveDraftForCompletion() { const result = await api.put(`/service-visits/${record.id}`, visitPayload()); custom.acceptSaved(result.data) }
}

function ContactForm({ row, onSaved }: { row: any; onSaved: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [outcome, setOutcome] = useState('contacted')
  const [channel, setChannel] = useState('call')
  const owners = useSession(state => state.lookups?.users ?? [])
  const [owner, setOwner] = useState(String(row.owner_id ?? ''))
  const [nextContact, setNextContact] = useState(row.next_contact_on ?? '')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const templates = useApi<any>(open ? '/maintenance/templates' : null)
  const unit = row.schedule?.unit
  return <><Button size="sm" onClick={() => setOpen(true)}>{t('تسجيل تواصل', 'Log contact')}</Button>{open && <Modal title={`${unit?.party?.name ?? ''} · ${unit?.party?.mobile ?? unit?.party?.phone ?? ''}`} onClose={() => setOpen(false)} footer={<Button variant="primary" loading={busy} onClick={async () => {
    setBusy(true); setError(null)
    try { if (owner && Number(owner) !== row.owner_id) await api.put(`/maintenance/followups/${row.id}/owner`, { owner_id: Number(owner) }); await api.post(`/maintenance/followups/${row.id}/contact`, { channel, outcome, notes: message, message, next_contact_on: nextContact || null }); setOpen(false); invalidate('/operations', '/parties', '/maintenance', '/crm'); onSaved(); if (outcome === 'booked' && unit) navigate(newRequestPath(unit.party_id, unit)) } catch (failure) { setError(failure) } finally { setBusy(false) }
  }}>{t('تسجيل', 'Log')}</Button>}>
    <div className="grid gap-3">{error ? <ErrorBox error={error} /> : null}<Select value={channel} onChange={(event) => setChannel(event.target.value)} options={['call', 'whatsapp', 'email'].map((value) => ({ value, label: t(...serviceLabel(value)) }))} />
      <Select value={outcome} onChange={(event) => setOutcome(event.target.value)} options={['contacted', 'no_answer', 'booked', 'declined'].map((value) => ({ value, label: t(...serviceLabel(value)) }))} />
      <Select value="" placeholder={t('استخدام قالب', 'Use a template')} options={(templates.data?.data ?? []).map((template: any) => ({ value: template.id, label: `${template.key} (${template.locale})` }))} onChange={(event) => { const template = templates.data?.data.find((item: any) => item.id === Number(event.target.value)); if (template) setMessage(template.body.replace(/\{\{(customer|unit|stage|due_date|company)\}\}/g, (_: string, key: string) => ({ customer: unit?.party?.name, unit: unit?.unit_code, stage: row.schedule?.label_ar, due_date: row.due_on, company: useSession.getState().lookups?.settings?.['company.name'] }[key] ?? ''))) }} />
      {can('service.view_all') && <Field label={t('مسؤول المتابعة', 'Follow-up owner')}><Select value={owner} placeholder={t('غير محدد', 'Unassigned')} options={owners.map(user => ({ value: user.id, label: user.name }))} onChange={event => setOwner(event.target.value)} /></Field>}
      <Field label={t('المتابعة القادمة', 'Next contact')}><Input type="date" value={nextContact} onChange={(event) => setNextContact(event.target.value)} /></Field>
      <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} /><Button onClick={() => void navigator.clipboard.writeText(message)}>{t('نسخ الرسالة', 'Copy message')}</Button>
    </div>
  </Modal>}</>
}

function localDateTime(value: unknown): string { return value ? dateTimeInput(String(value)) : '' }
