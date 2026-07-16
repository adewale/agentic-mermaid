// Fan-in grouping in the ASCII grid layout (upstream lukilabs#68 / PR #69).
//
// Roots feeding the same target sit contiguously, and a fan-in target aligns
// under its own root group, so trunk rows of different fan-in groups do not
// collide into ambiguous ┼ crossings. Round-trips (A ⇄ B toggles) are
// excluded from the heuristic — they are cycles, not joins.

import { describe, test, expect } from 'bun:test'
import { convertToAsciiGraph } from '../ascii/converter.ts'
import { analyzeEdgeBundles } from '../ascii/edge-bundling.ts'
import type { AsciiConfig } from '../ascii/types.ts'
import { renderMermaidASCII } from '../index.ts'
import { parseMermaid } from '../parser.ts'

const CONFIG: AsciiConfig = {
  useAscii: false,
  paddingX: 5,
  paddingY: 5,
  boxBorderPadding: 1,
  graphDirection: 'TD',
}

function fanInGraph() {
  return convertToAsciiGraph(parseMermaid('graph TD\n  A --> C\n  B --> C'), CONFIG)
}

function columnOf(out: string, label: string): number {
  for (const line of out.split('\n')) {
    const i = line.indexOf(label)
    if (i >= 0) return i
  }
  throw new Error(`label ${label} not found`)
}

describe('ASCII fan-in grouping', () => {
  test('two fan-in groups get separate trunks with no ambiguous crossing (upstream #68 repro)', () => {
    const out = renderMermaidASCII(`graph TD
    A1 --> A
    A2 --> A
    B1 --> B
    B2 --> B
    A --> C
    B --> C`)
    expect(out).not.toContain('┼')
    // Each target sits under its own group: A under A1/A2, B under B1/B2.
    expect(columnOf(out, 'A ')).toBeLessThan(columnOf(out, 'B '))
    expect(columnOf(out, 'B ')).toBeGreaterThanOrEqual(columnOf(out, 'B1') - 2)
  })

  test('interleaved root declarations still group by target', () => {
    const out = renderMermaidASCII(`graph TD
    A1 --> A
    B1 --> B
    A2 --> A
    B2 --> B`)
    // Roots regrouped: both A-feeders left of both B-feeders.
    expect(Math.max(columnOf(out, 'A1'), columnOf(out, 'A2')))
      .toBeLessThan(Math.min(columnOf(out, 'B1'), columnOf(out, 'B2')))
    expect(out).not.toContain('┼')
  })

  test('bundle admission retains primary and legacy joins while rejecting feedback topology', () => {
    const primary = fanInGraph()
    expect(primary.edges.map(edge => edge.routeClass)).toEqual(['primary-forward', 'primary-forward'])
    expect(analyzeEdgeBundles(primary)).toHaveLength(1)

    const legacy = fanInGraph()
    for (const edge of legacy.edges) delete edge.routeClass
    expect(analyzeEdgeBundles(legacy)).toHaveLength(1)

    const feedback = fanInGraph()
    feedback.edges[0]!.routeClass = 'feedback'
    expect(analyzeEdgeBundles(feedback)).toEqual([])
  })

  test('a 2-cycle toggle pair is not treated as fan-in (state-machine guard)', () => {
    // T1's in-degree counts S1 and the back-edge from itself via T1 ⇄ S1;
    // only the forward edge may count, so T1 stays in S1's column instead of
    // being dragged sideways.
    const out = renderMermaidASCII(`graph TD
    S1 --> T1
    T1 --> S1`)
    expect(Math.abs(columnOf(out, 'S1') - columnOf(out, 'T1'))).toBeLessThanOrEqual(1)
  })
})
