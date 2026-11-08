import { useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'
import { useApi } from '@/lib/query'
import { int, money, percent, startOfYear, today, toNumber } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { DataTable } from '@/components/DataTable'
import { DateRange } from '@/components/DateRange'
import { ErrorBox, Money, PageHeader, Sheet, Spinner } from '@/components/ui'

export default function CrmReports() {
  const t = useT()
  const [range, setRange] = useState({ from: startOfYear(), to: today() })
  const { data, isLoading, error } = useApi<any>('/reports/crm', range)
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <div className="pb-8">
      <PageHeader title={t('تقارير المتابعة', 'CRM reports')} actions={<DateRange value={range} onChange={setRange} />} />
      <div className="figure-band mx-5 sheet">
        <div><div className="muted text-[12px]">{t('عملاء محتملون جدد', 'New leads')}</div><div className="figure">{int(data.leads)}</div></div>
        <div><div className="muted text-[12px]">{t('نسبة التحويل لعملاء', 'Lead conversion')}</div><div className="figure">{percent(data.lead_conversion)}</div></div>
        <div><div className="muted text-[12px]">{t('صفقات مكسوبة', 'Deals won')}</div><div className="figure">{int(data.won_count)}</div><div className="muted num text-[11px]">{money(data.won_value)}</div></div>
        <div><div className="muted text-[12px]">{t('نسبة الفوز', 'Win rate')}</div><div className="figure">{percent(data.win_rate)}</div></div>
      </div>
      <div className="grid gap-4 px-5 pt-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Sheet title={t('المسار حسب المرحلة', 'Pipeline by stage')}>
          <div className="h-[240px] p-3" dir="ltr">
            <ResponsiveContainer>
              <BarChart data={data.pipeline.map((s: any) => ({ name: nameOf(s), value: toNumber(s.value), color: s.color }))} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: 'var(--ink-2)' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(v)} contentStyle={{ background: 'var(--sheet)', border: '1px solid var(--rule-strong)', borderRadius: 8 }} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>{data.pipeline.map((s: any, i: number) => <Cell key={i} fill={s.color ?? 'var(--ledger)'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Sheet>
        <Sheet title={t('أسباب الخسارة', 'Why deals were lost')}>
          <DataTable rows={data.lost_reasons} rowKey={(r: any) => r.id ?? 0} compact columns={[
            { key: 'name', header: t('السبب', 'Reason'), render: (r: any) => nameOf(r) || '—' },
            { key: 'count', header: t('العدد', 'Count'), align: 'end', render: (r: any) => <span className="num">{r.count}</span> },
            { key: 'value', header: t('القيمة', 'Value'), align: 'end', render: (r: any) => <Money value={r.value} /> },
          ]} empty={<div className="p-4 muted">{t('لا توجد صفقات خاسرة في الفترة', 'No lost deals in this period')}</div>} />
        </Sheet>
        <Sheet title={t('أداء المندوبين', 'Rep performance')} className="col-span-2">
          <DataTable rows={data.reps} compact columns={[
            { key: 'name', header: t('المندوب', 'Rep') },
            { key: 'leads', header: t('عملاء محتملون', 'Leads'), align: 'end', render: (r: any) => <span className="num">{r.leads}</span> },
            { key: 'activities', header: t('أنشطة', 'Activities'), align: 'end', render: (r: any) => <span className="num">{r.activities}</span> },
            { key: 'won_count', header: t('مكسوبة', 'Won'), align: 'end', render: (r: any) => <span className="num">{r.won_count}</span> },
            { key: 'won_value', header: t('قيمة المكسوب', 'Won value'), align: 'end', render: (r: any) => <Money value={r.won_value} /> },
            { key: 'lost_count', header: t('خاسرة', 'Lost'), align: 'end', render: (r: any) => <span className="num">{r.lost_count}</span> },
            { key: 'open_value', header: t('مفتوح', 'Open'), align: 'end', render: (r: any) => <Money value={r.open_value} /> },
            { key: 'overdue_tasks', header: t('متابعات متأخرة', 'Overdue follow-ups'), align: 'end', render: (r: any) => <span className={`num ${r.overdue_tasks ? 'neg' : ''}`}>{r.overdue_tasks}</span> },
          ]} />
        </Sheet>
        <Sheet title={t('مصادر العملاء', 'Lead sources')} className="col-span-2">
          <DataTable rows={data.sources} rowKey={(r: any) => r.id ?? 0} compact columns={[
            { key: 'name', header: t('المصدر', 'Source'), render: (r: any) => nameOf(r) || t('غير محدد', 'Not set') },
            { key: 'leads', header: t('عملاء محتملون', 'Leads'), align: 'end', render: (r: any) => <span className="num">{r.leads}</span> },
            { key: 'converted', header: t('تحولوا لعملاء', 'Converted'), align: 'end', render: (r: any) => <span className="num">{r.converted}</span> },
            { key: 'rate', header: t('النسبة', 'Rate'), align: 'end', render: (r: any) => <span className="num">{percent(r.leads ? (r.converted / r.leads) * 100 : null)}</span> },
          ]} />
        </Sheet>
      </div>
    </div>
  )
}
