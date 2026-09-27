import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderMermaidSVG } from '../../src/index.ts'

const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-303-architecture-option-none.ts <parent-checkout>')

const out = resolve(import.meta.dir, '../../docs/pr-assets/issue-303-architecture-option-none')
const source = readFileSync(resolve(out, 'bg-none.mmd'), 'utf8')
const options = JSON.parse(readFileSync(resolve(out, 'options.json'), 'utf8')) as { bg: string }
const baseModule = await import(pathToFileURL(resolve(baseDirectory, 'src/index.ts')).href)
const before = baseModule.renderMermaidSVG(source, options) as string
if (!before.includes('--bg:none')) throw new Error('Parent no longer reproduces none-valued Architecture background')

let diagnostic: { code: string; field: string; value: string; message: string } | undefined
try {
  renderMermaidSVG(source, options)
} catch (error) {
  if (error instanceof Error && 'code' in error && 'field' in error && 'value' in error) {
    diagnostic = { code: String(error.code), field: String(error.field), value: String(error.value), message: error.message }
  }
}
if (diagnostic?.code !== 'INVALID_RENDER_COLOR' || diagnostic.field !== 'bg' || diagnostic.value !== 'none') {
  throw new Error('Head did not name the invalid Architecture background option')
}

writeFileSync(resolve(out, 'before.svg'), before)
writeFileSync(resolve(out, 'after-error.json'), `${JSON.stringify(diagnostic, null, 2)}\n`)
process.stdout.write('Wrote Architecture option before SVG and after named diagnostic from the same source/options\n')
