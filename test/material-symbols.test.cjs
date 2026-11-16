const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

test('icon subset covers JSX, conditional and mapped icons without changing font axes or source files', () => {
  const pluginFile = path.resolve(__dirname, '../frontend/tools/materialSymbols.ts')
  const load = createRequire(pluginFile)
  const ts = load('typescript')
  const output = ts.transpileModule(fs.readFileSync(pluginFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exported = {}
  vm.runInNewContext(output, { exports: exported, require: load })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qlhv-icon-test-'))
  try {
    fs.mkdirSync(path.join(root, 'src'))
    fs.mkdirSync(path.join(root, 'tools'))
    fs.writeFileSync(path.join(root, 'tools/material-symbols.codepoints'), 'calendar_month e000\ncancel e001\ncheck e002\nevent e003\nsync e004\n')
    const source = 'const icons = { success: "check" }; const view = <><span className="material-symbols-outlined">calendar_month</span><span>{active ? "cancel" : icons.success}</span><span>event_sync</span></>'
    const file = path.join(root, 'src', 'fixture.tsx')
    fs.writeFileSync(file, source)
    const plugin = exported.materialSymbolsSubset()
    plugin.configResolved({ root })
    const original = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
    const html = `<link href="${original}" rel="stylesheet">`
    const result = plugin.transformIndexHtml(html)
    const url = new URL(result.match(/href="([^"]+)"/)[1])
    assert.equal(url.searchParams.get('family'), new URL(original).searchParams.get('family'))
    assert.equal(url.searchParams.get('icon_names'), 'calendar_month,cancel,check,event,sync')
    assert.equal(url.searchParams.get('display'), 'block')
    assert.equal(fs.readFileSync(file, 'utf8'), source)
    assert.throws(() => plugin.transformIndexHtml('<html></html>'), /stylesheet link is missing/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
