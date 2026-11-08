import { CompanySettings } from './CompanySettings'
import { LanSharing } from './LanSharing'
import { SetupGuideCard } from '@/features/onboarding/SetupGuideCard'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileUp, KeyRound, Save, ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import { isDesktop, platform } from '@/lib/platform'
import { tr, usePrefs, useT } from '@/store/prefs'
import { can, useCan, useSession } from '@/store/session'
import { useTab } from '@/workspace/TabContext'
import { BRAND } from '@shared/brand'
import type { PrinterInfo } from '@shared/types'
import { Button, Check, Field, Input, Kv, NumberInput, PageHeader, Segmented, Select, Sheet, Spinner } from '@/components/ui'
import { MasterData, RESOURCES } from './MasterData'
import { Roles, Users } from './UsersRoles'
import { AuditSection, BackupSection, FiscalSection, OpeningSection } from './SystemSections'
import { ImportDialog, type ImportEntity } from './ImportDialog'

interface Section { key: string; ar: string; en: string; permission?: string | string[]; group: 'company' | 'data' | 'people' | 'finance' | 'system' | 'me' }

const SECTIONS: Section[] = [
  { key: 'company', ar: 'بيانات الشركة', en: 'Company', group: 'company', permission: 'settings.manage' },
  { key: 'setup', ar: 'دليل بدء العمل', en: 'Getting started', group: 'company', permission: 'settings.manage' },
  { key: 'sales', ar: 'المبيعات والضرائب', en: 'Sales & tax', group: 'company', permission: 'settings.manage' },
  { key: 'maintenance', ar: 'الصيانة والتنبيهات', en: 'Maintenance & alerts', group: 'company', permission: 'settings.manage' },
  { key: 'inventory', ar: 'المخزون', en: 'Inventory', group: 'company', permission: 'settings.manage' },
  { key: 'numbering', ar: 'ترقيم المستندات', en: 'Numbering', group: 'company', permission: 'settings.manage' },
  { key: 'printing', ar: 'الطباعة', en: 'Printing', group: 'company', permission: 'settings.manage' },
  { key: 'branches', ar: 'الفروع', en: 'Branches', group: 'data', permission: 'settings.manage' },
  { key: 'warehouses', ar: 'المخازن', en: 'Warehouses', group: 'data', permission: 'settings.manage' },
  { key: 'items', ar: 'بيانات الأصناف', en: 'Item setup', group: 'data', permission: ['products.manage', 'pricing.manage'] },
  { key: 'taxes', ar: 'الضرائب ومراكز التكلفة', en: 'Taxes & cost centres', group: 'data', permission: ['taxes.manage', 'accounts.manage'] },
  { key: 'crm', ar: 'إعدادات المتابعة', en: 'CRM setup', group: 'data', permission: ['crm.settings', 'customers.manage'] },
  { key: 'import', ar: 'استيراد البيانات', en: 'Import data', group: 'data', permission: ['products.manage', 'customers.manage', 'suppliers.manage'] },
  { key: 'users', ar: 'المستخدمون', en: 'Users', group: 'people', permission: 'users.manage' },
  { key: 'roles', ar: 'الأدوار والصلاحيات', en: 'Roles & permissions', group: 'people', permission: 'users.manage' },
  { key: 'fiscal', ar: 'السنوات المالية والإقفال', en: 'Fiscal years & lock', group: 'finance', permission: ['fiscal.manage', 'finance.reports'] },
  { key: 'opening', ar: 'الأرصدة الافتتاحية', en: 'Opening balances', group: 'finance', permission: 'fiscal.manage' },
  { key: 'backup', ar: 'النسخ الاحتياطي', en: 'Backups', group: 'system', permission: 'backup.manage' },
  { key: 'audit', ar: 'سجل العمليات', en: 'Audit log', group: 'system', permission: 'audit.view' },
  { key: 'desktop', ar: 'هذا الجهاز', en: 'This computer', group: 'me' },
  { key: 'profile', ar: 'حسابي', en: 'My account', group: 'me' },
  { key: 'about', ar: 'حول البرنامج', en: 'About', group: 'me' },
]
const GROUPS: Record<Section['group'], [string, string]> = {
  company: ['الشركة', 'Company'], data: ['البيانات الأساسية', 'Master data'], people: ['المستخدمون', 'People'], finance: ['الحسابات', 'Accounting'], system: ['النظام', 'System'], me: ['شخصي', 'Personal'],
}

/** Settings: company, master data, users, accounting periods, backups, this computer. */
export default function SettingsPage() {
  const t = useT()
  const allowed = useCan()
  const tab = useTab()
  const visible = SECTIONS.filter((s) => !s.permission || allowed(s.permission))
  const current = visible.find((s) => s.key === tab.params.section) ?? visible[0]

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '220px minmax(0, 1fr)' }}>
      <nav className="overflow-auto py-4" style={{ borderInlineEnd: '1px solid var(--rule)', background: 'var(--sheet-2)' }} aria-label={t('أقسام الإعدادات', 'Settings sections')}>
        {(Object.keys(GROUPS) as Section['group'][]).map((g) => {
          const items = visible.filter((s) => s.group === g)
          if (!items.length) return null
          return (
            <div key={g} className="mb-3">
              <div className="muted px-4 pb-1 text-[11px] font-semibold">{t(...GROUPS[g])}</div>
              {items.map((s) => (
                <button key={s.key} className="settings-nav" aria-current={current?.key === s.key ? 'page' : undefined} onClick={() => tab.replace(`/settings/${s.key}`)}>{t(s.ar, s.en)}</button>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="min-w-0 overflow-auto pb-10">
        <PageHeader title={current ? t(current.ar, current.en) : t('الإعدادات', 'Settings')} />
        <div className="px-5">{current && <SectionBody section={current.key} />}</div>
      </div>
    </div>
  )
}

function SectionBody({ section }: { section: string }) {
  switch (section) {
    case 'setup': return <div className="grid max-w-[880px] gap-4"><p className="muted m-0">{tr('راجع بيانات الشركة والمخازن والفريق والأصناف والعملاء. يمكنك استئناف الدليل في أي وقت دون تغيير البيانات المحفوظة.', 'Review your company, warehouses, team, products and customers. Resume the guide at any time without changing saved records.')}</p><SetupGuideCard showCompleted /></div>
    case 'company':
    case 'sales':
    case 'maintenance':
    case 'inventory':
    case 'numbering':
    case 'printing':
      return <CompanySettings section={section} />
    case 'branches': return <MasterData def={RESOURCES.branches} />
    case 'warehouses': return <MasterData def={RESOURCES.warehouses} />
    case 'items': return <Stack>{can('products.manage') && <><MasterData def={RESOURCES.units} /><MasterData def={RESOURCES.categories} /><MasterData def={RESOURCES.brands} /></>}{can('pricing.manage') && <MasterData def={RESOURCES['price-lists']} />}</Stack>
    case 'taxes': return <Stack>{can('taxes.manage') && <MasterData def={RESOURCES['tax-rates']} />}{can('accounts.manage') && <MasterData def={RESOURCES['cost-centers']} />}</Stack>
    case 'crm': return <Stack>{can('crm.settings') && <><MasterData def={RESOURCES['crm-stages']} /><MasterData def={RESOURCES['crm-sources']} /><MasterData def={RESOURCES['crm-lost-reasons']} /></>}{can('customers.manage') && <MasterData def={RESOURCES.tags} />}</Stack>
    case 'import': return <ImportSection />
    case 'users': return <Users />
    case 'roles': return <Roles />
    case 'fiscal': return <FiscalSection />
    case 'opening': return <OpeningSection />
    case 'backup': return <BackupSection />
    case 'audit': return <AuditSection />
    case 'desktop': return <DesktopSection />
    case 'profile': return <ProfileSection />
    case 'about': return <AboutSection />
    default: return null
  }
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>
}

// ─── Import ────────────────────────────────────────────────────────────
function ImportSection() {
  const t = useT()
  const [entity, setEntity] = useState<ImportEntity | null>(null)
  const cards: { key: ImportEntity; ar: string; en: string; perm: string; hintAr: string; hintEn: string }[] = [
    { key: 'customer-units', ar: 'فلاتر العملاء وتاريخ الصيانة', en: 'Customer filters and history', perm: 'service.manage', hintAr: 'أكواد العملاء والأجهزة والأرقام المسلسلة وتواريخ التركيب واستبدال الشمعات.', hintEn: 'Customer/model codes, serials, installation and actual stage replacement dates.' },
    { key: 'products', ar: 'الأصناف', en: 'Items', perm: 'products.manage', hintAr: 'الكود والاسم والوحدة والباركود والأسعار والمجموعة.', hintEn: 'Code, name, unit, barcode, prices and category.' },
    { key: 'customers', ar: 'العملاء', en: 'Customers', perm: 'customers.manage', hintAr: 'بيانات الاتصال والرقم الضريبي وحد الائتمان ومدة السداد.', hintEn: 'Contacts, tax number, credit limit and payment terms.' },
    { key: 'suppliers', ar: 'الموردون', en: 'Suppliers', perm: 'suppliers.manage', hintAr: 'بيانات الاتصال والرقم الضريبي ومدة السداد.', hintEn: 'Contacts, tax number and payment terms.' },
  ]
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
      {cards.filter((c) => can(c.perm)).map((c) => (
        <Sheet key={c.key} title={t(c.ar, c.en)} bodyClassName="grid gap-3 p-4">
          <p className="muted m-0 text-[13px]">{t(c.hintAr, c.hintEn)}</p>
          <Button icon={FileUp} onClick={() => setEntity(c.key)}>{t('استيراد من ملف CSV', 'Import from CSV')}</Button>
        </Sheet>
      ))}
      {entity && <ImportDialog entity={entity} onClose={() => setEntity(null)} />}
    </div>
  )
}

// ─── This computer ─────────────────────────────────────────────────────
function DesktopSection() {
  const t = useT()
  const prefs = usePrefs((s) => s.prefs)
  const update = usePrefs((s) => s.update)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  useEffect(() => { if (isDesktop) platform.print.printers().then(setPrinters).catch(() => undefined) }, [])
  if (!prefs) return <Spinner />
  const printerOptions = printers.map((p) => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ` (${t('الافتراضية', 'default')})` : ''}` }))
  return (
    <div className="grid gap-4">
      {isDesktop && <LanSharing />}
      <Sheet title={t('المظهر واللغة', 'Look and language')} bodyClassName="grid grid-cols-2 gap-4 p-4">
        <Field label={t('اللغة', 'Language')}><Segmented value={prefs.locale} onChange={(x) => void update({ locale: x })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} /></Field>
        <Field label={t('المظهر', 'Theme')}><Segmented value={prefs.theme} onChange={(x) => void update({ theme: x })} options={[{ value: 'light', label: t('فاتح', 'Light') }, { value: 'dark', label: t('داكن', 'Dark') }, { value: 'system', label: t('حسب النظام', 'System') }]} /></Field>
        <Field label={t('حجم العرض', 'Zoom')}><Select value={String(prefs.zoom)} onChange={(e) => void update({ zoom: Number(e.target.value) })} options={[0.9, 1, 1.1, 1.25].map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` }))} /></Field>
      </Sheet>
      <Sheet title={t('الطابعات', 'Printers')} bodyClassName="grid grid-cols-2 gap-4 p-4">
        {!isDesktop && <p className="muted col-span-2 m-0 text-[13px]">{t('اختيار الطابعات متاح في تطبيق سطح المكتب. المتصفح يستخدم نافذة الطباعة العادية.', 'Choosing printers needs the desktop app. The browser uses its normal print dialog.')}</p>}
        <Field label={t('طابعة الفواتير A4', 'A4 printer')}><Select value={prefs.printers.a4 ?? ''} disabled={!isDesktop} onChange={(e) => void update({ printers: { ...prefs.printers, a4: e.target.value || undefined } })} placeholder={t('الافتراضية للنظام', 'System default')} options={printerOptions} /></Field>
        <Field label={t('طابعة الإيصالات (حراري)', 'Receipt printer (thermal)')}><Select value={prefs.printers.receipt ?? ''} disabled={!isDesktop} onChange={(e) => void update({ printers: { ...prefs.printers, receipt: e.target.value || undefined } })} placeholder={t('الافتراضية للنظام', 'System default')} options={printerOptions} /></Field>
        <Check checked={prefs.silentReceipt} disabled={!isDesktop} onChange={(x) => void update({ silentReceipt: x })} label={t('طباعة الإيصال مباشرة بدون معاينة', 'Print receipts straight away without preview')} />
        <Field label={t('عدد نسخ الإيصال', 'Receipt copies')}><NumberInput value={prefs.receiptCopies} onChange={(x) => void update({ receiptCopies: Math.max(1, Math.min(5, Math.round(x))) })} /></Field>
      </Sheet>
      {isDesktop && (
        <Sheet title={t('النسخ الاحتياطي التلقائي', 'Automatic backups')} bodyClassName="grid grid-cols-2 gap-4 p-4">
          <Check checked={prefs.autoBackup.enabled} onChange={(x) => void update({ autoBackup: { ...prefs.autoBackup, enabled: x } })} label={t('نسخة احتياطية يومية تلقائية', 'Daily automatic backup')} />
          <Check checked={prefs.autoBackup.onExit} onChange={(x) => void update({ autoBackup: { ...prefs.autoBackup, onExit: x } })} label={t('نسخة عند إغلاق البرنامج', 'Back up when the app closes')} />
          <Field label={t('عدد النسخ المحفوظة', 'Backups to keep')}><NumberInput value={prefs.autoBackup.keep} onChange={(x) => void update({ autoBackup: { ...prefs.autoBackup, keep: Math.max(3, Math.round(x)) } })} /></Field>
        </Sheet>
      )}
    </div>
  )
}

// ─── My account ────────────────────────────────────────────────────────
function ProfileSection() {
  const t = useT()
  const user = useSession((s) => s.user)
  const [profile, setProfile] = useState({ name: user?.name ?? '', email: (user as any)?.email ?? '', phone: (user as any)?.phone ?? '' })
  const [pw, setPw] = useState({ current_password: '', password: '', password_confirmation: '' })
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Sheet title={t('بياناتي', 'My details')} bodyClassName="grid gap-3 p-4">
        <Field label={t('الاسم', 'Name')}><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
        <Field label={t('البريد', 'Email')}><Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} dir="ltr" /></Field>
        <Field label={t('الهاتف', 'Phone')}><Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} dir="ltr" /></Field>
        <div className="flex justify-end"><Button variant="primary" icon={Save} onClick={async () => {
          try { await api.put('/auth/profile', { name: profile.name, email: profile.email || null, phone: profile.phone || null }); await useSession.getState().refreshUser(); toast.success(t('تم الحفظ', 'Saved')) } catch (e: any) { toast.error(e.message) }
        }}>{t('حفظ', 'Save')}</Button></div>
      </Sheet>
      <Sheet title={<span className="inline-flex items-center gap-2"><KeyRound size={15} />{t('تغيير كلمة المرور', 'Change password')}</span>} bodyClassName="grid gap-3 p-4">
        <Field label={t('كلمة المرور الحالية', 'Current password')}><Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} autoComplete="current-password" /></Field>
        <Field label={t('كلمة المرور الجديدة', 'New password')} hint={t('6 أحرف على الأقل', 'At least 6 characters')}><Input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label={t('تأكيد كلمة المرور', 'Confirm password')}><Input type="password" value={pw.password_confirmation} onChange={(e) => setPw({ ...pw, password_confirmation: e.target.value })} autoComplete="new-password" /></Field>
        <div className="flex justify-end"><Button variant="primary" disabled={!pw.current_password || !pw.password} onClick={async () => {
          if (pw.password !== pw.password_confirmation) return toast.error(t('كلمتا المرور غير متطابقتين.', 'The passwords do not match.'))
          try { await api.put('/auth/password', pw); setPw({ current_password: '', password: '', password_confirmation: '' }); toast.success(t('تم تغيير كلمة المرور', 'Password changed')) } catch (e: any) { toast.error(e.message) }
        }}>{t('تغيير', 'Change')}</Button></div>
      </Sheet>
    </div>
  )
}

// ─── About ─────────────────────────────────────────────────────────────
function AboutSection() {
  const t = useT()
  const info = useSession((s) => s.info)
  const profile = useSession((s) => s.profile)
  const [app, setApp] = useState<{ version: string; platform: string; electron: string; userData: string } | null>(null)
  const [logs, setLogs] = useState<string | null>(null)
  useEffect(() => { if (isDesktop) platform.app.info().then(setApp).catch(() => undefined) }, [])
  return (
    <div className="grid gap-4">
      <Sheet bodyClassName="px-4 py-3">
        <div className="mb-2 text-[18px] font-semibold">{t(BRAND.nameAr, BRAND.name)}</div>
        <Kv label={t('إصدار البرنامج', 'App version')}><span className="num">{app?.version ?? info?.version}</span></Kv>
        <Kv label={t('إصدار الخادم', 'Server version')}><span className="num">{info?.version}</span></Kv>
        <Kv label={t('الشركة', 'Company')}>{profile?.name}</Kv>
        <Kv label={t('طريقة الاتصال', 'Connection')}>{profile?.mode === 'local' ? t('ملف محلي على هذا الجهاز', 'Local file on this computer') : `${t('خادم', 'Server')} ${profile?.serverUrl ?? ''}`}</Kv>
        <Kv label={t('قاعدة البيانات', 'Database')}><span className="num">{info?.database}</span></Kv>
        {app && <Kv label={t('النظام', 'Platform')}><span className="num">{app.platform} · Electron {app.electron}</span></Kv>}
        <Kv label={t('المطور', 'Vendor')}>{BRAND.vendor}</Kv>
        <Button onClick={async () => {
          try { const diagnostics = await platform.app.diagnostics(); await platform.files.save({ defaultName: 'manzoma-support.json', content: JSON.stringify(diagnostics, null, 2), encoding: 'utf8' }) }
          catch (error: any) { toast.error(error.message) }
        }}>{t('حفظ تقرير دعم آمن', 'Save sanitized support report')}</Button>
        <p className="muted text-[12px]">{t('يتضمن الإصدار وحالة الترخيص والفحص فقط؛ لا يحتوي مفاتيح أو كلمات مرور أو بيانات العملاء أو السجلات.', 'Includes version, license status and scan health only; excludes keys, passwords, customer data and logs.')}</p>
      </Sheet>
      {isDesktop && profile?.mode === 'local' && (
        <Sheet title={t('سجل الخادم المحلي', 'Local server log')} actions={<div className="flex gap-2"><Button size="sm" icon={ScrollText} onClick={async () => setLogs(await platform.backend.logs())}>{t('عرض', 'Show')}</Button><Button size="sm" variant="ghost" onClick={() => platform.shell.openLogs()}>{t('فتح مجلد السجلات', 'Open log folder')}</Button></div>}>
          {logs !== null && <pre className="m-0 max-h-[360px] overflow-auto p-3 text-[11px]" dir="ltr" style={{ background: 'var(--sheet-2)' }}>{logs || '—'}</pre>}
        </Sheet>
      )}
    </div>
  )
}
