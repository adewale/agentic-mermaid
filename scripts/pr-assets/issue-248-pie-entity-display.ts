#!/usr/bin/env bun
/** Authentic same-source before/after Pie entity-display evidence. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

export const SOURCE = `pie showData
  "A&#35;B" : 1
  "A&#65;B" : 2
`
const BASE_SHA = 'c8398a26d0c8a9e63554c973b17c8f1aa71b505a'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-pie-entity-display.ts <base-checkout>')

const base = resolve(baseDirectory)
const revision = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (revision.exitCode !== 0 || new TextDecoder().decode(revision.stdout).trim() !== BASE_SHA) {
  throw new Error(`Expected an independent base checkout at ${BASE_SHA}`)
}
for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
  const clean = Bun.spawnSync({ cmd: ['git', ...args], cwd: base, stdout: 'pipe', stderr: 'pipe' })
  if (clean.exitCode !== 0) throw new Error('Baseline checkout has tracked changes; before evidence requires a clean base')
}
function baselineRender(exportName: 'renderMermaidSVG' | 'renderMermaidPNG'): Uint8Array {
  const importPath = exportName === 'renderMermaidSVG' ? './src/index.ts' : './src/agent/png.ts'
  const script = `import { ${exportName} } from '${importPath}'; process.stdout.write(${exportName}(${JSON.stringify(SOURCE)}))`
  const result = Bun.spawnSync({ cmd: ['bun', '-e', script], cwd: base, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`Baseline render failed: ${new TextDecoder().decode(result.stderr)}`)
  return result.stdout
}

const legendText = (svg: string) => [...svg.matchAll(/class="pie-legend-text"[^>]*>([^<]*)<\/text>/g)]
  .map(match => match[1])
const beforeSvg = new TextDecoder().decode(baselineRender('renderMermaidSVG'))
if (JSON.stringify(legendText(beforeSvg)) !== JSON.stringify(['A&amp;#35;B [1] (33.3%)', 'A&amp;#65;B [2] (66.7%)'])) {
  throw new Error('Expected the authentic literal-entity baseline labels')
}
const afterSvg = renderMermaidSVG(SOURCE)
if (JSON.stringify(legendText(afterSvg)) !== JSON.stringify(['A&amp;#B [1] (33.3%)', 'A&amp;AB [2] (66.7%)'])) {
  throw new Error('Expected pinned Mermaid browser-visible label projection')
}
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-pie-entity-display-before.svg', beforeSvg],
  ['issue-248-pie-entity-display-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-pie-entity-display-after.svg', afterSvg],
  ['issue-248-pie-entity-display-after.png', renderMermaidPNG(SOURCE)],
] as const
for (const [name, bytes] of files) {
  writeFileSync(join(output, name), bytes)
  process.stdout.write(`${name} sha256:${createHash('sha256').update(bytes).digest('hex')}\n`)
}
