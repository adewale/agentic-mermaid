#!/usr/bin/env bun
/** Same-source Pie named-reference before/after evidence from an exact base. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

export const SOURCE = `pie showData
  title Named references
  "A#reg;B" : 1
  "C" : 2
`
const BASE_SHA = '4328ff81ee0e3e2c4aaca91ee2109c5a16e64ee4'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-pie-named-entity.ts <base-checkout> [--check]')

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

const legendText = (svg: string) => svg.match(/class="pie-legend-text"[^>]*>([^<]*)<\/text>/)?.[1]
const beforeSvg = new TextDecoder().decode(baselineRender('renderMermaidSVG'))
if (legendText(beforeSvg) !== 'A&amp;reg;B [1] (33.3%)') throw new Error('Expected literal baseline legend')
const afterSvg = renderMermaidSVG(SOURCE)
if (legendText(afterSvg) !== 'A®B [1] (33.3%)') throw new Error('Expected decoded named-reference legend')

const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-pie-named-entity-before.svg', beforeSvg],
  ['issue-248-pie-named-entity-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-pie-named-entity-after.svg', afterSvg],
  ['issue-248-pie-named-entity-after.png', renderMermaidPNG(SOURCE)],
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
