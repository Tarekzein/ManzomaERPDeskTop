import { mapImportRows } from '@/lib/importMapping'
import { useState } from 'react'
import { toast } from 'sonner'
import { Download, FileUp, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { exportCsv, parseCsv } from '@/lib/csv'
import { platform } from '@/lib/platform'
import { useT } from '@/store/prefs'
import { Button } from '@/components/ui'
import { Modal } from '@/components/Dialogs'

export type ImportEntity = 'products' | 'customers' | 'suppliers' | 'customer-units'
type Entity = ImportEntity

const COLUMNS: Record<Entity, string[]> = {
  'customer-units': ['unit_code', 'customer_code', 'product_code', 'profile_name', 'profile_version', 'serial_number', 'address', 'purchased_on', 'installed_on', 'warranty_starts_on', 'warranty_ends_on', 'notes'],
  products: ['code', 'name', 'name_en', 'type', 'category_code', 'unit', 'barcode', 'sale_price', 'min_sale_price', 'purchase_price', 'reorder_level', 'vat_rate', 'track_batches', 'track_serials'],
  customers: ['code', 'name', 'name_en', 'phone', 'mobile', 'email', 'city', 'address', 'tax_number', 'credit_limit', 'payment_terms_days', 'subject_to_wht'],
  suppliers: ['code', 'name', 'name_en', 'phone', 'mobile', 'email', 'city', 'address', 'tax_number', 'payment_terms_days', 'subject_to_wht'],
}

/**
 * CSV import (Excel "CSV UTF-8"). Rows are matched by code: existing records
 * are updated, new ones created; bad rows are reported and skipped.
 */
export function ImportDialog({ entity, onClose }: { entity: Entity; onClose: () => void }) {
  const t = useT()
  const [file, setFile] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ created: number; updated: number; skipped?: number; preview?: { row: number; unit_code: string; action: string; needs_review?: boolean }[]; errors: { row: number; message: string }[] } | null>(null)
  const schema = useApi<any>(`/forms/${entity}`)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [dryRun, setDryRun] = useState(false)
  const profiles = useApi<any>(entity === 'customer-units' ? '/maintenance/profiles' : null)
  const stageColumns = entity === 'customer-units' ? [...new Set<string>((profiles.data?.data ?? []).flatMap((profile: any) => (profile.stages ?? []).map((stage: any) => `stage.${stage.stage_key}`)))] : []
  const columns = [...COLUMNS[entity], ...stageColumns, ...(schema.data?.fields ?? []).filter((field: any) => field.writable !== false).map((field: any) => `custom.${field.key}`)]
  const headers = rows.length ? Object.keys(rows[0]) : []
  const known = headers.filter((h) => columns.includes(h))
  const unknown = headers.filter((h) => !columns.includes(h) && !h.startsWith('stage.') && !Object.values(mapping).includes(h))
  const required = entity === 'customer-units' ? ['unit_code', 'customer_code', 'product_code', 'profile_name'] : ['name']
  const missingName = rows.length > 0 && required.some(key => !headers.includes(Object.hasOwn(mapping, key) ? mapping[key] : key))
  const title = { 'customer-units': t('استيراد فلاتر العملاء وتاريخ الصيانة', 'Import customer filters and maintenance history'), products: t('استيراد أصناف', 'Import items'), customers: t('استيراد عملاء', 'Import customers'), suppliers: t('استيراد موردين', 'Import suppliers') }[entity]

  const pick = async () => {
    const r = await platform.files.openText([{ name: 'CSV', extensions: ['csv', 'txt'] }])
    if (!r.ok || !r.content) return
    setMapping({})
    setFile(r.name ?? 'file.csv')
    setResult(null)
    setRows(parseCsv(r.content).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))))
  }

  const run = async (preview = false) => {
    setBusy(true)
    try {
      const r = await api.post(`/import/${entity}`, { rows: mapImportRows(rows, columns, mapping, entity === 'customer-units'), dry_run: preview })
      setResult(r); setDryRun(preview)
      invalidate(entity === 'products' ? '/products' : entity === 'customer-units' ? '/customer-units' : '/parties', '/maintenance', '/operations')
      if (!preview && !r.errors.length) toast.success(t('تم الاستيراد', 'Import finished'))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} size="xl" onClose={() => { if (!busy) onClose() }} footer={<>
      <Button icon={Download} className="me-auto" onClick={() => exportCsv(`${entity}-template`, [], columns.map((c) => ({ header: c, value: () => '' })))}>{t('تنزيل النموذج', 'Download template')}</Button>
      <Button disabled={busy} onClick={onClose}>{result ? t('إغلاق', 'Close') : t('إلغاء', 'Cancel')}</Button>
      {result && dryRun && <Button onClick={() => setResult(null)}>{t('العودة للمراجعة', 'Back to review')}</Button>}
      {!result && <Button disabled={!rows.length || missingName} loading={busy} onClick={() => void run(true)}>{t('فحص بدون حفظ', 'Validate without saving')}</Button>}
      {!result && <Button variant="primary" icon={Upload} loading={busy} disabled={!rows.length || missingName} onClick={() => void run()}>{t(`استيراد ${rows.length} صف`, `Import ${rows.length} rows`)}</Button>}
    </>}>
      {result ? (
        <div>
          {dryRun && <p>{t('نتيجة الفحص فقط؛ لم تُحفظ بيانات.', 'Validation preview; no data was saved.')}</p>}
          <div className="figure-band sheet mb-3">
            <div><div className="muted text-[12px]">{t('جديد', 'Created')}</div><div className="figure">{result.created}</div></div>
            <div><div className="muted text-[12px]">{t('تم تحديثه', 'Updated')}</div><div className="figure">{result.updated}</div></div>
            {result.skipped != null && <div><div className="muted text-[12px]">{t('سبق استيراده', 'Already imported')}</div><div className="figure">{result.skipped}</div></div>}
            <div><div className="muted text-[12px]">{t('أخطاء', 'Errors')}</div><div className="figure" style={{ color: result.errors.length ? 'var(--red)' : undefined }}>{result.errors.length}</div></div>
          </div>
          {result.preview?.some(row => row.needs_review) && <p className="notice">{t('بعض الفلاتر بدون تاريخ تركيب معروف وستظهر للمراجعة في الصيانة.', 'Some filters have no known installation date and will appear for maintenance review.')}</p>}
          {result.errors.length > 0 && <Button icon={Download} className="mb-3" onClick={() => exportCsv(`${entity}-errors`, result.errors, [{ header: t('السطر', 'Row'), value: row => row.row }, { header: t('الخطأ', 'Error'), value: row => row.message }])}>{t('تنزيل الأخطاء', 'Download errors')}</Button>}
          {result.errors.length > 0 && (
            <div className="max-h-[300px] overflow-auto sheet">
              <table className="ledger">
                <thead><tr><th style={{ width: 80 }}>{t('السطر', 'Row')}</th><th>{t('الخطأ', 'Error')}</th></tr></thead>
                <tbody>{result.errors.map((e) => <tr key={e.row}><td className="num">{e.row}</td><td className="neg">{e.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="muted m-0 text-[13px]">{entity === 'customer-units' ? t('احفظ الملف بصيغة CSV UTF-8 واربط الأعمدة. الأكواد المستوردة سابقاً تُتخطى؛ التاريخ المختلف يحتاج مراجعة ولا يُستبدل تلقائياً.', 'Save as CSV UTF-8 and map the columns. Identical prior imports are skipped; different history requires review and is never overwritten automatically.') : t('احفظ الملف من Excel بصيغة "CSV UTF-8". الصف الأول أسماء الأعمدة كما في النموذج. الصفوف التي لها كود موجود تُحدّث، والباقي يُضاف.', 'Save from Excel as "CSV UTF-8". The first row holds the column names from the template. Rows whose code exists are updated; the rest are added.')}</p>
          <div className="flex items-center gap-3">
            <Button disabled={busy} icon={FileUp} onClick={pick}>{t('اختيار ملف', 'Choose file')}</Button>
            {file && <span className="num muted">{file} · {rows.length} {t('صف', 'rows')}</span>}
          </div>
          {missingName && <div className="neg text-[13px]">{t('اربط الأعمدة المطلوبة: ', 'Map the required columns: ')}{required.join(', ')}</div>}
          {rows.length > 0 && <details><summary>{t('ربط أعمدة الملف', 'Map file columns')}</summary><div className="grid gap-3 py-3 sm:grid-cols-2">{columns.map(column => <label key={column} className="field"><span>{column}{required.includes(column) ? ' *' : ''}</span><select className="select" value={Object.hasOwn(mapping, column) ? mapping[column] : (headers.includes(column) ? column : '')} onChange={event => setMapping(old => ({ ...old, [column]: event.target.value }))}><option value="">{t('غير مرتبط', 'Not mapped')}</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div></details>}
          {entity === 'customer-units' && <p className="muted">{t('استخدم أكواد العملاء والأصناف الموجودة. أعمدة stage.مفتاح_المرحلة تسجل آخر استبدال فعلي بصيغة YYYY-MM-DD. اترك التاريخ المجهول فارغاً للمراجعة؛ لا تُدخل تاريخاً افتراضياً.', 'Use existing customer/product codes. Columns named stage.STAGE_KEY hold actual last replacement dates as YYYY-MM-DD. Leave unknown dates blank for review; do not invent dates.')}</p>}
          {unknown.length > 0 && <div className="text-[13px]" style={{ color: 'var(--amber)' }}>{t('أعمدة سيتم تجاهلها', 'Columns that will be ignored')}: <span className="num">{unknown.join(', ')}</span></div>}
          {rows.length > 0 && (
            <div className="max-h-[320px] overflow-auto sheet">
              <table className="ledger grid-lines">
                <thead><tr><th>#</th>{known.map((h) => <th key={h} className="num">{h}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 50).map((r, i) => <tr key={i}><td className="num muted">{i + 2}</td>{known.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody>
              </table>
              {rows.length > 50 && <div className="muted p-2 text-[12px]">{t(`و ${rows.length - 50} صف آخر…`, `and ${rows.length - 50} more rows…`)}</div>}
            </div>
          )}
          <div className="muted text-[12px]">{t('الأعمدة', 'Columns')}: <span className="num">{columns.join(', ')}</span></div>
        </div>
      )}
    </Modal>
  )
}
