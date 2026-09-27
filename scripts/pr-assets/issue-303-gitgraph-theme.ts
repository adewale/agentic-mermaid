import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderMermaidSVG } from '../../src/index.ts'

const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-303-gitgraph-theme.ts <base-checkout>')

const out = resolve(import.meta.dir, '../../docs/pr-assets/issue-303-gitgraph-theme')
const source = readFileSync(resolve(out, 'invalid-branch-color.mmd'), 'utf8')
const baseModule = await import(pathToFileURL(resolve(baseDirectory, 'src/index.ts')).href)
const before = baseModule.renderMermaidSVG(source) as string
if (!before.includes('stroke="notacolor"')) throw new Error('Base no longer reproduces the invalid GitGraph stroke')

let diagnostic: { code: string; key: string; value: string; message: string } | undefined
try {
  renderMermaidSVG(source)
} catch (error) {
  if (error instanceof Error && 'code' in error && 'key' in error && 'value' in error) {
    diagnostic = { code: String(error.code), key: String(error.key), value: String(error.value), message: error.message }
  }
}
if (diagnostic?.code !== 'INVALID_THEME_COLOR' || diagnostic.key !== 'git0' || diagnostic.value !== 'notacolor') {
  throw new Error('Head did not name the invalid GitGraph color')
}

writeFileSync(resolve(out, 'before.svg'), before)
writeFileSync(resolve(out, 'after-error.json'), `${JSON.stringify(diagnostic, null, 2)}\n`)
process.stdout.write('Wrote GitGraph baseline SVG and named after-error diagnostic from the same source\n')
