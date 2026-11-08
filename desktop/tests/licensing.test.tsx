import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reserveCompanyDirectory } from '../src/main/companyDirectory'
import { deviceProof, fingerprint, requestProof, verifyLicense, type LicenseClaims } from '../src/main/licenseCrypto'

const fixture = vi.hoisted(() => ({ root: '', profiles: [] as import('../src/shared/types').CompanyProfile[] }))
vi.mock('electron', () => ({ app: { isPackaged:false, getAppPath:()=>fixture.root, getVersion:()=> '1.0.0' }, safeStorage:{isEncryptionAvailable:()=>true,isAsyncEncryptionAvailable:async()=>true,getSelectedStorageBackend:()=> 'test_keychain',encryptString:(v:string)=>Buffer.from(v),decryptString:(v:Buffer)=>v.toString(),encryptStringAsync:async(v:string)=>Buffer.from(v),decryptStringAsync:async(v:Buffer)=>({result:v.toString(),shouldReEncrypt:false})} }))
vi.mock('../src/main/paths', () => ({ paths:{isDev:true,userData:()=>join(fixture.root,'profile')} }))
vi.mock('../src/main/store', () => ({ store:{ prefs:()=>({locale:'en'}), profiles:()=>fixture.profiles, profile:(id:string)=>fixture.profiles.find(p=>p.id===id), upsertProfile:(profile: import('../src/shared/types').CompanyProfile)=>{ fixture.profiles=fixture.profiles.filter(p=>p.id!==profile.id); fixture.profiles.push(profile); return profile } } }))
vi.mock('node:child_process', async original => ({ ...await original<object>(), execFileSync:()=> '"IOPlatformUUID" = "fixture-device-identity" MachineGuid REG_SZ fixture-device-identity' }))
import { licensing } from '../src/main/licensing'
const issuer = generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{format:'pem',type:'spki'},privateKeyEncoding:{format:'pem',type:'pkcs8'}})
const otherIssuer = generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{format:'pem',type:'spki'},privateKeyEncoding:{format:'pem',type:'pkcs8'}})
const slot1 = 'f3ae472c-1063-4f7a-98e8-806006f51111'
function envelope(claims: LicenseClaims, privateKey = issuer.privateKey) { const payload = Buffer.from(JSON.stringify(claims)).toString('base64url'); return {payload,signature:sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url')} }
let claims: LicenseClaims
beforeAll(async () => {
  fixture.root = mkdtempSync(join(tmpdir(),'manzoma-desktop-license-')); mkdirSync(join(fixture.root,'resources'))
  writeFileSync(join(fixture.root,'resources/license-public-key.pem'),issuer.publicKey)
  process.env.ERP_LICENSE_REQUIRED = 'true'
  await licensing.initialize()
  const request = licensing.request()
  claims = {v:1,issuer:'https://erp.test',license_id:'fixture-license',revision:1,customer_name:'Filter company',device_id:request.device_id,machine_hash:request.machine_hash,mode:'hybrid',issued_at:Math.floor(Date.now()/1000),expires_at:Math.floor(Date.now()/1000)+86400,offline_companies:[{id:slot1,name:'Company slot 1'}],online_companies:[],device_public_key:request.public_key,company_assignment:{id:slot1,name:'Company slot 1',mode:'offline',host_device_id:request.device_id},max_companies:3,max_devices:2}
})
afterAll(() => { delete process.env.ERP_LICENSE_REQUIRED; vi.unstubAllGlobals(); rmSync(fixture.root,{recursive:true,force:true}) })

describe('License signatures and proof interoperability', () => {
  it('accepts only the pinned issuer, device and hardware with valid dates', () => {
    const cert = envelope(claims)
    expect(verifyLicense(cert,issuer.publicKey,claims.device_id,claims.machine_hash)).toEqual(claims)
    expect(()=>verifyLicense(cert,otherIssuer.publicKey,claims.device_id,claims.machine_hash)).toThrow('signature')
    expect(()=>verifyLicense(cert,issuer.publicKey,'other-device',claims.machine_hash)).toThrow('another device')
    expect(()=>verifyLicense(cert,issuer.publicKey,claims.device_id,'other-machine')).toThrow('another device')
    expect(()=>verifyLicense(cert,issuer.publicKey,claims.device_id,claims.machine_hash,(claims.expires_at+1)*1000)).toThrow('expired')
    expect(()=>verifyLicense(cert,issuer.publicKey,claims.device_id,claims.machine_hash,(claims.issued_at-301)*1000)).toThrow('date')
    expect(()=>verifyLicense({...cert,payload:cert.payload+'a'},issuer.publicKey,claims.device_id,claims.machine_hash)).toThrow('signature')
  })
  it('allows only explicitly bundled issuer rollover keys', () => {
    const cert = envelope(claims)
    expect(verifyLicense(cert, [otherIssuer.publicKey, issuer.publicKey], claims.device_id, claims.machine_hash)).toEqual(claims)
    expect(() => verifyLicense(cert, [otherIssuer.publicKey], claims.device_id, claims.machine_hash)).toThrow('signature')
  })
  it('verifies PHP-issued certificates with the same raw signed payload in Node', async () => {
    const php = ` $d=json_decode(stream_get_contents(STDIN),true); $payload=rtrim(strtr(base64_encode(json_encode($d['claims'],JSON_UNESCAPED_SLASHES)),'+/','-_'),'='); openssl_sign($payload,$sig,$d['key'],OPENSSL_ALGO_SHA256); echo json_encode(['payload'=>$payload,'signature'=>rtrim(strtr(base64_encode($sig),'+/','-_'),'=')]); `
    // Keep the actual executable for this cross-runtime check; the hardware lookup alone is mocked.
    const { execFileSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const result = execFileSync('php',['-r',php],{input:JSON.stringify({claims,key:issuer.privateKey}),encoding:'utf8'})
    expect(verifyLicense(JSON.parse(result),issuer.publicKey,claims.device_id,claims.machine_hash)).toEqual(claims)
  })
  it('binds API proof to method, resource, company, timestamp and nonce', () => {
    const key = issuer.privateKey, id = fingerprint(issuer.publicKey), time = '1793000000', nonce = 'f'.repeat(48)
    const proof = requestProof(key,id,'POST','/api/parties','elite',time,nonce)
    const message = ['manzoma-api-v1',id,time,nonce,'POST','/api/parties','elite'].join('\n')
    expect(verify('RSA-SHA256',Buffer.from(message),issuer.publicKey,Buffer.from(proof,'base64url'))).toBe(true)
    expect(verify('RSA-SHA256',Buffer.from(message.replace('elite','other')),issuer.publicKey,Buffer.from(proof,'base64url'))).toBe(false)
    const registration = deviceProof(key,id,claims.machine_hash)
    expect(verify('RSA-SHA256',Buffer.from(['manzoma-device-v1',id,claims.machine_hash].join('\n')),issuer.publicKey,Buffer.from(registration,'base64url'))).toBe(true)
  })
})
describe('Desktop license manager', () => {
  it('requires a license by default, with an explicit development-only bypass', () => {
    delete process.env.ERP_LICENSE_REQUIRED
    expect(licensing.required()).toBe(true)
    expect(()=>licensing.assertVerified()).toThrow('activate')
    process.env.ERP_LICENSE_BYPASS='development'
    try { expect(licensing.required()).toBe(false); expect(()=>licensing.assertVerified()).not.toThrow() } finally { delete process.env.ERP_LICENSE_BYPASS }
    expect(licensing.required()).toBe(true)
  })
  it('cannot reserve or erase another concurrent company import', () => {
    const root=join(fixture.root,'reservation-test'), id='f3ae472c-1063-4f7a-98e8-806006f53333'
    const first=reserveCompanyDirectory(root,id)
    writeFileSync(join(first.directory,'company.sqlite'),'existing data')
    expect(()=>reserveCompanyDirectory(root,id)).toThrow()
    expect(readFileSync(join(first.directory,'company.sqlite'),'utf8')).toBe('existing data')
    first.discard()
  })
  it('exports public device proof and existing company identities without secrets', () => {
    const request = licensing.request()
    expect(request.proof).toBeTruthy(); expect(request.public_key).toContain('PUBLIC KEY')
    expect(JSON.stringify(request)).not.toContain('PRIVATE KEY')
    expect(fingerprint(request.public_key)).toBe(request.device_id)
    expect(licensing.status().valid).toBe(false)
  })
  it('requires initial internet activation and rejects an initial license-file bypass', async () => {
    const key = 'MZ1.' + Buffer.from(JSON.stringify({server:'https://erp.test',key:slot1+'.'+'a'.repeat(64)})).toString('base64url')
    expect(()=>licensing.import(JSON.stringify(envelope(claims)))).toThrow('activate this device first')
    const offline = vi.fn(async()=>{throw new TypeError('fetch failed')}); vi.stubGlobal('fetch',offline)
    await expect(licensing.activate('',key)).rejects.toThrow('Connect to the internet')
    expect(licensing.status().valid).toBe(false)
    const online = vi.fn(async(_url: string, _options: RequestInit)=>new Response(JSON.stringify({certificate:envelope(claims)}),{status:200}))
    vi.stubGlobal('fetch',online)
    expect((await licensing.activate('',key)).valid).toBe(true)
    expect(online.mock.calls[0]?.[0]).toBe('https://erp.test/api/licensing/activate')
    const body=JSON.parse(String(online.mock.calls[0]?.[1]?.body))
    expect(body.activation_key).toBe(slot1+'.'+'a'.repeat(64))
    expect(body.request.device_id).toBe(claims.device_id)
    expect(readFileSync(licensing.certificatePath(),'utf8')).not.toContain(key)
    expect(readFileSync(licensing.certificatePath(),'utf8')).not.toContain(body.activation_key)
  })
  it('uses the cached signed license with network disconnected after activation', async () => {
    const network = vi.fn(()=>Promise.reject(new Error('No network'))); vi.stubGlobal('fetch',network)
    expect(licensing.status().valid).toBe(true)
    vi.resetModules()
    const { licensing: restarted } = await import('../src/main/licensing')
    await restarted.initialize()
    expect(restarted.status().valid).toBe(true)
    await restarted.open({id:slot1,name:'Local',mode:'local',createdAt:''})
    expect(licensing.newCompanyId()).toBe(slot1)
    mkdirSync(join(fixture.root,'profile/companies',slot1),{recursive:true}); writeFileSync(join(fixture.root,'profile/companies',slot1,'company.sqlite'),'fixture')
    await expect(licensing.reserveLocalCompanyId()).rejects.toThrow('only one company')
    expect(()=>licensing.newCompanyId()).toThrow('slots')
    await expect(licensing.open({id:'unlicensed',name:'Other',mode:'local',createdAt:''})).rejects.toThrow('not assigned')
    expect(network).not.toHaveBeenCalled()
    expect(licensing.request().existing_companies).toHaveLength(1)
  })
  it('blocks offline use at expiry without contacting the authority', async () => {
    const network=vi.fn(); vi.stubGlobal('fetch',network); vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date((claims.expires_at+1)*1000))
      expect(licensing.status().valid).toBe(false)
      await expect(licensing.open({id:slot1,name:'Local',mode:'local',createdAt:''})).rejects.toThrow('expired')
      expect(network).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('rejects malformed keys and unsafe activation URLs before sending any request', async () => {
    const network=vi.fn(); vi.stubGlobal('fetch',network)
    for (const key of ['MZ1.invalid', 'MZ1.'+Buffer.from(JSON.stringify({server:'http://unsafe.test',key:slot1+'.'+'a'.repeat(64)})).toString('base64url'), 'MZ1.'+'x'.repeat(4096)]) {
      await expect(licensing.activate('',key)).rejects.toThrow('Invalid activation key')
    }
    await expect(licensing.activate('ftp://localhost',slot1+'.'+'a'.repeat(64))).rejects.toThrow('HTTPS')
    expect(network).not.toHaveBeenCalled()
  })
  it('rejects forged files, wrong machines and older license revisions without replacing a valid certificate', () => {
    expect(()=>licensing.import(JSON.stringify(envelope(claims,otherIssuer.privateKey)))).toThrow('signature')
    expect(()=>licensing.import(JSON.stringify(envelope({...claims,machine_hash:'other'})))).toThrow('another device')
    licensing.import(JSON.stringify(envelope({...claims,revision:2})))
    expect(()=>licensing.import(JSON.stringify(envelope(claims)))).toThrow('older')
    expect(licensing.status().valid).toBe(true)
  })
  it('refreshes an online license and signs API requests without exposing the private key', async () => {
    const network = vi.fn(async()=>new Response(JSON.stringify({certificate:envelope({...claims,revision:2,offline_companies:[],online_companies:['elite'],company_assignment:{id:'elite',name:'Online',mode:'online'}})}),{status:200,headers:{'Content-Type':'application/json'}}))
    vi.stubGlobal('fetch',network)
    await licensing.open({id:'server-profile',name:'Online',mode:'server',serverUrl:'https://erp.test',company:'elite',createdAt:''})
    expect(network).toHaveBeenCalledOnce()
    const proof = licensing.headers({id:'server-profile',name:'Online',mode:'server',serverUrl:'https://erp.test',company:'elite',createdAt:''},'POST','/api/parties')
    expect(proof['X-Device-Id']).toBe(claims.device_id); expect(proof['X-Device-Signature']).toBeTruthy()
    expect(JSON.stringify(proof)).not.toContain('PRIVATE KEY')
    expect(()=>licensing.headers({id:'other',name:'Other',mode:'server',serverUrl:'https://other.test',company:'elite',createdAt:''},'GET','/api/parties')).toThrow('not licensed')
    expect(readFileSync(licensing.certificatePath(),'utf8')).not.toContain('activation_key')
  })
  it('remembers signed revocation, rejects old offline files and recovers only with a newer grant', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({certificate:envelope({...claims,revision:3,status:'revoked'})}),{status:200})))
    const result = await licensing.refresh()
    expect(result.valid).toBe(false); expect(result.error).toContain('revoked')
    await expect(licensing.open({id:slot1,name:'Local',mode:'local',createdAt:''})).rejects.toThrow('revoked')
    expect(()=>licensing.import(JSON.stringify(envelope({...claims,revision:2})))).toThrow('older')
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({certificate:envelope({...claims,revision:4,status:'active'})}),{status:200})))
    expect((await licensing.refresh()).valid).toBe(true)
  })

  it('retries online company registration with the same request ID and persists no password', async () => {
    const input={name:'Fresh filters',nameEn:'Fresh filters',currency:'EGP',vatRate:14,adminName:'Owner',adminUsername:'owner',adminPassword:'registration-password',locale:'ar' as const,demo:false}
    licensing.import(JSON.stringify(envelope({...claims,revision:4,offline_companies:[],online_companies:[],company_assignment:null})))
    let calls=0
    const network=vi.fn(async (_url:string,_options:RequestInit)=>{
      if (++calls === 1) throw new TypeError('Interrupted connection')
      return new Response(JSON.stringify({company:{slug:'registered',name:input.name},certificate:envelope({...claims,revision:5,max_companies:4,offline_companies:[],online_companies:['registered'],company_assignment:{id:'registered',name:input.name,mode:'online'}})}),{status:200})
    })
    vi.stubGlobal('fetch',network)
    await expect(licensing.registerServerCompany(input)).rejects.toThrow('Interrupted')
    const pendingFile=join(fixture.root,'profile/licensing/company-registrations.json')
    expect(readFileSync(pendingFile,'utf8')).not.toContain(input.adminPassword)
    expect(readFileSync(pendingFile,'utf8')).not.toContain('adminPassword')
    const profile=await licensing.registerServerCompany(input)
    expect(profile.mode).toBe('server'); expect(profile.company).toBe('registered'); expect(profile.serverUrl).toBe('https://erp.test')
    const [first,retry]=network.mock.calls.map(call=>JSON.parse(String(call[1].body)))
    expect(first.registration_id).toBe(retry.registration_id)
    expect(network.mock.calls[1][1].headers).toHaveProperty('X-Device-Signature')
    expect(fixture.profiles).toContainEqual(profile)
    expect(JSON.parse(readFileSync(pendingFile,'utf8'))).toEqual({})
    expect(readFileSync(licensing.certificatePath(),'utf8')).not.toContain(input.adminPassword)
  })
  it('rejects a second company before making any authority request', async () => {
    const network=vi.fn();vi.stubGlobal('fetch',network)
    await expect(licensing.reserveLocalCompanyId()).rejects.toThrow('only one company')
    await expect(licensing.registerServerCompany({name:'Other',currency:'EGP',vatRate:14,adminName:'Owner',adminUsername:'owner',adminPassword:'password123',locale:'ar',demo:false})).rejects.toThrow('only one company')
    expect(network).not.toHaveBeenCalled()
  })
  it('reports only actual local databases without turning unused capacity into registered companies', async () => {
    licensing.import(JSON.stringify(envelope({...claims,revision:6})))
    const network=vi.fn(async (_url:string,options:RequestInit)=>new Response(JSON.stringify({certificate:envelope({...claims,revision:7,offline_companies:claims.offline_companies.map(company=>({...company,registered:true}))})}),{status:200}))
    vi.stubGlobal('fetch',network)
    await licensing.syncLocalCompanies(true)
    expect(network.mock.calls[0][0]).toBe('https://erp.test/api/licensing/offline-companies/confirm')
    const reported=JSON.parse(String(network.mock.calls[0][1].body)).companies
    expect(reported.map((company:{id:string})=>company.id).sort()).toEqual([slot1].sort())
  })
  it('does not offer server registration to an offline-only license', async () => {
    licensing.import(JSON.stringify(envelope({...claims,revision:8,mode:'offline'})))
    const network=vi.fn(); vi.stubGlobal('fetch',network)
    await expect(licensing.registerServerCompany({name:'Other',currency:'EGP',vatRate:14,adminName:'Owner',adminUsername:'owner',adminPassword:'password123',locale:'ar',demo:false})).rejects.toThrow('only one company')
    expect(network).not.toHaveBeenCalled()
  })

})
