import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(resolve(root, 'src/shared/messages.ar.json'), 'utf8'))
const server = JSON.parse(readFileSync(resolve(root, '../backend/lang/ar.json'), 'utf8'))
const problems = []
if (JSON.stringify(catalog) !== JSON.stringify(server)) problems.push('Desktop and backend message catalogues differ.')
for (const [key, value] of Object.entries(catalog)) if (!key.trim() || !/[\u0600-\u06ff]/.test(value)) problems.push(`Missing Arabic translation: ${key}`)
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) { scan(path); continue }
    if (!path.endsWith('.tsx')) continue
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node) {
      if (ts.isJsxAttribute(node) && ['aria-label', 'title', 'label'].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z]+\s+[A-Za-z]+|^[A-Za-z]{3,}$/.test(node.initializer.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
        problems.push(`${path.slice(root.length + 1)}:${line}: untranslated ${node.name.getText(source)}: ${node.initializer.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
scan(resolve(root, 'src/renderer/src'))
const erp = readFileSync(resolve(root, '../backend/config/erp.php'), 'utf8')
const permissions = erp.slice(erp.indexOf("'permissions' =>"), erp.indexOf("'opt_in_permissions' =>"))
const labels = readFileSync(resolve(root, 'src/renderer/src/features/settings/UsersRoles.tsx'), 'utf8')
for (const [, permission] of permissions.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) if (!labels.includes(`'${permission}':`)) problems.push(`Missing bilingual permission label: ${permission}`)
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1 }
else console.log(`Translation checks passed: ${Object.keys(catalog).length} shared Arabic messages and renderer labels.`)
