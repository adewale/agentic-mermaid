// Fast, direct unit tests for the faithfulness counter (src/agent/structural-count.ts).
//
// These exercise every branch of countStructuralElements without going through
// layout, so they run in well under a second — which is what lets the
// stryker.incremental.config.json lane mutate this module and gate per-PR
// (Move 7). Each family asserts the exact {nodes, edges, groups} for a known
// source, pinning the projection a mutant would have to change.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/index.ts'
import { countStructuralElements, countsEqual, faithfulnessWarning, type StructuralCount } from '../agent/structural-count.ts'
import { FAMILY_COUNT_FIXTURES } from './helpers/family-count-fixtures.ts'

function count(src: string): StructuralCount {
  const p = parseMermaid(src)
  expect(p.ok).toBe(true)
  if (!p.ok) throw new Error('parse')
  const c = countStructuralElements(p.value)
  expect(c).not.toBeNull()
  return c!
}

describe('countStructuralElements — exact projection per family', () => {
  for (const { family, source, count: expected } of FAMILY_COUNT_FIXTURES) {
    test(`${family} ${JSON.stringify(expected)} — ${source.split('\n')[0]}`, () => {
      expect(count(source)).toEqual(expected)
    })
  }

  test('composite state counts nested states + transitions recursively', () => {
    const c = count('stateDiagram-v2\n  [*]-->Outer\n  state Outer {\n    a-->b\n  }')
    // Outer + a + b states; the Outer→ nested a→b transition plus the top [*]→Outer.
    expect(c.nodes).toBeGreaterThanOrEqual(3)
    expect(c.edges).toBeGreaterThanOrEqual(2)
  })

  test('opaque bodies return null (no fabricated count)', () => {
    const p = parseMermaid('xychart-beta\n  title "Has a title ⇒ opaque"\n  bar [1,2]')
    expect(p.ok).toBe(true)
    if (p.ok) expect(countStructuralElements(p.value)).toBeNull()
  })

  test('countsEqual compares all three axes', () => {
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 1, edges: 2, groups: 3 })).toBe(true)
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 9, edges: 2, groups: 3 })).toBe(false)
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 1, edges: 9, groups: 3 })).toBe(false)
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 1, edges: 2, groups: 9 })).toBe(false)
  })
})

// Move 3: the pure faithfulness verdict (the logic of the
// CONTENT_DROPPED_ON_ROUNDTRIP lint, now in the mutation-gated counter module).
describe('faithfulnessWarning — the round-trip drop verdict', () => {
  const C = (n: number, e: number, g: number): StructuralCount => ({ nodes: n, edges: e, groups: g })

  test('opaque before (null) ⇒ no warning', () => {
    expect(faithfulnessWarning(null, C(1, 1, 0))).toEqual([])
    expect(faithfulnessWarning(null, null)).toEqual([])
  })

  test('equal counts ⇒ no warning', () => {
    expect(faithfulnessWarning(C(3, 2, 1), C(3, 2, 1))).toEqual([])
  })

  test('null after (re-parse failed) ⇒ total-loss warning with zeroed after', () => {
    const w = faithfulnessWarning(C(3, 2, 1), null)
    expect(w).toHaveLength(1)
    expect(w[0]!.code).toBe('CONTENT_DROPPED_ON_ROUNDTRIP')
    expect((w[0] as { after: StructuralCount }).after).toEqual({ nodes: 0, edges: 0, groups: 0 })
  })

  test('a drop on ANY axis ⇒ CONTENT_DROPPED_ON_ROUNDTRIP carrying before + after', () => {
    for (const after of [C(2, 2, 1), C(3, 1, 1), C(3, 2, 0), C(4, 2, 1)]) {
      const w = faithfulnessWarning(C(3, 2, 1), after)
      expect(w).toHaveLength(1)
      expect(w[0]!.code).toBe('CONTENT_DROPPED_ON_ROUNDTRIP')
      expect((w[0] as { before: StructuralCount; after: StructuralCount })).toMatchObject({ before: { nodes: 3, edges: 2, groups: 1 }, after })
    }
  })
})
