import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import electron from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = await mkdtemp(resolve(tmpdir(), 'manzoma-ui-review-'))
await build({ configFile: false, root: resolve(root, 'tests/fixtures/ui'), base: './', logLevel: 'warn', resolve: { alias: { '@': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } }, plugins: [react(), tailwindcss()], build: { outDir: resolve(output, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2500 } })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [resolve(root, 'scripts/verify-ui-electron.cjs'), output], { env, stdio: 'inherit' })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
