import { useState } from 'react'
import { CalendarPlus, FilePlus2, HandCoins, Pencil, Phone, Plus, Printer, Wallet } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, startOfYear, today } from '@/lib/format'
import { docLabel } from '@/lib/docTypes'
import { nameOf, useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab, useTabTitle } from '@/workspace/TabContext'
import { Button, ErrorBox, Kv, Money, PageHeader, Pill, Segmented, Sheet, Spinner } from '@/components/ui'
import { DataTable } from '@/components/DataTable'
import { StatusPill } from '@/components/Status'
import { StatementTable } from '@/components/Statement'
import { DateRange } from '@/components/DateRange'
import { printElement } from '@/features/print/printService'
import { StatementPrint } from '@/features/print/templates'
import { ActivityForm } from '@/features/crm/ActivityForm'
import { newRequestPath, serviceLabel, unitPath, visitPath } from '@/features/service/workflow'
import { PartyForm } from './PartyForm'

/** The customer file is the entry point for filters, visits and money owed. */
export default function PartyView() {
  const t = useT()
  const allowed = useCan()
  const { params } = useTab()
  const [view, setView] = useState('service')
  const [range, setRange] = useState({ from: startOfYear(), to: today() })
  const [edit, setEdit] = useState(false)
  const [activity, setActivity] = useState(false)
  const party = useApi<any>(`/parties/${params.id}`)
  const p = party.data?.data
  const isCustomer = Boolean(p?.is_customer)
  const service = isCustomer && allowed('service.view')
  const current = !service && view === 'service' ? 'invoices' : view
  const overview = useApi<any>(current === 'invoices' ? `/parties/${params.id}/overview` : null)
  const statement = useApi<any>(current === 'statement' ? `/parties/${params.id}/statement` : null, range)
  const units = useApi<any>(service && current === 'service' ? '/customer-units' : null, { party_id: params.id, per_page: 10 })
  const visits = useApi<any>(service && current === 'service' ? '/service-visits' : null, { party_id: params.id, per_page: 5 })
  const communications = useApi<any>(service && current === 'service' && allowed('crm.view') ? '/crm/activities' : null, { party_id: params.id, per_page: 5 })
  const coordinator = allowed('service.manage') && allowed('service.view_all')
  useTabTitle(p ? nameOf(p) : undefined)
  if (party.isLoading) return <Spinner />
  if (party.error) return <ErrorBox error={party.error} />
  if (!p) return null
  const summary = party.data.summary
  return <div className="grid gap-4 p-5">
    <PageHeader title={nameOf(p)} actions={<>
      {isCustomer && coordinator && <Button variant="primary" icon={CalendarPlus} onClick={() => navigate(newRequestPath(p.id))}>{t('طلب خدمة', 'Request service')}</Button>}
      {allowed(p.is_supplier && !p.is_customer ? 'suppliers.manage' : 'customers.manage') && <Button icon={Pencil} onClick={() => setEdit(true)}>{t('تعديل', 'Edit')}</Button>}
    </>} />
    <div className="flex flex-wrap items-center gap-4 rounded-lg p-4" style={{ background: 'var(--sheet-2)' }}>
      <span className="inline-flex items-center gap-2"><Phone size={16} /><span className="num">{p.mobile || p.phone || '—'}</span></span>
      <span>{p.address || p.city || t('لم يُسجل عنوان', 'No address recorded')}</span>
      <span className="ms-auto">{t('الرصيد المستحق', 'Outstanding balance')}: <Money value={isCustomer ? summary?.balance : -Number(summary?.balance ?? 0)} paren colored /></span>
      {!p.is_active && <Pill tone="red">{t('موقوف', 'Inactive')}</Pill>}
    </div>
    <Segmented value={current} onChange={setView} options={[
      ...(service ? [{ value: 'service', label: t('الفلاتر والخدمة', 'Filters & service') }] : []),
      { value: 'invoices', label: t('الفواتير والتحصيل', 'Invoices & payments') },
      { value: 'statement', label: t('كشف الحساب', 'Statement') },
    ]} />
    {current === 'service' && <div className="grid items-start gap-4 lg:grid-cols-2">
      <Sheet title={t('فلاتر العميل', 'Customer filters')} actions={coordinator && <Button icon={Plus} size="sm" onClick={() => navigate(`/service/units?new=1&party=${p.id}`)}>{t('تسجيل فلتر', 'Register filter')}</Button>} bodyClassName="grid gap-3 p-4">
        {units.isLoading ? <Spinner /> : units.error ? <ErrorBox error={units.error} /> : <>
          {!units.data?.data?.length && <p className="muted">{t('سجل الفلتر وتاريخ تركيبه لتبدأ تذكيرات تغيير الشمعات.', 'Register a filter and its installation date to start replacement reminders.')}</p>}
          {units.data?.data?.map((unit: any) => <div key={unit.id} className="grid gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--rule)' }}>
            <div className="flex flex-wrap justify-between gap-2"><strong>{nameOf(unit.product)} · {unit.unit_code}</strong><Pill>{t(...serviceLabel(unit.status))}</Pill></div>
            {unit.serial && <span className="num muted">{unit.serial.serial_number}</span>}
            {unit.address && <div className="muted">{unit.address.label} · {unit.address.street}</div>}
            {unit.schedules?.map((stage: any) => <div key={stage.id} className="flex justify-between gap-2 text-[12px]"><span>{t(stage.label_ar, stage.label_en)}</span><span className="num">{stage.next_due_on ? date(stage.next_due_on) : t('راجع التاريخ', 'Review date')}</span></div>)}
            <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => navigate(unitPath(unit.id, p.id))}>{unit.status === 'pending_installation' ? t('تأكيد التركيب', 'Confirm installation') : t('تفاصيل الفلتر', 'Filter details')}</Button>{coordinator && <Button size="sm" onClick={() => navigate(newRequestPath(p.id, unit))}>{t('طلب زيارة', 'Request visit')}</Button>}</div>
          </div>)}
          {(units.data?.total ?? 0) > 10 && <Button onClick={() => navigate(`/service/units?party=${p.id}`)}>{t('كل الفلاتر', 'All filters')} ({units.data.total})</Button>}
        </>}
      </Sheet>
      <div className="grid gap-4">
        <Sheet title={t('آخر الزيارات', 'Recent visits')} actions={<Button size="sm" variant="ghost" onClick={() => navigate(`/service/visits?party=${p.id}`)}>{t('الكل', 'All')}</Button>} bodyClassName="grid gap-2 p-4">
          {visits.error ? <ErrorBox error={visits.error} /> : visits.isLoading ? <Spinner /> : !visits.data?.data?.length ? <p className="muted">{t('لا توجد زيارات بعد.', 'No visits yet.')}</p> : visits.data.data.map((visit: any) => <Button key={visit.id} onClick={() => navigate(visitPath(visit.id))}>#{visit.id} · {visit.technician?.name} · {t(...serviceLabel(visit.status))}</Button>)}
          {coordinator && <Button variant="ghost" onClick={() => navigate(`/service/requests?party=${p.id}`)}>{t('طلبات خدمة العميل', 'Customer service requests')}</Button>}
        </Sheet>
        <Sheet title={t('بيانات التواصل', 'Contact details')} actions={allowed('crm.manage') && <Button size="sm" onClick={() => setActivity(true)}>{t('تسجيل مكالمة / ملاحظة', 'Log call / note')}</Button>} bodyClassName="px-4 py-2">
          {p.phone && <Kv label={t('الهاتف', 'Phone')}>{p.phone}</Kv>}{p.email && <Kv label={t('البريد', 'Email')}>{p.email}</Kv>}
          {p.contacts?.map((contact: any) => <Kv key={contact.id} label={contact.name}>{contact.phone}</Kv>)}
          {p.notes && <p className="whitespace-pre-wrap">{p.notes}</p>}
          {communications.error ? <ErrorBox error={communications.error} /> : communications.data?.data?.map((entry: any) => <div key={entry.id} className="border-t py-2 text-[12px]" style={{ borderColor: 'var(--rule)' }}><strong>{entry.subject}</strong><span className="muted"> · {date(entry.occurred_at)} · {entry.user?.name}</span>{entry.body && <p className="muted whitespace-pre-wrap">{entry.body}</p>}</div>)}
        </Sheet>
      </div>
    </div>}
    {current === 'invoices' && <>
      <div className="flex flex-wrap gap-2">
        {isCustomer && allowed('sales.invoices') && <Button icon={FilePlus2} onClick={() => navigate(`/docs/sales_invoice/new?party=${p.id}`)}>{t('فاتورة جديدة', 'New invoice')}</Button>}
        {allowed('vouchers.manage') && <Button icon={isCustomer ? HandCoins : Wallet} onClick={() => navigate(`/finance/vouchers/${isCustomer ? 'receipt' : 'payment'}/new?party=${p.id}`)}>{isCustomer ? t('تحصيل', 'Receive payment') : t('سداد', 'Pay supplier')}</Button>}
      </div>
      {overview.error ? <ErrorBox error={overview.error} /> : overview.isLoading ? <Spinner /> : overview.data && <Sheet title={t('آخر المستندات', 'Recent documents')}><DataTable rows={overview.data.documents} compact onOpen={(row: any) => navigate(`/docs/${row.type}/${row.id}`)} columns={[
        { key: 'type', header: t('النوع', 'Type'), render: (row: any) => docLabel(row.type) },
        { key: 'number', header: t('الرقم', 'Number'), render: (row: any) => row.number.startsWith('D-') ? t('مسودة', 'Draft') : row.number },
        { key: 'date', header: t('التاريخ', 'Date'), render: (row: any) => date(row.date) },
        { key: 'total', header: t('الإجمالي', 'Total'), render: (row: any) => <Money value={row.total} /> },
        { key: 'status', header: t('الحالة', 'Status'), render: (row: any) => <StatusPill status={row.payment_status ?? row.status} /> },
      ]} /></Sheet>}
    </>}
    {current === 'statement' && <>
      <div className="flex flex-wrap gap-2"><DateRange value={range} onChange={setRange} /><Button icon={Printer} disabled={!statement.data} onClick={() => void printElement(<StatementPrint data={statement.data} />, { paper: 'A4', title: p.code })}>{t('طباعة', 'Print')}</Button></div>
      {statement.error ? <ErrorBox error={statement.error} /> : statement.isLoading ? <Spinner /> : statement.data && <StatementTable lines={statement.data.lines} opening={statement.data.opening_balance} closing={statement.data.closing_balance} />}
    </>}
    {edit && <PartyForm party={p} onClose={() => setEdit(false)} onSaved={() => void party.refetch()} />}
    {activity && <ActivityForm partyId={p.id} onClose={() => setActivity(false)} onSaved={() => void communications.refetch()} />}
  </div>
}
