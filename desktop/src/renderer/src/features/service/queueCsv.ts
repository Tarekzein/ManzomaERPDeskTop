import type { CsvColumn } from '@/lib/csv'
import { nameOf } from '@/store/prefs'
import { serviceLabel } from './workflow'

export function serviceContext(row: any) {
  const unit = row.unit ?? row.schedule?.unit ?? row.request?.unit ?? (row.unit_code ? row : undefined)
  return { unit, party: row.party ?? row.request?.party ?? unit?.party }
}

export function serviceCsv(section: string, t: (ar: string, en: string) => string): CsvColumn<any>[] {
  if (section === 'profiles') return [
    { header: t('البرنامج', 'Profile'), value: row => row.name }, { header: t('الطراز', 'Model'), value: row => nameOf(row.product) },
    { header: t('الإصدار', 'Version'), value: row => row.version }, { header: t('عدد المراحل', 'Stages'), value: row => row.stages?.length ?? 0 },
    { header: t('نشط', 'Active'), value: row => row.active ? t('نعم', 'Yes') : t('لا', 'No') },
  ]
  const columns: CsvColumn<any>[] = [
    { header: t('الرقم', 'ID'), value: row => row.id }, { header: t('العميل', 'Customer'), value: row => nameOf(serviceContext(row).party) },
    { header: t('الهاتف', 'Phone'), value: row => serviceContext(row).party?.mobile || serviceContext(row).party?.phone },
    { header: t('كود الفلتر', 'Unit code'), value: row => serviceContext(row).unit?.unit_code },
    { header: t('الطراز', 'Model'), value: row => nameOf(serviceContext(row).unit?.product) },
    { header: t('الحالة', 'Status'), value: row => row.status ? t(...serviceLabel(row.status)) : '' },
  ]
  if (section === 'units') columns.push(
    { header: t('المسلسل', 'Serial'), value: row => row.serial?.serial_number }, { header: t('تاريخ التركيب', 'Installation date'), value: row => row.installed_on },
    { header: t('نهاية الضمان', 'Warranty end'), value: row => row.warranty_ends_on },
  )
  if (['due', 'followups'].includes(section)) columns.push(
    { header: t('المرحلة', 'Stage'), value: row => { const stage = row.schedule ?? row; return stage.label_ar ? t(stage.label_ar, stage.label_en) : '' } },
    { header: t('الاستحقاق', 'Due date'), value: row => row.next_due_on ?? row.due_on },
  )
  if (section === 'followups') columns.push({ header: t('التواصل القادم', 'Next contact'), value: row => row.next_contact_on }, { header: t('رقم المسؤول', 'Owner ID'), value: row => row.owner_id })
  if (section === 'requests') columns.push({ header: t('نوع الطلب', 'Request type'), value: row => t(...serviceLabel(row.type)) }, { header: t('الأولوية', 'Priority'), value: row => t(...serviceLabel(row.priority)) })
  if (['requests', 'visits'].includes(section)) columns.push({ header: t('الوصف', 'Description'), value: row => row.description ?? row.request?.description })
  if (section === 'visits') columns.push(
    { header: t('الفني', 'Technician'), value: row => row.technician?.name }, { header: t('المخزن / السيارة', 'Warehouse / van'), value: row => nameOf(row.warehouse) },
    { header: t('بداية الموعد — UTC', 'Appointment start — UTC'), value: row => row.scheduled_start }, { header: t('نهاية الموعد — UTC', 'Appointment end — UTC'), value: row => row.scheduled_end },
    { header: t('تاريخ التنفيذ', 'Work date'), value: row => row.completed_on },
  )
  return columns
}
