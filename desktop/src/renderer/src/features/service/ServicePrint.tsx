import { CustomPrintFields } from '@/features/print/templates'
import { serviceLabel } from './workflow'
import { nameOf, useT } from '@/store/prefs'

export function UnitLabelPrint({ unit, qr }: { unit: any; qr?: string }) {
  const t = useT()
  return <div>{qr && <img src={qr} alt={unit.unit_code} width={120} height={120} />}<h1>{unit.unit_code}</h1><p>{nameOf(unit.party)}</p><p>{nameOf(unit.product)} · {unit.serial?.serial_number}</p>
    <p>{t('تاريخ التركيب', 'Installed')}: {unit.installed_on ?? '—'}</p><table><thead><tr><th>{t('المرحلة', 'Stage')}</th><th>{t('الاستحقاق', 'Due')}</th></tr></thead><tbody>{unit.schedules?.map((stage: any) => <tr key={stage.id}><td>{t(stage.label_ar, stage.label_en)}</td><td>{stage.next_due_on}</td></tr>)}</tbody></table></div>
}

export function ServiceReportPrint({ visit }: { visit: any }) {
  const t = useT()
  return <div><h1>{t('تقرير زيارة صيانة', 'Service visit report')} #{visit.id}</h1><p>{nameOf(visit.request?.party)} · {visit.request?.unit?.unit_code}</p><p>{visit.technician?.name} · {visit.completed_on ?? visit.completed_at}</p><p style={{ whiteSpace: 'pre-wrap' }}>{visit.report}</p>
    <table><thead><tr><th>{t('القطعة', 'Part')}</th><th>{t('الكمية', 'Quantity')}</th><th>{t('التغطية', 'Billing')}</th></tr></thead><tbody>{visit.parts?.map((part: any) => <tr key={part.id}><td>{nameOf(part.product)}</td><td>{part.quantity}</td><td>{t(...serviceLabel(part.billing))}</td></tr>)}</tbody></table>
    <CustomPrintFields record={visit} /><div className="sign"><div>{t('الفني', 'Technician')}</div><div>{t('العميل', 'Customer')}</div></div></div>
}
