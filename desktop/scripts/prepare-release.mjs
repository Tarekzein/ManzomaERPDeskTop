import { createPublicKey } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
const key = process.env.ERP_ISSUER_PUBLIC_KEY
if (!key || key.includes('PRIVATE KEY')) throw new Error('Configure ERP_ISSUER_PUBLIC_KEY with the production issuer PUBLIC key.')
const parsed = createPublicKey(key)
if (parsed.asymmetricKeyType !== 'rsa' || parsed.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Issuer public key must be RSA with at least 2048 bits.')
if (process.platform !== 'linux' && !process.env.CSC_LINK) throw new Error('A distribution signing identity is required for Windows/macOS release builds.')
if (process.platform === 'darwin' && !['APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'].every(key=>process.env[key])) throw new Error('Configure macOS notarization credentials before releasing.')
mkdirSync('resources', { recursive: true })
writeFileSync('resources/license-public-key.pem', parsed.export({ format:'pem',type:'spki' }))
console.log('Release public key and signing configuration verified. Private keys are never copied into application resources.')
