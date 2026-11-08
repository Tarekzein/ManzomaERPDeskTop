import { ArrowUpRight, ClipboardCheck } from 'lucide-react'
import { useApi } from '@/lib/query'
import { useT } from '@/store/prefs'
import { useCan } from '@/store/session'
import { Button, Pill } from '@/components/ui'
import { openSetupGuide, STEP_LABELS, type GuideState } from './guide'

/**
 * Progress and a way back into the company guide. The dashboard shows it until setup is
 * completed (paused or never started included); Settings shows it always (`showCompleted`).
 */
export function SetupGuideCard({ showCompleted = false }: { showCompleted?: boolean }) {
  const t = useT()
  const allowed = useCan()
  const { data } = useApi<GuideState>(allowed('settings.manage') ? '/setup-guide' : null)
  if (!data || (data.status === 'completed' && !showCompleted)) return null
  const completed = data.status === 'completed'
  const next = data.current_step === 'review' ? t('المراجعة والبدء', 'Review and start') : t(...STEP_LABELS[data.current_step])
  return <section className="setup-card" aria-label={t('دليل بدء العمل', 'Getting started')}>
    <span className="setup-card-icon"><ClipboardCheck size={20} /></span>
    <div className="setup-card-body">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{completed ? t('تم إعداد الشركة', 'Company setup is complete') : t('أكمل إعداد شركتك', 'Finish setting up your company')}</strong>
        {data.status === 'paused' && <Pill tone="amber">{t('محفوظ للاستكمال', 'Saved for later')}</Pill>}
        {completed && <Pill tone="green">{t('مكتمل', 'Completed')}</Pill>}
      </div>
      <div className="setup-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done} aria-label={t('تقدم الإعداد', 'Setup progress')}><span style={{ width: `${data.total ? (data.done / data.total) * 100 : 0}%` }} /></div>
      <p>
        {t(`تمت مراجعة ${data.done} من ${data.total} خطوات`, `${data.done} of ${data.total} steps reviewed`)}
        {' · '}
        {completed ? t('يمكنك مراجعة أي خطوة دون تغيير البيانات المحفوظة.', 'You can revisit any step without changing saved records.') : t(`التالي: ${next}`, `Next: ${next}`)}
      </p>
    </div>
    <Button variant={completed ? 'default' : 'primary'} onClick={openSetupGuide}>
      {completed ? t('مراجعة الدليل', 'Review setup') : data.status === 'not_started' ? t('ابدأ الإعداد', 'Start setup') : t('متابعة الإعداد', 'Continue setup')}
      <ArrowUpRight size={15} className="flow-arrow" />
    </Button>
  </section>
}
