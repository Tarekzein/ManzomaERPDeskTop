/** Remote issuers require TLS. Plain HTTP is limited to this computer for local acceptance. */
export function licenseServerUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Use an HTTPS license server address.') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error('Use an HTTPS license server address.')
  return url.href.replace(/\/+$/, '')
}
