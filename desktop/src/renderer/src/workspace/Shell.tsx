import { SetupGuideBanner } from '@/features/onboarding/SetupGuideBanner'
import { Suspense, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { toast } from 'sonner'
import { Bell, Building2, ChevronDown, Languages, Lock, LogOut, Moon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search, Sun, UserRound, X } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import { can, setting, useCan, useSession } from '@/store/session'
import { nameOf, tr, useName, usePrefs, useT } from '@/store/prefs'
import { commands, isDesktop, platform } from '@/lib/platform'
import { api } from '@/lib/api'
import { useApi } from '@/lib/query'
import { date, today } from '@/lib/format'
import { Button, ErrorBox, MenuButton, Spinner } from '@/components/ui'
import { MENU, matchRoute, menuItemVisible, type MenuItem } from './routes'
import { TabContext } from './TabContext'
import { ErrorBoundary } from './ErrorBoundary'
import { LockScreen } from './LockScreen'
import { CommandPalette } from './CommandPalette'

export function Shell() {
  const { tabs, active, open, close, activate, closeOthers } = useWorkspace()
  const phase = useSession((s) => s.phase)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('erp.sidebar') === 'collapsed')
  const t = useT()

  useEffect(() => {
    return commands.on((command) => {
      if (command === 'command-palette') setPaletteOpen(true)
      if (command === 'lock') useSession.getState().lock()
      if (command === 'switch-company') void useSession.getState().close()
      if (command === 'preferences') open('/settings/desktop')
      if (command === 'about') open('/settings/about')
      if (command === 'backup-now') {
        api.post('/backups').then(() => toast.success(tr('تم إنشاء نسخة احتياطية', 'Backup created'))).catch((e) => toast.error(e.message))
      }
    })
  }, [open])

  useIdleLock()
  useReminders()

  const closeTab = (tab: (typeof tabs)[number]) => {
    if (tab.dirty && !window.confirm(t('توجد تعديلات غير محفوظة. إغلاق التبويب؟', 'This tab has unsaved changes. Close it?'))) return
    close(tab.id)
  }
  // Tabs pattern: one tab stop, arrows move between tabs, Delete closes the focused tab.
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    const forward = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const backward = document.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    const target = e.key === forward ? index + 1 : e.key === backward ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (target !== null) {
      e.preventDefault()
      const next = tabs[(target + tabs.length) % tabs.length]
      activate(next.id)
      e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus()
    } else if (e.key === 'Delete') {
      e.preventDefault()
      closeTab(tabs[index])
    }
  }

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: collapsed ? '60px 1fr' : '240px 1fr' }}>
      <Sidebar collapsed={collapsed} onToggle={() => {
        localStorage.setItem('erp.sidebar', collapsed ? 'open' : 'collapsed')
        setCollapsed(!collapsed)
      }} />
      <div className="flex min-w-0 flex-col" style={{ height: '100vh' }}>
        <Topbar onSearch={() => setPaletteOpen(true)} />
        <div className="tabstrip" role="tablist" aria-label={t('الشاشات المفتوحة', 'Open screens')}>
          {tabs.map((tab, index) => {
            const m = matchRoute(tab.path)
            const title = tab.title || (m ? m.route.title(m.params) : tab.path)
            return (
              <div
                key={tab.id}
                data-tab={tab.id}
                role="tab"
                aria-selected={tab.id === active}
                tabIndex={tab.id === active ? 0 : -1}
                onKeyDown={(e) => onTabKey(e, index)}
                className={clsx('tab', tab.id === active && 'active')}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    close(tab.id)
                  }
                }}
                onClick={() => activate(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  closeOthers(tab.id)
                }}
                title={title}
              >
                {tab.dirty && <span className="dirty" aria-label={t('تعديلات غير محفوظة', 'Unsaved changes')} />}
                <span className="tab-title">{title}</span>
                {/* Out of the tab order: Delete on the focused tab closes it from the keyboard. */}
                <button
                  type="button"
                  tabIndex={-1}
                  className="tab-close"
                  aria-label={t('إغلاق التبويب', 'Close tab')}
                  title={t('إغلاق (Delete)', 'Close (Delete)')}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab)
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
        <SetupGuideBanner />
        <main className="relative min-h-0 flex-1" style={{ background: 'var(--sheet)' }}>
          {tabs.map((tab) => {
            const m = matchRoute(tab.path)
            const visible = tab.id === active
            return (
              // Background tabs keep their size and scroll position but skip rendering;
              // display:none would collapse charts to zero width.
              <div key={tab.id} className="absolute inset-0 overflow-auto" style={visible ? undefined : { visibility: 'hidden', contentVisibility: 'hidden' }}>
                {!m ? (
                  <ErrorBox error={tr('الصفحة غير موجودة', 'Page not found')} />
                ) : m.route.permission && !can(Array.isArray(m.route.permission) ? m.route.permission[0] : m.route.permission) && !(Array.isArray(m.route.permission) && m.route.permission.some((p) => can(p))) ? (
                  <ErrorBox error={tr('ليس لديك صلاحية لفتح هذه الصفحة.', 'You do not have access to this page.')} />
                ) : (
                  <TabContext.Provider value={{ tabId: tab.id, path: tab.path, params: m.params, query: m.query, active: visible }}>
                    <ErrorBoundary>
                      <Suspense fallback={<Spinner />}>
                        <m.route.component key={tab.path} />
                      </Suspense>
                    </ErrorBoundary>
                  </TabContext.Provider>
                )}
              </div>
            )
          })}
        </main>
        <StatusBar />
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {phase === 'locked' && <LockScreen />}
    </div>
  )
}

/**
 * Sections fold like an accordion: only one is open at a time, and it follows
 * the screen in front, so the menu stays short however many modules there are.
 */
function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const t = useT()
  const allowed = useCan()
  const activePath = useWorkspace((s) => s.tabs.find((x) => x.id === s.active)?.path ?? '')
  const open = useWorkspace((s) => s.open)
  const company = useSession((s) => s.info?.company)
  const name = useName()
  const rtl = usePrefs((s) => s.locale) === 'ar'
  const [Fold, Unfold] = rtl ? [PanelRightClose, PanelRightOpen] : [PanelLeftClose, PanelLeftOpen]

  const visible = (item: MenuItem) => menuItemVisible(item, allowed)
  // A document opened from a list keeps that list highlighted.
  const base = activePath.split('?')[0]
  const isActive = (item: MenuItem) => base === item.path || base.startsWith(item.path + '/')
  const currentGroup = MENU.find((g) => g.items.some(isActive))?.key ?? null
  const [openGroup, setOpenGroup] = useState<string | null>(currentGroup)
  useEffect(() => {
    if (currentGroup) setOpenGroup(currentGroup)
  }, [currentGroup])

  const link = (item: MenuItem) => (
    <button key={item.path} className={clsx('side-link', isActive(item) && 'active')} onClick={() => open(item.path)} title={collapsed ? t(item.ar, item.en) : undefined} aria-current={isActive(item) ? 'page' : undefined}>
      <item.icon size={17} />
      {!collapsed && <span className="truncate">{t(item.ar, item.en)}</span>}
    </button>
  )
  const settings = MENU.find((g) => g.key === 'system')?.items.filter(visible) ?? []

  return (
    <nav className={clsx('sidebar flex min-h-0 flex-col', collapsed && 'collapsed')} aria-label={t('القائمة الرئيسية', 'Main menu')}>
      <div className={clsx('sidebar-brand flex items-center gap-3', collapsed ? 'justify-center px-2' : 'px-3')} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {company?.logo ? <img src={company.logo} alt="" className="h-9 w-9 shrink-0 rounded-md object-contain" style={{ background: '#fff' }} /> : <div className="sidebar-brandmark grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[16px] font-bold" style={{ background: 'var(--action)', color: '#fff' }}>{(name(company) || 'M').slice(0, 1)}</div>}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-white">{name(company) || 'ManzomaERP'}</div>
            <div className="truncate text-[11px]" style={{ color: 'var(--sidebar-ink-2)' }}>ManzomaERP</div>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {MENU.map((group) => {
          if (group.key === 'system') return null
          const items = group.items.filter(visible)
          if (!items.length) return null
          // A one-page section (Today) is just a link.
          if (group.items.length === 1) return link(items[0])
          const expanded = openGroup === group.key && !collapsed
          const label = t(group.ar, group.en)
          return (
            <div key={group.key} className="mt-0.5">
              <button
                className={clsx('side-group', group.key === currentGroup && 'current')}
                aria-expanded={expanded}
                title={collapsed ? label : undefined}
                onClick={() => {
                  if (collapsed) {
                    onToggle()
                    setOpenGroup(group.key)
                  } else {
                    setOpenGroup(expanded ? null : group.key)
                  }
                }}
              >
                <group.icon size={17} />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{label}</span>
                    <ChevronDown size={14} className="side-chevron" />
                  </>
                )}
              </button>
              {expanded && <div className="side-items">{items.map((item) => (
                <button key={item.path} className={clsx('side-link', isActive(item) && 'active')} onClick={() => open(item.path)} aria-current={isActive(item) ? 'page' : undefined}>
                  <span className="truncate">{t(item.ar, item.en)}</span>
                </button>
              ))}</div>}
            </div>
          )
        })}
      </div>
      <div className={clsx('flex gap-1 px-2 py-2', collapsed ? 'flex-col items-center' : 'items-center')} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className={collapsed ? 'w-full' : 'min-w-0 flex-1'}>{settings.map(link)}</div>
        <button className="side-link w-9 shrink-0 justify-center px-0" onClick={onToggle} aria-label={collapsed ? t('توسيع القائمة', 'Expand menu') : t('طي القائمة', 'Collapse menu')} title={collapsed ? t('توسيع القائمة', 'Expand menu') : t('طي القائمة', 'Collapse menu')}>
          {collapsed ? <Unfold size={17} /> : <Fold size={17} />}
        </button>
      </div>
    </nav>
  )
}

/** Menu accelerators are CmdOrCtrl, so hints follow the platform. */
const modKey = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl '

function Topbar({ onSearch }: { onSearch: () => void }) {
  const t = useT()
  const user = useSession((s) => s.user)
  const prefs = usePrefs((s) => s.prefs)
  const update = usePrefs((s) => s.update)
  const operations = useApi<any>(can('service.view') ? '/operations/today' : null, undefined, { refetchInterval: 120_000 })
  const agenda = (operations.data?.service?.overdue ?? 0) + (operations.data?.service?.due_week ?? 0)
  const open = useWorkspace((s) => s.open)
  return (
    <header className="workspace-topbar flex h-[60px] items-center justify-between gap-3 px-5">
      <button className="input workspace-search flex max-w-[500px] flex-1 items-center gap-2 text-start muted" style={{ cursor: 'text' }} onClick={onSearch}>
        <Search size={15} />
        <span className="flex-1 truncate">{t('ابحث عن عميل أو صنف أو شاشة…', 'Search customers, items or screens…')}</span>
        <kbd className="num rounded px-1.5 text-[11px]" style={{ border: '1px solid var(--rule)', background: 'var(--sheet-2)' }}>{modKey}K</kbd>
      </button>
      <div className="flex items-center gap-1">
        {can('service.view') && (
          <Button variant="ghost" icon={Bell} onClick={() => open('/service/due')} aria-label={agenda > 0 ? t(`مواعيد الصيانة: ${agenda}`, `Maintenance reminders: ${agenda}`) : t('مواعيد الصيانة', 'Maintenance reminders')} title={t('مواعيد الصيانة', 'Maintenance reminders')} className="relative">
            {agenda > 0 && <span className="num absolute -top-0.5 -end-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: 'var(--red)' }}>{agenda}</span>}
          </Button>
        )}
        <Button variant="ghost" icon={Languages} onClick={() => update({ locale: prefs?.locale === 'ar' ? 'en' : 'ar' })} aria-label={prefs?.locale === 'ar' ? 'English' : 'العربية'} lang={prefs?.locale === 'ar' ? 'en' : 'ar'} title={t('اللغة', 'Language')}>
          <span className="text-[12px]">{prefs?.locale === 'ar' ? 'EN' : 'ع'}</span>
        </Button>
        {/* Named for what a click does, not for the current state. */}
        <Button variant="ghost" icon={prefs?.theme === 'dark' ? Sun : Moon} onClick={() => update({ theme: prefs?.theme === 'dark' ? 'light' : 'dark' })} aria-label={prefs?.theme === 'dark' ? t('الوضع الفاتح', 'Light mode') : t('الوضع الداكن', 'Dark mode')} title={prefs?.theme === 'dark' ? t('الوضع الفاتح', 'Light mode') : t('الوضع الداكن', 'Dark mode')} />
        <MenuButton
          variant="ghost"
          header={<div className="px-2.5 pt-1.5 pb-2 text-[12px] muted">{user?.username} · {user?.roles.join(t('، ', ', '))}</div>}
          items={[
            { label: t('ملفي الشخصي', 'My profile'), icon: UserRound, onSelect: () => open('/settings/profile') },
            { label: t('قفل الشاشة', 'Lock screen'), icon: Lock, hint: `${modKey}L`, onSelect: () => useSession.getState().lock() },
            { label: t('تبديل الشركة', 'Switch company'), icon: Building2, onSelect: () => void useSession.getState().close() },
            null,
            { label: t('تسجيل الخروج', 'Sign out'), icon: LogOut, danger: true, onSelect: () => void useSession.getState().logout() },
          ]}
        >
          <span className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold" style={{ background: 'var(--ledger-soft)', color: 'var(--ledger)' }}>{user?.name.slice(0, 1)}</span>
          <span className="max-w-[140px] truncate">{user?.name}</span>
        </MenuButton>
      </div>
    </header>
  )
}

/** Connection, branch and period lock: what the sidebar and top bar don't already say. */
function StatusBar() {
  const t = useT()
  const { profile, user, info, baseUrl } = useSession()
  const [online, setOnline] = useState(true)
  const lockDate = setting<string | null>('accounting.lock_date', null)
  useEffect(() => {
    const check = () => api.get('/system/ping').then(() => setOnline(true)).catch(() => setOnline(false))
    const timer = setInterval(check, 20_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <footer className="statusbar">
      <span title={online ? undefined : t('تعذر الاتصال بالخادم', 'Cannot reach the server')}>
        <span className={clsx('dot', online ? 'dot-ok' : 'dot-bad')} />
        {!online ? t('غير متصل', 'Offline') : profile?.mode === 'local' ? t('كمبيوتر رئيسي', 'Main computer') : profile?.mode === 'lan' ? t('شبكة محلية', 'Local network') : t('خادم أونلاين', 'Online server')}
        {profile?.mode !== 'local' && <span className="num muted">{baseUrl?.replace(/^https?:\/\//, '')}</span>}
      </span>
      {user?.branch && <span>{nameOf(user.branch)}</span>}
      {lockDate && <span title={t('لا يمكن التسجيل قبل هذا التاريخ', 'No posting on or before this date')}>{t('الفترة مقفلة حتى', 'Locked to')} <span className="num">{date(lockDate)}</span></span>}
      <span className="num">{date(today())}</span>
      <span className="ms-auto border-0">{isDesktop ? '' : t('وضع المتصفح', 'Browser mode')} v{info?.version}</span>
    </footer>
  )
}

/** Lock the screen after the company's idle limit. */
function useIdleLock() {
  const minutes = Number(setting('security.idle_lock_minutes', 15)) || 0
  const last = useRef(Date.now())
  useEffect(() => {
    if (!minutes) return
    const bump = () => (last.current = Date.now())
    const events = ['mousemove', 'keydown', 'mousedown', 'wheel']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) useSession.getState().lock()
    }, 30_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(timer)
    }
  }, [minutes])
}

/** Desktop notification when a follow-up's reminder time arrives. */
function useReminders() {
  useEffect(() => {
    if (!can('crm.view')) return
    const seen = new Set<number>(JSON.parse(sessionStorage.getItem('erp.reminded') || '[]'))
    const poll = async () => {
      try {
        const agenda = await api.get('/crm/agenda')
        for (const task of agenda.reminders as any[]) {
          if (seen.has(task.id)) continue
          seen.add(task.id)
          const who = task.party?.name ?? task.lead?.company_name ?? task.lead?.name ?? ''
          void platform.notify(tr('تذكير متابعة', 'Follow-up reminder'), `${task.title}${who ? ' — ' + who : ''}`)
          toast(tr('تذكير متابعة', 'Follow-up reminder'), { description: task.title, action: { label: tr('فتح الأجندة', 'Open agenda'), onClick: () => useWorkspace.getState().open('/crm/agenda') } })
        }
        sessionStorage.setItem('erp.reminded', JSON.stringify([...seen]))
      } catch {
        // offline: try again next round
      }
    }
    void poll()
    const timer = setInterval(poll, 120_000)
    return () => clearInterval(timer)
  }, [])
}

