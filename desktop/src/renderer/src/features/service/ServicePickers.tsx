import { SearchSelect } from '@/components/SearchSelect'
import { nameOf, useT } from '@/store/prefs'

export function UnitPicker({ value, partyId, initialLabel, disabled, onChange }: { value: number | null; partyId: number | null; initialLabel?: string; disabled?: boolean; onChange: (id: number | null, unit: any) => void }) {
  const t = useT()
  return <SearchSelect value={value} disabled={disabled || !partyId} initialLabel={initialLabel} fetchPath="/customer-units" fetchParams={{ party_id: partyId }}
    placeholder={partyId ? t('ابحث بالكود أو الطراز أو المسلسل', 'Search unit code, model or serial') : t('اختر العميل أولاً', 'Choose a customer first')}
    map={unit => ({ id: unit.id, label: `${unit.unit_code} · ${nameOf(unit.product)}`, hint: unit.serial?.serial_number, data: unit })}
    onChange={(id, option) => onChange(id == null ? null : Number(id), option?.data)} />
}

export function RequestPicker({ value, partyId, initialLabel, disabled, onChange }: { value: number | null; partyId?: number; initialLabel?: string; disabled?: boolean; onChange: (id: number | null) => void }) {
  const t = useT()
  return <SearchSelect value={value} disabled={disabled} initialLabel={initialLabel} fetchPath="/service-requests" fetchParams={{ party_id: partyId, status: 'open' }}
    placeholder={t('ابحث برقم الطلب أو العميل أو الهاتف', 'Search request number, customer or phone')}
    map={request => ({ id: request.id, label: `#${request.id} · ${nameOf(request.party)}`, hint: request.description, data: request })}
    onChange={id => onChange(id == null ? null : Number(id))} />
}
