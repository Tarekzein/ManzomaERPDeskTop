import { platform } from './platform'

export interface CsvColumn<T> {
  header: string
  value: (row: T) => unknown
}

/** UTF-8 with BOM so Excel opens Arabic text correctly. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v)
    if (typeof v === 'string' && /^[=+@\-\t\r]/.test(s)) s = "'" + s
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map((c) => escape(c.header)).join(',')]
  rows.forEach((row) => lines.push(columns.map((c) => escape(c.value(row))).join(',')))
  return '﻿' + lines.join('\r\n')
}

export async function exportCsv<T>(name: string, rows: T[], columns: CsvColumn<T>[]): Promise<void> {
  await platform.files.save({ defaultName: `${name}.csv`, content: toCsv(rows, columns), filters: [{ name: 'CSV', extensions: ['csv'] }] })
}

export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/)[0] ?? ''
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (!header) return []
  const keys = header.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}
