#!/usr/bin/env bun
/** Same-source Pie authored formatting before/after evidence from an exact base. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

export const SOURCE = `pie showData
  title T<b>itle</b>
  "A<br>B" : 1
  "C" : 2
`
const BASE_SHA = '11b53c279a085d84c750ce9a35e638bd40c2b919'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-pie-authored-formatting.ts <base-checkout> [--check]')

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
if (!beforeSvg.includes('<tspan') || afterSvg.includes('<tspan')) {
  throw new Error('Expected baseline line-breaking and literal after rendering')
}
if (!afterSvg.includes('T&lt;b&gt;itle&lt;/b&gt;') || !afterSvg.includes('A&lt;br&gt;B')) {
  throw new Error('Expected authored formatting to remain literal after fix')
}

const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-pie-authored-formatting-before.svg', beforeSvg],
  ['issue-248-pie-authored-formatting-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-pie-authored-formatting-after.svg', afterSvg],
  ['issue-248-pie-authored-formatting-after.png', renderMermaidPNG(SOURCE)],
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
