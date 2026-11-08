import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import electron from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backend = resolve(root, '../backend')
const output = await mkdtemp(join(tmpdir(), 'manzoma-spare-parts-'))
const database = join(output, 'company.sqlite')
await writeFile(database, '')
const env = { ...process.env, APP_ENV: 'testing', APP_DEBUG: 'false', DB_CONNECTION: 'sqlite', DB_DATABASE: database, DB_URL: '',
  ERP_MULTI_COMPANY: 'false', ERP_CONTROL_ENABLED: 'false', ERP_LICENSE_ENFORCE: 'false', ERP_CONTROL_WEB_SETUP: 'false',
  ERP_STORAGE_PATH: join(output, 'storage'), ERP_BACKUP_PATH: join(output, 'backups'), CACHE_STORE: 'array', SESSION_DRIVER: 'array',
  APP_CONFIG_CACHE: join(output, 'config.php'), APP_SERVICES_CACHE: join(output, 'services.php'), APP_PACKAGES_CACHE: join(output, 'packages.php'),
  APP_ROUTES_CACHE: join(output, 'routes.php'), APP_EVENTS_CACHE: join(output, 'events.php'),
}
delete env.ELECTRON_RUN_AS_NODE
delete env.PHP_CLI_SERVER_WORKERS
const php = process.env.PHP_BINARY || 'php'
function runPhp(args) {
  const result = spawnSync(php, args, { cwd: backend, env, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}
runPhp(['artisan', 'migrate', '--force', '--no-interaction'])
runPhp(['-r', "require 'vendor/autoload.php'; $app = require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); app(App\\Modules\\Core\\Services\\InstallService::class)->install(['company_name'=>'Spare parts verification','admin_password'=>'spare-parts-test-123']);"])
const port = await new Promise((resolvePort, reject) => {
  const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)) })
})
const baseUrl = `http://127.0.0.1:${port}`
let serverLog = ''
const server = spawn(php, ['-S', `127.0.0.1:${port}`, resolve(backend, 'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php')], { cwd: resolve(backend, 'public'), env, stdio: ['ignore', 'pipe', 'pipe'] })
server.stdout.on('data', chunk => { serverLog += chunk }); server.stderr.on('data', chunk => { serverLog += chunk })
try {
  let started = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${baseUrl}/api/system/ping`)).ok) { started = true; break } } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  if (!started) throw new Error('Isolated backend did not start: ' + serverLog)
  await build({ configFile: false, root: resolve(root, 'tests/fixtures/spare-parts'), base: './', logLevel: 'warn',
    resolve: { alias: { '@': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } },
    plugins: [react(), tailwindcss()], build: { outDir: join(output, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2500 } })
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(electron, [resolve(root, 'scripts/verify-spare-parts-electron.cjs'), output, baseUrl], { cwd: root, env, stdio: 'inherit' })
    child.on('error', reject); child.on('exit', resolveExit)
  })
  if (code !== 0) {
    const log = await readFile(join(output, 'storage/logs/laravel.log'), 'utf8').catch(() => '')
    console.error(log.slice(-6000)); process.exitCode = 1
  }
} finally {
  server.kill()
  await writeFile(join(output, 'server.log'), serverLog)
  console.log(`Verification artifacts: ${output}`)
}
