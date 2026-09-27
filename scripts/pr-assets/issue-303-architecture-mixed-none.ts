import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderMermaidSVG } from '../../src/index.ts'

const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-303-architecture-mixed-none.ts <parent-checkout>')

const out = resolve(import.meta.dir, '../../docs/pr-assets/issue-303-architecture-mixed-none')
const source = readFileSync(resolve(out, 'mainbkg-none.mmd'), 'utf8')
const baseModule = await import(pathToFileURL(resolve(baseDirectory, 'src/index.ts')).href)
const before = baseModule.renderMermaidSVG(source) as string
for (const variable of ['--bg:none', '--arch-group-fill:none', '--arch-service-fill:none']) {
  if (!before.includes(variable)) throw new Error(`Parent no longer reproduces ${variable}`)
}

let diagnostic: { code: string; key: string; value: string; message: string } | undefined
try {
  renderMermaidSVG(source)
} catch (error) {
  if (error instanceof Error && 'code' in error && 'key' in error && 'value' in error) {
    diagnostic = { code: String(error.code), key: String(error.key), value: String(error.value), message: error.message }
  }
}
if (diagnostic?.code !== 'INVALID_THEME_COLOR' || diagnostic.key !== 'mainBkg' || diagnostic.value !== 'none') {
  throw new Error('Head did not name the invalid Architecture derived paint')
}

writeFileSync(resolve(out, 'before.svg'), before)
writeFileSync(resolve(out, 'after-error.json'), `${JSON.stringify(diagnostic, null, 2)}\n`)
process.stdout.write('Wrote Architecture before SVG and after named diagnostic from the same source\n')
