export interface ExportPage<T> { data: T[]; current_page?: number; last_page?: number; total?: number }
export interface ExportProgress { loaded: number; total?: number }

/** Save only a complete result. A failed, cancelled or inconsistent read never becomes a partial CSV. */
export async function collectPages<T>(fetchPage: (page: number) => Promise<ExportPage<T>>, options: { signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void; maxRows?: number } = {}): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>()
  let expectedTotal: number | undefined
  const limit = options.maxRows ?? 100_000
  for (let page = 1; ; page++) {
    options.signal?.throwIfAborted()
    const result = await fetchPage(page)
    options.signal?.throwIfAborted()
    const last = result.last_page ?? 1
    if (!Array.isArray(result.data) || !Number.isInteger(last) || last < page || (result.current_page !== undefined && result.current_page !== page)) throw new Error('Invalid paginated response. Export was not saved.')
    if (page === 1) expectedTotal = result.total
    if (expectedTotal !== result.total) throw new Error('The data changed during export. Refresh and try again.')
    if ((expectedTotal ?? 0) > limit || rows.length + result.data.length > limit) throw new Error('Export too large. Narrow the filters and try again.')
    for (const row of result.data) {
      const id = row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined
      if (id != null) {
        const key = String(id)
        if (seen.has(key)) throw new Error('The data changed during export. Refresh and try again.')
        seen.add(key)
      }
      rows.push(row)
    }
    options.onProgress?.({ loaded: rows.length, total: expectedTotal })
    if (page >= last) {
      if (expectedTotal !== undefined && rows.length !== expectedTotal) throw new Error('The data changed during export. Refresh and try again.')
      return rows
    }
    if (!result.data.length) throw new Error('Invalid paginated response. Export was not saved.')
  }
}
