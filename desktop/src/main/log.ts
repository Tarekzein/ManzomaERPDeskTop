import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

/** Minimal file logger for the main process (rotated by date). */
export function log(scope: string, message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] [${scope}] ${message}${extra !== undefined ? ' ' + safe(extra) : ''}\n`
  if (paths.isDev) process.stdout.write(line)
  try {
    appendFileSync(join(paths.logs(), `main-${new Date().toISOString().slice(0, 10)}.log`), line)
  } catch {
    // Logging must never crash the app.
  }
}

function safe(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}
