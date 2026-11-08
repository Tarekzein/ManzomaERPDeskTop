import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ListPage } from '@/components/ListPage'
import { Button, Check, Money, Pill, Select } from '@/components/ui'
import { StatusPill } from '@/components/Status'
import { statusLabel } from '@/lib/docTypes'
import { date } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { useCan, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { LeadForm } from './LeadForm'

export default function Leads() {
  const t = useT()
  const allowed = useCan()
  const sources = useSession((s) => s.lookups?.crm_sources ?? [])
  const [form, setForm] = useState(false)
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [mine, setMine] = useState(false)
  return (
    <>
      <ListPage
        title={t('العملاء المحتملون', 'Leads')}
        path="/crm/leads"
        params={{ status, source_id: source, mine: mine ? 1 : undefined }}
        onOpen={(r) => navigate(`/crm/leads/${r.id}`)}
        actions={allowed('crm.manage') && <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>{t('عميل محتمل جديد', 'New lead')}</Button>}
        searchPlaceholder={t('الاسم أو الشركة أو الهاتف', 'Name, company or phone')}
        filters={<>
          <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('كل الحالات', 'All statuses')} options={['new', 'contacted', 'qualified', 'unqualified', 'converted'].map((s) => ({ value: s, label: statusLabel(s) }))} />
          <Select className="w-auto" value={source} onChange={(e) => setSource(e.target.value)} placeholder={t('كل المصادر', 'All sources')} options={sources.map((s: any) => ({ value: s.id, label: nameOf(s) }))} />
          {allowed('crm.view_all') && <Check checked={mine} onChange={setMine} label={t('عملائي فقط', 'Mine only')} />}
        </>}
        csvName="leads"
        csv={[{ header: 'name', value: (r: any) => r.name }, { header: 'company', value: (r: any) => r.company_name }, { header: 'mobile', value: (r: any) => r.mobile }, { header: 'status', value: (r: any) => r.status }, { header: 'score', value: (r: any) => r.score }]}
        columns={[
          { key: 'name', header: t('الاسم', 'Name'), sortKey: 'name', render: (r: any) => <div><div className="font-medium">{r.company_name || r.name}</div>{r.company_name && <div className="muted text-[11px]">{r.name}</div>}</div> },
          { key: 'mobile', header: t('الموبايل', 'Mobile'), width: 130, render: (r: any) => <span className="num">{r.mobile || r.phone}</span> },
          { key: 'source', header: t('المصدر', 'Source'), width: 120, render: (r: any) => nameOf(r.source) },
          { key: 'owner', header: t('المسؤول', 'Owner'), width: 120, render: (r: any) => r.owner?.name ?? '' },
          { key: 'score', header: t('التقييم', 'Score'), sortKey: 'score', width: 90, render: (r: any) => <span className="inline-flex items-center gap-2"><span className="h-1.5 w-12 overflow-hidden rounded-full" style={{ background: 'var(--rule)' }}><span className="block h-full" style={{ width: `${r.score}%`, background: r.score >= 60 ? 'var(--ledger)' : r.score >= 30 ? 'var(--amber)' : 'var(--ink-3)' }} /></span><span className="num text-[11px] muted">{r.score}</span></span> },
          { key: 'value', header: t('القيمة المتوقعة', 'Expected value'), align: 'end', sortKey: 'expected_value', width: 120, render: (r: any) => <Money value={r.expected_value} /> },
          { key: 'deals', header: t('صفقات', 'Deals'), width: 70, render: (r: any) => (r.open_opportunities ? <Pill tone="blue">{r.open_opportunities}</Pill> : '') },
          { key: 'status', header: t('الحالة', 'Status'), width: 110, render: (r: any) => <StatusPill status={r.status} /> },
          { key: 'created', header: t('أضيف', 'Added'), sortKey: 'created_at', width: 95, render: (r: any) => <span className="num muted">{date(r.created_at)}</span> },
        ]}
      />
      {form && <LeadForm onClose={() => setForm(false)} onSaved={(l) => navigate(`/crm/leads/${l.id}`)} />}
    </>
  )
}
