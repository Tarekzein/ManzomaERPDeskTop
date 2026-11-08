import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, Circle, ClipboardCheck, Flag, Play, RefreshCw, Upload, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { queryClient, useApi } from '@/lib/query'
import { useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { navigate, useWorkspace } from '@/store/workspace'
import { useActiveTab, useTab } from '@/workspace/TabContext'
import { Button, ErrorBox, Pill, Sheet, Spinner } from '@/components/ui'
import { CompanySettings } from '@/features/settings/CompanySettings'
import { ImportDialog, type ImportEntity } from '@/features/settings/ImportDialog'
import { PartyForm } from '@/features/parties/PartyForm'
import { GUIDE_STEPS, STEP_LABELS, type GuideState, type GuideStepKey } from './guide'

const INTRO: Record<GuideStepKey, [string, string]> = {
  company: ['ابدأ ببيانات الشركة التي ستظهر في الفواتير وتقارير الخدمة. راجع الاسم وأضف وسيلة التواصل والعنوان.', 'Start with the company details shown on invoices and service reports. Review the name and add your contact details and address.'],
  locations: ['راجع الفرع والمخزن اللذين أُنشئا للشركة. أضف الموظفين والفنيين وسياراتهم عند الحاجة؛ يمكنك العمل بحساب المدير وحده في البداية.', 'Review the branch and warehouse created for your company. Add staff, technicians and their vans if needed; the administrator can operate alone initially.'],
  finance: ['راجع السنة المالية والخزينة والضرائب وطريقة تقييم المخزون قبل أول حركة. الإعدادات الافتراضية تحتاج مراجعتك حتى لو كانت جاهزة.', 'Review the fiscal year, cash account, taxes and stock costing method before the first transaction. Seeded defaults still need your review.'],
  products: ['أضف موديلات الفلاتر والشمعات وقطع الغيار مع الوحدة والسعر والتتبع المناسب. يمكنك استيراد قائمة الأصناف بدلاً من إدخالها يدوياً.', 'Add filter models, cartridges and spare parts with their units, prices and tracking. Import your catalogue instead of entering each item if you have a list.'],
  maintenance: ['اربط موديل الفلتر بمراحله وقطع الاستبدال والفترة الفعلية لكل مرحلة. تبدأ المواعيد بعد تأكيد التركيب، وتُحدث عند الاستبدال الفعلي.', 'Connect each filter model to its stages, replacement parts and actual intervals. Due dates start after confirmed installation and update after actual replacement.'],
  customers: ['أضف العملاء ووسائل التواصل ومواقع الخدمة. يمكنك تسجيل الفلتر الذي يملكه العميل في نفس النموذج أو استيراد تاريخ الأجهزة الموجودة.', 'Add customers, contact details and service locations. Record a customer’s existing filter in the same form or import installed-filter history.'],
}
const TIPS: Partial<Record<GuideStepKey, [string, string]>> = {
  locations: ['أضف المستخدمين من شاشة المستخدمين وحدد أدوارهم. لمخزون الفني، أضف مخزناً من نوع سيارة واربطه بالفني.', 'Create users and assign their roles. For technician stock, add a van warehouse and assign its technician.'],
  finance: ['أدخل الأرصدة الافتتاحية المعتمدة فقط. إن كانت الشركة تبدأ بلا أرصدة، اتركها صفراً. لا تُنشأ أي قيود أو دفعات من هذا الدليل.', 'Enter only approved opening balances. If the company starts without balances, leave them at zero. This guide creates no journal entries or payments.'],
  products: ['لا تُدخل كميات افتراضية. استخدم بضاعة أول المدة للكميات الفعلية فقط، أو استلم المشتريات لاحقاً إن كنت تبدأ بلا مخزون. أضف خدمات التركيب والصيانة كأصناف خدمة عند الحاجة.', 'Do not invent quantities. Enter actual opening stock, or receive purchases later if starting empty. Add installation and maintenance as service items when needed.'],
  maintenance: ['استخدم الفترات الصحيحة لموديلاتك، لا أمثلة افتراضية. إذا أجّلت هذه الخطوة، يمكنك البيع لكن تذكيرات الشمعات تحتاج إعداد برامج الصيانة أولاً.', 'Use the actual intervals for your models. If you defer this step, you can sell, but cartridge reminders need maintenance profiles first.'],
  customers: ['اترك تاريخ التركيب أو الاستبدال المجهول فارغاً للمراجعة. إذا لم يكن لديك عملاء بعد، يمكنك إضافتهم عند بدء العمل دون إنشاء سجلات تجريبية.', 'Leave unknown installation or replacement dates blank for review. If you have no customers yet, add them as work arrives rather than creating sample records.'],
}
const CHECK_LABELS: Record<string, [string, string]> = {
  company_name: ['اسم الشركة', 'Company name'], company_phone: ['وسيلة التواصل', 'Contact phone'], company_address: ['عنوان الشركة', 'Company address'],
  branch: ['فرع نشط', 'Active branch'], warehouse: ['مخزن تشغيلي مرتبط بفرع نشط', 'Operational warehouse linked to an active branch'], staff: ['مستخدمون إضافيون عند الحاجة', 'Additional staff, if needed'],
  fiscal_year: ['سنة مالية مفتوحة للفترة الحالية', 'Open fiscal year covering today'], cash_account: ['خزينة أو بنك بعملة الشركة', 'Cash or bank account in the company currency'], tax: ['ضريبة القيمة المضافة الافتراضية', 'Default VAT rate'], costing: ['طريقة تقييم المخزون', 'Stock costing method'],
  stock_products: ['صنف مخزني نشط بوحدة قياس', 'Active stock item with a unit of measure'], service_products: ['أصناف لخدمات التركيب والصيانة', 'Installation and maintenance service items'], stock_received: ['مخزون فعلي مستلم أو رصيد افتتاحي عند الحاجة', 'Actual received or opening stock, if needed'],
  maintenance_profile: ['برنامج صيانة نشط يحتوي على مراحل', 'Active maintenance profile with stages'], customers: ['عميل نشط', 'Active customer'], customer_filters: ['فلاتر العملاء الموجودة عند الحاجة', 'Existing customer filters, if applicable'],
}

export default function SetupGuide() {
  const t = useT()
  const allowed = useCan()
  const tab = useTab()
  const active = useActiveTab()
  const { data, error, isLoading, isFetching, refetch } = useApi<GuideState>('/setup-guide')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const [importing, setImporting] = useState<ImportEntity | null>(null)
  const [customer, setCustomer] = useState(false)
  useEffect(() => { if (active) void refetch() }, [active, refetch])
  const selected = tab.query.get('step')
  const key = selected === 'review' || GUIDE_STEPS.includes(selected as GuideStepKey) ? selected as GuideStepKey | 'review' : data?.current_step ?? 'company'
  const step = data?.steps.find(step => step.key === key)
  const firstPending = data?.steps.findIndex(step => !step.done) ?? 0
  const currentIndex = key === 'review' ? GUIDE_STEPS.length : GUIDE_STEPS.indexOf(key)
  const changeStep = (next: string) => tab.replace(`/getting-started?step=${next}`)
  const run = async (action: 'start' | 'pause' | 'review' | 'complete', step?: GuideStepKey, defer = false) => {
    setBusy(true); setFailure(null)
    try {
      const result = await api.post<GuideState>('/setup-guide', { action, step, defer })
      queryClient.setQueryData(['/setup-guide', {}], result)
      if (action === 'pause' || action === 'complete') { useWorkspace.getState().close(tab.tabId); navigate('/dashboard') }
      else changeStep(result.status === 'completed' ? 'review' : result.current_step)
    } catch (error) { setFailure(error) } finally { setBusy(false) }
  }
  const action = (labels: [string, string], path: string, permission: string | string[]) => allowed(permission) ? <Button disabled={busy} onClick={() => navigate(path)}>{t(...labels)}<ArrowUpRight size={14} className="flow-arrow" /></Button> : null
  const closeImport = () => { setImporting(null); void refetch() }

  if (isLoading) return <Spinner label={t('جارٍ تحميل دليل الشركة…', 'Loading company setup…')} />
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />
  if (!data) return null
  const activeGuide = data.status === 'active'
  return <div className="setup-page">
    <header className="setup-heading">
      <div><div className="today-eyebrow"><ClipboardCheck size={16} />{t('بداية مرتبة لشركتك', 'A CLEAR START FOR YOUR COMPANY')}</div><h1>{t('دليل بدء العمل', 'Getting started')}</h1><p>{t('أدخل البيانات مرة واحدة، ثم ابدأ البيع والتركيب والصيانة. يُحفظ التقدم للشركة ويمكن استئنافه من أي جهاز متصل بها.', 'Enter your data once, then start selling, installing and servicing. Progress belongs to the company and can be resumed on another device connected to it.')}</p></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" icon={RefreshCw} loading={isFetching && !isLoading} onClick={() => void refetch()}>{t('تحديث الحالة', 'Refresh status')}</Button>{data.status === 'completed' && <Button size="sm" disabled={busy} onClick={() => void run('start')}>{t('مراجعة الدليل مجدداً', 'Revisit setup')}</Button>}{activeGuide && <Button size="sm" disabled={busy} onClick={() => void run('pause')}>{t('أكمل لاحقاً', 'Finish later')}</Button>}</div>
    </header>
    <div className="setup-progress"><div className="flex items-center justify-between gap-3"><strong>{t(`تمت مراجعة ${data.done} من ${data.total} خطوات`, `${data.done} of ${data.total} steps reviewed`)}</strong><Pill tone={data.status === 'completed' ? 'green' : 'brand'}>{data.status === 'completed' ? t('تم إنهاء الإعداد', 'Setup completed') : data.status === 'paused' ? t('محفوظ للاستكمال', 'Saved for later') : t('إعداد الشركة', 'Company setup')}</Pill></div><div className="setup-progress-track" role="progressbar" aria-label={t('تقدم إعداد الشركة', 'Company setup progress')} aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}><span style={{ width: `${data.done / data.total * 100}%` }} /></div></div>
    {failure ? <ErrorBox error={failure} /> : null}
    {data.status === 'not_started' || data.status === 'paused' ? <Sheet title={data.status === 'paused' ? t('جاهز لاستكمال البيانات؟', 'Ready to continue?') : t('لنجهّز الشركة للعمل', 'Let’s prepare your company')} bodyClassName="grid gap-4 p-6"><p className="muted m-0">{t('ستراجع البيانات الموجودة وتضيف الناقص من النماذج المعتادة. لا يعيد الدليل إنشاء الشركة أو تغيير أرصدتها.', 'Review existing data and fill the gaps using the normal forms. The guide does not recreate the company or change its balances.')}</p><div><Button variant="primary" icon={Play} loading={busy} onClick={() => void run('start')}>{data.status === 'paused' ? t('استئناف الدليل', 'Resume setup') : t('ابدأ الإعداد', 'Start setup')}</Button></div></Sheet> : <div className="setup-layout">
      <nav className="setup-steps" aria-label={t('خطوات إعداد الشركة', 'Company setup steps')}>
        {data.steps.map((item, index) => <button key={item.key} className="setup-step" aria-current={key === item.key ? 'step' : undefined} disabled={busy || (firstPending >= 0 && index > firstPending && !item.done && data.status !== 'completed')} onClick={() => changeStep(item.key)}><span className={`setup-step-number${item.done ? ' complete' : ''}`}>{item.done ? <CheckCircle2 size={17} /> : index + 1}</span><span className="min-w-0 flex-1"><strong>{t(...STEP_LABELS[item.key])}</strong>{item.deferred && <small>{t('مؤجل لحين الحاجة', 'Deferred until needed')}</small>}</span></button>)}
        <button className="setup-step" aria-current={key === 'review' ? 'step' : undefined} disabled={busy || (!data.can_finish && data.status !== 'completed')} onClick={() => changeStep('review')}><span className="setup-step-number"><Flag size={17} /></span><strong>{t('المراجعة والبدء', 'Review and start')}</strong></button>
      </nav>
      <div className="grid min-w-0 content-start gap-5">
        {key === 'review' ? <>
          <Sheet title={data.status === 'completed' ? t('تم تجهيز البداية', 'Your starting setup is ready') : t('راجع خطتك لبدء التشغيل', 'Review before starting')} bodyClassName="grid gap-4 p-6">
            <p className="muted m-0">{t('تمت مراجعة الإعدادات الأساسية. الخطوات المؤجلة تظل واضحة ويمكن الرجوع إليها من دليل بدء العمل في الإعدادات.', 'The basic setup has been reviewed. Deferred steps remain visible and can be revisited from Getting started in Settings.')}</p>
            {data.steps.map(item => <div key={item.key} className="setup-review-row"><span className="flex items-center gap-2">{item.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}{t(...STEP_LABELS[item.key])}</span><div className="flex items-center gap-2">{item.deferred && <Pill tone="amber">{t('مؤجل', 'Deferred')}</Pill>}<Button size="sm" variant="ghost" onClick={() => changeStep(item.key)}>{t('عرض', 'View')}</Button></div></div>)}
            {data.steps.some(item => item.deferred && item.key === 'maintenance') && <p className="setup-tip">{t('برامج الصيانة مؤجلة: لن تبدأ تذكيرات الفلاتر قبل إعداد المراحل وربطها بأجهزة العملاء وتأكيد التركيب.', 'Maintenance profiles are deferred: filter reminders need configured stages, linked customer filters and confirmed installation.')}</p>}
            <div className="flex flex-wrap gap-2">{action(['راجع النسخ الاحتياطي', 'Review backups'], '/settings/backup', 'backup.manage')}{action(['أضف أول فاتورة', 'Create your first invoice'], '/docs/sales_invoice/new', 'sales.invoices')}{action(['سجل طلب خدمة', 'Create a service request'], '/service/requests?new=1', 'service.manage')}</div>
          </Sheet>
          <div className="setup-footer"><Button onClick={() => navigate('/dashboard')}>{t('لوحة اليوم', 'Today')}</Button>{activeGuide && <Button icon={CheckCircle2} variant="primary" loading={busy} disabled={!data.can_finish} onClick={() => void run('complete')}>{t('إنهاء الإعداد وبدء العمل', 'Finish setup and start work')}</Button>}</div>
        </> : step && <>
          <Sheet title={<span className="flex items-center gap-2"><span className="muted num">{currentIndex + 1}.</span>{t(...STEP_LABELS[step.key])}</span>} bodyClassName="grid gap-5 p-5">
            <p className="muted m-0">{t(...INTRO[step.key])}</p>
            <ul className="setup-checks">{step.checks.map(check => <li key={check.key} data-passed={check.passed}><span>{check.passed ? <CheckCircle2 size={17} /> : <Circle size={17} />}{t(...(CHECK_LABELS[check.key] ?? [check.key, check.key]))}</span>{!check.passed && <small>{check.required ? t('مطلوب لهذه الخطوة', 'Required for this step') : t('حسب الحاجة', 'If needed')}</small>}</li>)}</ul>
            {TIPS[step.key] && <p className="setup-tip">{t(...TIPS[step.key]!)}</p>}
            <div className="flex flex-wrap gap-2">
              {step.key === 'locations' && <>{action(['راجع الفروع', 'Review branches'], '/settings/branches', 'settings.manage')}{action(['أضف المخازن والسيارات', 'Manage warehouses and vans'], '/settings/warehouses', 'settings.manage')}{action(['أضف أعضاء الفريق', 'Add your team'], '/settings/users', 'users.manage')}</>}
              {step.key === 'finance' && <>{action(['راجع الضرائب والسداد', 'Review tax and payments'], '/settings/sales', 'settings.manage')}{action(['راجع تقييم المخزون', 'Review stock costing'], '/settings/inventory', 'settings.manage')}{action(['راجع الخزائن والبنوك', 'Review cash and banks'], '/finance/treasury', 'accounts.manage')}{action(['راجع السنة المالية', 'Review fiscal year'], '/settings/fiscal', 'fiscal.manage')}{action(['أدخل الأرصدة الافتتاحية', 'Enter opening balances'], '/settings/opening', 'fiscal.manage')}</>}
              {step.key === 'products' && <>{action(['أضف صنفاً', 'Add an item'], '/inventory/products/new', 'products.manage')}{allowed('products.manage') && <Button icon={Upload} onClick={() => setImporting('products')}>{t('استيراد الأصناف', 'Import items')}</Button>}{action(['أدخل المخزون الفعلي', 'Enter actual opening stock'], '/inventory/docs/opening/new', 'stock.adjust')}{action(['أضف الموردين', 'Add suppliers'], '/parties/suppliers?new=1', 'suppliers.manage')}</>}
              {step.key === 'maintenance' && <>{action(['أضف برنامج صيانة', 'Add maintenance profile'], '/service/profiles?new=1', 'service.settings')}{action(['حدد مسؤولي المتابعة', 'Choose follow-up owners'], '/settings/maintenance', 'settings.manage')}</>}
              {step.key === 'customers' && <>{allowed('customers.manage') && <><Button icon={UserPlus} onClick={() => setCustomer(true)}>{t('أضف عميلاً وفلتره', 'Add customer and filter')}</Button><Button icon={Upload} onClick={() => setImporting('customers')}>{t('استيراد العملاء', 'Import customers')}</Button></>}{allowed('service.manage') && allowed('service.view_all') && <Button icon={Upload} onClick={() => setImporting('customer-units')}>{t('استيراد تاريخ الفلاتر', 'Import filter history')}</Button>}{action(['سجل فلتر عميل', 'Register a customer filter'], '/service/units?new=1', 'service.manage')}</>}
            </div>
          </Sheet>
          {step.key === 'company' && <CompanySettings section="company" onSaved={activeGuide ? () => run('review', 'company') : undefined} />}
          <div className="setup-footer">
            {currentIndex > 0 ? <Button disabled={busy} onClick={() => changeStep(GUIDE_STEPS[currentIndex - 1])}><ArrowLeft size={15} className="flow-arrow" />{t('السابق', 'Previous')}</Button> : <span />}
            <div className="flex flex-wrap gap-2">{activeGuide && !step.required && <Button disabled={busy} onClick={() => void run('review', step.key, true)}>{t('أجّل هذه الخطوة', 'Set up later')}</Button>}{activeGuide && step.key !== 'company' && <Button variant="primary" loading={busy} disabled={!step.ready} onClick={() => void run('review', step.key)}>{t('راجعت البيانات، متابعة', 'Reviewed, continue')}<ArrowRight size={15} className="flow-arrow" /></Button>}{data.status === 'completed' && <Button onClick={() => changeStep('review')}>{t('العودة للمراجعة', 'Back to summary')}</Button>}</div>
          </div>
        </>}
      </div>
    </div>}
    {importing && <ImportDialog entity={importing} onClose={closeImport} />}
    {customer && <PartyForm role="customer" onClose={() => { setCustomer(false); void refetch() }} />}
  </div>
}
