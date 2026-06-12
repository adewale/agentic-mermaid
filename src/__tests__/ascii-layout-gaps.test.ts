// ASCII layout coverage for known gaps surfaced by the deep audit:
//   1. nested subgraph containers (subgraph inside subgraph)
//   2. multi-level direction overrides (outer TD, inner LR, boundary-crossing edges)
//   3. unlabeled fan-out trunk junction sharing
//
// Invariant-level assertions (structure present, exact counts, relative
// positions) in the style of ascii-subgraph-edge.test.ts — no golden strings,
// so layout tweaks that preserve the invariants don't churn this file.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../index.ts'

/** Count non-overlapping occurrences of a substring. */
function count(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

/** Index of the first row (line) containing a substring, or -1. */
function rowOf(out: string, needle: string): number {
  return out.split('\n').findIndex(l => l.includes(needle))
}

/** Count rows whose text contains every glyph in `needle` (used for nested borders). */
function countCharOccurrences(out: string, ch: string): number {
  return out.split('').filter(c => c === ch).length
}

describe('ASCII gap: nested subgraph containers', () => {
  const NESTED = `flowchart TD
  subgraph Outer
    subgraph Inner
      A --> B
    end
    B --> C
  end
  C --> D
`

  test('inner container nests inside the outer container', () => {
    const out = renderMermaidASCII(NESTED)
    const lines = out.split('\n')

    // Both titles render exactly once each.
    expect(count(out, 'Outer')).toBe(1)
    expect(count(out, 'Inner')).toBe(1)

    // The Inner title row is strictly between the Outer top border and the
    // first inner node — i.e. Inner is drawn inside Outer.
    const outerRow = rowOf(out, 'Outer')
    const innerRow = rowOf(out, 'Inner')
    expect(innerRow).toBeGreaterThan(outerRow)
    expect(rowOf(out, 'A')).toBeGreaterThan(innerRow)

    // The Inner box's TOP border row (┌───┐) sits one row above its title and
    // must itself be flanked by the Outer container's vertical borders — proof
    // the inner container is wrapped by the outer one.
    const innerBorderRow = lines[innerRow - 1]!
    const innerCorner = innerBorderRow.indexOf('┌')
    expect(innerCorner).toBeGreaterThan(0)
    // An Outer '│' border precedes the inner corner, and another follows the
    // closing inner corner.
    const outerLeft = innerBorderRow.lastIndexOf('│', innerCorner)
    expect(outerLeft).toBeGreaterThanOrEqual(0)
    expect(outerLeft).toBeLessThan(innerCorner)
    const innerCloseCorner = innerBorderRow.indexOf('┐', innerCorner)
    expect(innerCloseCorner).toBeGreaterThan(innerCorner)
    expect(innerBorderRow.indexOf('│', innerCloseCorner)).toBeGreaterThan(innerCloseCorner)
  })

  test('inner nodes sit inside BOTH borders; node count is exact', () => {
    const out = renderMermaidASCII(NESTED)
    const lines = out.split('\n')

    // The count of '│' left of a node's center = (container borders it sits
    // inside) + 1 (the node's own left box wall). Nesting depth therefore shows
    // up as a strict ordering: A (Inner⊂Outer) > C (Outer only) > D (outside).
    const barsLeftOf = (label: string): number => {
      const row = lines[rowOf(out, label)]!
      const col = row.indexOf(label)
      return row.slice(0, col).split('').filter(c => c === '│').length
    }

    // A is inside Inner which is inside Outer: 2 container bars + own wall = 3.
    expect(barsLeftOf(' A ')).toBe(3)

    // C is inside Outer but OUTSIDE Inner (declared after the inner `end`):
    // 1 container bar + own wall = 2.
    expect(barsLeftOf(' C ')).toBe(2)

    // D is fully outside both containers: just its own wall = 1.
    expect(barsLeftOf(' D ')).toBe(1)

    // The strict nesting ordering must hold (the load-bearing invariant).
    expect(barsLeftOf(' A ')).toBeGreaterThan(barsLeftOf(' C '))
    expect(barsLeftOf(' C ')).toBeGreaterThan(barsLeftOf(' D '))

    // D still renders exactly once as its own node.
    expect(count(out, ' D ')).toBe(1)
  })
})

describe('ASCII gap: multi-level direction override', () => {
  const MIXED = `flowchart TD
  Start --> G1
  subgraph G1
    direction LR
    X --> Y --> Z
  end
  G1 --> End
`

  test('outer flow is vertical, inner chain is horizontal', () => {
    const out = renderMermaidASCII(MIXED)

    // Outer TD: Start above the container, End below it.
    expect(rowOf(out, 'Start')).toBeLessThan(rowOf(out, 'G1'))
    expect(rowOf(out, 'End')).toBeGreaterThan(rowOf(out, 'G1'))

    // Inner LR: X, Y, Z all share one row (laid out left-to-right).
    const xRow = rowOf(out, ' X ')
    expect(rowOf(out, ' Y ')).toBe(xRow)
    expect(rowOf(out, ' Z ')).toBe(xRow)

    // And in left-to-right column order on that row.
    const line = out.split('\n')[xRow]!
    expect(line.indexOf(' X ')).toBeLessThan(line.indexOf(' Y '))
    expect(line.indexOf(' Y ')).toBeLessThan(line.indexOf(' Z '))
  })

  test('inner LR edges render with horizontal arrowheads, boundary edges vertical', () => {
    const out = renderMermaidASCII(MIXED)
    const xRow = out.split('\n')[rowOf(out, ' X ')]!

    // The inner X->Y->Z chain uses right-pointing arrowheads on its own row.
    expect(count(xRow, '►')).toBeGreaterThanOrEqual(2)
    // The inner row carries no vertical (Down) arrowheads — those belong to the
    // outer TD boundary edges, on different rows.
    expect(xRow).not.toContain('▼')

    // The boundary edges (Start->G1 and G1->End) cross vertically: a Down
    // arrowhead enters the container top and another leaves toward End.
    expect(count(out, '▼')).toBeGreaterThanOrEqual(2)

    // Every node appears exactly once (no phantom container box for G1).
    for (const n of ['Start', 'End', ' X ', ' Y ', ' Z ']) {
      expect(count(out, n)).toBe(1)
    }
    expect(count(out, 'G1')).toBe(1)
  })
})

describe('ASCII gap: unlabeled fan-out trunk junction sharing', () => {
  const FANOUT = `flowchart TD
  A --> B
  A --> C
  A --> D
`

  test('siblings share one trunk: arrowhead on every target, no diagonal glyphs', () => {
    const out = renderMermaidASCII(FANOUT)

    // One source, three targets, all on the same row below the trunk.
    const bRow = rowOf(out, ' B ')
    expect(rowOf(out, ' C ')).toBe(bRow)
    expect(rowOf(out, ' D ')).toBe(bRow)

    // Exactly three Down arrowheads — one entering each target.
    expect(count(out, '▼')).toBe(3)

    // No diagonal corner/arrow glyphs leak in for a clean vertical fan-out.
    for (const stray of ['◢', '◣', '◥', '◤']) {
      expect(out).not.toContain(stray)
    }
    // And no horizontal arrowheads (the whole fan-out is vertical in TD).
    expect(out).not.toContain('►')
    expect(out).not.toContain('◄')
  })

  test('the shared trunk uses a single branch row with proper T/├ junctions', () => {
    const out = renderMermaidASCII(FANOUT)
    const lines = out.split('\n')

    // Find the branch row: the one carrying the trunk split. In Unicode mode the
    // split row holds a left-tee/cross plus a top-tee, never bare '+'.
    const branchRow = lines.find(l => l.includes('├') && l.includes('┬'))
    expect(branchRow).toBeDefined()

    // The three drop columns under B, C, D align with the targets' centers.
    const bCol = lines[rowOf(out, ' B ')]!.indexOf('B')
    const dCol = lines[rowOf(out, ' D ')]!.indexOf('D')
    expect(branchRow!.length).toBeGreaterThanOrEqual(dCol)
    // Branch row spans from B's column to D's column (the full fan width).
    const firstJunction = branchRow!.search(/[├┬┼]/)
    const lastJunction = branchRow!.length - 1 - [...branchRow!].reverse().findIndex(c => '┐┬┼'.includes(c))
    expect(firstJunction).toBeLessThanOrEqual(bCol)
    expect(lastJunction).toBeGreaterThanOrEqual(dCol - 2)

    // No ASCII '+' corner leaks into Unicode output.
    expect(countCharOccurrences(out, '+')).toBe(0)
  })
})
