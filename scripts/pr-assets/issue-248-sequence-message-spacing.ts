#!/usr/bin/env bun
/** Same-source Sequence message spacing evidence before/after the shared-parser fix. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

const SOURCE = `sequenceDiagram
  participant Alice
  participant Bob
  Alice-->>+Bob: Hello
  Bob-->>- Alice: Hi
  Alice ->>() Bob: Center
`
const BASE_SHA = '589fff9116f71a37d4915513256213322b4fad32'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-sequence-message-spacing.ts <base-checkout>')

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

const drawnTexts = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
  .map(match => match[1]!.replace(/<[^>]+>/g, '').trim())
const beforeSvg = new TextDecoder().decode(baselineRender('renderMermaidSVG'))
if (!drawnTexts(beforeSvg).includes('Hello') || drawnTexts(beforeSvg).includes('Hi') || drawnTexts(beforeSvg).includes('Center')) {
  throw new Error('Expected the authentic prior dropped-message baseline')
}
const afterSvg = renderMermaidSVG(SOURCE)
if (!['Hello', 'Hi', 'Center', 'Alice', 'Bob'].every(text => drawnTexts(afterSvg).includes(text))) {
  throw new Error('The current renderer did not retain both spaced Sequence messages')
}
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-sequence-message-spacing-before.svg', beforeSvg],
  ['issue-248-sequence-message-spacing-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-sequence-message-spacing-after.svg', afterSvg],
  ['issue-248-sequence-message-spacing-after.png', renderMermaidPNG(SOURCE)],
] as const
for (const [name, bytes] of files) {
  writeFileSync(join(output, name), bytes)
  process.stdout.write(`${name} sha256:${createHash('sha256').update(bytes).digest('hex')}\n`)
}
