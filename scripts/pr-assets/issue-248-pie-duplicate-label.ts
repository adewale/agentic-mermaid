#!/usr/bin/env bun
/** Same-source Pie duplicate-label first-wins visual evidence. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

export const SOURCE = `pie showData
  "Alpha" : 10
  "Beta" : 20
  "Alpha" : 30
`
const BASE_SHA = 'ae980eab4be7bb12cb53f1c41bd87f0ac6beccf5'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-pie-duplicate-label.ts <base-checkout>')

const base = resolve(baseDirectory)
const revision = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (revision.exitCode !== 0 || new TextDecoder().decode(revision.stdout).trim() !== BASE_SHA) {
  throw new Error(`Expected an independent base checkout at ${BASE_SHA}`)
}
function baselineRender(exportName: 'renderMermaidSVG' | 'renderMermaidPNG'): Uint8Array {
  const importPath = exportName === 'renderMermaidSVG' ? './src/index.ts' : './src/agent/png.ts'
  const script = `import { ${exportName} } from '${importPath}'; process.stdout.write(${exportName}(${JSON.stringify(SOURCE)}))`
  const result = Bun.spawnSync({ cmd: ['bun', '-e', script], cwd: base, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`Baseline render failed: ${new TextDecoder().decode(result.stderr)}`)
  return result.stdout
}

const slices = (svg: string) => [...svg.matchAll(/data-label="([^"]+)" data-value="([^"]+)"/g)]
  .map(match => [match[1], Number(match[2])])
const beforeSvg = new TextDecoder().decode(baselineRender('renderMermaidSVG'))
if (JSON.stringify(slices(beforeSvg)) !== JSON.stringify([['Alpha', 10], ['Beta', 20], ['Alpha', 30]])) {
  throw new Error('Expected the authentic prior three-slice baseline')
}
const afterSvg = renderMermaidSVG(SOURCE)
if (JSON.stringify(slices(afterSvg)) !== JSON.stringify([['Alpha', 10], ['Beta', 20]])) {
  throw new Error('Expected Mermaid-first-wins two-slice result')
}
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-pie-duplicate-label-before.svg', beforeSvg],
  ['issue-248-pie-duplicate-label-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-pie-duplicate-label-after.svg', afterSvg],
  ['issue-248-pie-duplicate-label-after.png', renderMermaidPNG(SOURCE)],
] as const
for (const [name, bytes] of files) {
  writeFileSync(join(output, name), bytes)
  process.stdout.write(`${name} sha256:${createHash('sha256').update(bytes).digest('hex')}\n`)
}
