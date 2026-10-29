// The README hero is a direct public PNG render of the authored Mermaid source.
// Freshness uses SVG output so platform-specific PNG encoding is not compared.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidPNG, renderMermaidSVG } from '../../src/agent/index.ts'
import type { RenderOptions } from '../../src/types.ts'

const ROOT = join(import.meta.dir, '../..')
const source = readFileSync(join(ROOT, 'examples/styles/readme-hero.mmd'), 'utf8')
const style = JSON.parse(readFileSync(join(ROOT, 'examples/styles/readme-hero.style.json'), 'utf8'))
const options: RenderOptions = {
  style: ['hand-drawn', 'nord-light', style], seed: 11, security: 'strict',
}
const outputPath = join(ROOT, 'assets/hero.png')
const fingerprintPath = join(ROOT, 'assets/hero.fingerprint.txt')
const fingerprint = '# Public SVG behind the direct README hero render.\n'
  + renderMermaidSVG(source, options)

if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || !existsSync(fingerprintPath)
    || readFileSync(fingerprintPath, 'utf8') !== fingerprint) {
    console.error('README hero is stale. Run bun run hero and review assets/hero.png.')
    process.exit(1)
  }
  console.log('README hero source and public renderer output are current.')
} else {
  writeFileSync(outputPath, renderMermaidPNG(source, { ...options, fitTo: { width: 1600 } }))
  writeFileSync(fingerprintPath, fingerprint)
  console.log('Wrote direct Agentic Mermaid render to assets/hero.png.')
}
