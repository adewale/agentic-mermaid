// Loop 7 bug 3.5: pathfinder determinism regression guard.
//
// The plan called for a 10-run byte-identity check on a fixture with multiple
// parallel edges. Probing the current code revealed the pathfinder IS already
// deterministic across 10 runs (probably because the A* priority queue uses
// stable index-based tie-breaks and the Set/Map iteration order in V8/Bun is
// insertion-ordered). The fix is therefore documented as a regression guard
// rather than a behaviour change — if anyone introduces a tie-break that
// depends on iteration of an unordered structure or on Math.random / Date.now,
// this test will catch it.

import { describe, it, expect } from 'bun:test'
import { renderMermaidAscii } from '../ascii/index.ts'
import { renderMermaidASCII } from '../agent/index.ts'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CORPUS_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')

interface CorpusEntry { family: string; source: string; origin: string; index: number }

function loadCorpus(): CorpusEntry[] {
  return existsSync(CORPUS_PATH) ? JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) : []
}

const EXPECTED_CORPUS_RENDERED = 252
const EXPECTED_CORPUS_ASCII_ERRORS = [
  'architecture:syntax/architecture.md:1',
  'architecture:syntax/architecture.md:2',
  'architecture:syntax/architecture.md:3',
  // Gantt docs entries that error BY DESIGN, deterministically: index 6 is a
  // directive-only fragment (GANTT_EMPTY) and index 10 ends a task with an
  // inline `%% not yet official` comment that even upstream only renders via
  // wall-clock fallback (GANTT_BAD_DATE) — see eval/mermaid-gantt-bench e9.
  'gantt:syntax/gantt.md:10',
  'gantt:syntax/gantt.md:6',
  'timeline:syntax/timeline.md:5',
]

function corpusKey(entry: CorpusEntry): string { return `${entry.family}:${entry.origin}:${entry.index}` }

function asciiOutcome(source: string): { ok: true; hash: string; length: number } | { ok: false; error: string } {
  try {
    const out = renderMermaidASCII(source)
    return { ok: true, hash: createHash('sha256').update(out).digest('hex'), length: out.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const FIXTURES: Array<{ name: string; src: string }> = [
  {
    name: 'fan-out fan-in (parallel edges)',
    src: `graph LR
  A --> B
  A --> C
  A --> D
  B --> E
  C --> E
  D --> E
  A --> E
`,
  },
  {
    name: 'cross-pattern routing (forces tie-break choices)',
    src: `graph TD
  A --> C
  A --> D
  B --> C
  B --> D
`,
  },
  {
    name: 'self-and-bidirectional edges',
    src: `graph LR
  A --> B
  B --> A
  A --> C
  C --> A
`,
  },
]

describe('ASCII full-corpus determinism', () => {
  it('every mermaid-js docs corpus entry has a stable ASCII outcome across repeated runs', () => {
    const corpus = loadCorpus()
    expect(corpus.length).toBeGreaterThan(200)
    const unstable: Array<{ family: string; origin: string; index: number; outcomes: ReturnType<typeof asciiOutcome>[] }> = []
    const errors: string[] = []
    let rendered = 0
    for (const entry of corpus) {
      const outcomes = [asciiOutcome(entry.source), asciiOutcome(entry.source), asciiOutcome(entry.source)]
      if (outcomes.every(o => o.ok)) rendered++
      else errors.push(corpusKey(entry))
      if (new Set(outcomes.map(o => JSON.stringify(o))).size !== 1) {
        unstable.push({ family: entry.family, origin: entry.origin, index: entry.index, outcomes })
      }
    }
    expect(rendered).toBe(EXPECTED_CORPUS_RENDERED)
    expect(errors.sort()).toEqual(EXPECTED_CORPUS_ASCII_ERRORS)
    expect(unstable).toEqual([])
  })
})

describe('ASCII pathfinder determinism', () => {
  for (const fx of FIXTURES) {
    it(`renders ${fx.name} byte-identically across 10 runs`, () => {
      const hashes = new Set<string>()
      for (let i = 0; i < 10; i++) {
        const out = renderMermaidAscii(fx.src, { useAscii: false })
        hashes.add(createHash('sha256').update(out).digest('hex'))
      }
      expect(hashes.size).toBe(1)
    })
  }

  it('ASCII mode also stays deterministic', () => {
    const src = FIXTURES[0]!.src
    const hashes = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const out = renderMermaidAscii(src, { useAscii: true })
      hashes.add(createHash('sha256').update(out).digest('hex'))
    }
    expect(hashes.size).toBe(1)
  })
})
