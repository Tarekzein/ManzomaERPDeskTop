import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanyAutomation } from '../src/main/companyAutomation'
afterEach(() => vi.useRealTimers())
describe('Local company scans', () => {
  it('catches up at open and after sleep, never overlaps and stops on company close', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const scan = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const runner = new CompanyAutomation(scan, 60_000)
    runner.start()
    expect(scan).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(scan).toHaveBeenCalledTimes(1)
    finish(); await Promise.resolve(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(scan).toHaveBeenCalledTimes(2)
    finish(); await Promise.resolve(); await Promise.resolve()
    await runner.stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(scan).toHaveBeenCalledTimes(2)
    expect(runner.state.lastSuccess).toBeTruthy()
  })
  it('records a failure, retries safely and clears the error after success', async () => {
    vi.useFakeTimers()
    const scan = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue(undefined)
    const runner = new CompanyAutomation(scan)
    runner.start(); await vi.advanceTimersByTimeAsync(1)
    expect(runner.state.lastError).toBe('busy')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(scan).toHaveBeenCalledTimes(2)
    expect(runner.state.lastError).toBeUndefined()
    await runner.stop()
  })
})
