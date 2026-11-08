import { SearchSelect, type Option } from './SearchSelect'
import { Select } from './ui'
import { useSession } from '@/store/session'
import { nameOf, useT } from '@/store/prefs'
import { money, qty } from '@/lib/format'

export function partyOption(p: any): Option {
  return { id: p.id, label: nameOf(p), hint: p.code, data: p }
}

export function PartyPicker({ value, onChange, role, initialLabel, autoFocus, disabled, placeholder }: { value: any; onChange: (id: number | null, party: any) => void; role?: 'customer' | 'supplier'; initialLabel?: string; autoFocus?: boolean; disabled?: boolean; placeholder?: string }) {
  const t = useT()
  return (
    <SearchSelect
      value={value}
      onChange={(id, o) => onChange(id, o?.data ?? null)}
      fetchPath="/parties"
      fetchParams={{ role, active: 1 }}
      map={partyOption}
      initialLabel={initialLabel}
      autoFocus={autoFocus}
      disabled={disabled}
      placeholder={placeholder ?? (role === 'supplier' ? t('اختر المورد', 'Choose supplier') : role === 'customer' ? t('اختر العميل', 'Choose customer') : t('اختر العميل/المورد', 'Choose customer or supplier'))}
    />
  )
}

export function productOption(p: any): Option {
  return { id: p.id, label: nameOf(p), hint: <span className="num">{p.code} · {qty(p.on_hand ?? 0)}</span>, data: p }
}

export function ProductPicker({ value, onChange, initialLabel, small, autoFocus, warehouseId, inputRef, onKeyDown, type, disabled, recipePart, excludeId }: { value: any; onChange: (id: number | null, product: any) => void; initialLabel?: string; small?: boolean; autoFocus?: boolean; warehouseId?: number | null; inputRef?: React.Ref<HTMLInputElement>; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; type?: 'stock' | 'service'; disabled?: boolean; recipePart?: boolean; excludeId?: number }) {
  const t = useT()
  return (
    <SearchSelect
      value={value}
      onChange={(id, o) => onChange(id, o?.data ?? null)}
      disabled={disabled}
      fetchPath="/products"
      fetchParams={{ active: 1, warehouse_id: warehouseId ?? undefined, type, recipe_part: recipePart ? 1 : undefined, exclude_id: excludeId }}
      map={productOption}
      initialLabel={initialLabel}
      small={small}
      autoFocus={autoFocus}
      inputRef={inputRef}
      onKeyDown={onKeyDown}
      clearable={false}
      placeholder={t('اسم الصنف أو الكود أو الباركود', 'Item name, code or barcode')}
    />
  )
}

export function AccountPicker({ value, onChange, accounts, filter, small, placeholder }: { value: any; onChange: (id: number | null, account: any) => void; accounts: any[] | undefined; filter?: (a: any) => boolean; small?: boolean; placeholder?: string }) {
  const t = useT()
  const options = (accounts ?? []).filter((a) => !a.is_group && a.is_active && (!filter || filter(a))).map((a) => ({ id: a.id, label: `${a.code} ${nameOf(a)}`, hint: a.balance !== undefined ? <span className="num">{money(a.balance)}</span> : undefined, data: a }))
  return <SearchSelect value={value} onChange={(id, o) => onChange(id, o?.data ?? null)} options={options} small={small} placeholder={placeholder ?? t('اختر الحساب', 'Choose account')} />
}

type LookupKey = 'warehouses' | 'cash_accounts' | 'branches' | 'price_lists' | 'cost_centers' | 'categories' | 'brands' | 'units' | 'crm_sources' | 'crm_lost_reasons' | 'crm_stages'

export function LookupSelect({ kind, value, onChange, placeholder, filter, small, allowEmpty = true, label, disabled }: { kind: LookupKey; value: any; onChange: (id: number | null) => void; placeholder?: string; filter?: (row: any) => boolean; small?: boolean; allowEmpty?: boolean; disabled?: boolean; label?: (row: any) => string }) {
  const lookups = useSession((s) => s.lookups)
  const rows = ((lookups?.[kind] as any[]) ?? []).filter((r) => !filter || filter(r))
  return (
    <Select
      disabled={disabled}
      small={small}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      placeholder={allowEmpty ? placeholder ?? '—' : undefined}
      options={rows.map((r) => ({ value: r.id, label: label ? label(r) : `${r.code ? r.code + ' · ' : ''}${nameOf(r)}` }))}
    />
  )
}

export function UserSelect({ value, onChange, salespeople, placeholder, small, disabled }: { value: any; onChange: (id: number | null) => void; salespeople?: boolean; placeholder?: string; small?: boolean; disabled?: boolean }) {
  const users = useSession((s) => s.lookups?.users ?? [])
  return (
    <Select
      disabled={disabled}
      small={small}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      placeholder={placeholder ?? '—'}
      options={users.filter((u: any) => !salespeople || u.is_salesperson).map((u: any) => ({ value: u.id, label: u.name }))}
    />
  )
}
