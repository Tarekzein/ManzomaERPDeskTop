/** API timestamps without an offset are UTC, including Laravel's SQL-style serialization. */
export function apiDateTime(value: string): Date {
  const normalized = value.replace(' ', 'T')
  return new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : normalized + 'Z')
}

/** datetime-local controls contain the operator's local time. */
export function dateTimeInput(value: string): string {
  const date = apiDateTime(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function utcDateTime(value: string): string {
  if (!value) throw new Error('A date and time are required.')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date or time.')
  return date.toISOString()
}
