import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readLanInvitation, invitationMessage } from '../src/main/lanInvitation'
import { fingerprint, type LicenseClaims } from '../src/main/licenseCrypto'
import { lanAddress, privateAddress } from '../src/shared/lanAddress'

describe('Encrypted LAN pairing',()=>{
  it('accepts a signed host invitation only for the same license and rejects tampering/expiry/public URLs',()=>{
    const key=()=>generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
    const issuer=key(),host=key(),hostId=fingerprint(host.publicKey),id='f3ae472c-1063-4f7a-98e8-806006f51111'
    const claims:LicenseClaims={v:1,issuer:'https://erp.test',license_id:'license',revision:1,customer_name:'Filter company',device_id:hostId,device_public_key:host.publicKey,machine_hash:'host-machine',mode:'hybrid',issued_at:Math.floor(Date.now()/1000),expires_at:Math.floor(Date.now()/1000)+3600,offline_companies:[{id,name:'Filters'}],online_companies:[],max_companies:1,max_devices:3,company_assignment:{id,name:'Filters',mode:'offline',host_device_id:hostId}}
    const payload=Buffer.from(JSON.stringify(claims)).toString('base64url'),envelope={payload,signature:sign('RSA-SHA256',Buffer.from(payload),issuer.privateKey).toString('base64url')}
    const data={url:'https://192.168.1.10:9443',company:id,name:'Filters',tlsFingerprint:'a'.repeat(64),host:envelope}
    const invitation={...data,signature:sign('RSA-SHA256',Buffer.from(invitationMessage(data)),host.privateKey).toString('base64url')}
    const encode=(value:unknown)=>'MZLAN1.'+Buffer.from(JSON.stringify(value)).toString('base64url')
    expect(readLanInvitation(encode(invitation),[issuer.publicKey],claims).company).toBe(id)
    for(const changed of [{...invitation,tlsFingerprint:'b'.repeat(64)},{...invitation,url:'https://8.8.8.8:9443'},{...invitation,name:'Tampered'}])expect(()=>readLanInvitation(encode(changed),[issuer.publicKey],claims)).toThrow('pairing code')
    expect(()=>readLanInvitation(encode(invitation),[issuer.publicKey],{...claims,license_id:'other'})).toThrow('pairing code')
    expect(()=>lanAddress('http://192.168.1.10:9443')).toThrow()
    expect(privateAddress('::ffff:192.168.1.5')).toBe(true)
    expect(privateAddress('172.32.1.1')).toBe(false)
    expect(privateAddress('192.168.1.999')).toBe(false)
  })
})
