#!/usr/bin/env bun
/** Same-source ER multi-class paint before/after from the landed #315 tree. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

export const SOURCE = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  classDef vip fill:#ff8a65
  classDef hot stroke:#3b4cca,stroke-width:4px
  class CUSTOMER, ORDER vip, hot
`
const BASE_SHA = '5ea446a02d1341ecebf72de677d5ec2b77dda064'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun scripts/pr-assets/issue-248-er-multi-class.ts <base-checkout> [--check]')

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
if (!beforeSvg.includes('data-class="hot"') || beforeSvg.includes('data-class="vip hot"')) {
  throw new Error('Expected baseline to lose the first class and leave ORDER unstyled')
}
if (!afterSvg.includes('data-class="vip hot"') || !afterSvg.includes('fill="#ff8a65"') || !afterSvg.includes('stroke="#3b4cca"')) {
  throw new Error('Expected after render to apply both classDefs to both entities')
}

const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-er-multi-class-before.svg', beforeSvg],
  ['issue-248-er-multi-class-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-er-multi-class-after.svg', afterSvg],
  ['issue-248-er-multi-class-after.png', renderMermaidPNG(SOURCE)],
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
