#!/usr/bin/env bun
/** Same-source Class member rendering before/after the authored-text fix. */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'

const SOURCE = 'classDiagram\n  class Account {\n    +id: string\n    int count\n    +List~int~ position\n  }\n'
const BASE_SHA = '5982650fff6f95c723a492f3370a603f868b3e4e'
const baseDirectory = process.argv[2]
if (!baseDirectory) throw new Error('Usage: bun run scripts/pr-assets/issue-248-class-member-text.ts <base-checkout>')

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

const beforeSvg = new TextDecoder().decode(baselineRender('renderMermaidSVG'))
const visibleText = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
  .map(match => match[1]!.replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').trim())
if (!visibleText(beforeSvg).includes('+ string: id:') || !visibleText(beforeSvg).includes('count: int')) {
  throw new Error('Expected the authentic prior member-text mismatch')
}
const afterSvg = renderMermaidSVG(SOURCE)
if (!['+id: string', 'int count', '+List<int> position'].every(text => visibleText(afterSvg).includes(text))) {
  throw new Error('The current renderer did not preserve authored Class member text')
}
const output = join(import.meta.dir, '..', '..', 'docs', 'pr-assets')
const files = [
  ['issue-248-class-member-text-before.svg', beforeSvg],
  ['issue-248-class-member-text-before.png', baselineRender('renderMermaidPNG')],
  ['issue-248-class-member-text-after.svg', afterSvg],
  ['issue-248-class-member-text-after.png', renderMermaidPNG(SOURCE)],
] as const
for (const [name, bytes] of files) {
  writeFileSync(join(output, name), bytes)
  process.stdout.write(`${name} sha256:${createHash('sha256').update(bytes).digest('hex')}\n`)
}
