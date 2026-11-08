import { userErrorMessage, httpErrorMessage } from '@shared/userError'
import { platform } from './platform'
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public errors?: Record<string, string[]>,
    public context?: Record<string, any>,
  ) {
    super(userErrorMessage(message, config.locale))
    if (errors) this.errors = Object.fromEntries(Object.entries(errors).map(([key, messages]) => [key, messages.map(message => userErrorMessage(message, config.locale))]))
  }
}

interface ApiConfig {
  baseUrl: string
  token: string | null
  company?: string
  locale: string
  onUnauthorized?: () => void
}

const config: ApiConfig = { baseUrl: '', token: null, locale: 'ar' }

export function configureApi(patch: Partial<ApiConfig>): void {
  Object.assign(config, patch)
}

type Query = Record<string, string | number | boolean | null | undefined>

function qs(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  })
  const s = params.toString()
  return s ? `?${s}` : ''
}

async function headers(json = true, method = 'GET', path = '/api/unknown'): Promise<Record<string, string>> {
  const h: Record<string, string> = { Accept: 'application/json', 'X-Locale': config.locale }
  if (json) h['Content-Type'] = 'application/json'
  if (config.token) h.Authorization = `Bearer ${config.token}`
  if (config.company) h['X-Company'] = config.company
  return { ...h, ...await platform.licensing.headers(method, path) }
}

async function request<T>(method: string, path: string, query?: Query, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const signedHeaders = await headers(body !== undefined, method, `/api${path}`)
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/api${path}${qs(query)}`, {
      method,
      headers: { ...signedHeaders, ...extraHeaders },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(config.locale === 'ar' ? 'تعذر الاتصال بالخادم. تأكد من تشغيله ومن الشبكة.' : 'Cannot reach the server. Check that it is running and the network is up.', 0, 'network')
  }
  if (response.status === 401 && config.token) config.onUnauthorized?.()
  return readResponse(response) as Promise<T>
}

async function readResponse(response: Response): Promise<any> {
  if (response.status >= 500) throw new ApiError(httpErrorMessage(response.status, config.locale), response.status, 'server_error')
  const text = await response.text().catch(() => { throw new ApiError(httpErrorMessage(502, config.locale), 502, 'invalid_response') })
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError(httpErrorMessage(response.ok ? 502 : response.status, config.locale), response.ok ? 502 : response.status, 'invalid_response')
  }
  if (!response.ok) {
    const firstError = data?.errors ? (Object.values(data.errors as Record<string, string[]>)[0]?.[0] ?? null) : null
    throw new ApiError(firstError || data?.message || httpErrorMessage(response.status, config.locale), response.status, data?.code, data?.errors, data?.context)
  }
  return data
}

export const api = {
  upload: async (path: string, data: FormData): Promise<any> => {
    const signedHeaders = await headers(false, 'POST', `/api${path}`)
    let response: Response
    try { response = await fetch(`${config.baseUrl}/api${path}`, { method: 'POST', headers: signedHeaders, body: data }) }
    catch { throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'network') }
    if (response.status === 401 && config.token) config.onUnauthorized?.()
    return readResponse(response)
  },
  postOnce: <T = any>(path: string, body: unknown, key: string) => request<T>('POST', path, undefined, body, { 'Idempotency-Key': key }),
  get: <T = any>(path: string, query?: Query) => request<T>('GET', path, query),
  post: <T = any>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, query, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, undefined, body ?? {}),
  del: <T = any>(path: string) => request<T>('DELETE', path),
  url: (path: string, query?: Query) => `${config.baseUrl}/api${path}${qs(query)}`,
  async download(path: string, query?: Query): Promise<Blob> {
    const signedHeaders = await headers(false, 'GET', `/api${path}`)
    let response: Response
    try { response = await fetch(`${config.baseUrl}/api${path}${qs(query)}`, { headers: signedHeaders }) }
    catch { throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'network') }
    if (response.status === 401 && config.token) config.onUnauthorized?.()
    if (!response.ok) await readResponse(response)
    return response.blob()
  },
}

export interface Page<T> {
  data: T[]
  current_page?: number
  last_page?: number
  total?: number
  per_page?: number
  totals?: Record<string, any>
}
