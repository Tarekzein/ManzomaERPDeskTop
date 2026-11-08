import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createHash, createPublicKey } from 'node:crypto'

export function verifyRuntime(file, platform, arch) {
  if (!existsSync(file)) throw new Error(`Missing ${platform}-${arch} PHP runtime: ${file}`)
  const bytes = readFileSync(file)
  if (platform === 'win32') {
    const offset = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1
    if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset < 0 || offset + 6 > bytes.length || bytes.readUInt32LE(offset) !== 0x4550 || bytes.readUInt16LE(offset + 4) !== 0x8664 || arch !== 'x64') throw new Error('PHP must be a Windows x64 PE executable.')
  } else if (platform === 'darwin') {
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== (arch === 'arm64' ? 0x0100000c : 0x01000007)) throw new Error(`PHP must be a macOS ${arch} Mach-O executable.`)
    if (process.platform === 'darwin') {
      const dependencies = execFileSync('/usr/bin/otool', ['-L', file], { encoding: 'utf8', timeout: 30_000 }).split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(Boolean)
      if (dependencies.some(library => !library.startsWith('/usr/lib/') && !library.startsWith('/System/Library/'))) throw new Error('PHP must be self-contained; Homebrew or developer-machine library dependencies cannot be shipped.')
    }
  } else if (platform === 'linux') {
    if (bytes.length < 20 || bytes.toString('ascii', 1, 4) !== 'ELF' || bytes[4] !== 2 || bytes.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62)) throw new Error(`PHP must be a Linux ${arch} ELF executable.`)
  }
  if (platform === process.platform && arch === process.arch) {
    const modules = execFileSync(file, ['-n', '-m'], { encoding: 'utf8', timeout: 30_000 })
    const missing = ['mbstring', 'openssl', 'bcmath', 'intl', 'tokenizer', 'ctype', 'fileinfo', 'zip', 'dom', 'xml', 'session'].filter(module => !new RegExp(`^${module}$`, 'mi').test(modules))
    if (missing.length) throw new Error(`Bundled PHP is missing required extensions: ${missing.join(', ')}`)
    // Some static distributions register SQLite PDO through their Swoole build.
    // Test the database driver itself rather than only an extension's display name.
    execFileSync(file, ['-n', '-r', '$db = new PDO("sqlite::memory:"); $db->exec("CREATE TABLE runtime_probe (id INTEGER)");'], { timeout: 30_000, stdio: 'pipe' })
    const version = execFileSync(file, ['-n', '-r', 'echo PHP_VERSION;'], { encoding: 'utf8', timeout: 30_000 })
    const [major, minor] = version.split('.').map(Number)
    if (major !== 8 || minor < 3) throw new Error(`Bundled PHP ${version} does not meet Laravel's PHP 8.3+ requirement.`)
  }
  return { platform, arch, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function verifyPackagedResources(resources, platform, arch) {
  for (const required of ['backend/artisan', 'backend/vendor/autoload.php', 'app.asar', 'license-public-key.pem', 'license-legacy-public-keys.json']) if (!existsSync(join(resources, required))) throw new Error(`Package is missing ${required}`)
  const pem = readFileSync(join(resources, 'license-public-key.pem'), 'utf8')
  if (pem.includes('PRIVATE KEY')) throw new Error('Package contains a private issuer key.')
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Package needs a valid RSA public issuer key.')
  return verifyRuntime(join(resources, 'php', platform === 'win32' ? 'php.exe' : 'php'), platform, arch)
}
