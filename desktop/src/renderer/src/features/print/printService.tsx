import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import type { ReactElement } from 'react'
import { toast } from 'sonner'
import ar400 from '@fontsource/cairo/files/cairo-arabic-400-normal.woff2?url'
import ar600 from '@fontsource/cairo/files/cairo-arabic-600-normal.woff2?url'
import ar700 from '@fontsource/cairo/files/cairo-arabic-700-normal.woff2?url'
import la400 from '@fontsource/cairo/files/cairo-latin-400-normal.woff2?url'
import la600 from '@fontsource/cairo/files/cairo-latin-600-normal.woff2?url'
import la700 from '@fontsource/cairo/files/cairo-latin-700-normal.woff2?url'
import type { PrintRequest } from '@shared/types'
import { platform } from '@/lib/platform'
import { usePrefs, tr } from '@/store/prefs'

export type Paper = PrintRequest['paper']

let fontCss: Promise<string> | null = null

/** Fonts are embedded so printing works offline and in the hidden print window. */
function fonts(): Promise<string> {
  fontCss ??= (async () => {
    const arabicRange = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1'
    const latinRange = 'U+0000-00FF,U+2000-206F,U+20AC'
    const files: [string, number, string][] = [
      [ar400, 400, arabicRange], [ar600, 600, arabicRange], [ar700, 700, arabicRange],
      [la400, 400, latinRange], [la600, 600, latinRange], [la700, 700, latinRange],
    ]
    const faces = await Promise.all(
      files.map(async ([url, weight, range]) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(tr('تعذر تحميل خط الطباعة. حاول مرة أخرى.', 'Could not load the print font. Please try again.'))
        const blob = new Blob([await response.arrayBuffer()], { type: 'font/woff2' })
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        return `@font-face{font-family:'Cairo';font-weight:${weight};src:url(${data}) format('woff2');unicode-range:${range};}`
      }),
    )
    return faces.join('\n')
  })().catch((error) => { fontCss = null; throw error })
  return fontCss
}

const baseCss = (paper: Paper) => `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Cairo',sans-serif;color:#111;font-size:${paper.startsWith('receipt') ? '11px' : '11.5px'};line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:${paper === 'A5' ? 'A5' : paper.startsWith('receipt') ? (paper === 'receipt58' ? '58mm' : '80mm') + ' auto' : 'A4'};margin:${paper.startsWith('receipt') ? '0' : '12mm 10mm'}}
.page{padding:${paper.startsWith('receipt') ? '3mm 3mm 6mm' : '0'};width:100%}
.num{font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}
td.num,th.num{direction:inherit;unicode-bidi:normal}
h1,h2,h3{margin:0}
table{width:100%;border-collapse:collapse}
th{background:#f1f3f8;font-weight:600;text-align:start;padding:5px 6px;border:1px solid #c5ccda;font-size:10.5px}
td{padding:4px 6px;border:1px solid #e2e6ef;vertical-align:top}
td.r,th.r{text-align:end}
.muted{color:#58667a}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:8px;border-bottom:2px solid #485e8b;margin-bottom:10px}
.co h1{font-size:17px}
.title{text-align:end}
.title h2{font-size:18px;color:#485e8b}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;margin-bottom:10px}
.meta div{display:flex;gap:6px}
.meta b{min-width:90px;color:#58667a;font-weight:600}
.totals{margin-top:8px;margin-inline-start:auto;width:46%}
.totals td{border:none;border-bottom:1px solid #e2e6ef;padding:3px 6px}
.totals tr.grand td{font-weight:700;font-size:13px;border-top:1px solid #111;border-bottom:3px double #111}
.words{margin-top:8px;padding:6px 8px;background:#f5f6fa;border-inline-start:3px solid #485e8b}
.sign{display:flex;justify-content:space-between;margin-top:34px;gap:24px}
.sign div{flex:1;text-align:center;border-top:1px solid #888;padding-top:4px;color:#58667a}
.foot{margin-top:14px;font-size:10px;color:#58667a;text-align:center}
.stamp{display:inline-block;border:2px solid #b4322a;color:#b4322a;padding:2px 10px;border-radius:6px;font-weight:700;transform:rotate(-6deg)}
.receipt{text-align:center}
.receipt table td,.receipt table th{border:none;padding:2px 0;font-size:10.5px}
.receipt .line{border-top:1px dashed #555;margin:5px 0}
.receipt .tot td{font-size:12px;font-weight:700}
`

export async function buildHtml(element: ReactElement, paper: Paper, title = 'Print'): Promise<string> {
  const locale = usePrefs.getState().locale
  const body = renderToStaticMarkup(element)
  const safeTitle = title.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
  return `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${await fonts()}\n${baseCss(paper)}</style></head><body><div class="page">${body}</div></body></html>`
}

/* Preview dialog state, rendered by <PrintPreviewHost/>. */
interface PreviewState {
  html: string | null
  paper: Paper
  title: string
  open(html: string, paper: Paper, title: string): void
  close(): void
}

export const usePrintPreview = create<PreviewState>((set) => ({
  html: null,
  paper: 'A4',
  title: '',
  open: (html, paper, title) => set({ html, paper, title }),
  close: () => set({ html: null }),
}))

/**
 * Print a document. Receipts go straight to the receipt printer when the
 * user enabled silent printing; everything else opens a preview first.
 */
export async function printElement(element: ReactElement, opts: { paper: Paper; title: string; direct?: boolean }): Promise<void> {
  try {
    const html = await buildHtml(element, opts.paper, opts.title)
    const prefs = usePrefs.getState().prefs
    const isReceipt = opts.paper.startsWith('receipt')
    if (opts.direct || (isReceipt && prefs?.silentReceipt && prefs.printers.receipt)) {
      const result = await platform.print.html({
        html,
        paper: opts.paper,
        printer: isReceipt ? prefs?.printers.receipt : prefs?.printers.a4,
        silent: Boolean(isReceipt ? prefs?.silentReceipt : false),
        copies: isReceipt ? prefs?.receiptCopies ?? 1 : 1,
      })
      if (!result.ok && result.error) toast.error(result.error)
      return
    }
    usePrintPreview.getState().open(html, opts.paper, opts.title)
  } catch (error) {
    toast.error(tr('تعذرت الطباعة: ', 'Printing failed: ') + (error instanceof Error ? error.message : String(error)))
  }
}
