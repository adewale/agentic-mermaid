// Substrate determinism lint. Runs in the unit suite and as `bun run
// lint:contracts`. Layout must stay deterministic: ambient nondeterminism is
// banned in the agent + layout-engine code. This test scans the source (with
// comments removed) and fails on hits.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lintSource, REPO_ROOT, walkFiles } from './helpers/source-scan.ts'

const SRC = join(REPO_ROOT, 'src')
const tsFiles = (dir: string) => walkFiles(dir, path => path.endsWith('.ts'))

// Files under the substrate's determinism contract. src/gantt forbids
// wall-clock reads; Mindmap/GitGraph require deterministic geometry and ids
// (GitGraph deliberately replaces upstream random generated ids with c<N>);
// the ASCII grid + A* router must render byte-identically on every run, which
// is what makes its golden corpus valid.
function substrateFiles(): string[] {
  const agentFiles = tsFiles(join(SRC, 'agent'))
  const familyFiles = ['gantt', 'mindmap', 'gitgraph', 'ascii'].flatMap(family => tsFiles(join(SRC, family)))
  return [...agentFiles, ...familyFiles, join(SRC, 'layout-engine.ts')]
}

const BANNED = [
  { name: 'Math.random', re: /\bMath\s*\.\s*random\b/ },
  { name: 'Date.now', re: /\bDate\s*\.\s*now\b/ },
  { name: 'performance.now', re: /\bperformance\s*\.\s*now\b/ },
  { name: 'process.env', re: /\bprocess\s*\.\s*env\b/ },
]

function bannedHits(source: string): string[] {
  const hits = new Set(lintSource('substrate.ts', source, BANNED).map(finding => finding.rule))
  return BANNED.filter(({ name }) => hits.has(name)).map(({ name }) => name)
}

describe('substrate grep-lint (real enforcement)', () => {
  for (const file of substrateFiles()) {
    const rel = file.slice(REPO_ROOT.length + 1)
    test(`${rel} has no ambient nondeterminism`, () => {
      expect({ file: rel, banned: bannedHits(readFileSync(file, 'utf8')) }).toEqual({ file: rel, banned: [] })
    })
  }

  test('the lint actually has teeth (would catch a violation)', () => {
    const cases: Array<[string, string[]]> = [
      ['const x = Math.random()', ['Math.random']],
      ['const t = performance . now()', ['performance.now']],
      ['if (process.env.DEBUG) log()', ['process.env']],
      // A banned token mentioned only in a comment is prose, not code.
      ['// never call Date.now() here\nconst t = 0', []],
      ['/* Math.random() is banned */ const t = 0', []],
      // `//` inside a string must not swallow the code after it.
      ["const u = 'https://example.com'; const t = Date.now()", ['Date.now']],
      // A quote inside a regex literal must not open a string that hides code.
      ["const q = /'/g; const t = Date.now()", ['Date.now']],
    ]
    for (const [source, expected] of cases) expect({ source, hits: bannedHits(source) }).toEqual({ source, hits: expected })
  })

  test('the scanned set covers every substrate directory', () => {
    const rels = substrateFiles().map(file => file.slice(SRC.length + 1))
    for (const dir of ['agent/', 'gantt/', 'mindmap/', 'gitgraph/', 'ascii/']) {
      expect({ dir, files: rels.some(rel => rel.startsWith(dir)) }).toEqual({ dir, files: true })
    }
    expect(rels).toContain('layout-engine.ts')
  })
})
