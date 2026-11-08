import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Package, Search, User } from 'lucide-react'
import { api } from '@/lib/api'
import { useWorkspace } from '@/store/workspace'
import { useCan } from '@/store/session'
import { nameOf, useT } from '@/store/prefs'
import { MENU, QUICK_ACTIONS, menuItemVisible } from './routes'

interface Entry {
  key: string
  label: string
  hint?: string
  icon: any
  path: string
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const t = useT()
  const allowed = useCan()
  const open = useWorkspace((s) => s.open)
  const [term, setTerm] = useState('')
  const [remote, setRemote] = useState<Entry[]>([])
  const [active, setActive] = useState(0)

  const screens = useMemo<Entry[]>(() => {
    const items = [...QUICK_ACTIONS, ...MENU.flatMap((g) => g.items)].filter((i) => menuItemVisible(i, allowed))
    return items.map((i) => ({ key: i.path + i.en, label: t(i.ar, i.en), icon: i.icon, path: i.path }))
  }, [allowed, t])

  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) {
      setRemote([])
      return
    }
    const timer = setTimeout(async () => {
      const out: Entry[] = []
      if (allowed(['customers.view', 'suppliers.view'])) {
        const parties = await api.get('/parties', { search: q, per_page: 6 }).catch(() => ({ data: [] }))
        parties.data.forEach((p: any) => out.push({ key: 'p' + p.id, label: nameOf(p), hint: p.code, icon: User, path: `/parties/view/${p.id}` }))
      }
      if (allowed(['products.view', 'stock.view'])) {
        const products = await api.get('/products', { search: q, per_page: 6 }).catch(() => ({ data: [] }))
        products.data.forEach((p: any) => out.push({ key: 'i' + p.id, label: nameOf(p), hint: p.code, icon: Package, path: `/inventory/products/${p.id}` }))
      }
      setRemote(out)
    }, 200)
    return () => clearTimeout(timer)
  }, [term])

  const q = term.trim().toLowerCase()
  const list = [...screens.filter((s) => !q || s.label.toLowerCase().includes(q)).slice(0, q ? 8 : 12), ...remote]
  useEffect(() => setActive(0), [term, remote.length])
  // Block body: scrollIntoView returns a promise in current Chromium, which React would call as a cleanup.
  useEffect(() => {
    document.getElementById(`palette-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (entry: Entry | undefined) => {
    if (!entry) return
    open(entry.path)
    onClose()
  }

  return (
    <div className="overlay" style={{ placeItems: 'start center', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: 'min(620px, 100%)' }} role="dialog" aria-modal="true" aria-label={t('البحث السريع', 'Command palette')}>
        <div className="flex items-center gap-2 px-3" style={{ borderBottom: '1px solid var(--rule)' }}>
          <Search size={16} className="muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={list[active] ? `palette-${active}` : undefined}
            aria-label={t('اكتب اسم شاشة أو عميل أو صنف', 'Type a screen, customer or item')}
            className="h-12 flex-1 border-0 bg-transparent text-[15px] outline-none"
            placeholder={t('اكتب اسم شاشة أو عميل أو صنف', 'Type a screen, customer or item')}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(list.length - 1, i + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              }
              if (e.key === 'Enter') go(list[active])
            }}
          />
        </div>
        <div id="palette-results" role="listbox" className="max-h-[50vh] overflow-auto p-1">
          {list.map((entry, i) => (
            <div key={entry.key} id={`palette-${i}`} role="option" aria-selected={i === active} className={clsx('option rounded-md', i === active && 'active')} onMouseEnter={() => setActive(i)} onClick={() => go(entry)}>
              <span className="flex items-center gap-2">
                <entry.icon size={15} className="muted" />
                {entry.label}
              </span>
              {entry.hint && <small className="num">{entry.hint}</small>}
            </div>
          ))}
          {list.length === 0 && <div className="p-4 muted" role="status">{t('لا توجد نتائج. جرّب اسمًا أو كودًا آخر.', 'No matches. Try another name or code.')}</div>}
        </div>
      </div>
    </div>
  )
}
