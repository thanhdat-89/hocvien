import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'
import type { Plugin } from 'vite'

/** Keep the existing font axes and glyphs, but download only names used by the app. */
export function materialSymbolsSubset(): Plugin {
  let root = ''
  return {
    name: 'material-symbols-subset',
    configResolved(config) { root = config.root },
    transformIndexHtml(html) {
      // Official Google Material Symbols codepoint inventory (Apache 2.0).
      // Keeping it local makes builds reproducible and requires no network requests.
      const inventory = new Set(readFileSync(join(root, 'tools/material-symbols.codepoints'), 'utf8')
        .trim().split(/\r?\n/).map(line => line.split(' ')[0]))
      const names = new Set<string>()
      const scan = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name)
          if (entry.isDirectory()) { scan(path); continue }
          if (!/\.tsx?$/.test(entry.name)) continue
          const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
          const visit = (node: ts.Node) => {
            // Includes JSX icon text, conditional icons, nav/config maps and component props.
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
              const name = node.text.trim()
              if (inventory.has(name)) names.add(name)
              else if (/^[a-z]+(?:_[a-z]+)+$/.test(name)) {
                // Preserve partial ligatures in existing composite names too.
                for (const part of name.split('_')) if (inventory.has(part)) names.add(part)
              }
            }
            ts.forEachChild(node, visit)
          }
          visit(source)
        }
      }
      scan(join(root, 'src'))
      if (!names.size) throw new Error('Material Symbols inventory is empty')
      const url = /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined[^"\s]*/
      if (!url.test(html)) throw new Error('Material Symbols stylesheet link is missing')
      return html.replace(url, match => `${match}&icon_names=${Array.from(names).sort().join(',')}&display=block`)
    },
  }
}
