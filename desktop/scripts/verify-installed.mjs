/** Exercise an actual installed/unpacked app, with its bundled PHP/backend, in an isolated profile. */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, existsSync, rmSync } from 'node:fs'
import { createPublicKey, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { verifyPackagedResources } from './runtime-checks.mjs'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const input = process.argv[2]
if (!input) throw new Error('Usage: npm run verify:installed -- "/absolute/path/to/ManzomaERP Desktop.app" (or installed .exe)')
const target = resolve(input)
if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Run installed acceptance on macOS or Windows.')
const executable = process.platform === 'darwin' ? join(target, 'Contents/MacOS', execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(target, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()) : target
const resources = process.platform === 'darwin' ? join(target, 'Contents/Resources') : join(dirname(target), 'resources')
verifyPackagedResources(resources, process.platform, process.arch)
const backend = join(resources, 'backend'), php = process.env.ERP_PHP_BINARY || 'php'
const bootstrap = `require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(\\Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();`
const original = JSON.parse(execFileSync(php, ['-r', bootstrap + `echo json_encode(['private'=>config('licensing.private_key')]);`], { cwd: resolve(desktop, '../backend'), encoding: 'utf8' }))
if (!existsSync(original.private)) throw new Error('The configured backend issuer private key is needed to issue an isolated test license. It is never copied into the app.')
const der = key => createPublicKey(key).export({ type: 'spki', format: 'der' })
if (!der(readFileSync(original.private)).equals(der(readFileSync(join(resources, 'license-public-key.pem'))))) throw new Error('Installed public trust does not match this checkout issuer. Rebuild with the correct PUBLIC key; do not rotate existing keys.')
const root = mkdtempSync(join(tmpdir(), 'manzoma-installed-'))
mkdirSync(join(root, 'server-storage'), { mode: 0o700 }); mkdirSync(join(root, 'profile'), { mode: 0o700 })
writeFileSync(join(root, 'server.sqlite'), '', { mode: 0o600 })
writeFileSync(join(root, 'public.pem'), readFileSync(join(resources, 'license-public-key.pem')))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function port() { const server = netServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const result = server.address().port; await new Promise(resolve => server.close(resolve)); return result }
let offline = false
const phpPort = await port()
const proxy = createServer(async (request, response) => {
  if (offline) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"message":"Acceptance server disconnected"}'); return }
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const upstream = await fetch(`http://127.0.0.1:${phpPort}${request.url}`, { method: request.method, headers: { ...request.headers, host: `127.0.0.1:${phpPort}` }, body: ['GET','HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' })
    response.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key]) => !['transfer-encoding','content-encoding'].includes(key))))
    response.end(Buffer.from(await upstream.arrayBuffer()))
  } catch { response.writeHead(502); response.end('Acceptance upstream unavailable') }
})
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
const authority = `http://127.0.0.1:${proxy.address().port}`
const env = { ...process.env, APP_ENV: 'local', APP_DEBUG: 'false', APP_KEY: 'base64:' + randomBytes(32).toString('base64'), APP_URL: authority,
  DB_CONNECTION: 'sqlite', DB_DATABASE: join(root,'server.sqlite'), DB_URL: '', CONTROL_DB_CONNECTION: 'sqlite', CONTROL_DB_DATABASE: join(root,'control.sqlite'), ERP_MULTI_COMPANY: 'false',
  ERP_STORAGE_PATH: join(root,'server-storage'), ERP_COMPANIES_REGISTRY: join(root,'companies.json'), ERP_CONTROL_ENABLED: 'true', ERP_CONTROL_WEB_SETUP: 'false', ERP_LICENSE_ENFORCE: 'true', ERP_LICENSE_ISSUER: authority,
  ERP_LICENSE_PRIVATE_KEY: original.private, ERP_LICENSE_PUBLIC_KEY: join(root,'public.pem'), ERP_LICENSE_LEGACY_PUBLIC_KEYS: '', CACHE_STORE: 'file', SESSION_DRIVER: 'file', QUEUE_CONNECTION: 'sync', BCRYPT_ROUNDS: '4' }
for (const [key,name] of Object.entries({APP_SERVICES_CACHE:'services.php',APP_PACKAGES_CACHE:'packages.php',APP_CONFIG_CACHE:'config.php',APP_ROUTES_CACHE:'routes.php',APP_EVENTS_CACHE:'events.php'})) env[key]=join(root,'server-storage/bootstrap',name)
function command(args) { return execFileSync(php, args, { cwd: backend, env, encoding: 'utf8', timeout: 180000, maxBuffer: 10*1024*1024 }) }
const log = createWriteStream(join(root,'app.log'))
const results = []
let issuer, appProcess, socket, sequence = 0, profileDirectory = 'online-profile', retainedHost
const pending = new Map()
async function cdp(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 180000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } }); socket.send(JSON.stringify({id,method,params})) })
}
async function js(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result?.value
}
async function wait(expression, timeout = 90000) { const end = Date.now()+timeout; while (Date.now()<end) { try { if (await js(`Promise.resolve(${expression}).then(Boolean)`)) return } catch {} await delay(150) } throw new Error('Timed out: '+expression) }
async function click(text) {
  const selector = `Array.from(document.querySelectorAll('button')).find(button=>button.getClientRects().length && getComputedStyle(button).visibility==='visible' && !button.disabled && button.textContent.replace(button.querySelector('kbd')?.textContent??'','').trim()===${JSON.stringify(text)})`
  await wait(selector); await js(selector+'.click()'); await delay(100)
}
async function fill(label, value) {
  const selector = `Array.from(document.querySelectorAll('label')).find(label=>getComputedStyle(label).visibility==='visible' && label.textContent.includes(${JSON.stringify(label)}) && label.querySelector('input'))?.querySelector('input')`
  await wait(selector); await js(`(()=>{const input=${selector};input.focus();input.select()})()`); await cdp('Input.insertText', { text: String(value) })
}
async function launch() {
  mkdirSync(join(root,profileDirectory),{recursive:true,mode:0o700})
  const debugPort = await port(), appEnv = { ...process.env }
  for (const key of Object.keys(appEnv)) if (/^(ERP_|DB_|CONTROL_DB_|APP_|ELECTRON_RENDERER_URL|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)/.test(key)) delete appEnv[key]
  appProcess = spawn(executable, [`--user-data-dir=${join(root,profileDirectory)}`, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], { env: appEnv, stdio: ['ignore','pipe','pipe'] })
  let startupError; appProcess.once('error', error => { startupError = error })
  appProcess.stdout.pipe(log, {end:false}); appProcess.stderr.pipe(log, {end:false})
  let page
  for (let i=0;i<150;i++) { if (startupError) throw startupError; if (appProcess.exitCode !== null) throw new Error('Packaged app exited; see the isolated app.log.'); try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(page=>page.type==='page'); if(page)break } catch {} await delay(200) }
  if (!page) throw new Error('Packaged app did not start; see the isolated app.log.')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true}) })
  socket.addEventListener('message',event=>{ const message=JSON.parse(event.data); const handler=pending.get(message.id);if(handler){pending.delete(message.id); message.error?handler.reject(new Error(message.error.message)):handler.resolve(message.result)} })
  socket.addEventListener('close',()=>{for(const entry of pending.values())entry.reject(new Error('Packaged app disconnected'));pending.clear()},{once:true})
  await cdp('Runtime.enable'); await cdp('Page.enable'); await wait('Boolean(window.erp)')
  const info=await js('window.erp.app.info()')
  if(info.isDev || resolve(info.userData)!==resolve(join(root,profileDirectory)))throw new Error('Verification did not start an isolated packaged application.')
}
async function close() {
  if(!appProcess)return
  try { await js('window.erp.profiles.close()') } catch {}
  socket?.close()
  const child=appProcess; appProcess=null
  child.kill('SIGTERM')
  if(child.exitCode===null && child.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(resolve,10000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL')
}
async function picker() { await js('window.erp.profiles.close()');await cdp('Page.reload',{ignoreCache:true});await wait(`document.body.textContent.includes('Your company')`) }
async function login() { await wait(`Boolean(document.querySelector('input[autocomplete=username]')) || Boolean(document.querySelector('nav'))`);if(await js(`Boolean(document.querySelector('input[autocomplete=username]'))`)){await fill('User name','acceptance_admin');await fill('Password','Acceptance-password-123');await click('Sign in')}await wait(`Boolean(document.querySelector('nav'))`) }
async function create(mode,name) { await click(mode==='server'?'Register an online company':'New company on this PC');await fill('Company name (Arabic)',name);await click('Next: administrator');await fill('Administrator name','Acceptance operator');await fill('User name','acceptance_admin');await fill('Password','Acceptance-password-123');await fill('Confirm password','Acceptance-password-123');await click('Create company');await login();await wait(`document.querySelector('.setup-page') && getComputedStyle(document.querySelector('.setup-page')).visibility==='visible'`) }
try {
  command(['artisan','migrate','--database=control','--path=database/control','--force','--no-interaction'])
  const activation=command(['-r',bootstrap+`$l=app(\\App\\Control\\Services\\LicenseService::class)->save(['customer_name'=>'Installed acceptance fixture','mode'=>'hybrid','status'=>'active','max_companies'=>2,'max_devices'=>3,'expires_at'=>now()->addDays(2)->toIso8601String()]);echo app(\\App\\Control\\Services\\LicenseService::class)->activationKey($l);`]).trim()
  issuer=spawn(php,['artisan','serve','--host=127.0.0.1',`--port=${phpPort}`,'--no-reload'],{cwd:backend,env,stdio:'ignore',detached:process.platform!=='win32'})
  for(let i=0;i<100;i++){try{if((await fetch(authority+'/api/system/ping')).ok)break}catch{}await delay(200);if(i===99)throw new Error('Isolated issuer did not start')}
  console.log('Checking packaged startup and activation…');await launch();await js(`window.erp.prefs.set({locale:'en',autoBackup:{enabled:true,onExit:true,keep:3}})`);await cdp('Page.reload',{ignoreCache:true});await wait(`document.body.textContent.includes('Activate this device')`)
  if(!await js('window.erp.profiles.list().then(()=>false).catch(()=>true)'))throw new Error('Company access bypassed activation')
  await fill('Activation key',activation);await click('Activate this device');await wait(`document.body.textContent.includes('Your company')`);results.push('Packaged license gate and copy/paste activation')
  console.log('Checking online registration and login…');await create('server','Packaged online fixture');results.push('Online company registration, login and setup guide')
  await picker();offline=true
  console.log('Checking readable connection errors in English and Arabic…')
  await wait(`[...document.querySelectorAll('li')].some(row=>row.textContent.includes('Packaged online fixture'))`)
  await js(`(()=>{const row=[...document.querySelectorAll('li')].find(row=>row.textContent.includes('Packaged online fixture'));[...row.querySelectorAll('button')].find(button=>button.textContent.trim()==='Open').click()})()`)
  await wait(`document.body.textContent.includes('The server could not complete the request.')`)
  await click('العربية')
  await wait(`document.documentElement.lang==='ar' && document.body.textContent.includes('تعذر على الخادم إتمام الطلب')`)
  writeFileSync(join(root,'connection-error-ar.png'),Buffer.from((await cdp('Page.captureScreenshot')).data,'base64'))
  await click('English')
  await wait(`document.documentElement.lang==='en' && document.body.textContent.includes('The server could not complete the request.')`)
  if(await js(`/HTTP 503|SQLSTATE|PailServiceProvider|Error invoking remote method/.test(document.body.textContent)`))throw new Error('Technical diagnostics leaked into the interface')
  results.push('Connection failure remains readable and switches between Arabic and English')
  await close();offline=false;profileDirectory='offline-profile';await launch()
  await js(`window.erp.prefs.set({locale:'en',autoBackup:{enabled:true,onExit:true,keep:3}})`);await cdp('Page.reload',{ignoreCache:true});await wait(`document.body.textContent.includes('Activate this device')`)
  await fill('Activation key',activation);await click('Activate this device');await wait(`document.body.textContent.includes('Your company')`)
  console.log('Checking main-computer company setup with bundled PHP…');await create('local','Packaged offline fixture')
  offline=true
  await wait('window.erp.backend.status().then(status=>status.state===\'running\' && Boolean(status.automation?.lastSuccess))')
  const status=await js('window.erp.backend.status()');if(!status.baseUrl?.startsWith('http://127.0.0.1:'))throw new Error('Local company did not start bundled PHP')
  await click('Inventory');await click('Items');await click('New item');await fill('Item name','Packaged fixture filter');await fill('Code','PKG-FILTER');await click('Save')
  await wait(`(async()=>{const status=await window.erp.backend.status();const token=await window.erp.auth.getToken(status.profileId);const headers=await window.erp.licensing.headers('GET','/api/products');const response=await fetch(status.baseUrl+'/api/products?search=PKG-FILTER',{headers:{...headers,Authorization:'Bearer '+token}});return response.ok && (await response.json()).data.some(row=>row.code==='PKG-FILTER')})()`)
  await js('window.erp.profiles.close()');results.push('Offline company creation, product save, setup guide and local automation')
  const localProfile = (await js('window.erp.profiles.list()')).find(profile => profile.mode === 'local')
  await close()
  // Reproduce a profile last opened in development: production must discard dev providers.
  const staleCache = join(root,profileDirectory,'companies',localProfile.id,'storage','bootstrap')
  for (const file of ['packages.php','services.php']) writeFileSync(join(staleCache,file),`<?php return ['providers' => ['Laravel\\\\Pail\\\\PailServiceProvider']];`)
  rmSync(join(staleCache,'runtime-fingerprint'),{force:true})
  console.log('Checking offline restart with stale development provider caches…');await launch();await wait(`document.body.textContent.includes('Your company')`)
  await wait(`[...document.querySelectorAll('li')].some(row=>row.textContent.includes('Packaged offline fixture'))`)
  await js(`(()=>{const row=[...document.querySelectorAll('li')].find(row=>row.textContent.includes('Packaged offline fixture'));[...row.querySelectorAll('button')].find(button=>button.textContent.trim()==='Open').click()})()`);await login();await wait('window.erp.licensing.status().then(status=>status.valid)');await wait(`(async()=>{const status=await window.erp.backend.status();const token=await window.erp.auth.getToken(status.profileId);const headers=await window.erp.licensing.headers('GET','/api/products');const response=await fetch(status.baseUrl+'/api/products?search=PKG-FILTER',{headers:{...headers,Authorization:'Bearer '+token}});return response.ok && (await response.json()).data.some(row=>row.code==='PKG-FILTER')})()`);results.push('Offline license and saved product survive process restart')
  results.push('Stale development provider caches rebuilt without losing saved company data')
  offline=false;const confirmed=await js('window.erp.licensing.refresh()');if(!confirmed.valid || confirmed.unconfirmedLocalCompanies!==0)throw new Error('Offline company confirmation did not complete on reconnection')
  console.log('Checking second-company denial and encrypted LAN pairing…')
  if(!await js(`window.erp.profiles.createLocal({name:'Forbidden second company',adminUsername:'owner',adminPassword:'password123',adminName:'Owner',currency:'EGP',vatRate:14,locale:'en',demo:false}).then(()=>false,error=>error.message.includes('only one company'))`))throw new Error('Second local company was allowed')
  const sharing=await js(`window.erp.lan.configure(true,${await port()})`)
  if(!sharing.enabled || !sharing.urls.length)throw new Error('No private LAN interface is available for the encrypted sharing test')
  const invitation=await js(`window.erp.lan.invitation(${JSON.stringify(sharing.urls[0])})`)
  retainedHost={appProcess,socket};appProcess=null;socket=null
  profileDirectory='lan-profile';await launch();await js(`window.erp.prefs.set({locale:'en'})`);await cdp('Page.reload',{ignoreCache:true});await wait(`document.body.textContent.includes('Activate this device')`)
  await fill('Activation key',activation);await click('Activate this device');await wait(`document.body.textContent.includes('Your company')`)
  await click('Connect to the main computer');await wait(`Boolean(document.querySelector('textarea'))`)
  await js(`document.querySelector('textarea').focus()`);await cdp('Input.insertText',{text:invitation});await click('Pair this device');await login()
  const shared=await js('window.erp.profiles.list()');if(shared.length!==1||shared[0].mode!=='lan')throw new Error('LAN client did not retain exactly one shared company')
  offline=true
  await cdp('Page.reload',{ignoreCache:true});await wait(`document.body.textContent.includes('Your company')`)
  await wait(`[...document.querySelectorAll('li')].some(row=>row.textContent.includes('Packaged offline fixture'))`)
  await click('Open');await login()
  await wait(`(async()=>{const profile=(await window.erp.profiles.list())[0];const token=await window.erp.auth.getToken(profile.id);const headers=await window.erp.licensing.headers('GET','/api/products');const response=await fetch(profile.serverUrl+'/api/products?search=PKG-FILTER',{headers:{...headers,'X-Company':profile.company,Authorization:'Bearer '+token}});return response.ok && (await response.json()).data.some(row=>row.code==='PKG-FILTER')})()`)
  // Write through the TLS gateway, then verify the host's actual SQLite file changed.
  await js(`(async()=>{const profile=(await window.erp.profiles.list())[0];const token=await window.erp.auth.getToken(profile.id);const headers=await window.erp.licensing.headers('POST','/api/parties');const response=await fetch(profile.serverUrl+'/api/parties',{method:'POST',headers:{...headers,'X-Company':profile.company,Authorization:'Bearer '+token,'Content-Type':'application/json','X-Locale':'en'},body:JSON.stringify({name:'LAN shared customer',is_customer:true,type:'individual'})});if(!response.ok)throw new Error(await response.text())})()`)
  const database=join(root,'offline-profile','companies',localProfile.id,'company.sqlite')
  const saved=execFileSync(php,['-r',`$db=new PDO('sqlite:'.$argv[1]);echo $db->query("SELECT COUNT(*) FROM parties WHERE name='LAN shared customer'")->fetchColumn();`,database],{encoding:'utf8'})
  if(saved.trim()!=='1')throw new Error('LAN client write did not reach the main computer database')
  results.push('Encrypted LAN pairing and shared database read/write work with the issuer disconnected')
  await close();appProcess=retainedHost.appProcess;socket=retainedHost.socket;retainedHost=null;await close();offline=false
  const counts=JSON.parse(command(['-r',bootstrap+`echo json_encode(['companies'=>\\App\\Control\\Models\\LicensedCompany::whereNotNull('registered_at')->count(),'devices'=>\\App\\Control\\Models\\LicensedDevice::count()]);`]))
  if(counts.companies!==2 || counts.devices!==3)throw new Error('Company/device counts were duplicated: '+JSON.stringify(counts))
  results.push('Two companies across three isolated device profiles; the LAN client uses no extra company allocation')
  writeFileSync(join(root,'result.json'),JSON.stringify({result:'passed',target,results,counts},null,2));console.log(JSON.stringify({result:'passed',results,counts,evidence:root}))
} catch(error) {
  try { const shot=await cdp('Page.captureScreenshot');writeFileSync(join(root,'failure.png'),Buffer.from(shot.data,'base64')) } catch {}
  console.error(error.message);console.error('Isolated evidence:',root);process.exitCode=1
} finally {
  await close()
  if(retainedHost){appProcess=retainedHost.appProcess;socket=retainedHost.socket;retainedHost=null;await close()}
  if(issuer?.pid){if(process.platform==='win32'){try{execFileSync('taskkill',['/pid',String(issuer.pid),'/T','/F'],{stdio:'ignore'})}catch{}}else{try{process.kill(-issuer.pid,'SIGTERM')}catch{}}}
  proxy.closeAllConnections();proxy.close();log.end()
}
