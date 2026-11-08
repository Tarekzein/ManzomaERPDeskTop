import { createServer, type Server } from 'node:https'
import { request as httpRequest } from 'node:http'
import { X509Certificate } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { paths } from './paths'
import { privateAddress } from '../shared/lanAddress'
import { log } from './log'

/** Opt-in HTTPS gateway; PHP/SQLite remain bound to loopback on the main computer. */
export class LanHost {
  private server?: Server
  private port = 9443
  private profileId?: string
  private fingerprint?: string
  private directory() { const p = join(paths.userData(),'lan'); mkdirSync(p,{recursive:true,mode:0o700}); return p }
  private settings() { try { return JSON.parse(readFileSync(join(this.directory(),'settings.json'),'utf8')) as {enabled:boolean;port:number;profileId:string} } catch { return null } }

  status() {
    const ips = Object.values(networkInterfaces()).flatMap(rows => rows ?? []).filter(row => row.family === 'IPv4' && !row.internal && privateAddress(row.address)).map(row => row.address)
    return {enabled:Boolean(this.server),port:this.port,urls:this.server ? [...new Set(ips)].map(ip=>`https://${ip}:${this.port}`) : []}
  }
  async resume(profileId: string, baseUrl: string) {
    const settings = this.settings()
    if (settings?.enabled && settings.profileId === profileId) {
      try { await this.start(profileId,baseUrl,settings.port) }
      catch(error) { log('lan','Could not restart LAN sharing',String(error)) }
    }
  }
  async configure(enabled: boolean, profileId: string, baseUrl: string, port: number) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.')
    await this.stop()
    if (enabled) await this.start(profileId,baseUrl,port)
    writeFileSync(join(this.directory(),'settings.json'),JSON.stringify({enabled,profileId,port}),{mode:0o600})
    return this.status()
  }
  certificateFingerprint(profileId: string) {
    if (!this.server || profileId !== this.profileId || !this.fingerprint) throw new Error('Enable local network sharing first.')
    return this.fingerprint
  }
  private async start(profileId: string, baseUrl: string, port: number) {
    const folder = this.directory(), cert = join(folder,'tls-cert.pem'), key = join(folder,'tls-private.pem')
    if (!existsSync(cert) || !existsSync(key)) {
      const cnf = join(folder,'openssl.cnf')
      writeFileSync(cnf,'[req]\ndistinguished_name=dn\n[dn]\nCN=Manzoma Local Network\n',{mode:0o600})
      const code = `$o=['config'=>$argv[1],'private_key_bits'=>2048,'private_key_type'=>OPENSSL_KEYTYPE_RSA,'digest_alg'=>'sha256'];$k=openssl_pkey_new($o);$r=openssl_csr_new(['commonName'=>'Manzoma Local Network'],$k,$o);$c=openssl_csr_sign($r,null,$k,3650,$o);if(!$c)exit(1);openssl_x509_export($c,$cert);openssl_pkey_export($k,$key,null,$o);echo json_encode(['cert'=>$cert,'key'=>$key]);`
      const generated = JSON.parse(execFileSync(paths.php(),['-r',code,cnf],{encoding:'utf8',timeout:15000,windowsHide:true}))
      writeFileSync(key,generated.key,{mode:0o600}); writeFileSync(cert,generated.cert,{mode:0o600})
    }
    this.fingerprint = new X509Certificate(readFileSync(cert)).fingerprint256.replaceAll(':','').toLowerCase()
    const target = new URL(baseUrl)
    const server = createServer({cert:readFileSync(cert),key:readFileSync(key),minVersion:'TLSv1.2',maxHeaderSize:32*1024},(req,res)=>{
      if (!privateAddress(req.socket.remoteAddress ?? '') || !req.url?.startsWith('/api/')) {res.writeHead(403);res.end();return}
      if (req.method === 'OPTIONS') {
        res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Accept,X-Locale,X-Company,X-Device-Id,X-Device-Time,X-Device-Nonce,X-Device-Signature,X-App-Version,X-Offline-Certificate,Idempotency-Key'});res.end();return
      }
      const headers = {...req.headers,host:target.host,'x-manzoma-lan':'1'}
      for (const name of ['connection','forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto']) delete headers[name as keyof typeof headers]
      const proxy = httpRequest({hostname:'127.0.0.1',port:target.port,path:req.url,method:req.method,headers,timeout:120000},upstream=>{
        res.writeHead(upstream.statusCode ?? 502,upstream.headers);upstream.pipe(res)
      })
      proxy.on('timeout',()=>proxy.destroy())
      proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'content-type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify({message:'The main computer is unavailable. Ask its operator to open the company.'}))})
      req.on('aborted',()=>proxy.destroy());req.pipe(proxy)
    })
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>{server.removeListener('error',reject);resolve()})})
    server.on('error',error=>log('lan','Gateway error',String(error)))
    this.server=server;this.profileId=profileId;this.port=port
  }
  async stop() {
    const server=this.server;this.server=undefined;this.profileId=undefined
    if(server)await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()})
  }
}
export const lanHost = new LanHost()
