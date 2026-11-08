import arabic from './messages.ar.json'

/** Exact application messages only; record names, server values and technical identifiers stay intact. */
export function localizeMessage(message: string, locale: string): string {
  const plain = message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
  if (locale !== 'ar') return plain
  const translated = (arabic as Record<string, string>)[plain]
  if (translated) return translated
  const inactive = /^This license is (revoked|suspended|expired)\. Refresh it or contact the administrator\.$/.exec(plain)
  if (inactive) return 'الترخيص ' + ({ revoked: 'ملغى', suspended: 'موقوف', expired: 'منتهي' }[inactive[1]] ?? '') + '. حدّثه أو تواصل مع المسؤول.'
  if (/^This license does not allow (online|offline) use\.$/.test(plain)) return plain.includes('offline') ? 'الترخيص لا يسمح بالعمل دون إنترنت.' : 'الترخيص لا يسمح بالعمل على الخادم.'
  return plain
}
