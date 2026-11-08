import { useApi } from '@/lib/query'
import { useT, nameOf } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { Button, ErrorBox, Sheet } from '@/components/ui'
import { unitPath } from './workflow'

/** Register installed ownership from the original sale without moving stock again. */
export function RegisterSoldFilters({ invoice }: { invoice: any }) {
  const t = useT()
  const profiles = useApi<any>('/maintenance/profiles')
  const registered = useApi<any>('/customer-units/invoice-registrations', { invoice_id: invoice.id })
  const lines = (invoice.lines ?? []).filter((line: any) => profiles.data?.data?.some((profile: any) => profile.active && profile.product_id === line.product_id))
  if (profiles.error || registered.error) return <ErrorBox error={profiles.error || registered.error} />
  if (!lines.length) return null
  return <Sheet title={t('تركيب الفلاتر المباعة', 'Install sold filters')} bodyClassName="grid gap-2 p-3">
    <p className="muted text-[12px]">{t('سجل جهاز العميل ثم أكد تاريخ التركيب لتبدأ مواعيد تغيير الشمعات.', 'Register the customer’s filter, then confirm installation to start replacement reminders.')}</p>
    {lines.flatMap((line: any) => (line.serial_numbers?.length ? line.serial_numbers : ['']).map((serial: string) => {
      const existing = serial ? (registered.data?.serial_units ?? []).find((unit: any) => unit.invoice_line_id === line.id && unit.serial_number === serial) : null
      const full = Number(registered.data?.counts?.[line.id] ?? 0) >= (Number(line.quantity) - Number(line.processed_quantity ?? 0)) * Number(line.factor)
      return <Button key={`${line.id}-${serial}`} disabled={registered.isLoading} onClick={() => {
        if (existing) { navigate(unitPath(existing.id, invoice.party_id)); return }
        if (full) { navigate(`/service/units?party=${invoice.party_id}`); return }
        const query = new URLSearchParams({ new: '1', party: String(invoice.party_id), product: String(line.product_id), invoice_line: String(line.id), purchased: invoice.date.slice(0, 10) })
        if (serial) query.set('serial', serial)
        navigate(`/service/units?${query}`)
      }}>{existing || full ? t('عرض الفلاتر المسجلة: ', 'View registered filters: ') : t('تسجيل ', 'Register ')}{nameOf(line.product)} {serial}</Button>
    }))}
  </Sheet>
}
