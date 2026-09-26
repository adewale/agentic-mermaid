#!/usr/bin/env bun
/** Authentic failed-before/rendered-after evidence for Journey fractional scores.
 * Pass an independent checkout of the exact merged #292 base commit. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

const SOURCE = 'journey\n  title Fractional Journey scores\n  section Work\n  First: 3: Me\n  Review: 3.5: Me\n  Last: 4: Me'
const BASE_SHA = '49cbd03ac1a3df5c23920305a4bc424daa8e406f'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-journey-fractional-score.ts <base-checkout>')

const base = resolve(baseDirectory)
const revision = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: base, stdout: 'pipe', stderr: 'pipe' })
if (revision.exitCode !== 0 || new TextDecoder().decode(revision.stdout).trim() !== BASE_SHA) {
  throw new Error(`Expected an independent base checkout at ${BASE_SHA}`)
}
const baselineScript = `import { renderMermaidSVG } from './src/index.ts'; process.stdout.write(renderMermaidSVG(${JSON.stringify(SOURCE)}))`
const baseline = Bun.spawnSync({ cmd: ['bun', '-e', baselineScript], cwd: base, stdout: 'pipe', stderr: 'pipe' })
const priorError = new TextDecoder().decode(baseline.stderr)
if (baseline.exitCode === 0 || !priorError.includes('Journey task "Review" has invalid score 3.5')) {
  throw new Error(`Expected the authentic base render failure, got ${priorError}`)
}
process.stdout.write('Base renderer: Journey task "Review" has invalid score 3.5\n')

const afterSvg = renderMermaidSVG(SOURCE)
if (!afterSvg.includes('class="journey-score-marker" data-score="3.5"') || /NaN|Infinity|undefined/.test(afterSvg)) {
  throw new Error('Current renderer did not preserve finite fractional score semantics')
}
const afterPng = renderMermaidPNG(SOURCE, { scale: 2 })
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
for (const [name, bytes] of [
  ['issue-248-journey-fractional-score-after.svg', afterSvg],
  ['issue-248-journey-fractional-score-after.png', afterPng],
] as const) {
  writeFileSync(join(output, name), bytes)
  process.stdout.write(`${name} sha256:${createHash('sha256').update(bytes).digest('hex')}\n`)
}
