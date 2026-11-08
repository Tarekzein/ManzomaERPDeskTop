import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { Button, Field, Textarea } from './ui'
import { tr } from '@/store/prefs'

const modalStack: HTMLElement[] = []
const visibleElement = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
const tabbable = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]')].filter((element) => element.tabIndex >= 0 && !element.matches(':disabled, [inert], [aria-disabled="true"]') && visibleElement(element))

export function Modal({ title, onClose, children, footer, size = 'md', busy = false }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'md' | 'wide' | 'xl'; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const current = useRef({ onClose, busy })
  current.current = { onClose, busy }
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    modalStack.push(dialog)
    if (visibleElement(dialog) && !dialog.contains(document.activeElement)) {
      const items = tabbable(dialog)
      const first = items.find((element) => element.matches('input, select, textarea'))
      ;(first ?? items[0] ?? dialog).focus()
    }
    const key = (event: KeyboardEvent) => {
      if (modalStack.filter(visibleElement).at(-1) !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!current.current.busy) current.current.onClose()
      }
      if (event.key === 'Tab') {
        const items = tabbable(dialog)
        const first = items[0]
        const last = items.at(-1)
        if (!first) { event.preventDefault(); dialog.focus(); return }
        if (!dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      modalStack.splice(modalStack.indexOf(dialog), 1)
      document.removeEventListener('keydown', key)
      if (previous?.isConnected && visibleElement(previous) && (dialog.contains(document.activeElement) || document.activeElement === document.body)) previous.focus()
    }
  }, [])
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div ref={ref} className={clsx('dialog', size === 'wide' && 'dialog-wide', size === 'xl' && 'dialog-xl')} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" icon={X} disabled={busy} onClick={onClose} aria-label={tr('إغلاق', 'Close')} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* Promise-based confirm and reason prompts, rendered once by <DialogHost/>. */
interface Pending {
  kind: 'confirm' | 'reason'
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (value: any) => void
}

const useDialogs = create<{ pending: Pending | null; set: (p: Pending | null) => void }>((set) => ({ pending: null, set: (pending) => set({ pending }) }))

export function confirmDialog(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: 'confirm', ...opts, resolve }))
}

export function reasonDialog(opts: { title: string; message?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: 'reason', danger: true, ...opts, resolve }))
}

export function DialogHost() {
  const { pending, set } = useDialogs()
  const [reason, setReason] = useState('')
  useEffect(() => setReason(''), [pending])
  if (!pending) return null
  const close = (value: any) => {
    pending.resolve(value)
    set(null)
  }
  const disabled = pending.kind === 'reason' && reason.trim().length < 3
  return (
    <Modal
      title={pending.title}
      onClose={() => close(pending.kind === 'confirm' ? false : null)}
      footer={
        <>
          <Button onClick={() => close(pending.kind === 'confirm' ? false : null)}>{tr('رجوع', 'Cancel')}</Button>
          <Button variant={pending.danger ? 'danger' : 'primary'} disabled={disabled} onClick={() => close(pending.kind === 'confirm' ? true : reason.trim())}>
            {pending.confirmLabel ?? tr('تأكيد', 'Confirm')}
          </Button>
        </>
      }
    >
      {pending.message && <p className="m-0 mb-3 leading-relaxed">{pending.message}</p>}
      {pending.kind === 'reason' && (
        <Field label={tr('السبب', 'Reason')} hint={tr('يُحفظ السبب في سجل المراجعة.', 'The reason is kept in the audit log.')}>
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      )}
    </Modal>
  )
}
