// ============================================================================
// quality:add-real — add a diagram from a user's issue as a gate fixture.
//
// Copies the diagram verbatim and names its issue in a `%%` comment (after any
// front matter, which Mermaid requires first). Refuses a diagram already in the
// fixtures, a missing issue URL, or one that does not lay out. A fixture added
// this way is a real input: the paired gate judges quality on it and
// `audit:ugly` must find no hard defect in it.
//
//   bun run quality:add-real <diagram.mmd> --url https://github.com/<owner>/<repo>/issues/<n> [--name <file>]
// ============================================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { layoutMermaidWithReceipt } from '../../src/agent/index.ts'
import { FIXTURES_DIR, issueUrl } from './real-diagrams.ts'

const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined }
const file = process.argv[2], url = arg('--url')
if (!file || file.startsWith('--') || !url || !issueUrl(url)) {
  console.error('usage: quality:add-real <diagram.mmd> --url https://github.com/<owner>/<repo>/issues/<n> [--name <file>]')
  process.exit(2)
}
// Drop an existing leading %% comment line; keep the author's diagram verbatim.
const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
while (lines[0]?.startsWith('%%')) lines.shift()
const body = lines.join('\n').trim()
const normalized = (text: string) => text.split('\n').filter(line => !line.trim().startsWith('%%')).join('\n').trim()
for (const name of readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.mmd'))) {
  if (normalized(readFileSync(join(FIXTURES_DIR, name), 'utf8')) === body) { console.error(`already a fixture: ${name}`); process.exit(1) }
}
const [, owner, repo, number] = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/)!
const name = arg('--name') ?? `${repo === 'mermaid' && owner === 'mermaid-js' ? 'mermaid' : repo}-${number}.mmd`
const target = join(FIXTURES_DIR, name.endsWith('.mmd') ? name : `${name}.mmd`)
if (existsSync(target)) { console.error(`${basename(target)} exists; pass --name`); process.exit(1) }
const comment = `%% Real diagram from a user issue: ${url}`
const end = body.startsWith('---') ? body.indexOf('\n---', 3) : -1
const text = end > 0 ? `${body.slice(0, end + 4)}\n${comment}${body.slice(end + 4)}` : `${comment}\n${body}`
try { layoutMermaidWithReceipt(text) } catch (error) {
  console.error(`does not lay out, so it cannot be a quality fixture: ${String((error as Error)?.message ?? error).split('\n')[0]}`)
  process.exit(1)
}
writeFileSync(target, `${text}\n`)
console.log(`added ${basename(target)}. Next: bun run audit:ugly (0 hard findings), then UPDATE_LAYOUT_BASELINE=1 bun test --timeout 180000 src/__tests__/layout-equivalence.test.ts`)
