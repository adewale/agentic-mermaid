#!/usr/bin/env bun
/** Authentic same-input before/after evidence for issue #248 bare Class links.
 * Pass an independent checkout of the exact base commit as the first argument.
 * The prior renderer's 0×0 SVG is intentionally preserved, not fabricated. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

const SOURCE = 'classDiagram\nclassO .. classP : Link(Dashed)'
const BASE_SHA = 'ec7efab94ced1ac9ae8afda3806a625a531e0824'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-class-bare-links.ts <base-checkout>')

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
if (!afterSvg.includes('data-from="classO" data-to="classP" data-type="link-dashed"') || !afterSvg.includes('stroke-dasharray="6 4"')) {
  throw new Error('The current renderer did not produce the expected markerless dashed relation')
}
const afterPng = renderMermaidPNG(SOURCE, { scale: 2 })
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-class-bare-link-before.svg', beforeSvg],
  ['issue-248-class-bare-link-after.svg', afterSvg],
  ['issue-248-class-bare-link-after.png', afterPng],
] as const
for (const [name, bytes] of files) {
  writeFileSync(join(output, name), bytes)
  const digest = createHash('sha256').update(bytes).digest('hex')
  process.stdout.write(`${name} sha256:${digest}\n`)
}
