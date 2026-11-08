import { CustomFieldFilters } from '@/features/forms/CustomFieldFilters'
import type { FormSchema } from '@/features/forms/DynamicForm'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, RefreshCw, Search, SearchX } from 'lucide-react'
import { DataTable, Pager, type Column, type Sort } from './DataTable'
import { Button, Empty, ErrorBox, PageHeader } from './ui'
import { useApi } from '@/lib/query'
import { type CsvColumn } from '@/lib/csv'
import { useCsvExport } from '@/lib/useCsvExport'
import { useT } from '@/store/prefs'

/**
 * Standard list screen: search, filters, server paging and sorting, CSV export.
 */
export function ListPage<T extends Record<string, any>>({
  title,
  subtitle,
  path,
  params,
  columns,
  onOpen,
  actions,
  filters,
  csv,
  csvName,
  defaultSort = '-id',
  searchPlaceholder,
  footer,
  summary,
  empty,
  perPage = 50,
  rowClassName,
}: {
  title: ReactNode
  subtitle?: ReactNode
  path: string
  params?: Record<string, any>
  columns: Column<T>[]
  onOpen?: (row: T) => void
  actions?: ReactNode
  filters?: ReactNode
  csv?: CsvColumn<T>[]
  csvName?: string
  defaultSort?: string
  searchPlaceholder?: string
  footer?: (totals: any, rows: T[]) => Column<T>[] | undefined
  summary?: (totals: any) => ReactNode
  empty?: ReactNode
  perPage?: number
  rowClassName?: (row: T) => string | undefined
}) {
  const t = useT()
  const download = useCsvExport()
  const formKey = path === '/parties' ? (params?.role === 'supplier' ? 'suppliers' : 'customers') : path.startsWith('/documents/') ? path.split('/')[2] : path.startsWith('/master/') ? path.split('/')[2] : path === '/products' ? 'products' : path.startsWith('/crm/') ? path.split('/')[2] : path.startsWith('/stock-documents/') ? `stock_${path.split('/')[2]}` : path === '/journals' ? 'journals' : path === '/vouchers' ? `voucher_${params?.expenses ? 'expense' : params?.type ?? 'receipt'}` : null
  const dynamicSchema = useApi<FormSchema>(formKey ? `/forms/${formKey}` : null)
  const dynamicColumns = (dynamicSchema.data?.fields ?? []).filter((field) => field.usage_flags_json?.list)
  const dynamicFilters = (dynamicSchema.data?.fields ?? []).filter((field) => field.usage_flags_json?.filter)
  const [customFilters, setCustomFilters] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<Sort>(() => ({ key: defaultSort.replace(/^-/, ''), dir: defaultSort.startsWith('-') ? 'desc' : 'asc' }))
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => setPage(1), [debounced, JSON.stringify(params)])

  const query = { ...params, ...Object.fromEntries(Object.entries(customFilters).filter(([, value]) => value !== '').map(([key, value]) => [`custom[${key}]`, value])), search: debounced, page, per_page: perPage, sort: `${sort.dir === 'desc' ? '-' : ''}${sort.key}` }
  const { data, isLoading, error, refetch, isFetching } = useApi<any>(path, query, { placeholderData: (prev: any) => prev })
  const rows: T[] = data?.data ?? []
  const cols = useMemo(() => (footer ? footer(data?.totals, rows) ?? columns : columns), [footer, data, columns])

  const doExport = () => {
    if (!csv || (formKey && !dynamicSchema.data)) return
    const additional = dynamicColumns.map((field) => ({ header: t(field.label_ar, field.label_en), value: (row: T) => row.custom_fields?.[field.key] }))
    void download.start(path, query, csvName ?? 'export', [...csv, ...additional])
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {/* Page actions come last so the primary one sits at the end edge. */}
            <Button variant="ghost" icon={RefreshCw} onClick={() => refetch()} aria-label={t('تحديث', 'Refresh')} className={isFetching ? 'animate-pulse' : undefined} />
            {csv && <Button icon={Download} disabled={search !== debounced || Boolean(formKey && !dynamicSchema.data)} loading={Boolean(download.progress)} onClick={doExport}>{t('تصدير', 'Export')}</Button>}
            {actions}
          </>
        }
      />
      {download.progress && <div className="flex flex-wrap items-center gap-3 px-5 pb-3" role="status"><span className="muted">{t('جارٍ تجهيز كل النتائج المطابقة: ', 'Preparing all matching results: ')}{download.progress.loaded}{download.progress.total !== undefined ? ` / ${download.progress.total}` : ''}</span><Button size="sm" onClick={download.cancel}>{t('إلغاء التصدير', 'Cancel export')}</Button></div>}
      {download.error ? <ErrorBox error={download.error} /> : null}
      {dynamicSchema.error ? <ErrorBox error={dynamicSchema.error} onRetry={() => void dynamicSchema.refetch()} /> : null}
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div className="relative w-[280px]">
          <Search size={14} className="absolute inset-y-0 start-2.5 my-auto muted" />
          <input className="input ps-8" placeholder={searchPlaceholder ?? t('بحث…', 'Search…')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {filters}
        <CustomFieldFilters fields={dynamicFilters} value={customFilters} onChange={(next) => { setCustomFilters(next); setPage(1) }} />
      </div>
      {summary && data?.totals && <div className="px-5 pb-3">{summary(data.totals)}</div>}
      {error ? <ErrorBox error={error} onRetry={() => refetch()} /> : null}
      <div className="mx-5 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg" style={{ border: '1px solid var(--rule)' }}>
        <div className="min-h-0 flex-1 overflow-hidden">
          <DataTable rows={rows} columns={[...cols, ...dynamicColumns.map((field) => ({ key: `custom_${field.key}`, sortKey: field.type === 'multi_select' ? undefined : `custom:${field.key}`, header: t(field.label_ar, field.label_en), render: (row: T) => { const value = row.custom_fields?.[field.key]; return Array.isArray(value) ? value.join(', ') : String(value ?? '') } }))]} loading={isLoading} onOpen={onOpen} sort={sort} onSort={setSort} footer={Boolean(footer)} rowClassName={rowClassName} maxHeight="100%" empty={empty ?? (debounced || Object.values(customFilters).some(Boolean) ? <Empty icon={SearchX} title={t('لا توجد نتائج مطابقة', 'No matching records')} hint={t('جرّب كلمة بحث أخرى أو امسح عوامل التصفية.', 'Try a different search or clear the filters.')} /> : undefined)} />
        </div>
        <Pager page={data?.current_page ?? 1} lastPage={data?.last_page ?? 1} total={data?.total} onPage={setPage} />
      </div>
    </div>
  )
}
