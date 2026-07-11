// Substrate enforcement that ACTUALLY RUNS (unlike an uninstalled ESLint).
// Layout must stay deterministic: ambient nondeterminism is banned in the
// agent + layout-engine code. This test greps the source and fails on hits.

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

describe('substrate grep-lint (real enforcement)', () => {
  for (const file of substrateFiles()) {
    const rel = file.slice(REPO.length + 1)
    test(`${rel} has no ambient nondeterminism`, () => {
      const src = readFileSync(file, 'utf8')
      // Strip line comments so a banned token mentioned in prose doesn't trip.
      const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
      for (const { name, re } of BANNED) {
        expect({ file: rel, banned: name, found: re.test(code) }).toEqual({ file: rel, banned: name, found: false })
      }
    })
  }

  test('the lint actually has teeth (would catch a violation)', () => {
    const violating = `const x = Math.random()`
    const code = violating.replace(/\/\/.*$/, '')
    expect(BANNED[0]!.re.test(code)).toBe(true)
  })
})
