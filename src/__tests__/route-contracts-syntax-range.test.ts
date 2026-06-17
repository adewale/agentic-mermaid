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
import { labelRect, shapePorts } from '../route-contracts.ts'
import { ARROW_HEAD, resolveRenderStyle } from '../styles.ts'
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

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 0,
): boolean {
  return a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
}

function readableLabelGap(style: { edgeLabelFontSize: number }): number {
  return Math.max(8, style.edgeLabelFontSize * 0.75)
}

function terminalMarkerGap(style: { edgeLabelFontSize: number; lineWidth?: number }, edge: PositionedEdge): number {
  const lineWidth = style.lineWidth ?? 1
  const strokeWidth = edge.style === 'thick' ? lineWidth * 2 : lineWidth
  return Math.max(18, style.edgeLabelFontSize + ARROW_HEAD.width + strokeWidth * 2)
}

function labelHalfExtentAlongSegment(
  box: { w: number; h: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? box.w / 2 : box.h / 2
}

function expectLabelClearsTerminalMarkers(
  edge: PositionedEdge,
  box: { x: number; y: number; w: number; h: number },
  style: { edgeLabelFontSize: number; lineWidth?: number },
): void {
  const clearance = terminalMarkerGap(style, edge)
  const label = edge.labelPosition!
  if (edge.hasArrowStart && edge.points.length >= 2 && distanceToPolyline(label, edge.points.slice(0, 2)) <= 0.001) {
    const start = edge.points[0]!
    const halfExtent = labelHalfExtentAlongSegment(box, start, edge.points[1]!)
    expect(Math.hypot(label.x - start.x, label.y - start.y)).toBeGreaterThanOrEqual(halfExtent + clearance - 0.001)
  }
  if (edge.hasArrowEnd && edge.points.length >= 2 && distanceToPolyline(label, edge.points.slice(-2)) <= 0.001) {
    const end = edge.points[edge.points.length - 1]!
    const halfExtent = labelHalfExtentAlongSegment(box, edge.points[edge.points.length - 2]!, end)
    expect(Math.hypot(label.x - end.x, label.y - end.y)).toBeGreaterThanOrEqual(halfExtent + clearance - 0.001)
  }
}

function pointToSegmentDistance(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y)

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(point.x - projX, point.y - projY)
}

function distanceToPolyline(point: { x: number; y: number }, points: Array<{ x: number; y: number }>): number {
  let minDistance = Infinity
  for (let i = 1; i < points.length; i++) {
    minDistance = Math.min(minDistance, pointToSegmentDistance(point, points[i - 1]!, points[i]!))
  }
  return minDistance
}

function bestLabelSegment(edge: PositionedEdge): { index: number; a: { x: number; y: number }; b: { x: number; y: number } } {
  let best = { index: 1, distance: Infinity }
  for (let i = 1; i < edge.points.length; i++) {
    const distance = pointToSegmentDistance(edge.labelPosition!, edge.points[i - 1]!, edge.points[i]!)
    if (distance < best.distance) best = { index: i, distance }
  }
  expect(best.distance).toBeLessThanOrEqual(0.001)
  return { index: best.index, a: edge.points[best.index - 1]!, b: edge.points[best.index]! }
}

function expectLabelUsesStraightRunPorts(
  edge: PositionedEdge,
  box: { x: number; y: number; w: number; h: number },
  direction: 'TD' | 'BT' | 'LR' | 'RL',
): void {
  const { a, b } = bestLabelSegment(edge)
  const verticalFlow = direction === 'TD' || direction === 'BT'
  const epsilon = 0.001
  if (verticalFlow) {
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(epsilon)
    expect(edge.labelPosition!.x).toBeGreaterThanOrEqual(box.x - epsilon)
    expect(edge.labelPosition!.x).toBeLessThanOrEqual(box.x + box.w + epsilon)
    expect(box.y).toBeGreaterThanOrEqual(Math.min(a.y, b.y) - epsilon)
    expect(box.y + box.h).toBeLessThanOrEqual(Math.max(a.y, b.y) + epsilon)
  } else {
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(epsilon)
    expect(edge.labelPosition!.y).toBeGreaterThanOrEqual(box.y - epsilon)
    expect(edge.labelPosition!.y).toBeLessThanOrEqual(box.y + box.h + epsilon)
    expect(box.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x) - epsilon)
    expect(box.x + box.w).toBeLessThanOrEqual(Math.max(a.x, b.x) + epsilon)
  }
}

function stableProductLoopGeometry(positioned: ReturnType<typeof layoutGraphSync>) {
  const round = (n: number) => Math.round(n * 1000) / 1000
  return {
    nodes: positioned.nodes.map(n => ({
      id: n.id,
      x: round(n.x),
      y: round(n.y),
      width: round(n.width),
      height: round(n.height),
      shape: n.shape,
    })),
    edges: positioned.edges.map(e => ({
      source: e.source,
      target: e.target,
      label: e.label,
      points: e.points.map(p => ({ x: round(p.x), y: round(p.y) })),
      routeCertificate: e.routeCertificate
        ? {
            routeClass: e.routeCertificate.routeClass,
            bendCount: e.routeCertificate.bendCount,
            sourcePort: e.routeCertificate.sourcePort,
            targetPort: e.routeCertificate.targetPort,
            invariant: e.routeCertificate.invariant,
          }
        : undefined,
    })),
  }
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

  it('a styled TD decision fan-out keeps branch labels clear of the diamond tip', () => {
    // Characterization from issue #42 plus the editor regression reported
    // while tackling #38: the branch spread is good (SW/SE bundle anchors),
    // but the label pill must not ride up into the decision diamond.
    const source = `flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end`
    const options = {
      style: {
        text: { fontSize: 13, letterSpacing: 0.1 },
        node: { fontSize: 15, fontWeight: 600, letterSpacing: -0.1, paddingX: 22, paddingY: 14, cornerRadius: 16, lineWidth: 1.5 },
        edge: { fontSize: 12, fontWeight: 600, letterSpacing: 0.1, lineWidth: 2.25, bendRadius: 12 },
        group: { fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' as const, padding: 24, paddingY: 18, cornerRadius: 18, borderColor: '#f97316', lineWidth: 1.5 },
      },
    }
    const positioned = layoutGraphSync(parseMermaid(source), options)
    const style = resolveRenderStyle(options)
    const decision = positioned.nodes.find(n => n.id === 'B')!
    const decisionSouth = shapePorts(decision).S.y
    const yes = findEdge(positioned.edges, 'B', 'C')
    const needsWork = findEdge(positioned.edges, 'B', 'D')
    const yesLabel = labelRect(yes, style)!
    const needsWorkLabel = labelRect(needsWork, style)!

    expect(findEdge(positioned.edges, 'A', 'B').routeCertificate?.sourcePort).toBe('S')
    expect(findEdge(positioned.edges, 'A', 'B').routeCertificate?.targetPort).toBe('N')
    expect(yes.routeCertificate?.invariant).toBe('bundle')
    expect(needsWork.routeCertificate?.invariant).toBe('bundle')
    expect(yes.routeCertificate?.sourcePort).toBe('SW')
    expect(needsWork.routeCertificate?.sourcePort).toBe('SE')
    expect(distanceToPolyline(yes.labelPosition!, yes.points)).toBeLessThanOrEqual(0.001)
    expect(distanceToPolyline(needsWork.labelPosition!, needsWork.points)).toBeLessThanOrEqual(0.001)
    expectLabelUsesStraightRunPorts(yes, yesLabel, 'TD')
    expectLabelUsesStraightRunPorts(needsWork, needsWorkLabel, 'TD')
    expect(yes.labelPosition!.y).toBeCloseTo(needsWork.labelPosition!.y, 3)
    expect(rectsOverlap(yesLabel, needsWorkLabel, readableLabelGap(style))).toBe(false)
    expectLabelClearsTerminalMarkers(yes, yesLabel, style)
    expectLabelClearsTerminalMarkers(needsWork, needsWorkLabel, style)
    expect(yesLabel.y).toBeGreaterThanOrEqual(decisionSouth + 2)
    expect(needsWorkLabel.y).toBeGreaterThanOrEqual(decisionSouth + 2)
    expect(stableProductLoopGeometry(positioned)).toEqual({
      nodes: [
        { id: 'A', x: 70.625, y: 86, width: 162.35, height: 47.5, shape: 'rectangle' },
        { id: 'B', x: 88.775, y: 181.5, width: 126.05, height: 126.05, shape: 'diamond' },
        { id: 'C', x: 46.55, y: 425.15, width: 91.25, height: 47.5, shape: 'rectangle' },
        { id: 'D', x: 165.8, y: 425.15, width: 91.25, height: 47.5, shape: 'rectangle' },
      ],
      edges: [
        {
          source: 'A',
          target: 'B',
          label: undefined,
          points: [{ x: 151.8, y: 133.5 }, { x: 151.8, y: 181.5 }],
          routeCertificate: { routeClass: 'primary-forward', bendCount: 0, sourcePort: 'S', targetPort: 'N', invariant: 'straight' },
        },
        {
          source: 'B',
          target: 'C',
          label: 'yes',
          points: [{ x: 120.288, y: 276.038 }, { x: 120.288, y: 366.35 }, { x: 92.175, y: 366.35 }, { x: 92.175, y: 425.15 }],
          routeCertificate: { routeClass: 'primary-forward', bendCount: 2, sourcePort: 'SW', targetPort: 'N', invariant: 'bundle' },
        },
        {
          source: 'B',
          target: 'D',
          label: 'needs work',
          points: [{ x: 183.313, y: 276.038 }, { x: 183.313, y: 366.35 }, { x: 211.425, y: 366.35 }, { x: 211.425, y: 425.15 }],
          routeCertificate: { routeClass: 'primary-forward', bendCount: 2, sourcePort: 'SE', targetPort: 'N', invariant: 'bundle' },
        },
      ],
    })
    zeroHardViolations(source)
  })

  it('a three-way decision fan-out allocates sibling labels with readable gaps', () => {
    const source = `flowchart TD
  Q{Choose}
  Q -->|alpha| A[Alpha]
  Q -->|beta path| B[Beta]
  Q -.->|gamma| C[Gamma]`
    const positioned = layoutGraphSync(parseMermaid(source))
    const style = resolveRenderStyle({})
    const branchEdges = positioned.edges.filter(e => e.source === 'Q')
    const labelRects = branchEdges.map(edge => {
      expect(edge.routeCertificate?.invariant).toBe('bundle')
      expect(distanceToPolyline(edge.labelPosition!, edge.points)).toBeLessThanOrEqual(0.001)
      const rect = labelRect(edge, style)!
      expectLabelUsesStraightRunPorts(edge, rect, 'TD')
      expectLabelClearsTerminalMarkers(edge, rect, style)
      return rect
    })

    for (let i = 0; i < labelRects.length; i++) {
      for (let j = i + 1; j < labelRects.length; j++) {
        expect(rectsOverlap(labelRects[i]!, labelRects[j]!, readableLabelGap(style))).toBe(false)
      }
    }
    zeroHardViolations(source)
  })

  it('property: labeled decision fan-out labels stay off incident nodes across directions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('TD', 'BT', 'LR', 'RL'),
        fc.constantFrom('yes', 'no', 'ok', 'fix', 'ship', 'work'),
        fc.constantFrom('retry', 'else', 'wait', 'redo', 'safe', 'fail'),
        (dir, labelA, labelB) => {
          const source = `flowchart ${dir}
  Q{Ready?}
  Q -->|${labelA}| A[Alpha]
  Q -.->|${labelB}| B[Beta]`
          const graph = parseMermaid(source)
          const positioned = layoutGraphSync(graph)
          const style = resolveRenderStyle({})
          const nodes = new Map(positioned.nodes.map(n => [n.id, n]))
          const labelRects: Array<{ x: number; y: number; w: number; h: number }> = []

          for (const edge of positioned.edges.filter(e => e.source === 'Q')) {
            const rect = labelRect(edge, style)
            expect(rect).not.toBeNull()
            labelRects.push(rect!)
            const sourceNode = nodes.get(edge.source)!
            const targetNode = nodes.get(edge.target)!
            expect(rectsOverlap(rect!, { x: sourceNode.x, y: sourceNode.y, w: sourceNode.width, h: sourceNode.height }, 2)).toBe(false)
            expect(rectsOverlap(rect!, { x: targetNode.x, y: targetNode.y, w: targetNode.width, h: targetNode.height }, 2)).toBe(false)
            expect(distanceToPolyline(edge.labelPosition!, edge.points)).toBeLessThanOrEqual(0.001)
            expectLabelUsesStraightRunPorts(edge, rect!, dir)
            expectLabelClearsTerminalMarkers(edge, rect!, style)
            expect(edge.labelPosition).toBeDefined()
            expect(edge.routeCertificate).toBeDefined()
          }
          expect(rectsOverlap(labelRects[0]!, labelRects[1]!, readableLabelGap(style))).toBe(false)
        },
      ),
      { numRuns: 40 },
    )
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
