import { useState } from 'react'
import { toast } from 'sonner'
import { AlarmClock, Check, Phone, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { invalidate, useApi } from '@/lib/query'
import { datetime } from '@/lib/format'
import { useT } from '@/store/prefs'
import { navigate } from '@/store/workspace'
import { Button, Empty, ErrorBox, PageHeader, Pill, Spinner } from '@/components/ui'
import { TaskForm } from './TaskForm'
import { ActivityForm } from './ActivityForm'

/** The salesperson's day: what is late, what is today, what is next. */
export default function Agenda() {
  const t = useT()
  const agenda = useApi<any>('/crm/agenda')
  const [newTask, setNewTask] = useState(false)
  const [log, setLog] = useState<any | null>(null)
  const [edit, setEdit] = useState<any | null>(null)

  const complete = async (task: any) => {
    await api.post(`/crm/tasks/${task.id}/complete`)
    invalidate('/crm')
    toast.success(t('تم إنجاز المتابعة', 'Follow-up done'), { action: { label: t('تسجيل ما تم', 'Log what happened'), onClick: () => setLog(task) } })
  }
  const snooze = async (task: any, minutes: number) => {
    await api.post(`/crm/tasks/${task.id}/snooze`, { minutes })
    invalidate('/crm')
  }

  if (agenda.isLoading) return <Spinner />
  if (agenda.error) return <ErrorBox error={agenda.error} />
  const { overdue, today, upcoming } = agenda.data

  const Section = ({ title, tone, items }: { title: string; tone?: 'red' | 'green'; items: any[] }) => (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">{title}<Pill tone={tone}>{items.length}</Pill></h2>
      {items.length === 0 ? <div className="muted">{t('لا شيء هنا', 'Nothing here')}</div> : (
        <div className="sheet overflow-hidden">
          {items.map((task) => {
            const who = task.party ?? task.lead
            const phone = task.party?.mobile || task.party?.phone || task.lead?.mobile || task.lead?.phone
            return (
              <div key={task.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--rule)' }}>
                <button className="grid h-6 w-6 shrink-0 place-items-center rounded-full border" style={{ borderColor: 'var(--rule-strong)' }} onClick={() => complete(task)} aria-label={t('تم', 'Done')}><Check size={13} /></button>
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setEdit(task)}>
                  <div className="flex items-center gap-2"><span className="font-medium">{task.title}</span>{task.priority === 'high' && <Pill tone="red">{t('عاجل', 'Urgent')}</Pill>}</div>
                  <div className="muted text-[12px]">
                    {who && <button className="hover:underline" onClick={(e) => { e.stopPropagation(); navigate(task.party ? `/parties/view/${task.party.id}` : `/crm/leads/${task.lead.id}`) }}>{task.party?.name ?? task.lead?.company_name ?? task.lead?.name}</button>}
                    {phone && <span className="num"> · <Phone size={10} className="inline" /> {phone}</span>}
                    {task.opportunity && <span> · {task.opportunity.title}</span>}
                  </div>
                </div>
                <span className={`num text-[12px] ${tone === 'red' ? 'neg' : 'muted'}`}>{datetime(task.due_at)}</span>
                <Button size="sm" variant="ghost" icon={AlarmClock} onClick={() => snooze(task, 60)} aria-label={t('تأجيل ساعة', 'Snooze 1 hour')} title={t('تذكير بعد ساعة', 'Remind me in an hour')} />
              </div>
            )
          })}
        </div>
      )}
    </section>
  )

  return (
    <div>
      <PageHeader title={t('أجندتي', 'My agenda')} subtitle={t('متابعاتك مرتبة حسب الموعد. اضغط الدائرة عند الإنجاز.', 'Your follow-ups by due time. Tick the circle when done.')} actions={<Button variant="primary" icon={Plus} onClick={() => setNewTask(true)}>{t('متابعة جديدة', 'New follow-up')}</Button>} />
      <div className="max-w-[920px] px-5">
        {overdue.length + today.length + upcoming.length === 0 ? <Empty title={t('لا توجد متابعات', 'No follow-ups')} hint={t('سجّل نشاطاً مع عميل واحجز الخطوة التالية لتظهر هنا.', 'Log an activity with a customer and book the next step to see it here.')} /> : (
          <>
            {overdue.length > 0 && <Section title={t('متأخرة', 'Overdue')} tone="red" items={overdue} />}
            <Section title={t('اليوم', 'Today')} tone="green" items={today} />
            <Section title={t('الأيام السبعة القادمة', 'Next 7 days')} items={upcoming} />
          </>
        )}
      </div>
      {newTask && <TaskForm onClose={() => setNewTask(false)} />}
      {edit && <TaskForm task={edit} onClose={() => setEdit(null)} />}
      {log && <ActivityForm leadId={log.lead_id ?? undefined} partyId={log.party_id ?? undefined} opportunityId={log.opportunity_id ?? undefined} onClose={() => setLog(null)} />}
    </div>
  )
}
