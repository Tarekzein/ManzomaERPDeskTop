import { useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { ListPage } from '@/components/ListPage'
import { Button, Check, Money, Pill, Select } from '@/components/ui'
import { LookupSelect } from '@/components/Pickers'
import { qty, toNumber } from '@/lib/format'
import { nameOf, useT } from '@/store/prefs'
import { can, useCan } from '@/store/session'
import { navigate } from '@/store/workspace'
import { ImportDialog } from '@/features/settings/ImportDialog'

export default function Products() {
  const t = useT()
  const allowed = useCan()
  const [category, setCategory] = useState<number | null>(null)
  const [warehouse, setWarehouse] = useState<number | null>(null)
  const [type, setType] = useState('')
  const [low, setLow] = useState(false)
  const [importing, setImporting] = useState(false)
  const showCost = can('inventory.view_cost')
  return (
    <>
      <ListPage
        title={t('الأصناف', 'Items')}
        path="/products"
        params={{ category_id: category, warehouse_id: warehouse, type, low_stock: low ? 1 : undefined, active: 1 }}
        defaultSort="code"
        onOpen={(r) => navigate(`/inventory/products/${r.id}`)}
        actions={allowed('products.manage') && <>
          <Button icon={Upload} onClick={() => setImporting(true)}>{t('استيراد', 'Import')}</Button>
          <Button variant="primary" icon={Plus} onClick={() => navigate('/inventory/products/new')}>{t('صنف جديد', 'New item')}</Button>
        </>}
        searchPlaceholder={t('الاسم أو الكود أو الباركود', 'Name, code or barcode')}
        filters={<>
          <div className="w-44"><LookupSelect kind="categories" value={category} onChange={setCategory} placeholder={t('كل المجموعات', 'All categories')} /></div>
          <div className="w-44"><LookupSelect kind="warehouses" value={warehouse} onChange={setWarehouse} placeholder={t('كل المخازن', 'All warehouses')} /></div>
          <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} placeholder={t('مخزني وخدمي', 'Stock and service')} options={[{ value: 'stock', label: t('مخزني', 'Stock') }, { value: 'service', label: t('خدمة', 'Service') }]} />
          <Check checked={low} onChange={setLow} label={t('تحت حد الطلب', 'At or below reorder level')} />
        </>}
        csvName="items"
        csv={[
          { header: 'code', value: (r: any) => r.code }, { header: 'name', value: (r: any) => r.name }, { header: 'name_en', value: (r: any) => r.name_en },
          { header: 'category', value: (r: any) => r.category?.name }, { header: 'unit', value: (r: any) => r.base_unit?.name }, { header: 'sale_price', value: (r: any) => r.sale_price },
          { header: 'on_hand', value: (r: any) => r.on_hand }, ...(showCost ? [{ header: 'avg_cost', value: (r: any) => r.avg_cost }] : []),
        ]}
        columns={[
          { key: 'code', header: t('الكود', 'Code'), sortKey: 'code', width: 100, render: (r: any) => <span className="num">{r.code}</span> },
          { key: 'name', header: t('الصنف', 'Item'), sortKey: 'name', render: (r: any) => <span className="inline-flex items-center gap-2">{nameOf(r)}{r.type === 'service' && <Pill tone="brand">{t('خدمة', 'Service')}</Pill>}{r.uses_spare_parts && <Pill tone="brand">{t('قطع غيار تلقائية', 'Automatic parts')}</Pill>}{r.track_batches && <Pill tone="amber">{t('تشغيلات', 'Batches')}</Pill>}</span> },
          { key: 'category', header: t('المجموعة', 'Category'), width: 140, render: (r: any) => nameOf(r.category) },
          { key: 'units', header: t('الوحدات', 'Units'), width: 160, render: (r: any) => <span className="muted text-[12px]">{r.units?.map((u: any) => `${nameOf(u.unit)}${toNumber(u.factor) !== 1 ? ` ×${qty(u.factor)}` : ''}`).join(' · ')}</span> },
          { key: 'sale_price', header: t('سعر البيع', 'Sale price'), align: 'end', sortKey: 'sale_price', width: 110, render: (r: any) => <Money value={r.sale_price} /> },
          ...(showCost ? [{ key: 'avg_cost', header: t('متوسط التكلفة', 'Avg. cost'), align: 'end' as const, width: 110, render: (r: any) => <Money value={r.avg_cost} /> }] : []),
          { key: 'on_hand', header: t('الرصيد', 'On hand'), align: 'end', sortKey: 'on_hand', width: 100, render: (r: any) => (r.type === 'service' ? <span className="muted">—</span> : <span className={`num ${toNumber(r.reorder_level) > 0 && toNumber(r.on_hand) <= toNumber(r.reorder_level) ? 'neg font-semibold' : ''}`}>{qty(r.on_hand)}</span>) },
        ]}
      />
      {importing && <ImportDialog entity="products" onClose={() => setImporting(false)} />}
    </>
  )
}
