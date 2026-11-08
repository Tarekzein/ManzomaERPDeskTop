/** Shared deep links preserve customer, unit and request context between modules. */
export function visitPath(id: number): string { return `/service/visits?open=${id}` }
export function unitPath(id: number, partyId?: number): string { return `/service/units?open=${id}${partyId ? `&party=${partyId}` : ''}` }
export function requestVisitPath(request: { id: number; party_id?: number; visits?: { id: number; status: string }[] }): string {
  const existing = request.visits?.find((visit) => visit.status !== 'cancelled')
  return existing ? visitPath(existing.id) : `/service/visits?new=1&request=${request.id}${request.party_id ? `&party=${request.party_id}` : ''}`
}
export function newRequestPath(partyId: number, unit?: { id: number; address_id?: number | null; status?: string }): string {
  const query = new URLSearchParams({ new: '1', party: String(partyId) })
  if (unit) { query.set('unit', String(unit.id)); if (unit.address_id) query.set('address', String(unit.address_id)); if (unit.status === 'pending_installation') query.set('type', 'installation') }
  return `/service/requests?${query}`
}
const LABELS: Record<string, [string, string]> = {
  pending_installation: ['بانتظار التركيب', 'Awaiting installation'], active: ['يعمل', 'Active'], paused: ['متوقف مؤقتاً', 'Paused'], retired: ['خارج الخدمة', 'Retired'], returned: ['مرتجع', 'Returned'],
  reversed: ['تم عكس الاستهلاك', 'Consumption reversed'],
  draft: ['مسودة', 'Draft'], scheduled: ['محدد الموعد', 'Scheduled'], in_progress: ['جارٍ التنفيذ', 'In progress'], completed: ['مكتمل', 'Completed'], cancelled: ['ملغي', 'Cancelled'], open: ['مفتوح', 'Open'],
  installation: ['تركيب', 'Installation'], maintenance: ['تغيير شمعات', 'Replacement'], repair: ['إصلاح', 'Repair'], complaint: ['شكوى', 'Complaint'],
  low: ['منخفضة', 'Low'], normal: ['عادية', 'Normal'], high: ['عاجلة', 'Urgent'], billable: ['بمقابل', 'Chargeable'], free: ['مجاني', 'Free'], warranty: ['ضمان', 'Warranty'],
  contacted: ['تم التواصل', 'Contacted'], no_answer: ['لم يرد', 'No answer'], booked: ['تم الحجز', 'Booked'], declined: ['رفض', 'Declined'], call: ['مكالمة', 'Call'], whatsapp: ['واتساب', 'WhatsApp'], email: ['بريد', 'Email'], needs_review: ['راجع تاريخ التركيب', 'Review installation date'],
}
export function serviceLabel(value: string): [string, string] { return LABELS[value] ?? [value ?? '—', value ?? '—'] }

export function serviceEditorDefaults(query: URLSearchParams): Record<string, unknown> {
  const number = (key: string) => /^\d+$/.test(query.get(key) ?? '') && Number(query.get(key)) > 0 ? Number(query.get(key)) : null
  return { party_id: number('party'), unit_id: number('unit'), address_id: number('address'), request_id: number('request'), product_id: number('product'), invoice_line_id: number('invoice_line'), serial_number: query.get('serial') ?? '', purchased_on: /^\d{4}-\d{2}-\d{2}$/.test(query.get('purchased') ?? '') ? query.get('purchased') : null, type: query.get('type') === 'installation' ? 'installation' : 'maintenance' }
}
