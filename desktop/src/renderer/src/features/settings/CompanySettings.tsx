import { AutomationStatus } from '@/features/service/AutomationStatus'
import { DOMAIN_FORM_WIDGETS } from '@/features/forms/DomainFormWidgets'
import { useDynamicFields } from '@/features/forms/DynamicForm'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Save, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/query'
import { nameOf, useT } from '@/store/prefs'
import { useSession } from '@/store/session'
import { Button, Check, ErrorBox, Field, Input, NumberInput, Segmented, Select, Sheet, Spinner, Textarea } from '@/components/ui'

export function CompanySettings({ section, onSaved }: { section: string; onSaved?: () => Promise<void> }) {
  const t = useT()
  const { data, isLoading, error, refetch } = useApi<any>('/settings')
  const custom = useDynamicFields('company-settings', data?.custom_meta)
  const lookups = useSession((s) => s.lookups)
  const [values, setValues] = useState<Record<string, any>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data?.data) setValues(data.data) }, [data])
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const v = (k: string) => values[k] ?? ''
  const set = (k: string, value: any) => setValues((x) => ({ ...x, [k]: value }))
  const save = async (keys: string[]) => {
    setBusy(true)
    try {
      const result = await api.put('/settings', { ...custom.payload(), values: Object.fromEntries(keys.map((k) => [k, values[k] === '' ? null : values[k]])) })
      custom.acceptSaved(result.custom_meta)
      await useSession.getState().refreshLookups()
      void refetch()
      toast.success(t('تم حفظ الإعدادات', 'Settings saved'))
      if (onSaved) await onSaved()
    } catch (e: any) {
      custom.capture(e)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  const footer = (keys: string[]) => <div className="flex justify-end px-4 pb-4"><Button variant="primary" icon={Save} loading={busy} onClick={() => save(keys)}>{onSaved ? t('حفظ ومتابعة', 'Save and continue') : t('حفظ', 'Save')}</Button></div>

  if (section === 'maintenance') {
    const keys = ['maintenance.reminder_days', 'maintenance.overdue_days', 'maintenance.owner_id', 'inventory.alert_owner_id']
    const people = (lookups?.users ?? []).map((user: any) => ({ value: user.id, label: user.name }))
    return <div className="grid gap-4"><AutomationStatus /><Sheet title={t('متابعة الشمعات ومسؤوليات الفريق', 'Replacement reminders and team responsibility')}>
      <p className="muted px-4 pt-4">{t('تُنشأ متابعة واحدة لكل مرحلة حتى استبدالها فعلياً. الاتصال أو حجز موعد لا يغيّر تاريخ الاستبدال.', 'One follow-up tracks each stage until actual replacement. Calling or booking does not reset its replacement date.')}</p>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label={t('التذكير قبل الاستحقاق — أيام', 'Remind before due — days')}><NumberInput min={0} max={365} value={v(keys[0])} onChange={value => set(keys[0], value)} /></Field>
        <Field label={t('تصعيد المتأخر بعد — أيام', 'Escalate overdue after — days')}><NumberInput min={1} max={365} value={v(keys[1])} onChange={value => set(keys[1], value)} /></Field>
        <Field label={t('مسؤول متابعة الصيانة', 'Maintenance follow-up owner')} hint={t('اتركه فارغاً لاختيار المنسق أو المدير المتاح.', 'Leave empty to use the available coordinator or administrator.')}><Select value={v(keys[2])} options={people} placeholder={t('تلقائي', 'Automatic')} onChange={event => set(keys[2], event.target.value ? Number(event.target.value) : null)} /></Field>
        <Field label={t('مسؤول تنبيهات المخزون', 'Low-stock alert owner')}><Select value={v(keys[3])} options={people} placeholder={t('تلقائي', 'Automatic')} onChange={event => set(keys[3], event.target.value ? Number(event.target.value) : null)} /></Field>
      </div>{footer(keys)}
    </Sheet></div>
  }

  if (section === 'company') {
    const keys = ['company.name', 'company.name_en', 'company.tax_number', 'company.commercial_register', 'company.activity_code', 'company.phone', 'company.email', 'company.address', 'company.logo']
    return (
      <Sheet>
        <div className="grid gap-3 p-4">
          {custom.renderRecord(values, setValues, DOMAIN_FORM_WIDGETS, busy, ['core.company.name', 'core.company.name_en', 'core.company.phone', 'core.company.email', 'core.company.address'])}
          <Field label={t('العملة', 'Currency')} hint={t('تُحدد عند إنشاء الشركة', 'Set when the company is created')} className="max-w-sm"><Input value={v('company.currency')} disabled dir="ltr" /></Field>
          <Field label={t('الشعار', 'Logo')} hint={t('يظهر في الفواتير والتقارير. PNG أو JPG حتى 400 كيلوبايت.', 'Shown on invoices and reports. PNG or JPG up to 400 KB.')} className="col-span-full">
            <div className="flex items-center gap-3">
              {v('company.logo') ? <img src={v('company.logo')} alt="" style={{ height: 56, maxWidth: 180, objectFit: 'contain', border: '1px solid var(--rule)', borderRadius: 6, padding: 4, background: '#fff' }} /> : <div className="muted text-[12px]">{t('لا يوجد شعار', 'No logo')}</div>}
              <label className="btn"><ImagePlus size={14} />{t('اختيار صورة', 'Choose image')}<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                if (file.size > 400 * 1024) { toast.error(t('الصورة أكبر من 400 كيلوبايت.', 'The image is larger than 400 KB.')); return }
                const reader = new FileReader()
                reader.onload = () => set('company.logo', String(reader.result))
                reader.readAsDataURL(file)
              }} /></label>
              {v('company.logo') && <Button variant="ghost" icon={Trash2} onClick={() => set('company.logo', null)}>{t('إزالة', 'Remove')}</Button>}
            </div>
          </Field>
        </div>
        {footer(keys)}
      </Sheet>
    )
  }

  if (section === 'sales') {
    const keys = ['sales.price_includes_tax', 'sales.default_payment_terms', 'sales.block_overdue_days', 'sales.require_salesperson', 'sales.invoice_footer', 'tax.wht_threshold', 'tax.default_vat_id']
    return (
      <Sheet>
        <div className="grid grid-cols-2 gap-4 p-4">
          <div className="col-span-2"><Check checked={Boolean(values['sales.price_includes_tax'])} onChange={(x) => set('sales.price_includes_tax', x)} label={t('أسعار البيع شاملة ضريبة القيمة المضافة (افتراضي الفواتير الجديدة)', 'Sale prices include VAT (default for new invoices)')} /></div>
          <div className="col-span-2"><Check checked={Boolean(values['sales.require_salesperson'])} onChange={(x) => set('sales.require_salesperson', x)} label={t('إلزام اختيار المندوب في فواتير المبيعات', 'Require a salesperson on sales invoices')} /></div>
          <Field label={t('مدة السداد الافتراضية (يوم)', 'Default payment terms (days)')} hint={t('تُستخدم للعملاء بدون مدة محددة', 'Used for customers without their own terms')}><NumberInput value={v('sales.default_payment_terms')} onChange={(x) => set('sales.default_payment_terms', Math.round(x))} /></Field>
          <Field label={t('إيقاف البيع الآجل عند تأخر السداد أكثر من (يوم)', 'Block credit sales when overdue more than (days)')} hint={t('0 = بدون إيقاف. التجاوز يحتاج صلاحية.', '0 = never block. Overriding needs a permission.')}><NumberInput value={v('sales.block_overdue_days')} onChange={(x) => set('sales.block_overdue_days', Math.round(x))} /></Field>
          <Field label={t('ضريبة القيمة المضافة الافتراضية', 'Default VAT rate')}><Select value={v('tax.default_vat_id')} onChange={(e) => set('tax.default_vat_id', e.target.value ? Number(e.target.value) : null)} placeholder="—" options={(lookups?.tax_rates ?? []).filter((r: any) => r.type === 'vat').map((r: any) => ({ value: r.id, label: nameOf(r) }))} /></Field>
          <Field label={t('حد الخصم والإضافة (لكل فاتورة)', 'Withholding tax threshold (per invoice)')} hint={t('لا يُحسب خصم المنبع على الفواتير الأقل من هذا المبلغ', 'No withholding below this invoice amount')}><NumberInput value={v('tax.wht_threshold')} onChange={(x) => set('tax.wht_threshold', x)} /></Field>
          <Field label={t('ملاحظة أسفل الفاتورة', 'Invoice footer note')} className="col-span-2"><Textarea rows={2} value={v('sales.invoice_footer')} onChange={(e) => set('sales.invoice_footer', e.target.value)} /></Field>
        </div>
        <div className="px-4 pb-4">{custom.render()}</div>
        {footer(keys)}
      </Sheet>
    )
  }

  if (section === 'inventory') {
    const keys = ['accounting.costing_method', 'inventory.allow_negative', 'inventory.expiry_alert_days']
    return (
      <Sheet>
        <div className="grid gap-4 p-4">
          <Field label={t('طريقة تقييم المخزون', 'Inventory costing method')} hint={t('لا يمكن تغييرها بعد تسجيل أول حركة مخزنية.', 'Cannot change after the first stock movement.')}>
            <Segmented value={v('accounting.costing_method') || 'average'} onChange={(x) => set('accounting.costing_method', x)} options={[{ value: 'average', label: t('المتوسط المرجح', 'Weighted average') }, { value: 'fifo', label: t('الوارد أولاً يصرف أولاً', 'FIFO') }]} />
          </Field>
          <Check checked={Boolean(values['inventory.allow_negative'])} onChange={(x) => set('inventory.allow_negative', x)} label={t('السماح بالبيع بدون رصيد للجميع (غير مستحسن)', 'Allow selling without stock for everyone (not recommended)')} />
          <Field label={t('التنبيه قبل انتهاء الصلاحية بـ (يوم)', 'Warn before expiry (days)')} className="max-w-[260px]"><NumberInput value={v('inventory.expiry_alert_days')} onChange={(x) => set('inventory.expiry_alert_days', Math.round(x))} /></Field>
        </div>
        <div className="px-4 pb-4">{custom.render()}</div>
        {footer(keys)}
      </Sheet>
    )
  }

  if (section === 'numbering') {
    const prefixKeys = Object.keys(values).filter((k) => k.startsWith('numbering.prefix.'))
    const labels: Record<string, [string, string]> = {
      sales_quotation: ['عرض سعر', 'Quotation'], sales_order: ['أمر بيع', 'Sales order'], sales_invoice: ['فاتورة مبيعات', 'Sales invoice'], sales_return: ['مرتجع مبيعات', 'Sales return'],
      purchase_order: ['أمر شراء', 'Purchase order'], purchase_receipt: ['إذن استلام', 'Goods receipt'], purchase_invoice: ['فاتورة مشتريات', 'Purchase invoice'], purchase_return: ['مرتجع مشتريات', 'Purchase return'],
      receipt: ['سند قبض', 'Receipt'], payment: ['سند صرف', 'Payment'], transfer: ['تحويل نقدية', 'Cash transfer'], journal: ['قيد يومية', 'Journal entry'],
      adjustment: ['تسوية مخزنية', 'Adjustment'], stock_transfer: ['تحويل مخزني', 'Stock transfer'], count: ['جرد', 'Stock count'], opening: ['أول المدة', 'Opening stock'],
    }
    const year = new Date().getFullYear()
    return (
      <Sheet>
        <p className="muted m-0 px-4 pt-3 text-[13px]">{t('الأرقام متسلسلة بدون فجوات لكل نوع ولكل سنة. المسودات لا تأخذ رقماً حتى الترحيل.', 'Numbers run without gaps per type and per year. Drafts get a number only when posted.')}</p>
        <table className="ledger">
          <thead><tr><th>{t('المستند', 'Document')}</th><th style={{ width: 140 }}>{t('البادئة', 'Prefix')}</th><th>{t('مثال', 'Example')}</th></tr></thead>
          <tbody>{prefixKeys.map((k) => {
            const type = k.replace('numbering.prefix.', '')
            return (
              <tr key={k}>
                <td>{t(...(labels[type] ?? [type, type]))}</td>
                <td><Input small value={v(k)} maxLength={8} onChange={(e) => set(k, e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} dir="ltr" /></td>
                <td className="num muted">{v(k)}-{year}-000001</td>
              </tr>
            )
          })}</tbody>
        </table>
        <div className="pt-3">{footer(prefixKeys)}</div>
      </Sheet>
    )
  }

  // printing
  const keys = ['print.receipt_header', 'print.receipt_footer', 'print.show_logo', 'print.show_qr']
  return (
    <Sheet>
      <div className="grid gap-4 p-4">
        <Check checked={values['print.show_logo'] !== false} onChange={(x) => set('print.show_logo', x)} label={t('إظهار الشعار في المطبوعات', 'Show the logo on printouts')} />
        <Check checked={values['print.show_qr'] !== false} onChange={(x) => set('print.show_qr', x)} label={t('إظهار رمز QR بالفاتورة', 'Show a QR code on invoices')} />
        <Field label={t('رأس إيصال الكاشير', 'Receipt header')}><Textarea rows={2} value={v('print.receipt_header')} onChange={(e) => set('print.receipt_header', e.target.value)} /></Field>
        <Field label={t('ذيل إيصال الكاشير', 'Receipt footer')}><Textarea rows={2} value={v('print.receipt_footer')} onChange={(e) => set('print.receipt_footer', e.target.value)} /></Field>
        <p className="muted m-0 text-[13px]">{t('الطابعات المستخدمة على هذا الجهاز تُضبط من "هذا الجهاز".', 'Which printers this computer uses is set under "This computer".')}</p>
      </div>
      <div className="px-4 pb-4">{custom.render()}</div>
        {footer(keys)}
    </Sheet>
  )
}

