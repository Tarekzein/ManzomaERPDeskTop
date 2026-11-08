import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/src/lib/platform', () => ({ platform: { licensing: { headers: async () => ({}) } } }))
import { api, configureApi } from '../src/renderer/src/lib/api'
afterEach(() => vi.unstubAllGlobals())

describe('API error boundaries', () => {
  it('hides debug JSON and proxy HTML for normal requests and uploads', async () => {
    configureApi({baseUrl:'https://erp.example.test',locale:'ar'})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({message:'SQLSTATE[secret]',trace:['private stack']}),{status:500})))
    await expect(api.get('/products')).rejects.toMatchObject({code:'server_error',message:expect.stringContaining('الخادم')})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>private proxy diagnostic</html>',{status:413})))
    await expect(api.upload('/attachments',new FormData())).rejects.toMatchObject({status:413,message:expect.stringContaining('الملف')})
  })
  it('keeps actionable validation messages and field errors', async () => {
    configureApi({locale:'ar'})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({message:'Validation failed',errors:{activation_key:['Invalid activation key.']}}),{status:422})))
    await expect(api.post('/test')).rejects.toMatchObject({status:422,message:expect.stringContaining('التفعيل'),errors:{activation_key:[expect.stringContaining('التفعيل')]}})
  })
  it('gives translated network and download errors without exposing fetch diagnostics', async () => {
    configureApi({locale:'en'})
    vi.stubGlobal('fetch', vi.fn(async () => {throw new TypeError('fetch failed private host')}))
    await expect(api.download('/export')).rejects.toMatchObject({code:'network',message:'Cannot reach the server. Check your connection and try again.'})
    await expect(api.upload('/attachments',new FormData())).rejects.toMatchObject({code:'network'})
  })
})
