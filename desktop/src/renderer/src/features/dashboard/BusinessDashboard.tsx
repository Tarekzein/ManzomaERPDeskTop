import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlarmClock, ArrowLeftRight, CalendarClock, ChevronLeft, ChevronRight, PackageOpen, Plus, RefreshCw, Timer, WalletCards } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApi } from '@/lib/query'
import { date, int, money, toNumber } from '@/lib/format'
import { docLabel } from '@/lib/docTypes'
import { nameOf, usePrefs, useT } from '@/store/prefs'
import { useCan, useSession } from '@/store/session'
import { navigate } from '@/store/workspace'
import { QUICK_ACTIONS } from '@/workspace/routes'
import { Button, ErrorBox, MenuButton, Money, Sheet, Spinner } from '@/components/ui'
import { StatusPill } from '@/components/Status'

/**
 * لوحة اليوم: what happened today, where the cash is, and what needs doing.
 * Every number links to the screen that explains it.
 */
export default function Dashboard() {
  const t = useT()
  const allowed = useCan()
  const user = useSession((s) => s.user)
  const locale = usePrefs((s) => s.locale)
  const { data, isLoading, error, refetch, isFetching } = useApi<any>('/reports/dashboard', undefined, { refetchInterval: 120_000 })
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />

  const s = data.sales
  const change = s && toNumber(s.last_month_to_date) > 0 ? ((toNumber(s.month) - toNumber(s.last_month_to_date)) / toNumber(s.last_month_to_date)) * 100 : null
  const Chevron = locale === 'ar' ? ChevronLeft : ChevronRight
  const longDate = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())

  const attention: { icon: LucideIcon; label: string; value: string; tone: 'red' | 'amber' | 'ink'; to: string }[] = []
  if (data.receivables && toNumber(data.receivables.overdue) > 0) attention.push({ icon: AlarmClock, label: t('فواتير عملاء متأخرة السداد', 'Overdue customer invoices'), value: money(data.receivables.overdue), tone: 'red', to: '/docs/sales_invoice?payment_status=overdue' })
  if (data.treasury && toNumber(data.treasury.cheques_in_due_7) > 0) attention.push({ icon: WalletCards, label: t('شيكات واردة تستحق خلال أسبوع', 'Cheques to collect this week'), value: money(data.treasury.cheques_in_due_7), tone: 'amber', to: '/finance/cheques?due=7&direction=received' })
  if (data.treasury && toNumber(data.treasury.cheques_out_due_7) > 0) attention.push({ icon: WalletCards, label: t('شيكات صادرة تستحق خلال أسبوع', 'Our cheques due this week'), value: money(data.treasury.cheques_out_due_7), tone: 'red', to: '/finance/cheques?due=7&direction=issued' })
  if (data.payables && toNumber(data.payables.due_7) > 0) attention.push({ icon: CalendarClock, label: t('مستحقات موردين خلال أسبوع', 'Supplier bills due this week'), value: money(data.payables.due_7), tone: 'amber', to: '/docs/purchase_invoice?payment_status=open' })
  if (data.crm?.tasks_overdue) attention.push({ icon: AlarmClock, label: t('متابعات متأخرة', 'Overdue follow-ups'), value: int(data.crm.tasks_overdue), tone: 'red', to: '/crm/agenda' })
  if (data.crm?.tasks_today) attention.push({ icon: CalendarClock, label: t('متابعات اليوم', 'Today’s follow-ups'), value: int(data.crm.tasks_today), tone: 'ink', to: '/crm/agenda' })
  if (data.inventory?.low_stock) attention.push({ icon: PackageOpen, label: t('أصناف تحت حد الطلب', 'Items below reorder level'), value: int(data.inventory.low_stock), tone: 'amber', to: '/inventory/reports/reorder' })
  if (data.inventory?.expiring) attention.push({ icon: Timer, label: t('تشغيلات تنتهي خلال ٦٠ يوماً', 'Batches expiring within 60 days'), value: int(data.inventory.expiring), tone: 'amber', to: '/inventory/reports/expiry' })
  if (data.inventory?.transfers_in_transit) attention.push({ icon: ArrowLeftRight, label: t('تحويلات في الطريق لم تُستلم', 'Transfers awaiting receipt'), value: int(data.inventory.transfers_in_transit), tone: 'ink', to: '/inventory/docs/transfer' })

  // One obvious next step; everything else waits behind "New".
  const [primary, ...more] = QUICK_ACTIONS.filter((q) => !q.permission || allowed(q.permission))
  const morning = new Date().getHours() < 12

  return (
    <div className="dashboard pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4">
        <div>
          <div className="muted text-[13px]">{longDate}</div>
          <h1 className="m-0 mt-1 text-[22px] font-semibold">{morning ? t(`صباح الخير، ${user?.name ?? ''}`, `Good morning, ${user?.name ?? ''}`) : t(`مساء الخير، ${user?.name ?? ''}`, `Good evening, ${user?.name ?? ''}`)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" icon={RefreshCw} loading={isFetching} onClick={() => void refetch()} aria-label={t('تحديث', 'Refresh')} title={t('تحديث', 'Refresh')} />
          {more.length > 0 && (
            <MenuButton icon={Plus} items={more.map((q) => ({ label: t(q.ar, q.en), icon: q.icon, onSelect: () => navigate(q.path) }))}>
              {t('جديد', 'New')}
            </MenuButton>
          )}
          {primary && <Button variant="primary" icon={primary.icon} onClick={() => navigate(primary.path)}>{t(primary.ar, primary.en)}</Button>}
        </div>
      </header>

      {s && (
        <section className="mx-6 sheet figure-band">
          <button className="dash-figure" onClick={() => navigate('/docs/sales_invoice')}>
            <div className="muted text-[12px]">{t('مبيعات اليوم', 'Today’s sales')}</div>
            <div className="figure">{money(s.today)}</div>
            <div className="muted text-[12px]">{t(`${int(s.today_count)} فاتورة`, `${int(s.today_count)} invoices`)}</div>
          </button>
          <button className="dash-figure" onClick={() => navigate('/reports/sales')}>
            <div className="muted text-[12px]">{t('مبيعات الشهر (صافي)', 'Month to date (net)')}</div>
            <div className="figure">{money(s.month)}</div>
            {change !== null && <div className="text-[12px] num" style={{ color: change >= 0 ? 'var(--ledger)' : 'var(--red)' }}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% {t('عن نفس الفترة من الشهر الماضي', 'vs. same point last month')}</div>}
          </button>
          {s.gross_profit_month !== undefined && (
            <button className="dash-figure" onClick={() => navigate('/finance/reports/income-statement')}>
              <div className="muted text-[12px]">{t('مجمل ربح الشهر', 'Gross profit, month')}</div>
              <div className="figure">{money(s.gross_profit_month)}</div>
              {toNumber(s.month) > 0 && <div className="muted text-[12px] num">{((toNumber(s.gross_profit_month) / toNumber(s.month)) * 100).toFixed(1)}% {t('هامش', 'margin')}</div>}
            </button>
          )}
          {data.receivables && (
            <button className="dash-figure" onClick={() => navigate('/finance/reports/aging-receivable')}>
              <div className="muted text-[12px]">{t('مستحق من العملاء', 'Owed by customers')}</div>
              <div className="figure">{money(data.receivables.total)}</div>
              {toNumber(data.receivables.overdue) > 0 && <div className="text-[12px] num" style={{ color: 'var(--red)' }}>{money(data.receivables.overdue)} {t('متأخر', 'overdue')}</div>}
            </button>
          )}
          {data.payables && (
            <button className="dash-figure" onClick={() => navigate('/finance/reports/aging-payable')}>
              <div className="muted text-[12px]">{t('مستحق للموردين', 'Owed to suppliers')}</div>
              <div className="figure">{money(data.payables.total)}</div>
            </button>
          )}
        </section>
      )}

      <div className="grid gap-4 px-6 pt-4" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(300px, 1fr)' }}>
        <div className="grid content-start gap-4">
          {s && (
            <Sheet title={t('صافي المبيعات — آخر ٣٠ يوماً', 'Net sales, last 30 days')}>
              <div className="h-[220px] px-2 pt-3" dir="ltr">
                <ResponsiveContainer>
                  {/* Bars, not a smoothed line: each day stands alone and a day without sales shows as a gap. */}
                  <BarChart data={fillDays(s.trend)} margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={(d) => d.slice(8)} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} interval={4} />
                    <YAxis hide />
                    <Tooltip cursor={{ fill: 'var(--ledger-soft)' }} formatter={(v) => [money(v), t('صافي المبيعات', 'Net sales')]} labelFormatter={(d) => date(d)} contentStyle={{ background: 'var(--sheet)', border: '1px solid var(--rule-strong)', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="amount" fill="var(--ledger)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Sheet>
          )}

          {s && (
            <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Sheet title={t('الأكثر مبيعاً هذا الشهر', 'Best sellers this month')}>
                <RankList rows={s.top_products} empty={t('لا مبيعات بعد', 'No sales yet')} onOpen={(r) => navigate(`/inventory/products/${r.key_id}`)} />
              </Sheet>
              <Sheet title={t('أكبر العملاء هذا الشهر', 'Top customers this month')}>
                <RankList rows={s.top_customers} empty={t('لا مبيعات بعد', 'No sales yet')} onOpen={(r) => navigate(`/parties/view/${r.key_id}`)} />
              </Sheet>
            </div>
          )}

          <Sheet title={user?.is_admin ? t('آخر المستندات', 'Latest documents') : t('آخر مستنداتي', 'My latest documents')}>
            {data.recent.length === 0 ? <div className="muted p-4">{t('لا توجد مستندات بعد', 'No documents yet')}</div> : (
              <table className="ledger">
                <tbody>
                  {data.recent.map((d: any) => (
                    <tr key={d.id} className="cursor-pointer" onClick={() => navigate(`/docs/${d.type}/${d.id}`)}>
                      <td className="muted" style={{ width: 130 }}>{docLabel(d.type)}</td>
                      <td className="num" style={{ width: 130 }}>{d.number.startsWith('D-') ? t('مسودة', 'Draft') : d.number}</td>
                      <td>{nameOf(d.party)}</td>
                      <td className="num muted" style={{ width: 96 }}>{date(d.date)}</td>
                      <td className="amount" style={{ width: 120 }}><Money value={d.total} /></td>
                      <td style={{ width: 100 }}><StatusPill status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Sheet>
        </div>

        <div className="grid content-start gap-4">
          <Sheet title={t('يحتاج انتباهك', 'Needs your attention')}>
            {attention.length === 0 ? (
              <div className="p-4 text-[13px]" style={{ color: 'var(--ledger)' }}>{t('لا يوجد ما يستدعي المتابعة الآن.', 'Nothing needs follow-up right now.')}</div>
            ) : (
              <ul className="m-0 list-none p-0">
                {attention.map((a) => (
                  <li key={a.label}>
                    <button className="attention-row" onClick={() => navigate(a.to)}>
                      <a.icon size={16} style={{ color: a.tone === 'red' ? 'var(--red)' : a.tone === 'amber' ? 'var(--amber)' : 'var(--ink-3)' }} />
                      <span className="flex-1 text-start">{a.label}</span>
                      <span className="num font-semibold" style={{ color: a.tone === 'red' ? 'var(--red)' : undefined }}>{a.value}</span>
                      <Chevron size={14} className="muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>

          {data.treasury && (
            <Sheet title={t('النقدية الآن', 'Cash right now')} actions={<Button size="sm" variant="ghost" onClick={() => navigate('/finance/treasury')}>{t('الخزائن', 'Accounts')}</Button>}>
              <table className="ledger">
                <tbody>
                  {data.treasury.accounts.map((c: any) => (
                    <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/finance/treasury/${c.id}`)}>
                      <td>{nameOf(c)} <span className="muted text-[11px]">{c.type === 'bank' ? t('بنك', 'Bank') : t('خزينة', 'Cash')}</span></td>
                      <td className="amount"><Money value={c.balance} colored /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total-row"><td>{t('الإجمالي', 'Total')}</td><td className="amount"><Money value={toNumber(data.treasury.cash) + toNumber(data.treasury.bank)} /></td></tr>
                </tfoot>
              </table>
              {toNumber(data.treasury.cheques_in_portfolio) > 0 && <div className="muted px-4 py-2 text-[12px]" style={{ borderTop: '1px solid var(--rule)' }}>{t('شيكات تحت التحصيل', 'Cheques awaiting collection')}: <span className="num">{money(data.treasury.cheques_in_portfolio)}</span></div>}
            </Sheet>
          )}

          {data.crm && (
            <Sheet title={t('مسار الصفقات', 'Pipeline')} actions={<Button size="sm" variant="ghost" onClick={() => navigate('/crm/pipeline')}>{t('فتح', 'Open')}</Button>}>
              <div className="px-4 py-2">
                <Row label={t('صفقات مفتوحة', 'Open deals')} value={int(data.crm.open_deals)} />
                <Row label={t('قيمة المسار', 'Pipeline value')} value={money(data.crm.pipeline_value)} />
                <Row label={t('القيمة المرجحة بالاحتمال', 'Probability-weighted')} value={money(data.crm.weighted_value)} />
                <Row label={t('عملاء محتملون جدد هذا الشهر', 'New leads this month')} value={int(data.crm.new_leads_month)} />
              </div>
            </Sheet>
          )}

          {data.inventory?.value !== undefined && (
            <Sheet bodyClassName="px-4 py-3">
              <button className="flex w-full items-center justify-between" onClick={() => navigate('/inventory/stock')}>
                <span className="muted text-[13px]">{t('قيمة المخزون بالتكلفة', 'Stock at cost')}</span>
                <span className="num text-[16px] font-semibold">{money(data.inventory.value)}</span>
              </button>
            </Sheet>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between py-1.5 text-[13px]" style={{ borderBottom: '1px dashed var(--rule)' }}><span className="muted">{label}</span><span className="num font-medium">{value}</span></div>
}

function RankList({ rows, empty, onOpen }: { rows: any[]; empty: string; onOpen: (r: any) => void }) {
  const max = Math.max(1, ...rows.map((r) => toNumber(r.net)))
  if (!rows.length) return <div className="muted p-4 text-[13px]">{empty}</div>
  return (
    <ul className="m-0 list-none px-4 py-2">
      {rows.map((r) => (
        <li key={r.key_id}>
          <button className="w-full py-1.5 text-start" onClick={() => onOpen(r)}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]"><span className="truncate">{nameOf({ name: r.label, name_en: r.label_en })}</span><span className="num">{money(r.net)}</span></div>
            <div className="mt-1 h-[3px] rounded-full" style={{ background: 'var(--rule)' }}><div className="h-full rounded-full" style={{ width: `${(toNumber(r.net) / max) * 100}%`, background: 'var(--ledger)' }} /></div>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The trend skips days without sales; fill them with zero so the line is honest. */
function fillDays(rows: { date: string; amount: number }[]) {
  const map = new Map(rows.map((r) => [r.date, toNumber(r.amount)]))
  const out: { date: string; amount: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ date: key, amount: map.get(key) ?? 0 })
  }
  return out
}
