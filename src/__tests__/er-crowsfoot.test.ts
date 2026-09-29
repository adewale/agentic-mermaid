/**
 * Crow's-foot glyph correction (bundled in plan §ER 6).
 *
 * Upstream reference (mermaid erMarkers.js, verified 2026-07):
 *   ONLY_ONE      = two ticks
 *   ZERO_OR_ONE   = one tick + circle
 *   ONE_OR_MORE   = crow's foot (3 fan lines) + one tick
 *   ZERO_OR_MORE  = crow's foot + circle (no tick)
 *
 * The shipped renderer drew ZERO_OR_ONE with TWO ticks (indistinguishable
 * from "exactly one" plus a circle) and ONE_OR_MORE with no tick
 * (indistinguishable from a bare "many"). These invariants judge the
 * regenerated goldens (P5): each cardinality's marker is asserted by its
 * exact primitive counts in the scene geometry; the four expected signatures
 * (2L0C, 1L1C, 4L0C, 3L1C) are pairwise distinct by construction.
 */
import { describe, it, expect } from 'bun:test'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { lowerErScene } from '../er/renderer.ts'
import { toMermaidLines } from '../mermaid-source.ts'

/** Lower `A <glyphs> B : x` and return the marker geometry at entity1's end. */
function markerFor(glyphs: string): { lines: number; circles: number; category: string } {
  const lines = toMermaidLines(`erDiagram\nA ${glyphs} B : x`)
  const scene = lowerErScene({
    positioned: layoutErDiagram(parseErDiagram(lines)),
    colors: { bg: '#ffffff', fg: '#27272A' },
    resolved: { renderOptions: {} },
  })
  const mark = scene.parts.find(p => p.kind === 'shape' && p.role === 'cardinality' && p.id.endsWith(':1'))
  if (!mark || mark.kind !== 'shape' || mark.geometry.kind !== 'compound') throw new Error('marker not found')
  const kinds = mark.geometry.children.map(g => g.kind)
  return {
    lines: kinds.filter(k => k === 'line').length,
    circles: kinds.filter(k => k === 'circle').length,
    category: String(mark.channels?.category),
  }
}

describe('crow\'s-foot marker vocabulary (upstream reference)', () => {
  it('|| (exactly one) draws two ticks, no circle', () => {
    expect(markerFor('||--|| ')).toEqual({ lines: 2, circles: 0, category: 'one' })
  })

  it('|o (zero or one) draws exactly one tick + one circle', () => {
    expect(markerFor('|o--o|')).toEqual({ lines: 1, circles: 1, category: 'zero-one' })
  })

  it('}| (one or more) draws the crow\'s foot + one tick', () => {
    expect(markerFor('}|--|{')).toEqual({ lines: 4, circles: 0, category: 'many' })
  })

  it('}o (zero or more) draws the crow\'s foot + circle, no tick', () => {
    expect(markerFor('}o--o{')).toEqual({ lines: 3, circles: 1, category: 'zero-many' })
  })
})
