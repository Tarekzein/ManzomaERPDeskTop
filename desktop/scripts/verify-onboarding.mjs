/** The supported onboarding check uses the same packaged flow as installer acceptance. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const target=process.argv[2] || (process.platform==='darwin' ? resolve(root,'dist',process.arch==='arm64'?'mac-arm64':'mac','ManzomaERP Desktop.app') : resolve(root,'dist/win-unpacked/ManzomaERP Desktop.exe'))
if(!existsSync(target))throw new Error('Build the matching installer first, or pass an installed app path: npm run verify:onboarding -- /path/to/app')
const child=spawn(process.execPath,[resolve(root,'scripts/verify-installed.mjs'),target],{stdio:'inherit',env:process.env})
child.on('error',error=>{console.error(error.message);process.exitCode=1})
child.on('exit',code=>{process.exitCode=code??1})
