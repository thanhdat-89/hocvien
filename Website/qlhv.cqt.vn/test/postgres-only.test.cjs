const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Backend chỉ dùng PostgreSQL: không còn module nào trong src/ nạp Firebase/Firestore hay Supabase.
// (db/export-firestore.cjs nằm ngoài src/ — chỉ dùng cho lần xuất dữ liệu khi chuyển đổi.)
test('backend source never loads Firebase, Firestore or Supabase', () => {
  const root = path.resolve(__dirname, '../src')
  const files = []
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.ts') && files.push(path.join(dir, entry.name)))
  walk(root)
  assert.ok(files.length > 40)
  for (const file of files) {
    const imports = [...fs.readFileSync(file, 'utf8').matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map(m => m[1])
    for (const name of imports) assert.doesNotMatch(name, /firebase|firestore|supabase|lib\/firebase/i, `${path.relative(root, file)} nạp ${name}`)
  }
  const pkg = require('../package.json')
  assert.equal(pkg.dependencies['firebase-admin'], undefined, 'firebase-admin chỉ còn là devDependency cho script xuất dữ liệu')
})
