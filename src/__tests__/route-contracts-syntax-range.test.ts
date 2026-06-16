// ============================================================================
// Syntax-range coverage for the route-contract heuristics (issue #26 audit).
//
// The route-contract pass (classification, certifying straightener, port
// ranking, fan-out spread, fan-in merge, reciprocal pairs) was developed and
// tested almost exclusively against plain `-->` edges declared one per line.
// The parser supports a wider Mermaid edge-syntax range — bidirectional
// arrows, dotted/thick links, circle/cross endpoint markers, `&` multi-edge
// chains, and both edge-label syntaxes — and every one of those reaches
// layoutGraphSync as an ordinary MermaidEdge. These tests pin that the
// heuristics treat the whole supported range uniformly.
//
// Deliberately covered in link-grammar.test.ts instead: `~~~` invisible
// links and length variants (`---->`, `-..->`, `====>`). This file focuses
// on route-contract geometry once parser support has produced edges.
// ============================================================================

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import type { EdgeMarker, EdgeStyle, PositionedEdge } from '../types.ts'

function layoutEdges(source: string): PositionedEdge[] {
  return layoutGraphSync(parseMermaid(source)).edges
}

function findEdge(edges: PositionedEdge[], from: string, to: string): PositionedEdge {
  const e = edges.find(e => e.source === from && e.target === to)
  if (!e) throw new Error(`edge ${from}->${to} not found`)
  return e
}

function isStraight(e: PositionedEdge): boolean {
  if (e.points.length !== 2) return false
  const [a, b] = [e.points[0]!, e.points[1]!]
  return Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01
}

function geometry(source: string): string {
  const positioned = layoutGraphSync(parseMermaid(source))
  return JSON.stringify({
    nodes: positioned.nodes.map(n => [n.id, n.x, n.y, n.width, n.height]),
    edges: positioned.edges.map(e => [e.source, e.target, e.points]),
  })
}

function zeroHardViolations(source: string): void {
  const graph = parseMermaid(source)
  expect(hardViolations(assessLayout(graph, layoutGraphSync(graph)))).toEqual([])
}

const EDGE_VOCABULARY: ReadonlyArray<{
  name: string
  op: string
  style: EdgeStyle
  startMarker?: EdgeMarker
  endMarker?: EdgeMarker
  allowsPipeLabel?: boolean
}> = [
  { name: 'solid arrow', op: '-->', style: 'solid', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'dotted arrow', op: '-.->', style: 'dotted', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'thick arrow', op: '==>', style: 'thick', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'solid bidirectional', op: '<-->', style: 'solid', startMarker: 'arrow', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'dotted bidirectional', op: '<-.->', style: 'dotted', startMarker: 'arrow', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'thick bidirectional', op: '<==>', style: 'thick', startMarker: 'arrow', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'circle endpoint', op: '--o', style: 'solid', endMarker: 'circle' },
  { name: 'cross endpoint', op: '--x', style: 'solid', endMarker: 'cross' },
  { name: 'circle-to-circle marker', op: 'o--o', style: 'solid', startMarker: 'circle', endMarker: 'circle' },
  { name: 'cross-to-cross marker', op: 'x--x', style: 'solid', startMarker: 'cross', endMarker: 'cross' },
]

describe('property: issue #37 edge vocabulary reaches route contracts uniformly', () => {
  it('preserves style/markers and keeps hard route metrics clean across directions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EDGE_VOCABULARY),
        fc.constantFrom('LR', 'TD', 'RL', 'BT'),
        fc.boolean(),
        (form, dir, labeled) => {
          const label = labeled && form.allowsPipeLabel ? '|go|' : ''
          const source = `flowchart ${dir}\n  A[One]\n  B[Two]\n  A ${form.op}${label} B`
          const graph = parseMermaid(source)
          const positioned = layoutGraphSync(graph)
          const edge = positioned.edges[0]!

          expect(edge.style).toBe(form.style)
          expect(edge.startMarker).toBe(form.startMarker)
          expect(edge.endMarker).toBe(form.endMarker)
          expect(edge.hasArrowStart).toBe(form.startMarker !== undefined)
          expect(edge.hasArrowEnd).toBe(form.endMarker !== undefined)
          expect(edge.routeCertificate).toBeDefined()
          expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
        },
      ),
      { numRuns: 80 },
    )
  })
})

describe('syntax range — bidirectional <--> edges through the route contracts', () => {
  it('A <--> B is ONE primary-forward edge (not a reciprocal pair) and straightens port to port', () => {
    const edges = layoutEdges('flowchart LR\n  A[One] <--> B[Two]')
    expect(edges).toHaveLength(1)
    const e = edges[0]!
    expect(e.routeCertificate?.routeClass).toBe('primary-forward')
    expect(isStraight(e)).toBe(true)
    // Both arrowheads survive layout — the renderer needs them.
    expect(e.hasArrowStart).toBe(true)
    expect(e.hasArrowEnd).toBe(true)
  })

  it('a bidirectional edge plus an explicit reverse edge forms a reciprocal pair with the bidi edge as primary', () => {
    // classifyRoutes works on author order regardless of marker syntax:
    // the <--> edge is primary, the explicit B --> A closes the cycle.
    const edges = layoutEdges('flowchart LR\n  A[One] <--> B[Two]\n  B --> A')
    const forward = findEdge(edges, 'A', 'B')
    const back = findEdge(edges, 'B', 'A')
    expect(forward.routeCertificate?.routeClass).toBe('primary-forward')
    expect(back.routeCertificate?.routeClass).toBe('feedback')
    // Two distinct lanes — feedback never shares the forward lane.
    if (isStraight(forward) && isStraight(back)) {
      expect(Math.abs(forward.points[0]!.y - back.points[0]!.y)).toBeGreaterThan(1)
    }
  })

  it('dotted bidirectional <-.-> straightens like solid and keeps its style', () => {
    const edges = layoutEdges('flowchart LR\n  A[One] <-.-> B[Two]')
    const e = edges[0]!
    expect(e.style).toBe('dotted')
    expect(isStraight(e)).toBe(true)
    expect(e.routeCertificate).toBeDefined()
  })

  it('hard rubric metrics stay zero for bidirectional chains in all four directions', () => {
    for (const dir of ['LR', 'TD', 'RL', 'BT'] as const) {
      zeroHardViolations(`flowchart ${dir}\n  A[One] <--> B[Two] <--> C[Three]`)
    }
  })
})

describe('syntax range — dotted and thick links through the straightener', () => {
  it.each([
    ['dotted', '-.->'],
    ['thick', '==>'],
  ] as const)('a %s chain straightens every edge to a two-point lane and keeps its style', (style, op) => {
    const edges = layoutEdges(`flowchart LR\n  A[One] ${op} B[Two] ${op} C[Three]`)
    expect(edges).toHaveLength(2)
    for (const e of edges) {
      expect(e.style).toBe(style)
      expect(isStraight(e)).toBe(true)
      expect(e.routeCertificate?.routeClass).toBe('primary-forward')
    }
  })

  it('a dotted labeled feedback edge still routes as feedback (style does not change classification)', () => {
    const edges = layoutEdges('flowchart LR\n  A[Request] --> B{Valid?}\n  B -. retry .-> A\n  B --> C[Process]')
    const back = findEdge(edges, 'B', 'A')
    expect(back.style).toBe('dotted')
    expect(back.routeCertificate?.routeClass).toBe('feedback')
    const forward = findEdge(edges, 'A', 'B')
    expect(isStraight(forward)).toBe(true)
  })

  it('hard rubric metrics stay zero for mixed-style diagrams', () => {
    zeroHardViolations('flowchart TD\n  A[Start] --> B{Check}\n  B -.->|maybe| C[Soft path]\n  B ==>|sure| D[Hard path]')
  })
})

describe('syntax range — circle/cross endpoint markers are decoration, not routing intent', () => {
  it('o--o and x--x edges straighten and certify exactly like solid arrows', () => {
    const edges = layoutEdges('flowchart LR\n  A[One] o--o B[Two]\n  C[Three] x--x D[Four]')
    for (const e of edges) {
      expect(isStraight(e)).toBe(true)
      expect(e.routeCertificate?.routeClass).toBe('primary-forward')
    }
    expect(findEdge(edges, 'A', 'B').startMarker).toBe('circle')
    expect(findEdge(edges, 'C', 'D').endMarker).toBe('cross')
  })
})

describe('syntax range — & multi-edge chains hit the same fan heuristics', () => {
  it('A --> B & C lays out byte-identically to the expanded two-line fan-out', () => {
    expect(geometry('flowchart LR\n  A --> B & C'))
      .toBe(geometry('flowchart LR\n  A --> B\n  A --> C'))
  })

  it('a &-declared fan-in merges at the shared entry port like the expanded form', () => {
    const compact = layoutEdges('flowchart LR\n  A[One] & B[Two] --> T[Hub]')
    const expanded = layoutEdges('flowchart LR\n  A[One] --> T[Hub]\n  B[Two] --> T')
    for (const edges of [compact, expanded]) {
      const lastA = findEdge(edges, 'A', 'T').points.at(-1)!
      const lastB = findEdge(edges, 'B', 'T').points.at(-1)!
      expect(Math.abs(lastA.x - lastB.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(lastA.y - lastB.y)).toBeLessThanOrEqual(0.5)
    }
  })

  it('an unlabeled &-declared diamond fan-out uses equivalent facet-symmetric branch routes', () => {
    // Compact `&` fan-outs are semantically equivalent to expanded fan-outs,
    // so the same diamond facet-spread floor applies: no branch hogs the E
    // vertex and the two emitted lines are mirror peers.
    const edges = layoutEdges('flowchart LR\n  Q{Decide} --> P[One] & R[Two]')
    const qp = findEdge(edges, 'Q', 'P')
    const qr = findEdge(edges, 'Q', 'R')
    expect(qp.routeCertificate?.invariant).toBe('bundle')
    expect(qr.routeCertificate?.invariant).toBe('bundle')
    expect(qp.routeCertificate?.sourcePort).toBe('NE')
    expect(qr.routeCertificate?.sourcePort).toBe('SE')
    expect(qp.points[0]!.x).toBeCloseTo(qr.points[0]!.x, 3)
    expect(qp.points[0]!.y).toBeLessThan(qr.points[0]!.y)
    zeroHardViolations('flowchart LR\n  Q{Decide} --> P[One] & R[Two]')
  })

  it('hard rubric metrics stay zero for a 3-target & fan-out in all directions', () => {
    for (const dir of ['LR', 'TD', 'RL', 'BT'] as const) {
      zeroHardViolations(`flowchart ${dir}\n  A --> B & C & D`)
    }
  })
})

describe('syntax range — both edge-label syntaxes are one semantics', () => {
  it('-->|go| and -- go --> produce byte-identical layouts', () => {
    expect(geometry('flowchart LR\n  A -->|go| B\n  B --> C'))
      .toBe(geometry('flowchart LR\n  A -- go --> B\n  B --> C'))
  })

  it('labeled feedback via -. text .-> routes through the outer channel like -- text -->', () => {
    const dotted = layoutEdges('flowchart LR\n  A[Req] --> B{OK?}\n  B -. no .-> A\n  B --> C[Done]')
    const solid = layoutEdges('flowchart LR\n  A[Req] --> B{OK?}\n  B -- no --> A\n  B --> C[Done]')
    expect(findEdge(dotted, 'B', 'A').routeCertificate?.invariant)
      .toBe(findEdge(solid, 'B', 'A').routeCertificate?.invariant)
  })
})
