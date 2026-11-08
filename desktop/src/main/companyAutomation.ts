export interface AutomationState { running: boolean; lastSuccess?: string; lastError?: string; lastAttempt?: string }

/** One scan per open company. A short heartbeat also catches up after machine sleep. */
export class CompanyAutomation {
  private timer?: ReturnType<typeof setInterval>
  private pending?: Promise<void>
  private nextRun = 0
  private active = false
  readonly state: AutomationState = { running: false }

  constructor(private readonly scan: () => Promise<unknown>, private readonly interval = 15 * 60_000) {}

  start(): void {
    if (this.active) return
    this.active = true
    this.timer = setInterval(() => { void this.tick() }, 30_000)
    this.timer.unref?.()
    void this.tick()
  }

  async tick(): Promise<void> {
    if (!this.active || this.pending || Date.now() < this.nextRun) return
    this.nextRun = Date.now() + this.interval
    this.state.running = true
    this.state.lastAttempt = new Date().toISOString()
    this.pending = (async () => {
      try {
        await this.scan()
        this.state.lastSuccess = new Date().toISOString()
        this.state.lastError = undefined
      } catch (error) {
        this.state.lastError = error instanceof Error ? error.message : String(error)
        // Retry transient SQLite contention without starting concurrent scans.
        this.nextRun = Date.now() + 60_000
      } finally { this.state.running = false }
    })()
    try { await this.pending } finally { this.pending = undefined }
  }

  async stop(): Promise<void> {
    this.active = false
    clearInterval(this.timer)
    await this.pending
  }
}
