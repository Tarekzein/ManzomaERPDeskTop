import { createContext, useContext, type ReactNode } from 'react'
import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import type { FormWidgetProps, FormWidgets } from '@/features/forms/DynamicForm'
const Context = createContext({ warehouseLocked: false, showCategory: true })
export function StockHeaderProvider({ value, children }: { value: { warehouseLocked: boolean; showCategory: boolean }; children: ReactNode }) { return <Context.Provider value={value}>{children}</Context.Provider> }
function SourceWarehouse(props: FormWidgetProps) {
  const context = useContext(Context)
  const Widget = DOMAIN_FORM_WIDGETS.stock_warehouse
  return <Widget {...props} disabled={props.disabled || context.warehouseLocked} />
}
function CountCategory(props: FormWidgetProps) {
  const context = useContext(Context)
  const Widget = DOMAIN_FORM_WIDGETS.stock_category
  return context.showCategory ? <Widget {...props} /> : null
}
export const STOCK_FORM_WIDGETS: FormWidgets = { ...DOMAIN_FORM_WIDGETS, stock_warehouse: SourceWarehouse, stock_category: CountCategory }
