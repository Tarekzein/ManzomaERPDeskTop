/** Submit known fields only; an explicitly unmapped column never falls back to its old header. */
export function mapImportRows(rows: Record<string, string>[], columns: string[], mapping: Record<string, string>, stages = false): Record<string, string>[] {
  const targets = [...new Set([...columns, ...(stages ? rows.flatMap(row => Object.keys(row).filter(key => key.startsWith('stage.'))) : [])])]
  return rows.map(row => Object.fromEntries(targets.flatMap(target => {
    const source = Object.hasOwn(mapping, target) ? mapping[target] : target
    return source && Object.hasOwn(row, source) ? [[target, row[source]]] : []
  })))
}
