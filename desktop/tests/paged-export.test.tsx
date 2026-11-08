import { describe, expect, it } from 'vitest'
import { collectPages } from '../src/renderer/src/lib/pagedExport'
import { serviceCsv } from '../src/renderer/src/features/service/queueCsv'
import { usePrefs } from '../src/renderer/src/store/prefs'
import { toCsv } from '../src/renderer/src/lib/csv'

describe('Complete paged exports', () => {
  it('reads every page above 1,000 records and preserves order and progress', async () => {
    const requested: number[] = [], progress: number[] = []
    const all = Array.from({ length: 1105 }, (_, i) => ({ id: i + 1 }))
    const result = await collectPages(async page => { requested.push(page); return { data: all.slice((page - 1) * 500, page * 500), current_page: page, last_page: 3, total: 1105 } }, { onProgress: value => progress.push(value.loaded) })
    expect(requested).toEqual([1, 2, 3]); expect(result).toEqual(all); expect(progress).toEqual([500, 1000, 1105])
  })
  it('propagates a failed later page instead of returning a partial result', async () => {
    await expect(collectPages(async page => { if (page === 2) throw new Error('Network failed'); return { data: [{ id: 1 }], current_page: 1, last_page: 2, total: 2 } })).rejects.toThrow('Network failed')
  })
  it('rejects changed totals and duplicate or missing records between pages', async () => {
    await expect(collectPages(async page => ({ data: [{ id: page }], current_page: page, last_page: 2, total: page === 1 ? 2 : 3 }))).rejects.toThrow('data changed')
    await expect(collectPages(async page => ({ data: [{ id: 1 }], current_page: page, last_page: 2, total: 2 }))).rejects.toThrow('data changed')
    await expect(collectPages(async () => ({ data: [{ id: 1 }], last_page: 1, total: 2 }))).rejects.toThrow('data changed')
  })
  it('stops before fetching another page after cancellation', async () => {
    const controller = new AbortController(), requested: number[] = []
    await expect(collectPages(async page => { requested.push(page); return { data: [{ id: page }], current_page: page, last_page: 2, total: 2 } }, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    expect(requested).toEqual([1])
  })
  it('rejects oversized or malformed output and accepts an unpaginated profile list', async () => {
    await expect(collectPages(async () => ({ data: [{ id: 1 }], total: 100001 }))).rejects.toThrow('too large')
    await expect(collectPages(async () => ({ data: [], current_page: 2, last_page: 3 }))).rejects.toThrow('Invalid paginated')
    expect(await collectPages(async () => ({ data: [{ id: 5 }, { id: 6 }] }))).toEqual([{ id: 5 }, { id: 6 }])
  })
  it('exports linked service identity and translated status while escaping spreadsheet formulas', () => {
    usePrefs.setState({ locale: 'en' })
    const row = { id: 7, status: 'scheduled', scheduled_start: '2026-10-28T07:00:00Z', request: { party: { name: 'أسرة', name_en: '=Household', mobile: '01012345678' }, unit: { unit_code: 'WF-7', product: { name_en: 'RO filter' } }, description: 'Kitchen visit' }, technician: { name: 'Ali' } }
    const csv = toCsv([row], serviceCsv('visits', (_ar, en) => en))
    expect(csv).toContain("'=Household"); expect(csv).toContain('WF-7'); expect(csv).toContain('Scheduled'); expect(csv).toContain('Appointment start — UTC'); expect(csv).toContain('2026-10-28T07:00:00Z')
  })
})
