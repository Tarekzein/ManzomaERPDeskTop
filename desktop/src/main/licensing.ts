import { licenseServerUrl } from '../shared/licenseServer'
import { serverSettings } from '../shared/serverSettings'
import { userErrorMessage, httpErrorMessage } from '../shared/userError'
import { app, safeStorage } from 'electron'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { execFileSync } from 'node:child_process'
import { paths } from './paths'
import { store } from './store'
import { deviceProof, fingerprint, requestProof, verifyLicense, type LicenseEnvelope, type LicenseClaims } from './licenseCrypto'
import type { CompanyProfile, CreateLocalCompanyInput, LicenseStatus } from '../shared/types'
import { readLanInvitation, invitationMessage, type LanInvitation } from './lanInvitation'

const required = () => app.isPackaged || process.env.ERP_LICENSE_BYPASS !== 'development'
const directory = () => { const dir = join(paths.userData(),'licensing'); mkdirSync(dir,{recursive:true}); return dir }
const certificatePath = () => join(directory(),'certificate.json')
function publicKeyPath(): string {
  if (app.isPackaged) return join(process.resourcesPath,'license-public-key.pem')
  const bundled = join(app.getAppPath(),'resources','license-public-key.pem')
  // Source development trusts only the sibling backend's local signing key, never a downloaded key.
  return existsSync(bundled) ? bundled : join(paths.backend(),'storage','app','control','signing-public.pem')
}
function legacyPublicKeysPath(): string { return app.isPackaged ? join(process.resourcesPath, 'license-legacy-public-keys.json') : join(app.getAppPath(), 'resources', 'license-legacy-public-keys.json') }
function trustedPublicKeys(): string[] {
  const current = readFileSync(publicKeyPath(), 'utf8')
  const file = legacyPublicKeysPath()
  const legacy: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  if (!Array.isArray(legacy) || legacy.length > 5 || legacy.some(key => typeof key !== 'string' || !key.includes('BEGIN PUBLIC KEY') || key.includes('PRIVATE KEY'))) throw new Error('Invalid issuer trust configuration.')
  return [current, ...legacy]
}
function atomic(path: string, value: string) { writeFileSync(path+'.tmp',value,{mode:0o600}); renameSync(path+'.tmp',path) }
let machine: string | null = null
function machineHash(): string {
  if (machine) return machine
  let raw: string
  if (process.platform === 'darwin') raw = execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8',timeout:10000}).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? ''
  else if (process.platform === 'win32') raw = execFileSync('reg',['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid'],{encoding:'utf8',timeout:10000,windowsHide:true}).match(/MachineGuid\s+REG_SZ\s+([^\s]+)/)?.[1] ?? ''
  else raw = readFileSync('/etc/machine-id','utf8').trim()
  if (!raw) throw new Error('Cannot identify this computer for device licensing.')
  machine = createHash('sha256').update('manzoma-device-v1:'+process.platform+':'+raw).digest('hex')
  return machine
}
let syncPromise: Promise<void> | null = null
let lastSyncAttempt = 0
let cachedIdentity: { publicKey: string; privateKey: string } | null = null
let identityPromise: Promise<void> | null = null
async function initializeIdentity(): Promise<void> {
  if (cachedIdentity) return
  if (identityPromise) return identityPromise
  identityPromise = (async () => {
    if (!await safeStorage.isAsyncEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('Enable the operating-system keychain before activating this device.')
    const file = join(directory(),'identity.json')
    if (existsSync(file)) {
      const stored = JSON.parse(readFileSync(file,'utf8'))
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(stored.privateKey,'base64'))
      if (decrypted.shouldReEncrypt) atomic(file, JSON.stringify({ publicKey: stored.publicKey, privateKey: (await safeStorage.encryptStringAsync(decrypted.result)).toString('base64') }))
      cachedIdentity = { publicKey: stored.publicKey as string, privateKey: decrypted.result }
    } else {
      const pair = generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
      atomic(file,JSON.stringify({publicKey:pair.publicKey,privateKey:(await safeStorage.encryptStringAsync(pair.privateKey)).toString('base64')}))
      cachedIdentity = pair
    }
  })()
  try { await identityPromise } finally { identityPromise = null }
}
function identity() {
  if (!cachedIdentity) throw new Error('Device key storage is not ready. Try activation again.')
  return cachedIdentity
}
function certificate() { if (!existsSync(certificatePath())) throw new Error('Connect to the internet and activate this device first.'); return JSON.parse(readFileSync(certificatePath(),'utf8')) as LicenseEnvelope }
function claims(allowExpired = false) {
  if (!existsSync(publicKeyPath())) throw new Error('This desktop build needs the issuer public key. Contact your administrator.')
  const device = identity()
  const now = Date.now()
  const verified = verifyLicense(certificate(),trustedPublicKeys(),fingerprint(device.publicKey),machineHash(),now,allowExpired,allowExpired)
  if (!allowExpired) {
    const file = join(directory(),'clock.json')
    const last = existsSync(file) ? Number(JSON.parse(readFileSync(file,'utf8')).last) : verified.issued_at * 1000
    if (!Number.isFinite(last) || now + 300000 < last) throw new Error('The computer clock moved backwards. Correct the date before opening the company.')
    if (!existsSync(file) || now > last + 60000) atomic(file,JSON.stringify({last:Math.max(now,last)}))
  }
  return verified
}
function signHeaders(method: string, path: string, company = ''): Record<string,string> {
  if (!/^\/api\/[a-z0-9_/?=&%.:-]+$/i.test(path) || !['GET','POST','PUT','PATCH','DELETE'].includes(method.toUpperCase())) throw new Error('Invalid API request.')
  const device = identity(), id = fingerprint(device.publicKey), time = String(Math.floor(Date.now()/1000)), nonce = randomBytes(24).toString('hex')
  return { 'X-Device-Id':id,'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Signature':requestProof(device.privateKey,id,method,path.split('?')[0],company,time,nonce),'X-App-Version':app.getVersion() }
}
function authority(raw: string): string { return licenseServerUrl(raw) }
function activationDetails(server: string, input: string): { issuer: string; key: string } {
  const value = input.trim()
  if (value.length > 4096) throw new Error('Invalid activation key.')
  if (value.startsWith('MZ1.')) {
    try {
      const encoded = value.slice(4)
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error()
      const data: unknown = JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))
      if (!data || typeof data !== 'object' || !('server' in data) || typeof data.server !== 'string' || !('key' in data) || typeof data.key !== 'string') throw new Error()
      return { issuer: authority(data.server), key: validateActivationSecret(data.key) }
    } catch { throw new Error('Invalid activation key. Copy the complete key from your license administrator.') }
  }
  return { issuer: authority(server), key: validateActivationSecret(value) }
}
function validateActivationSecret(key: string): string {
  if (!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/i.test(key)) throw new Error('Invalid activation key.')
  return key
}
async function postResult(url: string, body: unknown, headers: Record<string,string> = {}, timeout = 15000) {
  const response = await fetch(url,{method:'POST',headers:{'X-Locale':store.prefs?.()?.locale ?? 'ar',Accept:'application/json','Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:'error'})
  let data: { certificate?: LicenseEnvelope; message?: string; errors?: Record<string,string[]>; company?: {slug:string;name:string} }
  try { data = await response.json() } catch { throw new Error(httpErrorMessage(response.ok ? 502 : response.status, store.prefs().locale)) }
  if (response.status >= 500) throw new Error(httpErrorMessage(response.status, store.prefs().locale))
  if (!response.ok) throw new Error(Object.values(data.errors ?? {})[0]?.[0] ?? data.message ?? 'License server rejected this request.')
  if (!data.certificate) throw new Error('The server returned no license certificate.')
  return { ...data, certificate: data.certificate }
}
async function post(url: string, body: unknown, headers: Record<string,string> = {}) { return (await postResult(url,body,headers)).certificate }
function accept(envelope: LicenseEnvelope, expectedIssuer?: string) {
  const device = identity()
  const verified = verifyLicense(envelope,trustedPublicKeys(),fingerprint(device.publicKey),machineHash(),Date.now(),true,true)
  if (!verified.status || verified.status === 'active') verifyLicense(envelope,trustedPublicKeys(),fingerprint(device.publicKey),machineHash())
  if (expectedIssuer && authority(verified.issuer) !== authority(expectedIssuer)) throw new Error('License issuer does not match the selected server.')
  if (existsSync(certificatePath())) { const old = claims(true); if (old.license_id === verified.license_id && old.revision > verified.revision) throw new Error('This license file is older than the installed revision.') }
  atomic(certificatePath(),JSON.stringify(envelope))
}
export const licensing = {
  required, publicKeyPath, certificatePath, initialize: initializeIdentity,
  assertVerified(): void { if (required()) claims() },
  restoreCompanyShortcut(): void {
    if (!required() || store.profiles().length) return
    const c = claims(), assigned = c.company_assignment
    if (assigned?.mode === 'offline' && assigned.host_device_id === c.device_id && existsSync(join(paths.userData(),'companies',assigned.id,'company.sqlite'))) {
      store.upsertProfile({id:assigned.id,name:assigned.name,mode:'local',createdAt:new Date().toISOString()})
    }
  },
  status(): LicenseStatus {
    if (!required()) return { required:false,valid:true }
    try {
      const c = claims()
      const local = c.offline_companies.filter(company => store.profile(company.id) || existsSync(join(paths.userData(),'companies',company.id,'company.sqlite')))
      let sync: { lastSuccess?: string; failed?: boolean } = {}
      try { sync = JSON.parse(readFileSync(join(directory(),'company-sync.json'),'utf8')) } catch { /* No prior confirmation. */ }
      return {required:true,valid:true,customerName:c.customer_name,expiresAt:new Date(c.expires_at*1000).toISOString(),mode:c.mode,offlineSlots:c.offline_companies.length,companies:c.max_companies,devices:c.max_devices,issuer:c.issuer,
        assignment:c.company_assignment,
        localCompanies:local.length,unusedLocalSlots:c.offline_companies.length-local.length,unconfirmedLocalCompanies:local.filter(company=>!company.registered).length,lastCompanyConfirmation:sync.lastSuccess,companySyncFailed:sync.failed}
    }
    catch(error) { let issuer: string | undefined; try { issuer = claims(true).issuer } catch {} return {required:true,valid:false,issuer:issuer ?? (serverSettings.licenseServerUrl || undefined),error:userErrorMessage(error, store.prefs().locale)} }
  },
  request() {
    const device = identity(), id = fingerprint(device.publicKey)
    const root = join(paths.userData(),'companies')
    const existing = new Map(store.profiles().filter(p=>p.mode === 'local').map(p=>[p.id,p.name]))
    if (existsSync(root)) for (const dir of readdirSync(root)) if (/^[a-f0-9-]{36}$/i.test(dir) && existsSync(join(root,dir,'company.sqlite')) && !existing.has(dir)) existing.set(dir,'Existing company')
    return {device_id:id,public_key:device.publicKey,machine_hash:machineHash(),name:hostname().slice(0,120) || 'Desktop',platform:process.platform,app_version:app.getVersion(),existing_companies:[...existing].map(([id,name])=>({id,name})),proof:deviceProof(device.privateKey,id,machineHash())}
  },
  async activate(url: string, key: string) {
    const { issuer, key: secret } = activationDetails(url,key)
    // Do not consume central allowance if this build cannot verify the returned grant.
    if (!existsSync(publicKeyPath())) throw new Error('This desktop build needs the issuer public key. Contact your administrator.')
    let envelope: LicenseEnvelope
    try { envelope = await post(issuer+'/api/licensing/activate',{activation_key:secret,request:this.request()}) }
    catch (error) {
      if (error instanceof TypeError || (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name))) throw new Error('Connect to the internet to activate this device, then try again.')
      throw error
    }
    accept(envelope,issuer)
    return this.status()
  },
  async registerServerCompany(input: CreateLocalCompanyInput): Promise<CompanyProfile> {
    const c = claims(), issuer = authority(c.issuer)
    if (c.company_assignment) throw new Error('Each device can use only one company. Use another licensed device for a different company.')
    if (c.mode === 'offline') throw new Error('This license does not permit online companies.')
    const { adminPassword: _password, ...metadata } = input
    const digest = createHash('sha256').update(JSON.stringify({license:c.license_id,...metadata})).digest('hex')
    const file = join(directory(),'company-registrations.json')
    const pending: Record<string,string> = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : {}
    const id = pending[digest] ?? randomUUID()
    pending[digest] = id
    atomic(file,JSON.stringify(pending))
    const result = await postResult(issuer+'/api/licensing/companies',{...input,registration_id:id},signHeaders('POST','/api/licensing/companies'),120000)
    if (!result.company?.slug || !result.company.name) throw new Error('The server returned no registered company. Retry with the same details.')
    accept(result.certificate,issuer)
    if (!claims().online_companies.includes(result.company.slug)) throw new Error('The registered company is missing from the signed license. Refresh or retry setup.')
    const old = store.profiles().find(profile=>profile.mode === 'server' && profile.serverUrl === issuer && profile.company === result.company!.slug)
    const profile = store.upsertProfile({id:old?.id ?? randomUUID(),name:result.company.name,mode:'server',serverUrl:issuer,company:result.company.slug,createdAt:old?.createdAt ?? new Date().toISOString()})
    delete pending[digest]
    atomic(file,JSON.stringify(pending))
    return profile
  },
  import(contents: string) { if (!existsSync(certificatePath())) throw new Error('Connect to the internet and activate this device first.'); if (contents.length > 1000000) throw new Error('License file is too large.'); accept(JSON.parse(contents)); return this.status() },
  async refresh() { const c = claims(true), issuer = authority(c.issuer); const envelope = await post(issuer+'/api/licensing/refresh',{},signHeaders('POST','/api/licensing/refresh')); accept(envelope,issuer); return this.status() },
  async open(profile: CompanyProfile) {
    if (!required()) return
    if (profile.mode === 'server') { await this.refresh(); const c = claims(); if (authority(profile.serverUrl!) !== authority(c.issuer) || c.company_assignment?.mode !== 'online' || c.company_assignment.id !== (profile.company || 'default') || c.mode === 'offline') throw new Error('This server company is not assigned to your license.') }
    else if (profile.mode === 'lan') this.assertLan(profile)
    else { const c = claims(); if (c.mode === 'online' || c.company_assignment?.id !== profile.id || c.company_assignment.host_device_id !== c.device_id || !c.offline_companies.some(company=>company.id === profile.id)) throw new Error('This local company is not assigned to your offline license. Ask the administrator to update its company allowance, then activate again while connected.') }
  },
  assertLan(profile: CompanyProfile): void {
    const c = claims(), assigned = c.company_assignment
    if (!assigned || assigned.mode !== 'offline' || assigned.id !== profile.company || assigned.host_device_id !== profile.hostDeviceId || !profile.tlsFingerprint) throw new Error('This computer is not authorized for the shared company. Connect to the internet and pair it again.')
  },
  async assignOnline(company: string): Promise<void> {
    if (!required()) return
    const c = claims(), issuer = authority(c.issuer)
    accept(await post(issuer+'/api/licensing/company-assignment',{mode:'online',company},signHeaders('POST','/api/licensing/company-assignment')),issuer)
  },
  async joinLan(input: string): Promise<CompanyProfile> {
    const c = claims(), invite = readLanInvitation(input.trim(),trustedPublicKeys(),c)
    if (c.company_assignment && (c.company_assignment.mode !== 'offline' || c.company_assignment.id !== invite.company)) throw new Error('Each device can use only one company. Use another licensed device for a different company.')
    if (c.company_assignment?.host_device_id === c.device_id) throw new Error('This computer already hosts the company. Open its local company instead.')
    const issuer = authority(c.issuer)
    if (!c.company_assignment) accept(await post(issuer+'/api/licensing/company-assignment',{mode:'offline',company:invite.company},signHeaders('POST','/api/licensing/company-assignment')),issuer)
    const host: LicenseClaims = JSON.parse(Buffer.from(invite.host.payload,'base64url').toString('utf8'))
    return {id:'lan-'+invite.company,name:invite.name,mode:'lan',serverUrl:invite.url,company:invite.company,hostDeviceId:host.device_id,tlsFingerprint:invite.tlsFingerprint,createdAt:new Date().toISOString()}
  },
  invitation(url: string, company: CompanyProfile, tlsFingerprint: string): string {
    const c = claims()
    if (c.company_assignment?.id !== company.id || c.company_assignment.host_device_id !== c.device_id || company.mode !== 'local') throw new Error('Only the main computer can share this company.')
    const data: Omit<LanInvitation,'signature'> = {url,company:company.id,name:company.name,tlsFingerprint,host:certificate()}
    return 'MZLAN1.'+Buffer.from(JSON.stringify({...data,signature:sign('RSA-SHA256',Buffer.from(invitationMessage(data)),identity().privateKey).toString('base64url')})).toString('base64url')
  },
  async syncLocalCompanies(force = false): Promise<void> {
    if (!required()) return
    if (syncPromise) return syncPromise
    if (!force && Date.now()-lastSyncAttempt < 300000) return
    const c = claims()
    if (c.mode === 'online') return
    const companies = this.request().existing_companies
    if (!companies.length) return
    lastSyncAttempt = Date.now()
    syncPromise = (async () => {
      const issuer = authority(c.issuer)
      const result = await postResult(issuer+'/api/licensing/offline-companies/confirm',{companies},signHeaders('POST','/api/licensing/offline-companies/confirm'),3000)
      accept(result.certificate,issuer)
      atomic(join(directory(),'company-sync.json'),JSON.stringify({lastSuccess:new Date().toISOString(),failed:false}))
    })()
    try { await syncPromise } catch (error) {
      let previous: { lastSuccess?: string } = {}
      try { previous = JSON.parse(readFileSync(join(directory(),'company-sync.json'),'utf8')) } catch { /* First attempt. */ }
      atomic(join(directory(),'company-sync.json'),JSON.stringify({lastSuccess:previous.lastSuccess,failed:true}))
      throw error
    } finally { syncPromise = null }
  },
  async reserveLocalCompanyId(): Promise<string | undefined> {
    if (!required()) return undefined
    const c = claims()
    if (c.mode === 'online') throw new Error('This license does not permit offline companies.')
    if (c.company_assignment && (c.company_assignment.mode !== 'offline' || c.company_assignment.host_device_id !== c.device_id)) throw new Error('Each device can use only one company. Use another licensed device for a different company.')
    if (c.company_assignment && (existsSync(join(paths.userData(),'companies',c.company_assignment.id)) || store.profile(c.company_assignment.id))) throw new Error('Each device can use only one company. Use another licensed device for a different company.')
    const unused = c.offline_companies.find(company=>!existsSync(join(paths.userData(),'companies',company.id)) && !store.profile(company.id))
    if (unused) return unused.id
    const file = join(directory(),'offline-slot-request.json')
    const previous = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) as {license:string;id:string} : null
    const id = previous?.license === c.license_id && !existsSync(join(paths.userData(),'companies',previous.id)) && !store.profile(previous.id) ? previous.id : randomUUID()
    atomic(file,JSON.stringify({license:c.license_id,id}))
    const issuer = authority(c.issuer)
    try {
      const envelope = await post(issuer+'/api/licensing/offline-companies/reserve',{id},signHeaders('POST','/api/licensing/offline-companies/reserve'))
      accept(envelope,issuer)
    } catch (error) {
      if (error instanceof TypeError || (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name))) throw new Error('Connect to the internet to set up this device’s company. Existing paired devices still work offline.')
      throw error
    }
    if (!claims().offline_companies.some(company=>company.id === id)) throw new Error('The server did not reserve this company. Retry setup.')
    return id
  },
  newCompanyId(): string | undefined {
    if (!required()) return undefined
    const c = claims()
    if (c.mode === 'online') throw new Error('This license does not permit offline companies.')
    const slot = c.offline_companies.find(company=>!existsSync(join(paths.userData(),'companies',company.id)) && !store.profile(company.id))
    if (!slot) throw new Error('All offline company slots allocated to this device are in use. Connect to the internet when registering an additional company.')
    return slot.id
  },
  headers(profile: CompanyProfile | null, method: string, path: string): Record<string,string> {
    if (!required()) return {}
    if (!profile) throw new Error('Open a licensed company first.')
    const c = claims()
    if (profile.mode === 'lan') { this.assertLan(profile); return {...signHeaders(method,path,profile.company ?? ''),'X-Offline-Certificate':Buffer.from(JSON.stringify(certificate())).toString('base64url')} }
    if (profile.mode === 'local') { if (!c.offline_companies.some(x=>x.id === profile.id)) throw new Error('Company is not licensed.'); return {} }
    if (authority(profile.serverUrl!) !== authority(c.issuer) || !c.online_companies.includes(profile.company || 'default')) throw new Error('Company is not licensed.')
    return signHeaders(method,path,profile.company ?? '')
  },
  serverHeaders(url: string): Record<string,string> { if (!required()) return {}; const c = claims(); if (authority(url) !== authority(c.issuer)) throw new Error('Connect to the licensed server.'); return signHeaders('GET','/api/system/companies') },
  localEnvironment(profileId: string): NodeJS.ProcessEnv {
    if (!required()) return {ERP_CONTROL_ENABLED:'false',ERP_LICENSE_ENFORCE:'false'}
    const c = claims()
    return {ERP_CONTROL_ENABLED:'false',ERP_LICENSE_ENFORCE:'true',ERP_OFFLINE_CERTIFICATE:certificatePath(),ERP_LICENSE_PUBLIC_KEY:publicKeyPath(),ERP_LICENSE_LEGACY_PUBLIC_KEYS:legacyPublicKeysPath(),ERP_LICENSE_COMPANY_ID:profileId,ERP_LICENSE_DEVICE_ID:c.device_id,ERP_LICENSE_MACHINE_HASH:machineHash()}
  },
}
