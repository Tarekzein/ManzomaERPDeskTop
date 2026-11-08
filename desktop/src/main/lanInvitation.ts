import { verify } from 'node:crypto'
import { lanAddress } from '../shared/lanAddress'
import { verifyLicense, fingerprint, type LicenseEnvelope, type LicenseClaims } from './licenseCrypto'

export interface LanInvitation { url: string; company: string; name: string; tlsFingerprint: string; host: LicenseEnvelope; signature: string }
export function invitationMessage(data: Omit<LanInvitation, 'signature'>): string {
  return JSON.stringify([data.url,data.company,data.name,data.tlsFingerprint,data.host.payload,data.host.signature])
}
export function readLanInvitation(input: string, keys: string[], own: LicenseClaims): LanInvitation {
  try {
    if (input.length > 32000 || !input.startsWith('MZLAN1.')) throw new Error()
    const data: LanInvitation = JSON.parse(Buffer.from(input.slice(7),'base64url').toString('utf8'))
    if (lanAddress(data.url) !== data.url || !/^[a-f0-9]{64}$/.test(data.tlsFingerprint) || typeof data.name !== 'string' || data.name.length > 120) throw new Error()
    const raw: LicenseClaims = JSON.parse(Buffer.from(data.host.payload,'base64url').toString('utf8'))
    const host = verifyLicense(data.host, keys, raw.device_id, raw.machine_hash)
    if (!host.device_public_key || fingerprint(host.device_public_key) !== host.device_id || host.license_id !== own.license_id || host.issuer !== own.issuer || !host.offline_companies.some(c => c.id === data.company) || host.company_assignment?.id !== data.company || host.company_assignment.host_device_id !== host.device_id) throw new Error()
    if (!verify('RSA-SHA256',Buffer.from(invitationMessage(data)),host.device_public_key,Buffer.from(data.signature,'base64url'))) throw new Error()
    return data
  } catch { throw new Error('The pairing code is invalid or expired. Ask the main computer for a new code.') }
}
