import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Exclusive ownership prevents a failed concurrent import from deleting another company's files. */
export function reserveCompanyDirectory(userData: string, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid local company identifier.')
  const parent = join(userData, 'companies')
  mkdirSync(parent, { recursive: true })
  const directory = join(parent, id)
  mkdirSync(directory, { mode: 0o700 })
  return { directory, discard: () => rmSync(directory, { recursive: true, force: true }) }
}
