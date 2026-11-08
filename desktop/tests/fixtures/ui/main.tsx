import Dashboard from '@/features/dashboard/Dashboard'
import { api } from '@/lib/api'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/app.css'
import { LicenseGate } from '@/features/boot/LicenseGate'
import { platform } from '@/lib/platform'
import { Modal } from '@/components/Dialogs'
import { Button, Field, Input, Select, Segmented, Sheet } from '@/components/ui'
import { SearchSelect } from '@/components/SearchSelect'
import { DynamicForm } from '@/features/forms/DynamicForm'
import { PostDialog } from '@/features/trading/PostDialog'
import { buildHtml } from '@/features/print/printService'
import { usePrefs, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import ServiceWorkspace from '@/features/service/ServiceWorkspace'
import { TabContext } from '@/workspace/TabContext'

// Isolated UI fixtures only. No profile, authentication token or API data is loaded.
useSession.setState({ user: { id: 1, name: 'مستخدم تجريبي', username: 'fixture', roles: [], permissions: [], is_admin: true, default_cash_account_id: 1 } as any, lookups: { settings: { 'company.currency': 'EGP' }, cash_accounts: [{ id: 1, name: 'الخزينة الرئيسية', type: 'cash' }, { id: 2, name: 'البنك', type: 'bank' }] } as any })
const actualGet = api.get
let failMore = true
const savedExports: { defaultName: string; content: string }[] = []
platform.files.save = async request => { savedExports.push({ defaultName: request.defaultName, content: String(request.content) }); return { ok: true } }
api.get = async (path, query) => {
  if (path === '/forms/service-requests') return { form_key: 'service-requests', entity_type: 'service_requests', version: 1, fields: [{ key: 'district', type: 'text', label_ar: 'المنطقة', label_en: 'District', usage_flags_json: { list: true, filter: true } }], layout: { sections: [] } } as any
  if (path === '/fixture/options') {
    if (Number(query?.page) === 2 && failMore) { failMore = false; throw new Error('Fixture next-page failure') }
    const rows = Array.from({ length: 45 }, (_, index) => ({ id: index + 1, label: `Filter ${index + 1}` })).filter(row => !query?.search || row.label.toLowerCase().includes(String(query.search).toLowerCase()))
    const page = Number(query?.page ?? 1), perPage = Number(query?.per_page ?? 20)
    return { data: rows.slice((page - 1) * perPage, page * perPage), total: rows.length, current_page: page, last_page: Math.max(1, Math.ceil(rows.length / perPage)) } as any
  }
  if (path === '/service-requests') {
    const rows = [1, 2, 3].map(id => ({ id, custom_fields: { district: id === 2 ? 'Giza' : 'Cairo' }, description: id === 3 ? 'تركيب فلتر جديد' : 'تغيير شمعات المطبخ', status: id === 3 ? 'completed' : 'open', party_id: id, party: { id, name: `أسرة ${id}`, name_en: `Household ${id}`, mobile: `0101234567${id}` }, unit: { unit_code: `WF-${id}`, product: { name: 'فلتر سبع مراحل', name_en: 'Seven-stage filter' } } }))
      .filter(row => (!query?.status || row.status === query.status) && (!query?.search || JSON.stringify(row).includes(String(query.search))))
    return { data: rows, total: rows.length, current_page: 1, last_page: 1 } as any
  }
  return path === '/operations/today' ? {
  business_date: '2026-10-27',
  service: { visits_today: 3, due_week: 8, overdue: 2, late_visits: 1, awaiting_installation: 4, awaiting_scheduling: 2,
    visits: [
      { id: 1, scheduled_start: '2026-10-27T06:30:00Z', technician: { name: 'محمد علي' }, status: 'scheduled', request: { party: { name: 'أسرة أحمد حسين', name_en: 'Ahmed Hussein household' } } },
      { id: 2, scheduled_start: '2026-10-27T09:00:00Z', technician: { name: 'أحمد حسن' }, status: 'in_progress', request: { party: { name: 'أسرة منى خالد', name_en: 'Mona Khaled household' } } },
    ], requests: [
      { id: 3, party_id: 3, party: { name: 'أسرة عمر محمود', name_en: 'Omar Mahmoud household' }, description: 'تغيير شمعات الفلتر' },
      { id: 4, party_id: 4, party: { name: 'أسرة سارة عادل', name_en: 'Sara Adel household' }, description: 'تركيب فلتر جديد' },
    ] },
  stock: { low_stock: 2, alerts: [{ product_id: 1, warehouse_id: 1, name: 'شمعة المرحلة الأولى', name_en: 'Stage 1 cartridge' }, { product_id: 2, warehouse_id: 1, name: 'ممبرين ٧٥ جالون', name_en: '75 GPD membrane' }] },
} as any : actualGet(path, query)
}
let licenseValid = false
let workspaceMounts = 0
const sampleLicense = () => ({ required: true, valid: licenseValid, error: licenseValid ? undefined : 'Activation required', issuer: 'https://license.example.test' })
platform.licensing.status = async () => sampleLicense()
platform.licensing.activate = async (_server, key) => { if (key !== 'fixture-valid-key') throw new Error('Invalid activation key'); licenseValid = true; return sampleLicense() }
platform.licensing.import = async () => { licenseValid = true; return sampleLicense() }
platform.files.openText = async () => ({ ok: true, content: 'fixture-license-file' })
function LicensedProbe() {
  useEffect(() => { workspaceMounts++ }, [])
  return <section id="licensed-workspace"><button>Company login</button><button>Import existing company</button></section>
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Review() {
  const t = useT()
  const [view, setView] = useState('overview')
  const [nested, setNested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [phone, setPhone] = useState('01012345678')
  const [filter, setFilter] = useState<number | string | null>(1)
  const [values, setValues] = useState<Record<string, unknown>>({ city: 'القاهرة', street: 'شارع النصر', floor: 'الثالث', apartment: '12' })
  ;(window as any).uiReview = {
    license: (valid: boolean) => { licenseValid = valid; window.dispatchEvent(new Event('erp:license-changed')) },
    workspaceMounts: () => workspaceMounts,
    show: setView, busy: setBusy, nested: setNested, rerender: () => setTick((value) => value + 1),
    theme: (theme: string) => { document.documentElement.dataset.theme = theme },
    locale: (locale: 'ar' | 'en') => { document.documentElement.lang = locale; document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'; usePrefs.setState({ locale }) },
    print: () => buildHtml(<div>شركة فلاتر المياه — اختبار الطباعة</div>, 'A4', 'Cairo verification'),
    exports: () => savedExports,
  }
  if (view === 'dashboard') return <div className="h-full overflow-auto"><Dashboard /></div>
  if (view === 'autofocus') return <div className="p-7"><Field label={t('طراز الفلتر', 'Filter model')}><SearchSelect autoFocus options={[{ id: 1, label: 'Seven-stage filter' }, { id: 2, label: 'Five-stage filter' }]} value={filter} onChange={setFilter} /></Field></div>
  if (view === 'remote') return <div className="p-7"><Field label={t('طراز الفلتر', 'Filter model')}><SearchSelect key="remote-fixture" autoFocus fetchPath="/fixture/options" map={row => row} value={filter} onChange={setFilter} /></Field></div>
  if (view === 'service') return <TabContext.Provider value={{ tabId: 'fixture-service', path: '/service/requests', params: { section: 'requests' }, query: new URLSearchParams(), active: true }}><ServiceWorkspace /></TabContext.Provider>
  if (view === 'gate') return <LicenseGate><LicensedProbe /></LicenseGate>
  return <div className="p-7" data-tick={tick}>
    <div className="mb-7 flex items-center justify-between"><h1 className="text-[24px] font-bold">{t('منظومة الفلاتر', 'Filter operations')}</h1><Segmented value="today" onChange={() => undefined} options={[{ value: 'today', label: t('اليوم', 'Today') }, { value: 'customers', label: t('العملاء', 'Customers') }]} /></div>
    <div className="grid gap-4 md:grid-cols-3">{[['العملاء', 'Customers', '128'], ['زيارات اليوم', 'Visits today', '12'], ['مواعيد الشمعات', 'Replacement reminders', '8']].map(([ar, en, total]) => <Sheet key={en} title={t(ar, en)} bodyClassName="p-5 text-[28px] font-semibold">{total}</Sheet>)}</div>
    <div className="mt-6 flex gap-3"><Button id="open-form" variant="primary" onClick={() => setView('form')}>{t('عميل جديد', 'New customer')}</Button><Button id="open-post" onClick={() => setView('post')}>{t('مراجعة الفاتورة', 'Review invoice')}</Button></div>
    {view === 'form' && <Modal title={t('بيانات العميل والفلتر', 'Customer and filter details')} size="wide" onClose={() => setView('overview')} footer={<><Button onClick={() => setNested(true)}>{t('تأكيد تجريبي', 'Test confirmation')}</Button><Button variant="primary" onClick={() => setView('overview')}>{t('حفظ العميل', 'Save customer')}</Button></>}>
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('اسم العميل', 'Customer name')}><Input id="fixture-name" defaultValue="أحمد محمد" /></Field>
          <Field label={t('رقم الموبايل', 'Mobile number')} hint={t('رقم التواصل لمواعيد الصيانة', 'Contact number for maintenance')}><Input id="fixture-phone" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
          <Field label={t('طراز الفلتر', 'Filter model')}><SearchSelect options={[{ id: 1, label: t('فلتر سبع مراحل', 'Seven-stage filter') }, { id: 2, label: t('فلتر خمس مراحل', 'Five-stage filter') }]} value={filter} onChange={setFilter} /></Field>
          <Field label={t('البريد الإلكتروني', 'Email')} error={t('يرجى إدخال بريد إلكتروني صحيح.', 'Enter a valid email address.')}><Input id="fixture-error" defaultValue="invalid@" /></Field>
          <Field label={t('الحالة', 'Status')}><Select options={[{ value: 'active', label: t('يعمل', 'Active') }]} /></Field>
        </div>
        <DynamicForm formKey="fixture" schema={{ form_key: 'fixture', entity_type: '', version: 1, fields: ['city', 'street', 'floor', 'apartment'].map((key, index) => ({ key, type: 'text', label_ar: ['المدينة', 'الشارع', 'الدور', 'الشقة'][index], label_en: ['City', 'Street', 'Floor', 'Apartment'][index] })), layout: { sections: [{ key: 'address', label_ar: 'عنوان الخدمة', label_en: 'Service address', columns: 4, fields: ['city', 'street', 'floor', 'apartment'] }] } }} value={values} onChange={setValues} />
      </div>
      {nested && <Modal title={t('تأكيد', 'Confirm')} onClose={() => setNested(false)} footer={<Button variant="primary" onClick={() => setNested(false)}>{t('متابعة', 'Continue')}</Button>}>{t('تحقق من البيانات قبل الحفظ.', 'Check the details before saving.')}</Modal>}
    </Modal>}
    {view === 'post' && <PostDialog type="purchase_invoice" total={1121.14} busy={busy} onClose={() => setView('overview')} onPost={(options) => { (window as any).lastPost = options }} />}
  </div>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Review /></QueryClientProvider>)
