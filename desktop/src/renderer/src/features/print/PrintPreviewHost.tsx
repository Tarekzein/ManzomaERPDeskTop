import { FileDown, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/Dialogs'
import { Button } from '@/components/ui'
import { platform } from '@/lib/platform'
import { usePrefs, useT } from '@/store/prefs'
import { usePrintPreview } from './printService'

export function PrintPreviewHost() {
  const t = useT()
  const { html, paper, title, close } = usePrintPreview()
  const prefs = usePrefs((s) => s.prefs)
  if (!html) return null
  const receipt = paper.startsWith('receipt')
  return (
    <Modal
      title={t('معاينة الطباعة', 'Print preview') + ' — ' + title}
      onClose={close}
      size="xl"
      footer={
        <>
          <Button icon={FileDown} onClick={async () => {
            const r = await platform.print.pdf({ html, paper, defaultName: title })
            if (r.ok && r.path) toast.success(t('تم حفظ الملف', 'Saved') + ': ' + r.path)
          }}>{t('حفظ PDF', 'Save as PDF')}</Button>
          <Button variant="primary" icon={Printer} onClick={async () => {
            const r = await platform.print.html({ html, paper, printer: receipt ? prefs?.printers.receipt : prefs?.printers.a4, copies: 1 })
            if (r.ok) close()
            else if (r.error) toast.error(r.error)
          }}>{t('طباعة', 'Print')}</Button>
        </>
      }
    >
      <div className="grid place-items-center rounded-md p-4" style={{ background: 'var(--paper)' }}>
        <iframe title={t('معاينة الطباعة', 'Print preview')} srcDoc={html} sandbox="allow-same-origin" style={{ width: receipt ? (paper === 'receipt58' ? 230 : 310) : 794, height: '68vh', background: '#fff', border: '1px solid var(--rule-strong)', boxShadow: 'var(--shadow)' }} />
      </div>
    </Modal>
  )
}
