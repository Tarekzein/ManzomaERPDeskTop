import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { exportCsv, type CsvColumn } from './csv'
import { collectPages, type ExportProgress } from './pagedExport'

export function useCsvExport() {
  const running = useRef<AbortController | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => () => { running.current?.abort(); running.current = null }, [])
  const cancel = () => { running.current?.abort(); running.current = null; setProgress(null) }
  const start = async <T,>(path: string, params: Record<string, any>, name: string, columns: CsvColumn<T>[]) => {
    if (running.current) return
    const controller = new AbortController()
    running.current = controller; setError(null); setProgress({ loaded: 0 })
    try {
      const rows = await collectPages<T>(page => api.get(path, { ...params, page, per_page: 500 }), { signal: controller.signal, onProgress: value => { if (running.current === controller) setProgress(value) } })
      controller.signal.throwIfAborted()
      await exportCsv(name, rows, columns)
    } catch (failure) {
      if (!controller.signal.aborted && running.current === controller) setError(failure)
    } finally {
      if (running.current === controller) { running.current = null; setProgress(null) }
    }
  }
  return { start, cancel, progress, error }
}
