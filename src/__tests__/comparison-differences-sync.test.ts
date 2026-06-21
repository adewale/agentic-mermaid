// Drift guard for the diagram-family coverage facts.
//
// docs/comparison.md and scripts/site/differences.ts both describe how many
// diagram families this fork renders and which ones it adds on top of Beautiful
// Mermaid. differences.ts names comparison.md as its "Content source of truth"
// in a comment but does NOT read it at build time — it re-states the facts in
// hand-authored HTML, so the two can silently drift (and the published
// /differences page would then disagree with the doc).
//
// This test pins both surfaces to the runtime family registry
// (BUILTIN_FAMILY_METADATA), the single source of truth. Adding or removing a
// renderable family now fails CI unless docs/comparison.md AND
// scripts/site/differences.ts are both updated to match.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

const REPO = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8')
const asSet = (xs: string[]) => [...xs].map(s => s.trim().toLowerCase()).sort()

// Families upstream Beautiful Mermaid already renders. A stable external fact;
// the fork-"added" families are everything in the registry beyond these.
const UPSTREAM_BASE = ['flowchart', 'state', 'sequence', 'class', 'er', 'xychart']

const registryIds = BUILTIN_FAMILY_METADATA.map(f => String(f.id))
const forkAdded = registryIds.filter(id => !UPSTREAM_BASE.includes(id))
const total = registryIds.length

describe('comparison.md ↔ differences.ts ↔ family registry sync', () => {
  test('UPSTREAM_BASE cleanly partitions the registry (guards this test premise)', () => {
    for (const id of UPSTREAM_BASE) expect(registryIds).toContain(id)
    expect(asSet([...UPSTREAM_BASE, ...forkAdded])).toEqual(asSet(registryIds))
  })

  test('docs/comparison.md count and fork-added list track the registry', () => {
    const md = read('docs/comparison.md')
    expect(md).toContain(`${total} diagram families`)
    expect(md).toContain(`beyond the ${total} here`)
    const cellList = md.match(/those \d+ \+ ([^)|]+)\)/)?.[1]
    if (cellList === undefined) throw new Error('comparison.md "Diagram types" cell missing the "those N + ..." list')
    expect(asSet(cellList.split(','))).toEqual(asSet(forkAdded))
  })

  test('scripts/site/differences.ts NEW_TYPES tracks the registry fork-added families', () => {
    const ts = read('scripts/site/differences.ts')
    const start = ts.indexOf('const NEW_TYPES')
    if (start < 0) throw new Error('differences.ts NEW_TYPES array not found')
    // NEW_TYPES closes with a "]" at column 0; the architecture entry's inline
    // "[...]" is mid-line, so the first "\n]" is the array's real terminator.
    const block = ts.slice(start, ts.indexOf('\n]', start))
    const ids = [...block.matchAll(/\bid:\s*'([a-z][a-z-]*)'/g)]
      .map(m => m[1])
      .filter((id): id is string => id !== undefined)
    expect(asSet(ids)).toEqual(asSet(forkAdded))
  })

  test('scripts/site/differences.ts states the total family count in prose', () => {
    const ts = read('scripts/site/differences.ts').toLowerCase()
    const WORDS: Record<number, string> = {
      10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen',
    }
    const word = WORDS[total]
    if (!word) throw new Error(`add the number-word for ${total} to WORDS in this test`)
    expect(ts).toContain(`outside the ${word} here`)
  })
})
