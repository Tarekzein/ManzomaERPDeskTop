import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Empty, Spinner } from './ui'
import { useT } from '@/store/prefs'
import { int } from '@/lib/format'

export interface Column<T> {
  key: string
  header: ReactNode
  render?: (row: T, index: number) => ReactNode
  align?: 'start' | 'end' | 'center'
  width?: number | string
  sortKey?: string
  /** Footer cell (totals). */
  footer?: ReactNode
  className?: string
}

export interface Sort {
  key: string
  dir: 'asc' | 'desc'
}

export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  loading,
  onOpen,
  rowKey = (r: T) => r.id,
  sort,
  onSort,
  empty,
  footer,
  rowClassName,
  compact,
  maxHeight,
}: {
  rows: T[] | undefined
  columns: Column<T>[]
  loading?: boolean
  onOpen?: (row: T) => void
  rowKey?: (row: T) => string | number
  sort?: Sort
  onSort?: (sort: Sort) => void
  empty?: ReactNode
  footer?: boolean
  rowClassName?: (row: T) => string | undefined
  compact?: boolean
  maxHeight?: string
}) {
  const t = useT()
  const [active, setActive] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const keyed = useRef(false)
  useEffect(() => setActive(0), [rows])

  const onKey = (e: React.KeyboardEvent) => {
    // Keys pressed on a header or cell button belong to that button.
    if (!rows?.length || e.target !== e.currentTarget) return
    keyed.current = true
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && onOpen) {
      e.preventDefault()
      onOpen(rows[active])
    }
  }
  // Follow the keyboard cursor only; scrolling on mount would jump the whole page.
  useEffect(() => {
    if (!keyed.current) return
    wrapper.current?.querySelector<HTMLElement>(`tr[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div ref={wrapper} className="table-scroll overflow-auto" style={{ maxHeight }} tabIndex={0} onKeyDown={onKey}>
      <table className={clsx('ledger', compact && 'text-[12px]')}>
        <thead>
          <tr>
            {columns.map((c) => {
              const sortable = Boolean(c.sortKey && onSort)
              const current = Boolean(sort && c.sortKey && sort.key === c.sortKey)
              const label = (
                <>
                  {c.header}
                  {current && (sort!.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </>
              )
              return (
                <th
                  key={c.key}
                  className={clsx(c.align === 'end' && 'amount', sortable && 'sortable', c.className)}
                  style={{ width: c.width, textAlign: c.align === 'center' ? 'center' : undefined }}
                  aria-sort={current ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {/* A real button so sorting works from the keyboard too. */}
                  {sortable ? (
                    <button type="button" style={c.align === 'center' ? { justifyContent: 'center' } : undefined} onClick={() => onSort!({ key: c.sortKey!, dir: current && sort!.dir === 'asc' ? 'desc' : 'asc' })}>
                      {label}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1">{label}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && !rows?.length ? (
            <tr>
              <td colSpan={columns.length}>
                <Spinner />
              </td>
            </tr>
          ) : !rows?.length ? (
            <tr>
              <td colSpan={columns.length} style={{ borderBottom: 'none' }}>
                {empty ?? <Empty title={t('لا توجد سجلات لعرضها', 'No records to show')} />}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row)}
                data-index={i}
                className={clsx(i === active && 'active', rowClassName?.(row))}
                onClick={() => setActive(i)}
                onDoubleClick={() => onOpen?.(row)}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx(c.align === 'end' && 'amount', c.className)} style={{ textAlign: c.align === 'center' ? 'center' : undefined }}>
                    {c.render ? c.render(row, i) : (row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && rows && rows.length > 0 && (
          <tfoot>
            <tr>
              {columns.map((c) => (
                <td key={c.key} className={clsx(c.align === 'end' && c.footer !== undefined && 'amount')}>
                  {c.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export function Pager({ page, lastPage, total, onPage }: { page: number; lastPage: number; total?: number; onPage: (p: number) => void }) {
  const t = useT()
  if (lastPage <= 1 && !total) return null
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] muted" style={{ borderTop: '1px solid var(--rule)' }}>
      <span>{total !== undefined && t(`${int(total)} سجل`, `${int(total)} records`)}</span>
      {lastPage > 1 && <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={document.dir === 'rtl' ? ChevronRight : ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('السابق', 'Previous')} />
        <span className="num">
          {page} / {Math.max(lastPage, 1)}
        </span>
        <Button size="sm" variant="ghost" icon={document.dir === 'rtl' ? ChevronLeft : ChevronRight} disabled={page >= lastPage} onClick={() => onPage(page + 1)} aria-label={t('التالي', 'Next')} />
      </div>}
    </div>
  )
}
