import { useEffect, useState } from 'react'
import { Building2, HardDrive, Languages, LoaderCircle, Plus, Server, Trash2 } from 'lucide-react'
import type { CompanyProfile, LicenseStatus } from '@shared/types'
import { isDesktop, platform } from '@/lib/platform'
import { useSession } from '@/store/session'
import { usePrefs, useT } from '@/store/prefs'
import { Button, ErrorBox } from '@/components/ui'
import { confirmDialog } from '@/components/Dialogs'
import { datetime } from '@/lib/format'
import { ImportCompanyDialog } from './ImportCompanyDialog'
import { LicenseDialog } from './LicenseDialog'
import { SetupWizard } from './SetupWizard'
import { ServerDialog } from './ServerDialog'
import { serverSettings } from '@shared/serverSettings'
import { LanConnectDialog } from './LanConnectDialog'

/**
 * First screen: choose a company file on this PC or a company on a server.
 */
export function CompanyPicker() {
  const t = useT()
  const { open, phase, error, profile: opening } = useSession()
  const prefs = usePrefs((s) => s.prefs)
  const update = usePrefs((s) => s.update)
  const [profiles, setProfiles] = useState<CompanyProfile[] | null>(null)
  const [license, setLicense] = useState(false)
  const [importing, setImporting] = useState(false)
  const [wizard, setWizard] = useState<'local' | 'server' | null>(null)
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null)
  const [server, setServer] = useState<CompanyProfile | 'new' | null>(null)
  const [lan, setLan] = useState(false)

  const reload = async () => { const [rows,status]=await Promise.all([platform.profiles.list(),platform.licensing.status()]);setProfiles(rows);setLicenseStatus(status) }
  useEffect(() => {
    void reload().catch(() => setProfiles([]))
    void platform.licensing.status().then(setLicenseStatus).catch(() => setLicenseStatus(null))
  }, [])

  const sorted = [...(profiles ?? [])].sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
  const empty = !profiles?.length
  const unassigned = !licenseStatus?.assignment
  const canSetUpLocal = empty && licenseStatus?.mode !== 'online' && (unassigned || (licenseStatus?.offlineSlots === 1 && licenseStatus.localCompanies === 0))
  const canSetUpOnline = empty && unassigned && licenseStatus?.mode !== 'offline'

  return (
    <div className="grid h-full place-items-center overflow-auto p-6" style={{ background: 'var(--paper)' }}>
      <div className="w-full max-w-[760px]">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[26px] font-bold">{t('شركتك', 'Your company')}</h1>
            <p className="muted m-0 mt-1">{t('شركة واحدة لكل جهاز. تتصل أجهزة الموظفين بالكمبيوتر الرئيسي أو بالخادم الأونلاين.', 'One company per device. Staff connect to the main computer or the online server.')}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={Languages} lang={prefs?.locale === 'ar' ? 'en' : 'ar'} onClick={() => update({ locale: prefs?.locale === 'ar' ? 'en' : 'ar' })}>{prefs?.locale === 'ar' ? 'English' : 'العربية'}</Button>
          </div>
        </div>

        {error && <ErrorBox error={error} onRetry={opening ? () => void open(opening) : undefined} />}

        <div className="sheet overflow-hidden">
          {profiles === null ? (
            <div className="p-8 muted">…</div>
          ) : sorted.length === 0 ? (
            <div className="p-8">
              <div className="text-[15px] font-semibold">{t('لا توجد شركات بعد', 'No companies yet')}</div>
              <p className="muted mt-1 mb-0">{isDesktop ? t('أنشئ شركة على هذا الجهاز للعمل بدون إنترنت، أو اتصل بخادم الشركة ليعمل عدة مستخدمين معاً.', 'Create a company on this PC to work offline, or connect to your company server so several people can work together.') : t('اتصل بخادم الشركة للبدء.', 'Connect to your company server to start.')}</p>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {sorted.map((p) => {
                const busy = phase === 'opening' && opening?.id === p.id
                return (
                  <li key={p.id} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: '1px solid var(--rule)' }}>
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ background: 'var(--ledger-soft)', color: 'var(--ledger)' }}>
                      {p.mode === 'local' ? <HardDrive size={18} /> : <Server size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{p.name}</div>
                      <div className="muted text-[12px]">
                        {p.mode === 'local' ? t('ملف على هذا الجهاز', 'File on this PC') : <span className="num">{p.serverUrl}{p.company ? ` / ${p.company}` : ''}</span>}
                        {p.lastOpenedAt && <> · {t('آخر فتح', 'Last opened')} <span className="num">{datetime(p.lastOpenedAt)}</span></>}
                      </div>
                    </div>
                    {p.mode === 'server' && <Button size="sm" variant="ghost" onClick={() => setServer(p)}>{t('تعديل', 'Edit')}</Button>}
                    {!licenseStatus?.assignment && <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      aria-label={t('إزالة', 'Remove')}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: t('إزالة الشركة من القائمة؟', 'Remove this company from the list?'),
                          message: p.mode === 'local' ? t('يبقى ملف الشركة ونسخه الاحتياطية في مجلد البيانات ولا يُحذف.', 'The company file and its backups stay in the data folder; nothing is deleted.') : undefined,
                          confirmLabel: t('إزالة', 'Remove'),
                          danger: true,
                        })
                        if (ok) {
                          await platform.profiles.remove(p.id)
                          void reload()
                        }
                      }}
                    />}
                    <Button variant="primary" onClick={() => open(p)} disabled={phase === 'opening'}>
                      {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Building2 size={14} />}
                      {busy ? t('جارٍ الفتح…', 'Opening…') : t('فتح', 'Open')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 p-4" style={{ background: 'var(--sheet-2)' }}>
            {isDesktop && licenseStatus && canSetUpLocal && <Button onClick={() => setImporting(true)}>{t('استيراد شركة سابقة', 'Import existing company')}</Button>}
            {isDesktop && <Button onClick={() => setLicense(true)}>{t('ترخيص التطبيق', 'Application license')}</Button>}
            {isDesktop && licenseStatus && canSetUpLocal && (
              <Button icon={Plus} onClick={() => setWizard('local')}>
                {t('شركة جديدة على هذا الجهاز', 'New company on this PC')}
              </Button>
            )}
            {isDesktop && licenseStatus && canSetUpOnline && <Button icon={Plus} variant="primary" onClick={() => setWizard('server')}>{t('تسجيل شركة أونلاين', 'Register an online company')}</Button>}
            {(!isDesktop || empty && (canSetUpOnline || licenseStatus?.assignment?.mode === 'online')) && <Button icon={Server} onClick={() => setServer('new')}>
              {t('الاتصال بشركة أونلاين موجودة', 'Connect to an existing online company')}
            </Button>}
            {isDesktop && licenseStatus?.mode !== 'online' && (empty && unassigned || profiles?.[0]?.mode === 'lan' || empty && licenseStatus?.assignment?.mode === 'offline' && licenseStatus.offlineSlots === 0) && <Button icon={Server} onClick={()=>setLan(true)}>{t('الاتصال بالكمبيوتر الرئيسي','Connect to the main computer')}</Button>}
          </div>
        </div>
        {phase === 'opening' && opening?.mode === 'local' && <p className="muted mt-3 text-center">{t('يتم تشغيل قاعدة بيانات الشركة وتحديثها…', 'Starting and updating the company database…')}</p>}
      </div>
      {importing && <ImportCompanyDialog onClose={() => setImporting(false)} onImported={p => { setImporting(false); void reload(); void open(p) }} />}
      {license && <LicenseDialog onClose={() => setLicense(false)} />}
      {wizard && <SetupWizard mode={wizard} onClose={() => setWizard(null)} onCreated={(p) => { setWizard(null); void reload(); void open(p) }} />}
      {server && <ServerDialog initialUrl={licenseStatus?.issuer || serverSettings.serverUrl} profile={server === 'new' ? null : server} onClose={() => setServer(null)} onSaved={() => { setServer(null); void reload() }} />}
      {lan && <LanConnectDialog onClose={()=>setLan(false)} onConnected={profile=>{setLan(false);void reload();void open(profile)}}/>}
    </div>
  )
}
