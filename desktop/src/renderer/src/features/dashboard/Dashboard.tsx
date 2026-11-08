import { apiDateTime } from '@/features/forms/dateTime'
import { ArrowUpRight, CalendarCheck, CalendarDays, CalendarRange, ClipboardList, Clock3, HandCoins, Package, PackagePlus, Plus, ReceiptText, RefreshCw, Sparkles, type LucideIcon } from 'lucide-react'
import { useApi } from '@/lib/query'
import { today } from '@/lib/format'
import { nameOf, usePrefs, useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { navigate } from '@/store/workspace'
import { Button, ErrorBox, Pill, Sheet, Spinner } from '@/components/ui'
import { serviceLabel, visitPath, requestVisitPath } from '@/features/service/workflow'
import { SetupGuideCard } from '@/features/onboarding/SetupGuideCard'

export default function Dashboard() {
  const t = useT()
  const locale = usePrefs(state => state.locale)
  const allowed = useCan()
  const { data, isLoading, isFetching, error, refetch } = useApi<any>('/operations/today')
  const businessDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' }).format(new Date(`${data?.business_date ?? today()}T12:00:00Z`))
  return <div className="today-page grid gap-5">
    <section className="today-intro">
      <header className="today-heading">
        <div>
          <div className="today-eyebrow"><Sparkles size={14} />{t('مساحة العمل', 'YOUR WORKSPACE')}</div>
          <h1>{t('اليوم', 'Today')}</h1>
          <p>{t('العملاء والزيارات والمخزون؛ خطوات يومك واضحة أمامك.', 'Customers, visits and stock. A clear view of the day ahead.')}</p>
        </div>
        <div className="today-tools"><span className="today-date"><CalendarDays size={16} /><time dateTime={data?.business_date ?? today()}>{businessDate}</time></span><Button size="sm" icon={RefreshCw} loading={isFetching && !isLoading} onClick={() => void refetch()}>{t('تحديث', 'Refresh')}</Button></div>
      </header>
      <div className="today-actions">
        {allowed('service.manage') && allowed('service.view_all') && <Button variant="primary" icon={ClipboardList} onClick={() => navigate('/service/requests?new=1')}>{t('طلب خدمة', 'New service request')}</Button>}
        {allowed('customers.manage') && <Button icon={Plus} onClick={() => navigate('/parties/customers?new=1')}>{t('عميل جديد', 'New customer')}</Button>}
        {allowed('sales.invoices') && <Button icon={ReceiptText} onClick={() => navigate('/docs/sales_invoice/new')}>{t('بيع مباشر', 'Counter sale')}</Button>}
        {allowed('vouchers.manage') && <Button icon={HandCoins} onClick={() => navigate('/finance/vouchers/receipt/new')}>{t('تحصيل', 'Receive payment')}</Button>}
        {allowed('purchases.invoices') && <Button icon={PackagePlus} onClick={() => navigate('/docs/purchase_invoice/new')}>{t('شراء بضاعة', 'Buy stock')}</Button>}
      </div>
    </section>
    <SetupGuideCard />
    {error ? <ErrorBox error={error} onRetry={() => void refetch()} /> : isLoading ? <Spinner /> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data?.service && <>
          <WorkCount icon={CalendarCheck} label={t('زيارات اليوم', 'Visits today')} count={data.service.visits_today} path="/service/visits?when=today" hint={t('مواعيد الفريق لهذا اليوم', 'Your team’s scheduled appointments')} />
          <WorkCount icon={CalendarRange} label={t('تغيير شمعات خلال ٧ أيام', 'Replacements in 7 days')} count={data.service.due_week} path="/service/due" hint={t('وقت مناسب للتواصل مع العملاء', 'Plan customer follow-ups ahead')} />
          <WorkCount icon={Clock3} label={t('صيانة متأخرة', 'Overdue maintenance')} count={data.service.overdue} path="/service/due?when=overdue" tone="danger" hint={data.service.overdue ? t('تحتاج متابعة من الفريق', 'Needs a follow-up from the team') : t('لا توجد صيانة متأخرة', 'No overdue maintenance')} />
        </>}
        {data?.stock && <WorkCount icon={Package} label={t('تنبيهات نواقص المخزون', 'Low-stock alerts')} count={data.stock.low_stock} path="/inventory/reports/reorder" tone="warning" hint={data.stock.low_stock ? t('راجع القطع قبل الزيارة القادمة', 'Check parts before the next visit') : t('لا توجد تنبيهات نواقص', 'No low-stock alerts')} />}
      </div>
      {data?.service && <div className="grid items-start gap-5 lg:grid-cols-2">
        <Sheet title={t('مواعيد اليوم', 'Today’s appointments')} actions={<Button variant="ghost" size="sm" onClick={() => navigate('/service/visits')}>{t('كل الزيارات', 'All visits')}<ArrowUpRight size={14} className="flow-arrow" /></Button>} bodyClassName="grid gap-3 p-5">
          {!data.service.visits.length && <div className="queue-empty"><CalendarCheck /><strong>{t('لا توجد مواعيد اليوم', 'No appointments today')}</strong><span>{t('ستظهر المواعيد الجديدة هنا عند جدولتها.', 'New appointments appear here when scheduled.')}</span></div>}
          {data.service.visits.map((visit: any) => <button key={visit.id} className="appointment-row" onClick={() => navigate(visitPath(visit.id))}>
            <span className="appointment-time num">{visit.scheduled_start ? apiDateTime(visit.scheduled_start).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }) : '—'}</span>
            <span className="min-w-0 flex-1"><strong className="block truncate text-[14px] font-semibold">{nameOf(visit.request?.party)}</strong><span className="muted block text-[12px]">{visit.technician?.name || t('فني غير معيّن', 'Technician unassigned')}</span></span>
            <Pill tone="brand">{t(...serviceLabel(visit.status))}</Pill><ArrowUpRight size={15} className="flow-arrow shrink-0 muted" />
          </button>)}
          {data.service.late_visits > 0 && <Button onClick={() => navigate('/service/visits?when=late')}>{t('زيارات سابقة لم تكتمل', 'Earlier unfinished visits')}: {data.service.late_visits}</Button>}
        </Sheet>
        <Sheet title={t('الخطوة القادمة', 'Next actions')} bodyClassName="grid gap-4 p-5">
          <button className="next-action" onClick={() => navigate('/service/due?when=review')}><span className="flex items-center gap-3"><CalendarCheck size={18} className="shrink-0" /><span className="text-[13px] font-medium">{t('أجهزة بانتظار التركيب', 'Filters awaiting installation')}</span></span><span className="next-action-count num">{data.service.awaiting_installation}</span></button>
          {allowed('service.view_all') && <div>
            <div className="flex items-center justify-between gap-3 text-[12px] muted"><span>{t('طلبات بانتظار تحديد زيارة', 'Requests awaiting a visit')}</span><span className="num">{data.service.awaiting_scheduling}</span></div>
            {!data.service.requests.length && <div className="queue-empty"><ClipboardList /><strong>{t('كل الطلبات تمت جدولتها', 'All requests are scheduled')}</strong><span>{t('الطلبات الجديدة ستظهر هنا لتحديد موعدها.', 'New requests appear here when they need an appointment.')}</span></div>}
            {data.service.requests.map((request: any) => <div key={request.id} className="request-row"><div className="min-w-0 flex-1"><strong className="text-[13px] font-semibold">{nameOf(request.party)}</strong><div className="muted line-clamp-2 text-[12px]">{request.description}</div></div>{allowed('service.manage') && <Button size="sm" onClick={() => navigate(requestVisitPath(request))}>{t('حدد زيارة', 'Schedule visit')}</Button>}</div>)}
          </div>}
        </Sheet>
      </div>}
      {data?.stock?.alerts.length > 0 && <Sheet title={t('قطع تحتاج شراء أو تموين', 'Parts to buy or replenish')} bodyClassName="flex flex-wrap gap-2 p-5">{data.stock.alerts.map((alert: any, index: number) => <Button key={`${alert.product_id}-${alert.warehouse_id}-${index}`} icon={Package} onClick={() => navigate(`/inventory/card/${alert.product_id}`)}>{nameOf(alert)}</Button>)}</Sheet>}
      {!data?.service && !data?.stock && <Sheet title={t('ابدأ العمل', 'Start work')} bodyClassName="p-5"><p className="muted">{t('اختر العملاء أو الفواتير والتحصيل من القائمة حسب صلاحياتك.', 'Open customers or invoices and payments from the menu for your role.')}</p></Sheet>}
    </>}
  </div>
}

function WorkCount({ label, count, path, hint, icon: Icon, tone }: { label: string; count: number; path: string; hint: string; icon: LucideIcon; tone?: 'danger' | 'warning' }) {
  return <button className="work-count" data-tone={count > 0 ? tone : undefined} onClick={() => navigate(path)}><span className="work-count-heading"><span>{label}</span><span className="work-count-icon"><Icon size={18} /></span></span><span className="work-count-total"><strong className="num">{count}</strong><ArrowUpRight size={16} className="flow-arrow" /></span><small>{hint}</small></button>
}
