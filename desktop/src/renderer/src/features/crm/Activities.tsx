import { useState } from 'react'
import { ListPage } from '@/components/ListPage'
import { DateRange } from '@/components/DateRange'
import { Select } from '@/components/ui'
import { datetime, startOfMonth, today } from '@/lib/format'
import { useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { ACTIVITY_TYPES } from './ActivityForm'

export default function Activities() {
  const t = useT()
  const [range, setRange] = useState({ from: startOfMonth(), to: today() })
  const [type, setType] = useState('')
  return (
    <ListPage
      title={t('الأنشطة', 'Activities')}
      path="/crm/activities"
      params={{ ...range, type }}
      defaultSort="-occurred_at"
      onOpen={(r: any) => (r.party ? navigate(`/parties/view/${r.party.id}`) : r.lead && navigate(`/crm/leads/${r.lead.id}`))}
      filters={<><DateRange value={range} onChange={setRange} /><Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} placeholder={t('كل الأنواع', 'All types')} options={ACTIVITY_TYPES.map((a) => ({ value: a.value, label: t(a.ar, a.en) }))} /></>}
      csvName="activities"
      csv={[{ header: 'date', value: (r: any) => r.occurred_at }, { header: 'type', value: (r: any) => r.type }, { header: 'subject', value: (r: any) => r.subject }, { header: 'user', value: (r: any) => r.user?.name }]}
      columns={[
        { key: 'occurred_at', header: t('الوقت', 'When'), sortKey: 'occurred_at', width: 140, render: (r: any) => <span className="num">{datetime(r.occurred_at)}</span> },
        { key: 'type', header: t('النوع', 'Type'), width: 100, render: (r: any) => { const a = ACTIVITY_TYPES.find((x) => x.value === r.type); return a ? <span className="inline-flex items-center gap-1.5"><a.icon size={13} />{t(a.ar, a.en)}</span> : r.type } },
        { key: 'subject', header: t('الموضوع', 'Subject'), render: (r: any) => <div><div>{r.subject}</div>{r.body && <div className="muted max-w-[480px] truncate text-[11px]">{r.body}</div>}</div> },
        { key: 'with', header: t('مع', 'With'), render: (r: any) => r.party?.name ?? r.lead?.company_name ?? r.lead?.name ?? '' },
        { key: 'user', header: t('بواسطة', 'By'), width: 120, render: (r: any) => r.user?.name ?? '' },
      ]}
    />
  )
}
