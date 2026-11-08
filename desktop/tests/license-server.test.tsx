import { describe, expect, it } from 'vitest'
import { licenseServerUrl } from '../src/shared/licenseServer'

describe('Installed-app issuer addresses', () => {
  it('supports localhost acceptance without permitting remote plain HTTP', () => {
    expect(licenseServerUrl('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000')
    expect(licenseServerUrl('http://localhost:8000')).toBe('http://localhost:8000')
    expect(licenseServerUrl('http://[::1]:8000')).toBe('http://[::1]:8000')
    for (const url of ['http://192.168.1.10:8000', 'http://license.example.test', 'http://localhost.evil.test', 'http://127.0.0.1.evil.test']) expect(() => licenseServerUrl(url)).toThrow('HTTPS')
  })
  it('accepts remote HTTPS but rejects credentials, fragments and query parameters', () => {
    expect(licenseServerUrl('https://license.example.test/')).toBe('https://license.example.test')
    for (const url of ['https://user:password@license.example.test', 'https://license.example.test?token=secret', 'https://license.example.test#fragment', 'file:///tmp/issuer']) expect(() => licenseServerUrl(url)).toThrow('HTTPS')
  })
})
