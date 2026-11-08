import { createHash, createPublicKey, sign, verify } from 'node:crypto'
export interface LicenseEnvelope { payload: string; signature: string }
export interface LicenseClaims {
  v: 1; issuer: string; license_id: string; revision: number; customer_name: string; device_id: string; machine_hash: string;
  status?: 'active' | 'suspended' | 'revoked' | 'expired';
  mode: 'online' | 'offline' | 'hybrid'; issued_at: number; expires_at: number;
  device_public_key?: string;
  company_assignment?: {id: string; name: string; mode: 'online' | 'offline'; host_device_id?: string | null} | null;
  offline_companies: { id: string; name: string; registered?: boolean }[]; online_companies: string[]; max_devices: number; max_companies: number;
}
export const fingerprint = (publicKey: string) => createHash('sha256').update(publicKey).digest('hex')
export function verifyLicense(envelope: LicenseEnvelope, publicKey: string | string[], deviceId: string, machineHash: string, now = Date.now(), allowExpired = false, allowInactive = false): LicenseClaims {
  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || !(Array.isArray(publicKey) ? publicKey : [publicKey]).some(key => verify('RSA-SHA256', Buffer.from(envelope.payload), createPublicKey(key), Buffer.from(envelope.signature, 'base64url')))) throw new Error('The license signature is invalid.')
  const claims: LicenseClaims = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'))
  if (claims.v !== 1 || claims.device_id !== deviceId || claims.machine_hash !== machineHash) throw new Error('This license belongs to another device.')
  if (!allowInactive && claims.status && claims.status !== 'active') throw new Error('This license is ' + claims.status + '. Refresh it or contact the administrator.')
  if (!Number.isFinite(claims.issued_at) || !Number.isFinite(claims.expires_at) || claims.issued_at * 1000 > now + 300000 || (!allowExpired && claims.expires_at * 1000 <= now)) throw new Error('The license has expired or the computer date is incorrect.')
  if (!['online','offline','hybrid'].includes(claims.mode) || !Array.isArray(claims.offline_companies) || !Array.isArray(claims.online_companies) || claims.offline_companies.some(c => !/^[a-f0-9-]{36}$/i.test(c.id))) throw new Error('The license contents are invalid.')
  return claims
}
export function deviceProof(privateKey: string, deviceId: string, machineHash: string): string { return sign('RSA-SHA256', Buffer.from(['manzoma-device-v1',deviceId,machineHash].join('\n')), privateKey).toString('base64url') }
export function requestProof(privateKey: string, deviceId: string, method: string, path: string, company: string, timestamp: string, nonce: string): string {
  return sign('RSA-SHA256', Buffer.from(['manzoma-api-v1',deviceId,timestamp,nonce,method.toUpperCase(),path,company].join('\n')), privateKey).toString('base64url')
}
