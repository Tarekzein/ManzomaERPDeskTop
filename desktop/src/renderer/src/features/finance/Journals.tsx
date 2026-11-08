import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ListPage } from '@/components/ListPage'
import { DateRange, type Range } from '@/components/DateRange'
import { Button, Money, Select } from '@/components/ui'
import { StatusPill } from '@/components/Status'
import { sourceLabel, sourceLink, statusLabel } from '@/lib/docTypes'
import { date, startOfMonth, today } from '@/lib/format'
import { useT } from '@/store/prefs'
import { can } from '@/store/session'
import { navigate } from '@/store/workspace'

export const ENTRY_TYPES: Record<string, [string, string]> = {
  manual: ['يدوي', 'Manual'],
  opening: ['افتتاحي', 'Opening'],
  system: ['آلي', 'Automatic'],
  closing: ['إقفال', 'Closing'],
  reversal: ['عكسي', 'Reversal'],
}

export default function Journals() {
  const t = useT()
  const [range, setRange] = useState<Range>({ from: startOfMonth(), to: today() })
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  return (
    <ListPage
      title={t('القيود اليومية', 'Journal entries')}
      path="/journals"
      params={{ ...range, status, type }}
      onOpen={(r) => navigate(`/finance/journals/${r.id}`)}
      actions={can('journals.manage') && <Button variant="primary" icon={Plus} kbd="F2" onClick={() => navigate('/finance/journals/new')}>{t('قيد جديد', 'New entry')}</Button>}
      searchPlaceholder={t('رقم القيد أو البيان أو المرجع', 'Number, description or reference')}
      filters={<>
        <DateRange value={range} onChange={setRange} />
        <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} placeholder={t('كل الأنواع', 'All types')} options={Object.entries(ENTRY_TYPES).map(([value, [ar, en]]) => ({ value, label: t(ar, en) }))} />
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('كل الحالات', 'All statuses')} options={['draft', 'posted', 'reversed'].map((s) => ({ value: s, label: statusLabel(s) }))} />
      </>}
      csvName="journal-entries"
      csv={[{ header: 'number', value: (r: any) => r.number }, { header: 'date', value: (r: any) => r.date }, { header: 'description', value: (r: any) => r.description }, { header: 'total', value: (r: any) => r.total }, { header: 'status', value: (r: any) => r.status }]}
      columns={[
        { key: 'number', header: t('رقم القيد', 'Entry no.'), sortKey: 'number', width: 130, render: (r: any) => <span className="num font-medium">{r.number}</span> },
        { key: 'date', header: t('التاريخ', 'Date'), sortKey: 'date', width: 100, render: (r: any) => <span className="num">{date(r.date)}</span> },
        { key: 'description', header: t('البيان', 'Description'), render: (r: any) => r.description },
        { key: 'source', header: t('المصدر', 'Source'), width: 170, render: (r: any) => (r.source_type ? <button className="link" onClick={(e) => { e.stopPropagation(); const l = sourceLink(r.source_type, r.source_id); if (l) navigate(l) }}>{sourceLabel(r.source_type)} <span className="num">{r.reference}</span></button> : <span className="muted">{t(...(ENTRY_TYPES[r.type] ?? [r.type, r.type]))}</span>) },
        { key: 'total', header: t('المبلغ', 'Amount'), align: 'end', sortKey: 'total', width: 130, render: (r: any) => <Money value={r.total} /> },
        { key: 'creator', header: t('بواسطة', 'By'), width: 110, render: (r: any) => r.creator?.name ?? '' },
        { key: 'status', header: t('الحالة', 'Status'), width: 100, render: (r: any) => <StatusPill status={r.status} /> },
      ]}
    />
  )
}
