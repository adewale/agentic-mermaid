#!/usr/bin/env bun
/** Actual same-source before/after evidence for escaped Class relation IDs.
 * Pass an independent checkout at the exact merged #290 base commit. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

const SOURCE = 'classDiagram\n`class A` --> B'
const BASE_SHA = '6b834e1a0ee081a2c27a15f20cd5609be9ae562d'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-class-escaped-relation.ts <base-checkout>')

const base = resolve(baseDirectory)
const revision = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (revision.exitCode !== 0 || new TextDecoder().decode(revision.stdout).trim() !== BASE_SHA) {
  throw new Error(`Expected an independent base checkout at ${BASE_SHA}`)
}
const baselineScript = `import { renderMermaidSVG } from './src/index.ts'; process.stdout.write(renderMermaidSVG(${JSON.stringify(SOURCE)}))`
const baseline = Bun.spawnSync({ cmd: ['bun', '-e', baselineScript], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (baseline.exitCode !== 0) throw new Error(`Baseline render failed: ${new TextDecoder().decode(baseline.stderr)}`)
const beforeSvg = new TextDecoder().decode(baseline.stdout)
if (!beforeSvg.includes('width="0" height="0"') || beforeSvg.includes('class="class-relationship"')) {
  throw new Error('Expected the authentic prior empty Class render')
}

const afterSvg = renderMermaidSVG(SOURCE)
if (!afterSvg.includes('data-from="class A" data-to="B" data-type="association"') || !afterSvg.includes('class="class-relationship"')) {
  throw new Error('The current renderer did not preserve the escaped relation identity')
}
const afterPng = renderMermaidPNG(SOURCE, { scale: 2 })
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
for (const [name, bytes] of [
  ['issue-248-class-escaped-relation-before.svg', beforeSvg],
  ['issue-248-class-escaped-relation-after.svg', afterSvg],
  ['issue-248-class-escaped-relation-after.png', afterPng],
] as const) {
  writeFileSync(join(output, name), bytes)
  process.stdout.write(`${name} sha256:${createHash('sha256').update(bytes).digest('hex')}\n`)
}
