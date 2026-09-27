#!/usr/bin/env bun
/** Same-source sender-spaced Sequence central-connection evidence. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

const SOURCE = `sequenceDiagram
  participant Alice
  participant Bob
  Alice ()-->> Bob: Reverse
  Alice ()->>() Bob: Dual
`
const BASE_SHA = '571b087a51509c13a8d69875fb6b7e0f859ca15a'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-sequence-sender-central-spacing.ts <base-checkout>')

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
if (drawnTexts(beforeSvg).includes('Reverse') || drawnTexts(beforeSvg).includes('Dual')) {
  throw new Error('Expected the authentic prior dropped-message baseline')
}
const afterSvg = renderMermaidSVG(SOURCE)
if (!['Reverse', 'Dual', 'Alice', 'Bob'].every(text => drawnTexts(afterSvg).includes(text))) {
  throw new Error('The current renderer did not retain both sender-spaced central messages')
}
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-sequence-sender-central-spacing-before.svg', beforeSvg],
  ['issue-248-sequence-sender-central-spacing-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-sequence-sender-central-spacing-after.svg', afterSvg],
  ['issue-248-sequence-sender-central-spacing-after.png', renderMermaidPNG(SOURCE)],
] as const
for (const [name, bytes] of files) {
  writeFileSync(join(output, name), bytes)
  process.stdout.write(`${name} sha256:${createHash('sha256').update(bytes).digest('hex')}\n`)
}
