import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderMermaidSVG } from '../../src/index.ts'

const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-303-family-config-colors.ts <base-checkout>')

const out = resolve(import.meta.dir, '../../docs/pr-assets/issue-303-family-config-colors')
const source = readFileSync(resolve(out, 'invalid-section-fill.mmd'), 'utf8')
const baseModule = await import(pathToFileURL(resolve(baseDirectory, 'src/index.ts')).href)
const before = baseModule.renderMermaidSVG(source) as string
if (!before.includes('--tl-fill:notacolor') || !before.includes('color-mix(in srgb, notacolor')) {
  throw new Error('Base no longer reproduces the invalid Timeline config fill')
}

let diagnostic: { code: string; path: string; value: string; message: string } | undefined
try {
  renderMermaidSVG(source)
} catch (error) {
  if (error instanceof Error && 'code' in error && 'path' in error && 'value' in error) {
    diagnostic = { code: String(error.code), path: String(error.path), value: String(error.value), message: error.message }
  }
}
if (diagnostic?.code !== 'INVALID_CONFIG_COLOR' || diagnostic.path !== 'timeline.sectionFills[0]' || diagnostic.value !== 'notacolor') {
  throw new Error('Head did not name the invalid Timeline config color')
}

writeFileSync(resolve(out, 'before.svg'), before)
writeFileSync(resolve(out, 'after-error.json'), `${JSON.stringify(diagnostic, null, 2)}\n`)
process.stdout.write('Wrote Timeline config-color baseline SVG and named after-error diagnostic from the same source\n')
