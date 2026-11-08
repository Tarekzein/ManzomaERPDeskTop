import arabic from './messages.ar.json'
import { localizeMessage } from './localizeMessage'

const messages = arabic as Record<string, string>
const english = new Map(Object.entries(messages).map(([en, ar]) => [ar, en]))
const generic = 'Something went wrong. Try again. If it continues, contact your administrator.'

/** Never render PHP/SQL/HTML/OS diagnostics. Detailed failures belong in private logs. */
export function userErrorMessage(error: unknown, locale: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  let message = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').replace(/^Error:\s*/, '').trim()
  message = english.get(message) ?? message
  const say = (text: string) => localizeMessage(text, locale)
  if (/EADDRINUSE/i.test(message)) return say('This network port is already in use. Choose another port and try again.')
  if (/PailServiceProvider|(?:Class|Interface|Trait) ["'][^"']+["'] not found|In \S+\.php line \d+/i.test(message)) return say('The company database could not start. Close and reopen the application. If it continues, contact your administrator.')
  if (/fetch failed|failed to fetch|networkerror|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|TimeoutError|AbortError|network request failed/i.test(message)) return say('Cannot reach the server. Check your connection and try again.')
  if (/EACCES|EPERM|permission denied|access is denied/i.test(message)) return say('The application cannot access the required file. Check folder permissions or contact your administrator.')
  if (/ENOSPC|disk (?:is )?full|no space left/i.test(message)) return say('There is not enough disk space. Free some space and try again.')
  if (/^HTTP\s+(\d+)/i.test(message)) return httpErrorMessage(Number(message.match(/\d+/)?.[0]), locale)
  if (!message || message.length > 600 || /SQLSTATE|Stack trace|Fatal error|Parse error|Uncaught |Exception:|Error:|\.php(?::\d+|\s+(?:on\s+)?line)|node:|\bat .+\(.+:\d+:\d+\)|<\/?(?:html|body|head|script|!doctype)|Unexpected token|is not (?:a function|defined)|Cannot read propert|ENOENT|spawn .+|Command failed|SyntaxError|TypeError|ReferenceError|sqlite|mysql|PDOException/i.test(message)) return say(generic)
  const translated = localizeMessage(message, locale)
  // Untranslated dynamic server text must not appear in the wrong UI language.
  if (locale === 'ar' && !/[\u0600-\u06ff]/.test(translated) || locale !== 'ar' && /[\u0600-\u06ff]/.test(translated)) return say(generic)
  return translated
}

export function httpErrorMessage(status: number, locale: string): string {
  const message = status === 401 ? 'Your session has ended. Sign in again.'
    : status === 403 ? 'You do not have permission to perform this action.'
    : status === 404 ? 'The requested record or service was not found.'
    : status === 409 ? 'This record changed. Reload it and try again.'
    : status === 413 ? 'The file is too large. Choose a smaller file.'
    : status === 422 ? 'Please check the entered data and try again.'
    : status === 429 ? 'Too many attempts. Wait a moment and try again.'
    : status >= 500 ? 'The server could not complete the request. Try again shortly or contact your administrator.'
    : generic
  return localizeMessage(message, locale)
}
