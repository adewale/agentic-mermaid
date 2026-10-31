// The README hero is a direct public PNG render of the authored Mermaid source.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidPNG } from '../../src/agent/index.ts'
import type { RenderOptions } from '../../src/types.ts'

const ROOT = join(import.meta.dir, '../..')
const source = readFileSync(join(ROOT, 'examples/styles/readme-hero.mmd'), 'utf8')
const style = JSON.parse(readFileSync(join(ROOT, 'examples/styles/readme-hero.style.json'), 'utf8'))
const options: RenderOptions = {
  style: ['hand-drawn', 'nord-light', style], seed: 11, security: 'strict',
}
const outputPath = join(ROOT, 'assets/hero.png')
if (process.argv.length > 2) throw new Error('Usage: bun run hero')
writeFileSync(outputPath, renderMermaidPNG(source, { ...options, fitTo: { width: 1600 } }))
console.log('Wrote direct Agentic Mermaid render to assets/hero.png; review the image before committing.')
