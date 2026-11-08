import { createContext, useContext, type ReactNode } from 'react'
import { PartyPicker } from '@/components/Pickers'
import { Field } from '@/components/ui'
import { useT } from '@/store/prefs'
import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import type { FormWidgetProps, FormWidgets } from '@/features/forms/DynamicForm'
interface PartyContext { role: 'customer' | 'supplier'; label: string; locked: boolean; autoFocus: boolean; onChange: (id: number | null, party: any) => void }
const Context = createContext<PartyContext | null>(null)
export function TradeHeaderProvider({ value, children }: { value: PartyContext; children: ReactNode }) { return <Context.Provider value={value}>{children}</Context.Provider> }
function TradeParty({ field, value, disabled, error }: FormWidgetProps) {
  const context = useContext(Context)
  const t = useT()
  if (!context) return null
  return <Field label={t(field.label_ar, field.label_en)} error={error}><PartyPicker value={value ? Number(value) : null} role={context.role} initialLabel={context.label} disabled={disabled || context.locked} autoFocus={context.autoFocus} onChange={context.onChange} /></Field>
}
export const TRADE_FORM_WIDGETS: FormWidgets = { ...DOMAIN_FORM_WIDGETS, trade_party: TradeParty }
