/** Local test DMGs need no downloaded Python tooling; the signed app + Applications link suffice. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { verifyPackagedResources } from './runtime-checks.mjs'

if (process.platform !== 'darwin') throw new Error('Create DMGs on macOS.')
const [appPath, arch, outputPath] = process.argv.slice(2)
if (!appPath || !['x64','arm64'].includes(arch) || !outputPath) throw new Error('Usage: create-test-dmg.mjs /path/App.app x64|arm64 /output')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = resolve(appPath), output = resolve(outputPath)
verifyPackagedResources(join(app,'Contents/Resources'), 'darwin', arch)
execFileSync('/usr/bin/codesign', ['--verify','--deep','--strict',app], {stdio:'inherit'})
const stage = mkdtempSync(join(tmpdir(),'manzoma-dmg-stage-'))
try {
  const copy = join(stage, basename(app))
  execFileSync('/usr/bin/ditto', ['--norsrc',app,copy])
  execFileSync('/usr/bin/xattr',['-cr',copy])
  symlinkSync('/Applications',join(stage,'Applications'))
  const version = JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version
  mkdirSync(output,{recursive:true})
  const file = join(output,`ManzomaERP-${version}-${arch}.dmg`)
  execFileSync('/usr/bin/hdiutil',['create','-volname',`ManzomaERP ${version} ${arch}`,'-srcfolder',stage,'-format','UDZO','-ov',file],{stdio:'inherit',timeout:300000})
  console.log(`Test DMG ready: ${file}`)
} finally { rmSync(stage,{recursive:true,force:true}) }
