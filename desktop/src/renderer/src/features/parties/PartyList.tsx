import { useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { ListPage } from '@/components/ListPage'
import { Button, Check, Money, Pill } from '@/components/ui'
import { nameOf, useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { navigate } from '@/store/workspace'
import { useTab } from '@/workspace/TabContext'
import { PartyForm } from './PartyForm'
import { ImportDialog } from '@/features/settings/ImportDialog'

export default function PartyList() {
  const t = useT()
  const allowed = useCan()
  const { path, query, replace } = useTab()
  const role = path.includes('suppliers') ? 'supplier' : 'customer'
  const [form, setForm] = useState(query.get('new') === '1')
  const [importing, setImporting] = useState(false)
  const [withBalance, setWithBalance] = useState(false)
  const [inactive, setInactive] = useState(false)
  const manage = allowed(role === 'customer' ? 'customers.manage' : 'suppliers.manage')

  return (
    <>
      <ListPage
        title={role === 'customer' ? t('العملاء', 'Customers') : t('الموردون', 'Suppliers')}
        path="/parties"
        params={{ role, with_balance_only: withBalance ? 1 : undefined, active: inactive ? 0 : 1 }}
        defaultSort="name"
        onOpen={(r) => navigate(`/parties/view/${r.id}`)}
        actions={manage && <>
          <Button icon={Upload} onClick={() => setImporting(true)}>{t('استيراد', 'Import')}</Button>
          <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>{role === 'customer' ? t('عميل جديد', 'New customer') : t('مورد جديد', 'New supplier')}</Button>
        </>}
        searchPlaceholder={t('الاسم أو الكود أو الهاتف أو الرقم الضريبي', 'Name, code, phone or tax number')}
        filters={<>
          <Check checked={withBalance} onChange={setWithBalance} label={t('لهم رصيد فقط', 'With a balance only')} />
          <Check checked={inactive} onChange={setInactive} label={t('الموقوفون', 'Inactive')} />
        </>}
        csvName={role === 'customer' ? 'customers' : 'suppliers'}
        csv={[
          { header: 'code', value: (r: any) => r.code }, { header: 'name', value: (r: any) => r.name }, { header: 'name_en', value: (r: any) => r.name_en },
          { header: 'mobile', value: (r: any) => r.mobile }, { header: 'phone', value: (r: any) => r.phone }, { header: 'city', value: (r: any) => r.city },
          { header: 'tax_number', value: (r: any) => r.tax_number }, { header: 'credit_limit', value: (r: any) => r.credit_limit }, { header: 'balance', value: (r: any) => r.balance },
        ]}
        columns={[
          { key: 'code', header: t('الكود', 'Code'), sortKey: 'code', width: 90, render: (r: any) => <span className="num">{r.code}</span> },
          { key: 'name', header: t('الاسم', 'Name'), sortKey: 'name', render: (r: any) => <span className="inline-flex items-center gap-2">{nameOf(r)}{r.is_customer && r.is_supplier && <Pill tone="brand">{t('عميل ومورد', 'Both')}</Pill>}{r.tags?.map((tg: any) => <Pill key={tg.id}>{tg.name}</Pill>)}</span> },
          { key: 'mobile', header: t('الموبايل', 'Mobile'), width: 130, render: (r: any) => <span className="num">{r.mobile || r.phone}</span> },
          { key: 'city', header: t('المدينة', 'City'), width: 110 },
          { key: 'balance', header: t('الرصيد', 'Balance'), align: 'end', sortKey: 'balance', width: 130, render: (r: any) => <Money value={role === 'supplier' ? -Number(r.balance) : r.balance} paren colored /> },
        ]}
      />
      {form && <PartyForm role={role} onClose={() => { setForm(false); if (query.has('new')) replace(path.split('?')[0]) }} onSaved={(p) => navigate(`/parties/view/${p.id}`)} />}
      {importing && <ImportDialog entity={role === 'customer' ? 'customers' : 'suppliers'} onClose={() => setImporting(false)} />}
    </>
  )
}
