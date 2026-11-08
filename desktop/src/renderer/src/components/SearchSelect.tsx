import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, LoaderCircle, X } from 'lucide-react'
import clsx from 'clsx'
import { useFieldControl } from './ui'
import { api } from '@/lib/api'
import { useT } from '@/store/prefs'

export interface Option {
  id: number | string
  label: string
  hint?: ReactNode
  data?: any
}

/**
 * Keyboard-first picker. Searches the server (fetchPath) or filters local
 * options. Enter picks, Escape closes, arrows move.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  fetchPath,
  fetchParams,
  map,
  initialLabel,
  placeholder,
  small,
  disabled,
  autoFocus,
  clearable = true,
  className,
  inputRef,
  onKeyDown,
}: {
  value: number | string | null | undefined
  onChange: (id: any, option: Option | null) => void
  options?: Option[]
  fetchPath?: string
  fetchParams?: Record<string, any>
  map?: (row: any) => Option
  initialLabel?: string
  placeholder?: string
  small?: boolean
  disabled?: boolean
  autoFocus?: boolean
  clearable?: boolean
  className?: string
  inputRef?: React.Ref<HTMLInputElement>
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const t = useT()
  const accessibility = useFieldControl()
  const listId = useId()
  const [searchError, setSearchError] = useState('')
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [remote, setRemote] = useState<Option[]>([])
  const [remotePage, setRemotePage] = useState(1)
  const [remoteTotal, setRemoteTotal] = useState<number | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState('')
  const generation = useRef(0)
  const morePending = useRef(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [label, setLabel] = useState(initialLabel ?? '')
  const box = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (options && value !== null && value !== undefined && value !== '') {
      setLabel(options.find((o) => String(o.id) === String(value))?.label ?? initialLabel ?? '')
    } else if (!value) setLabel('')
    else if (initialLabel) setLabel(initialLabel)
  }, [value, options, initialLabel])

  useEffect(() => {
    const requestId = ++generation.current
    morePending.current = false
    setMoreLoading(false)
    if (!open || !fetchPath) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setSearchError('')
    setRemote([])
    setRemotePage(1); setRemoteTotal(undefined); setHasMore(false); setMoreError('')
    const timer = setTimeout(async () => {
      try {
        const result = await api.get(fetchPath, { ...fetchParams, search: term, page: 1, per_page: 20 })
        if (!cancelled && generation.current === requestId) {
          setRemote((result.data ?? result).map(map!))
          setRemoteTotal(result.total)
          setHasMore(Number(result.last_page ?? 1) > 1)
        }
      } catch (failure) {
        if (!cancelled) setSearchError(failure instanceof Error ? failure.message : t('تعذر تحميل الاختيارات', 'Could not load options'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      generation.current++
      clearTimeout(timer)
    }
  }, [open, term, fetchPath, JSON.stringify(fetchParams)])

  const loadMore = async (moveSelection = false) => {
    if (!fetchPath || loading || morePending.current || !hasMore) return
    const requestId = generation.current
    const next = remotePage + 1
    morePending.current = true; setMoreLoading(true); setMoreError('')
    try {
      const result = await api.get(fetchPath, { ...fetchParams, search: term, page: next, per_page: 20 })
      if (generation.current !== requestId) return
      const incoming: Option[] = (result.data ?? result).map(map!)
      setRemote(previous => {
        const known = new Set(previous.map(option => String(option.id)))
        return [...previous, ...incoming.filter(option => !known.has(String(option.id)))]
      })
      setRemotePage(next); setHasMore(next < Number(result.last_page ?? next)); setRemoteTotal(result.total)
      if (moveSelection && incoming.length) setActive(remote.length)
    } catch (failure) {
      if (generation.current === requestId) setMoreError(failure instanceof Error ? failure.message : t('تعذر تحميل الاختيارات التالية', 'Could not load more options'))
    } finally {
      if (generation.current === requestId) { morePending.current = false; setMoreLoading(false) }
    }
  }

  const list = useMemo(() => {
    if (fetchPath) return remote
    const q = term.trim().toLowerCase()
    return (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q) || String(o.hint ?? '').toLowerCase().includes(q)).slice(0, 200)
  }, [options, remote, term, fetchPath])

  useEffect(() => setActive(0), [term, open, fetchPath, JSON.stringify(fetchParams)])
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active, open, listId])

  const show = (anchor?: HTMLElement, resetTerm = true) => {
    if (disabled) return
    // React may focus a new input before attaching its parent ref. The input
    // itself already has geometry, so autofocus must not leave an invisible open list.
    setRect((anchor ?? box.current)?.getBoundingClientRect() ?? null)
    setOpen(true)
    if (resetTerm) setTerm('')
  }

  const pick = (option: Option | null) => {
    setLabel(option?.label ?? '')
    onChange(option ? option.id : null, option)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.popover')) setOpen(false)
    }
    const onScroll = () => setRect(box.current?.getBoundingClientRect() ?? null)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onScroll)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <div ref={box} className={clsx('relative', className)}>
      <input
        ref={inputRef}
        {...accessibility}
        className={clsx('input pe-12', small && 'input-sm')}
        value={open ? term : label}
        placeholder={open ? label || placeholder : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={(event) => show(event.currentTarget)}
        onClick={(event) => { if (!open || !rect) show(event.currentTarget) }}
        onChange={(e) => {
          setTerm(e.target.value)
          if (!open || !rect) show(e.currentTarget, false)
        }}
        onKeyDown={(e) => {
          if (open && e.key === 'ArrowDown') {
            e.preventDefault()
            if (active === list.length - 1 && hasMore) void loadMore(true)
            else setActive((i) => Math.max(0, Math.min(list.length - 1, i + 1)))
          } else if (open && e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          } else if (open && e.key === 'Enter') {
            e.preventDefault()
            if (list[active]) pick(list[active])
            onKeyDown?.(e)
            return
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          } else if (e.key === 'Tab') {
            setOpen(false)
          }
          onKeyDown?.(e)
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && list[active] ? `${listId}-${active}` : undefined}
      />
      <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center gap-1 muted">
        {loading ? <LoaderCircle size={13} className="animate-spin" /> : <ChevronDown size={13} />}
      </span>
      {clearable && value && !disabled ? (
        <button type="button" className="absolute inset-y-0 end-6 flex items-center muted" onClick={() => pick(null)} aria-label={t('مسح', 'Clear')} tabIndex={-1}>
          <X size={12} />
        </button>
      ) : null}
      {open &&
        rect &&
        createPortal(
          <div className="popover" style={{ position: 'fixed', top: Math.min(rect.bottom + 4, window.innerHeight - 330), left: document.dir === 'rtl' ? Math.max(8, rect.right - Math.max(rect.width, 280)) : rect.left, width: Math.max(rect.width, 280) }}>
            <div id={listId} role="listbox" aria-busy={loading || moreLoading} style={{ maxHeight: 240, overflowY: 'auto' }}>
            {searchError ? <div role="alert" className="p-3 error">{searchError}</div> : list.length === 0 ? (
              <div className="p-3 muted">{loading ? t('جارٍ البحث…', 'Searching…') : t('لا توجد نتائج', 'No matches')}</div>
            ) : (
              list.map((o, i) => (
                <div key={o.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={clsx('option', i === active && 'active')} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
                  <span className="truncate">{o.label}</span>
                  {o.hint && <small className="shrink-0">{o.hint}</small>}
                </div>
              ))
            )}
            </div>
            {fetchPath && list.length > 0 && <div className="picker-results">
              <span role="status">{remoteTotal === undefined ? t(`${list.length} نتيجة`, `${list.length} results`) : t(`عرض ${list.length} من ${remoteTotal}`, `Showing ${list.length} of ${remoteTotal}`)}</span>
              {hasMore && <button type="button" disabled={moreLoading} onMouseDown={event => event.preventDefault()} onClick={() => void loadMore()}>{moreLoading ? t('جارٍ التحميل…', 'Loading…') : t('عرض المزيد', 'Load more')}</button>}
              {moreError && <small role="alert" className="error">{moreError}</small>}
            </div>}
          </div>,
          document.body,
        )}
    </div>
  )
}
