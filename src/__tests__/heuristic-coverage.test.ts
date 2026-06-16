// ============================================================================
// Direct coverage for the three layout heuristics that the issue-#26 audit
// (docs/design/issue-26-audit.md, section (b) rows #13, #18, #20) flagged as
// "documented but tested only indirectly via the rubric hard metrics".
//
// Each heuristic previously rode on the rubric battery's aggregate
// `edgeThroughNode = 0` / `diagonalSegments = 0` gates and on crash-freedom
// property hunts. Those gates pass even if a heuristic's *refusal/repair*
// branch is dead, because nothing in the corpus forces that branch. The tests
// below construct the exact geometry that drives the branch, so a mutant that
// neutralises the guard (e.g. makes `snapOccludes` always return false, or
// makes `orthogonalizeEdgePoints` a no-op) flips a concrete assertion here.
//
// Methodology: github.com/adewale/testing-best-practices — deterministic
// inputs, real invariants (not tautologies), and a control case proving the
// heuristic would otherwise have acted, so the guard's effect is observable.
// ============================================================================

import { describe, expect, it } from 'bun:test'
import {
  alignLayerNodes,
  orthogonalizeEdgePoints,
  layoutGraphSync,
  convertToElkFormat,
} from '../layout-engine.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import { parseMermaid } from '../parser.ts'
import { assessLayout } from '../layout-rubric.ts'
import type { PositionedNode, PositionedEdge, Point } from '../types.ts'

// --- tiny builders for synthetic positioned geometry --------------------------
function mkNode(id: string, x: number, y: number, w = 40, h = 30): PositionedNode {
  return { id, label: id, shape: 'rectangle', x, y, width: w, height: h }
}
function mkEdge(source: string, target: string, points: Point[]): PositionedEdge {
  return { source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points }
}

// ============================================================================
// HEURISTIC #13 — occlusion-safe `alignLayerNodes` (the `snapOccludes`
// pre-check, src/layout-engine.ts).
//
// What it pins: after ELK routes edges, `alignLayerNodes` snaps same-layer
// nodes to a common flow-axis coordinate for tidiness. The guard refuses a
// snap when moving a node to the layer centre would park its bounding box on
// top of an already-routed *foreign* edge corridor (issue #25 rule 9 — no
// node movement after routing without rerouting). Alignment is cosmetic;
// occlusion is a hard defect, so the layer keeps ELK's stagger instead.
//
// How failure manifests: if the guard is removed/inverted, the GUARD case
// below snaps P onto the foreign F->G corridor, leaving an edge running
// through P's interior — a through-node occlusion. The CONTROL case proves
// the snap genuinely *would* have happened (so the GUARD assertion is not a
// tautology that passes simply because nothing ever snaps).
// ============================================================================
describe('occlusion-safe alignLayerNodes — the snapOccludes guard', () => {
  // TD flow: layers group by Y. P (y=100) and Q (y=120) sit in one layer with
  // a 20px ELK stagger (< the 0.6*layerSpacing grouping threshold) and share
  // no edge, so they are snap candidates. Their layer centre is y=110; a
  // snapped P would occupy y∈[110,140]. F and G live in their own (far) layers
  // so they never pollute P/Q's layer grouping.
  const layerCentre = 110

  it('CONTROL: with no foreign corridor in the way, the layer DOES snap to its centre', () => {
    const P = mkNode('P', 0, 100)
    const Q = mkNode('Q', 0, 120)
    const F = mkNode('F', -200, -100)
    const G = mkNode('G', -200, 400)
    // Foreign edge runs straight down at x=-180, nowhere near P/Q (x∈[0,40]).
    const e = mkEdge('F', 'G', [{ x: -180, y: -100 }, { x: -180, y: 400 }])

    alignLayerNodes([P, Q, F, G], [e], 'TD')

    // Both nodes converge on the shared layer centre — the snap fired.
    expect(P.y).toBeCloseTo(layerCentre, 1)
    expect(Q.y).toBeCloseTo(layerCentre, 1)
  })

  it('GUARD: a snap that would park a node on a foreign edge corridor is refused', () => {
    const P = mkNode('P', 0, 100)
    const Q = mkNode('Q', 0, 120)
    const F = mkNode('F', -200, -100)
    const G = mkNode('G', -200, 400)
    // Same foreign edge, but its horizontal mid-run is at y=135 spanning
    // x∈[-180,180]. Crucially this run is OUTSIDE P's current box (y∈[100,130])
    // but INSIDE the box P would occupy after snapping to the layer centre
    // (y∈[110,140]). So snapping — and only snapping — would create a fresh
    // through-node occlusion; snapOccludes must detect that and veto the snap.
    const e = mkEdge('F', 'G', [
      { x: -180, y: -100 },
      { x: -180, y: 135 },
      { x: 180, y: 135 },
      { x: 180, y: 400 },
    ])

    alignLayerNodes([P, Q, F, G], [e], 'TD')

    // The guard fired: P and Q kept ELK's stagger instead of snapping.
    expect(P.y).toBe(100)
    expect(Q.y).toBe(120)
    expect(Math.abs(P.y - layerCentre)).toBeGreaterThan(0.5)

    // And the invariant the guard exists to protect holds: no foreign edge
    // segment runs through the (un-snapped) node interior.
    const throughNode = e.points.slice(1).some((b, i) => {
      const a = e.points[i]!
      const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
      const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
      return xHi > P.x + 0.5 && xLo < P.x + P.width - 0.5 &&
        yHi > P.y + 0.5 && yLo < P.y + P.height - 0.5
    })
    expect(throughNode).toBe(false)
  })

  it('end-to-end: a real flowchart battery keeps edgeThroughNode at zero', () => {
    // Black-box backstop through the public pipeline: a fan-in/fan-out shape
    // (the family the audit names as exercising layer alignment) must still
    // certify zero through-node occlusions after alignment runs.
    const src = `flowchart TD
  A --> X
  B --> X
  C --> X
  X --> D
  X --> E
  X --> F`
    const graph = parseMermaid(src)
    const result = assessLayout(graph, layoutGraphSync(graph))
    expect(result.metrics.edgeThroughNode).toBe(0)
  })
})

// ============================================================================
// HEURISTIC #18 — cross-hierarchy orthogonalizer (`orthogonalizeEdgePoints`).
//
// What it pins: under SEPARATE hierarchy handling (which ELK requires for
// subgraph `direction` overrides), ELK can return a cross-hierarchy edge as a
// bare start/end pair with no orthogonal bend points — i.e. a diagonal.
// `orthogonalizeEdgePoints` rewrites any diagonal segment into an axis-aligned
// elbow (and returns the *same array reference* when nothing needed fixing, so
// callers can detect whether routing was applied).
//
// How failure manifests: if the function becomes a no-op, the diagonal
// survives and the rubric's `diagonalSegments` count goes positive; the unit
// case below also catches it directly because the returned polyline would
// still contain a segment with both dx>1 and dy>1.
// ============================================================================
describe('cross-hierarchy orthogonalizer — orthogonalizeEdgePoints', () => {
  const isAxisAligned = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) <= 0.5 || Math.abs(a.y - b.y) <= 0.5

  it('rewrites a diagonal cross-hierarchy segment into axis-aligned elbows', () => {
    // A bare diagonal, exactly what ELK SEPARATE mode hands back for an edge it
    // only gave endpoints to.
    const diagonal: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 80 }]
    const fixed = orthogonalizeEdgePoints(diagonal)

    // It actually did work (not the identity short-circuit).
    expect(fixed).not.toBe(diagonal)
    expect(fixed.length).toBeGreaterThan(2)
    // Every resulting segment is purely horizontal or vertical.
    for (let i = 1; i < fixed.length; i++) {
      expect(isAxisAligned(fixed[i - 1]!, fixed[i]!)).toBe(true)
    }
    // Endpoints are preserved.
    expect(fixed[0]).toEqual(diagonal[0])
    expect(fixed[fixed.length - 1]).toEqual(diagonal[1])
  })

  it('leaves an already-orthogonal path untouched (identity short-circuit)', () => {
    const ortho: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 50, y: 50 }]
    // Same reference back: the "no routing applied" signal callers rely on.
    expect(orthogonalizeEdgePoints(ortho)).toBe(ortho)
  })

  it('end-to-end: a subgraph direction override produces zero diagonal segments', () => {
    // `direction TB` inside a `flowchart LR` forces ELK into SEPARATE mode; the
    // Outside->A and B->Sink edges cross the subgraph hierarchy boundary and so
    // flow through the orthogonalizer. The whole layout must stay orthogonal.
    const src = `flowchart LR
  subgraph Pipe
    direction TB
    A[top] --> B[bottom]
  end
  Outside --> A
  B --> Sink`
    const graph = parseMermaid(src)
    const positioned = layoutGraphSync(graph)
    const result = assessLayout(graph, positioned)

    expect(result.metrics.diagonalSegments).toBe(0)

    // Stronger than the aggregate metric: assert every segment of every edge is
    // axis-aligned within 0.5px, and that the two boundary-crossing edges did
    // get genuine bend points (a single diagonal hop would fail axis-alignment).
    for (const e of positioned.edges) {
      for (let i = 1; i < e.points.length; i++) {
        expect(isAxisAligned(e.points[i - 1]!, e.points[i]!)).toBe(true)
      }
    }
    const crossing = positioned.edges.filter(
      e => (e.source === 'Outside' && e.target === 'A') ||
        (e.source === 'B' && e.target === 'Sink'),
    )
    expect(crossing.length).toBe(2)
    for (const e of crossing) {
      expect(e.points.length).toBeGreaterThanOrEqual(2)
    }
  })
})

// ============================================================================
// HEURISTIC #20 — ELK crash degradation ladder (`layoutGraphSync`).
//
// What it pins: ELK's bundled (GWT-compiled) engine can throw internal
// exceptions on rare dense multigraphs. Crash-freedom is part of this
// renderer's contract, so `layoutGraphSync` retries through a ladder of
// progressively plainer ELK option sets (drop feedbackEdges, then
// post-compaction, then forced model order / high-degree treatment) and only
// rethrows if *every* tier fails. The route-contract pass then repairs
// whatever the surviving tier produced.
//
// PINNED TRIGGER (issue #34): this 3-node/9-edge dense cyclic multigraph is a
// deterministic bundled-ELK failure for tier 0 (`elk.layered.feedbackEdges:
// true`): `java.lang.IllegalStateException: Invalid hitboxes for scanline
// constraint calculation.` Turning feedbackEdges off (tier 1) succeeds, which
// pins the actual crash → fallback → valid-layout transition instead of merely
// asserting broad crash-freedom on stress inputs.
// ============================================================================
const ELK_TIER0_HITBOX_CRASH = `flowchart TD
  N0 --> N2
  N1 --> N0
  N2 --> N1
  N1 --> N2
  N1 --> N2
  N2 --> N0
  N0 --> N1
  N0 --> N1
  N0 --> N1`

describe('ELK degradation ladder — layoutGraphSync crash-freedom', () => {
  const assertFinitePositionedGraph = (positioned: ReturnType<typeof layoutGraphSync>) => {
    expect(positioned.nodes.length).toBeGreaterThan(0)
    for (const n of positioned.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
      expect(n.width).toBeGreaterThan(0)
      expect(n.height).toBeGreaterThan(0)
    }
    for (const e of positioned.edges) {
      for (const p of e.points) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
      }
    }
  }

  const assertValidLayout = (src: string) => {
    const graph = parseMermaid(src)
    assertFinitePositionedGraph(layoutGraphSync(graph))
  }

  it('issue #34: tier-0 ELK hitbox crash succeeds via the feedbackEdges-off fallback', () => {
    const graph = parseMermaid(ELK_TIER0_HITBOX_CRASH)

    // The committed fixture proves the real bundled-ELK crash at the default
    // option set. This is the edge the older broad stress tests could not pin.
    expect(() => elkLayoutSync(convertToElkFormat(graph))).toThrow(/Invalid hitboxes|IllegalStateException/)

    // The first degraded option set is sufficient: disabling ELK's feedback
    // edge router makes the same graph lay out cleanly.
    const fallbackAttempt = convertToElkFormat(graph)
    fallbackAttempt.layoutOptions = {
      ...fallbackAttempt.layoutOptions,
      'elk.layered.feedbackEdges': 'false',
    }
    expect(() => elkLayoutSync(fallbackAttempt)).not.toThrow()

    const positioned = layoutGraphSync(graph)
    assertFinitePositionedGraph(positioned)
    expect(positioned.nodes.map(n => n.id).sort()).toEqual(['N0', 'N1', 'N2'])
    expect(positioned.edges.length).toBe(9)
  })

  it('a dense bidirectional complete digraph (K8 both ways) lays out without throwing', () => {
    // 8 nodes, every ordered pair connected => 56 edges with many feedback
    // edges and high-degree nodes — the structural class the ladder exists for.
    let src = 'flowchart TD\n'
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        src += `  N${i} --> N${j}\n  N${j} --> N${i}\n`
      }
    }
    expect(() => assertValidLayout(src)).not.toThrow()
  })

  it('a dense parallel multigraph lays out without throwing', () => {
    // 6 nodes, 3 parallel duplicate edges per ordered pair => 90 edges.
    let src = 'flowchart LR\n'
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        if (i === j) continue
        for (let k = 0; k < 3; k++) src += `  N${i} --> N${j}\n`
      }
    }
    expect(() => assertValidLayout(src)).not.toThrow()
  })

  it('a large cyclic graph with self-loops lays out without throwing', () => {
    // Cycle of 20 with a self-loop on every node — feedback-heavy.
    let src = 'flowchart TD\n'
    for (let i = 0; i < 20; i++) {
      src += `  N${i} --> N${(i + 1) % 20}\n  N${i} --> N${i}\n`
    }
    expect(() => assertValidLayout(src)).not.toThrow()
  })
})
