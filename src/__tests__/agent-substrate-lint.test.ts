// Substrate determinism lint. Runs in the unit suite and as `bun run
// lint:contracts`. Layout must stay deterministic: ambient nondeterminism is
// banned in the agent + layout-engine code. This test scans the source (with
// comments removed) and fails on hits.

import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
const SRC = join(REPO, 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

// Files under the substrate's determinism contract. src/gantt forbids
// wall-clock reads; Mindmap/GitGraph require deterministic geometry and ids
// (GitGraph deliberately replaces upstream random generated ids with c<N>).
function substrateFiles(): string[] {
  const agentFiles = walk(join(SRC, 'agent'))
  const familyFiles = ['gantt', 'mindmap', 'gitgraph'].flatMap(family => walk(join(SRC, family)))
  return [...agentFiles, ...familyFiles, join(SRC, 'layout-engine.ts')]
}

const BANNED = [
  { name: 'Math.random', re: /\bMath\s*\.\s*random\b/ },
  { name: 'Date.now', re: /\bDate\s*\.\s*now\b/ },
  { name: 'performance.now', re: /\bperformance\s*\.\s*now\b/ },
  { name: 'process.env', re: /\bprocess\s*\.\s*env\b/ },
]

/** Remove // and /* *\/ comments, leaving string literals intact, so a banned
 *  token in prose does not trip the lint and a `//` inside a string (a URL)
 *  does not hide the code after it. */
function stripComments(source: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (quote) {
      out += ch
      if (ch === '\\') out += source[++i] ?? ''
      else if (ch === quote) quote = null
    } else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 1
    } else {
      if (ch === "'" || ch === '"' || ch === '`') quote = ch
      out += ch
    }
  }
  return out
}

function bannedHits(source: string): string[] {
  const code = stripComments(source)
  return BANNED.filter(({ re }) => re.test(code)).map(({ name }) => name)
}

describe('substrate grep-lint (real enforcement)', () => {
  for (const file of substrateFiles()) {
    const rel = file.slice(REPO.length + 1)
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
    ]
    for (const [source, expected] of cases) expect({ source, hits: bannedHits(source) }).toEqual({ source, hits: expected })
  })

  test('the scanned set covers every substrate directory', () => {
    const rels = substrateFiles().map(file => file.slice(SRC.length + 1))
    for (const dir of ['agent/', 'gantt/', 'mindmap/', 'gitgraph/']) {
      expect({ dir, files: rels.some(rel => rel.startsWith(dir)) }).toEqual({ dir, files: true })
    }
    expect(rels).toContain('layout-engine.ts')
  })
})
