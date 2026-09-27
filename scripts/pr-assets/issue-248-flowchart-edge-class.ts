#!/usr/bin/env bun
/** Same-source Flowchart edge-class paint before/after from merged #317's tree. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

export const SOURCE = `flowchart LR
  A e1@--> B
  B e2@--> C
  classDef hot stroke:#ff0000,stroke-width:6px
  class e1 hot
`
const BASE_SHA = '45353ead07f2ec31ea3a6ab297adf588bd4fcdc2'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun scripts/pr-assets/issue-248-flowchart-edge-class.ts <base-checkout> [--check]')

const base = resolve(baseDirectory)
const revision = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (revision.exitCode !== 0 || new TextDecoder().decode(revision.stdout).trim() !== BASE_SHA) {
  throw new Error(`Expected an independent base checkout at ${BASE_SHA}`)
}
for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
  const clean = Bun.spawnSync({ cmd: ['git', ...args], cwd: base, stdout: 'pipe', stderr: 'pipe' })
  if (clean.exitCode !== 0) throw new Error('Baseline checkout has tracked changes')
}
function baselineRender(exportName: 'renderMermaidSVG' | 'renderMermaidPNG'): Uint8Array {
  const importPath = exportName === 'renderMermaidSVG' ? './src/index.ts' : './src/agent/png.ts'
  const script = `import { ${exportName} } from '${importPath}'; process.stdout.write(${exportName}(${JSON.stringify(SOURCE)}))`
  const result = Bun.spawnSync({ cmd: ['bun', '-e', script], cwd: base, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`Baseline render failed: ${new TextDecoder().decode(result.stderr)}`)
  return result.stdout
}

const beforeSvg = new TextDecoder().decode(baselineRender('renderMermaidSVG'))
const afterSvg = renderMermaidSVG(SOURCE)
const edgeTag = (svg: string, id: string): string => svg.match(new RegExp(`<(?:polyline|path)\\b[^>]*data-id="${id}"[^>]*>`))?.[0] ?? ''
if (!edgeTag(beforeSvg, 'e1').includes('data-id="e1"') || edgeTag(beforeSvg, 'e1').includes('stroke="#ff0000"')) {
  throw new Error('Expected baseline to retain the edge ID but omit its authored class paint')
}
if (!edgeTag(afterSvg, 'e1').includes('class="edge hot"') || !edgeTag(afterSvg, 'e1').includes('stroke="#ff0000"') || !edgeTag(afterSvg, 'e1').includes('stroke-width="6px"')) {
  throw new Error('Expected the after render to paint the assigned edge')
}
if (edgeTag(afterSvg, 'e2').includes('stroke="#ff0000"')) throw new Error('Unrelated edge inherited the assigned class paint')

const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-flowchart-edge-class-before.svg', beforeSvg],
  ['issue-248-flowchart-edge-class-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-flowchart-edge-class-after.svg', afterSvg],
  ['issue-248-flowchart-edge-class-after.png', renderMermaidPNG(SOURCE)],
] as const
for (const [name, bytes] of files) {
  const path = join(output, name)
  const value = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  if (process.argv.includes('--check')) {
    if (Buffer.compare(readFileSync(path), Buffer.from(value)) !== 0) throw new Error(`${name} is stale`)
  } else {
    writeFileSync(path, value)
  }
  process.stdout.write(`${name} sha256:${createHash('sha256').update(value).digest('hex')}\n`)
}
