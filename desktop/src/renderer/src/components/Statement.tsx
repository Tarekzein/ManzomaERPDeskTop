import { ExternalLink } from 'lucide-react'
import { DataTable, type Column } from './DataTable'
import { Money } from './ui'
import { useT } from '@/store/prefs'
import { date } from '@/lib/format'
import { sourceLabel, sourceLink } from '@/lib/docTypes'
import { navigate } from '@/store/workspace'

export interface StatementLine {
  date: string
  entry_id?: number
  entry_number?: string
  number?: string
  reference?: string | null
  description?: string | null
  source_type?: string | null
  source_id?: number | null
  debit: number
  credit: number
  balance: number
  party?: string | null
}

/**
 * Running-balance ledger used for statements of account, the general ledger
 * and cash box movements. Double-click opens the source document.
 */
export function StatementTable({ lines, opening, closing, debitLabel, creditLabel, showParty }: { lines: StatementLine[]; opening: number; closing: number; debitLabel?: string; creditLabel?: string; showParty?: boolean }) {
  const t = useT()
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0)
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0)
  const rows = [{ date: '', description: t('رصيد أول المدة', 'Opening balance'), debit: 0, credit: 0, balance: opening, _opening: true } as any, ...lines.map((l, i) => ({ ...l, _i: i }))]
  const columns: Column<any>[] = [
    { key: 'date', header: t('التاريخ', 'Date'), width: 96, render: (r) => <span className="num">{date(r.date)}</span> },
    { key: 'source', header: t('المستند', 'Document'), width: 150, render: (r) => (r._opening ? '' : <span className="inline-flex items-center gap-1">{sourceLabel(r.source_type)} <span className="num muted">{r.reference}</span></span>) },
    { key: 'description', header: t('البيان', 'Description'), render: (r) => (r._opening ? <b>{r.description}</b> : r.description) },
    ...(showParty ? [{ key: 'party', header: t('الطرف', 'Party'), render: (r: any) => r.party ?? '' }] : []),
    { key: 'debit', header: debitLabel ?? t('مدين', 'Debit'), align: 'end', width: 120, render: (r) => (r._opening ? '' : <Money value={r.debit} className={Number(r.debit) ? '' : 'muted'} />), footer: <Money value={totalDebit} /> },
    { key: 'credit', header: creditLabel ?? t('دائن', 'Credit'), align: 'end', width: 120, render: (r) => (r._opening ? '' : <Money value={r.credit} className={Number(r.credit) ? '' : 'muted'} />), footer: <Money value={totalCredit} /> },
    { key: 'balance', header: t('الرصيد', 'Balance'), align: 'end', width: 130, render: (r) => <Money value={r.balance} paren colored />, footer: <Money value={closing} paren colored /> },
    { key: 'go', header: '', width: 34, render: (r) => (sourceLink(r.source_type, r.source_id) ? <button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate(sourceLink(r.source_type, r.source_id)!)} aria-label={t('فتح المستند', 'Open document')}><ExternalLink size={12} /></button> : null) },
  ]
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => (r._opening ? 'opening' : `l${r._i}`)}
      columns={columns}
      footer
      onOpen={(r) => {
        // Documents open themselves; manual entries open the journal entry.
        const link = sourceLink(r.source_type, r.source_id) ?? (r.entry_id ? `/finance/journals/${r.entry_id}` : null)
        if (link) navigate(link)
      }}
    />
  )
}
