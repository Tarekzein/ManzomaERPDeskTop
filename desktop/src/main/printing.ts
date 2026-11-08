import { BrowserWindow, dialog, shell } from 'electron'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PdfRequest, PrintRequest, PrinterInfo } from '../shared/types'
import { log } from './log'

const MICRONS_PER_PX = 25400 / 96

/**
 * Renders print-ready HTML (built by the renderer, fonts embedded) in a hidden
 * window and sends it to a printer, or saves it as PDF.
 */
async function render(html: string): Promise<{ win: BrowserWindow; file: string; heightPx: number }> {
  const file = join(tmpdir(), `manzoma-print-${randomUUID()}.html`)
  writeFileSync(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  })
  await win.loadFile(file)
  // Wait for embedded fonts and images before measuring or printing.
  const heightPx = Number(await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all(Array.from(document.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r })))).then(() => document.documentElement.scrollHeight)'))
  return { win, file, heightPx }
}

function pageSize(paper: PrintRequest['paper'], heightPx: number): Electron.WebContentsPrintOptions['pageSize'] {
  switch (paper) {
    case 'receipt80':
      return { width: 80_000, height: Math.max(100_000, Math.ceil(heightPx * MICRONS_PER_PX) + 5_000) }
    case 'receipt58':
      return { width: 58_000, height: Math.max(100_000, Math.ceil(heightPx * MICRONS_PER_PX) + 5_000) }
    case 'A5':
      return 'A5'
    default:
      return 'A4'
  }
}

export async function listPrinters(win: BrowserWindow | null): Promise<PrinterInfo[]> {
  if (!win) return []
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: Boolean((p as unknown as { isDefault?: boolean }).isDefault) }))
}

export async function printHtml(request: PrintRequest): Promise<{ ok: boolean; error?: string }> {
  const { win, file, heightPx } = await render(request.html)
  try {
    return await new Promise((resolve) => {
      win.webContents.print(
        {
          silent: Boolean(request.silent && request.printer),
          deviceName: request.printer || undefined,
          copies: Math.max(1, request.copies ?? 1),
          printBackground: true,
          landscape: Boolean(request.landscape),
          margins: { marginType: request.paper.startsWith('receipt') ? 'none' : 'default' },
          pageSize: pageSize(request.paper, heightPx),
        },
        (success, reason) => resolve(success ? { ok: true } : { ok: false, error: reason }),
      )
    })
  } catch (error) {
    log('print', 'failed', String(error))
    return { ok: false, error: String(error) }
  } finally {
    setTimeout(() => {
      win.destroy()
      try {
        unlinkSync(file)
      } catch {
        // already gone
      }
    }, 1500)
  }
}

export async function saveHtmlAsPdf(parent: BrowserWindow | null, request: PdfRequest): Promise<{ ok: boolean; path?: string; error?: string }> {
  const target = await dialog.showSaveDialog(parent ?? undefined!, {
    defaultPath: request.defaultName.endsWith('.pdf') ? request.defaultName : `${request.defaultName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (target.canceled || !target.filePath) return { ok: false }
  const { win, file, heightPx } = await render(request.html)
  try {
    const size = pageSize(request.paper, heightPx)
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: Boolean(request.landscape),
      pageSize: typeof size === 'string' ? size : { width: size!.width / 25400, height: size!.height / 25400 },
      margins: request.paper.startsWith('receipt') ? { top: 0, bottom: 0, left: 0, right: 0 } : undefined,
    })
    writeFileSync(target.filePath, pdf)
    void shell.openPath(target.filePath)
    return { ok: true, path: target.filePath }
  } catch (error) {
    return { ok: false, error: String(error) }
  } finally {
    win.destroy()
    try {
      unlinkSync(file)
    } catch {
      // ignore
    }
  }
}
