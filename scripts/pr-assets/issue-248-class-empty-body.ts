#!/usr/bin/env bun
/** Same-input public-render evidence for the inline empty Class body (#299).
 * The prior 0×0 SVG is preserved as the honest baseline. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

const SOURCE = 'classDiagram\n  class EmptyClass {}\n'
const BASE_SHA = '8013285d4ac887c9d0a99788cbd711a4f9349611'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-class-empty-body.ts <base-checkout>')

const base = resolve(baseDirectory)
const revision = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (revision.exitCode !== 0 || new TextDecoder().decode(revision.stdout).trim() !== BASE_SHA) {
  throw new Error(`Expected an independent base checkout at ${BASE_SHA}`)
}
const baselineScript = `import { renderMermaidSVG } from './src/index.ts'; process.stdout.write(renderMermaidSVG(${JSON.stringify(SOURCE)}))`
const baseline = Bun.spawnSync({ cmd: ['bun', '-e', baselineScript], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (baseline.exitCode !== 0) throw new Error(`Baseline render failed: ${new TextDecoder().decode(baseline.stderr)}`)
const beforeSvg = new TextDecoder().decode(baseline.stdout)
if (!beforeSvg.includes('width="0" height="0"') || beforeSvg.includes('data-id="EmptyClass"')) {
  throw new Error('Expected the authentic prior empty Class render')
}

const afterSvg = renderMermaidSVG(SOURCE)
if (!afterSvg.includes('class="class-node" data-id="EmptyClass"') || afterSvg.includes('width="0" height="0"')) {
  throw new Error('The current renderer did not produce the expected Class node')
}
const afterPng = renderMermaidPNG(SOURCE, { scale: 2 })
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-class-empty-body-before.svg', beforeSvg],
  ['issue-248-class-empty-body-after.svg', afterSvg],
  ['issue-248-class-empty-body-after.png', afterPng],
] as const
for (const [name, bytes] of files) {
  writeFileSync(join(output, name), bytes)
  const digest = createHash('sha256').update(bytes).digest('hex')
  process.stdout.write(`${name} sha256:${digest}\n`)
}
