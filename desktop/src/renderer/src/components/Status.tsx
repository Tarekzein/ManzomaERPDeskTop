import clsx from 'clsx'
import { Pill } from './ui'
import { statusLabel, statusTone } from '@/lib/docTypes'
import { useT } from '@/store/prefs'
import { date } from '@/lib/format'

export function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return null
  return <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>
}

/** The ink stamp on a document: posted, void, paid or draft. */
export function Stamp({ status, paymentStatus, postedAt, animate }: { status: string; paymentStatus?: string | null; postedAt?: string | null; animate?: boolean }) {
  const t = useT()
  const kind = status === 'void' || status === 'cancelled' ? 'void' : paymentStatus === 'paid' ? 'paid' : status === 'draft' ? 'draft' : 'posted'
  const label = {
    void: t('ملغي', 'VOID'),
    paid: t('مدفوع', 'PAID'),
    draft: t('مسودة', 'DRAFT'),
    posted: status === 'posted' ? t('مرحّل', 'POSTED') : statusLabel(status),
  }[kind]
  return (
    <div className={clsx('stamp', `stamp-${kind}`, animate && 'stamp-enter')} aria-label={label}>
      {label}
      {postedAt && kind !== 'draft' && <small className="num">{date(postedAt)}</small>}
    </div>
  )
}
