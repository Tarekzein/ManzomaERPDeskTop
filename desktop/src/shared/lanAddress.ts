/** Invitations accept only HTTPS endpoints on this computer/private LAN, never a public host. */
export function privateAddress(host: string): boolean {
  const ip = host.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '')
  if (ip === '::1' || /^(?:fc|fd)[0-9a-f]{2}:|^fe80:/i.test(ip)) return true
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
}
export function lanAddress(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || !privateAddress(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the HTTPS address from the main computer pairing code.')
  return url.origin
}
