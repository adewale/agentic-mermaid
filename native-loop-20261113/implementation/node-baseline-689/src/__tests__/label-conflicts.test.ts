import { describe, expect, it } from 'bun:test'
import { measureLabelConflicts, measureRenderedLabelConflicts } from '../layout/label-conflicts.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { resolveRenderStyle } from '../styles.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import { measureQuality } from '../agent/quality.ts'
import { toFinite } from '../agent/types.ts'
import type { PositionedEdge, PositionedGraph, PositionedNode } from '../types.ts'

const style = resolveRenderStyle()

function edge(overrides: Partial<PositionedEdge> = {}): PositionedEdge {
  return {
    source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true,
    points: [{ x: 0, y: 300 }, { x: 200, y: 300 }], ...overrides,
  }
}

function labeled(overrides: Partial<PositionedEdge> = {}): PositionedEdge {
  // A retained 24x14 text block renders as a 40x30 pill, at x=80..120,
  // y=85..115. The fixture avoids depending on font measurement estimates.
  return edge({
    label: 'label', labelPosition: { x: 100, y: 100 },
    labelBlock: { ...graphEdgeTextBlock('label', style), width: 24, height: 14 },
    ...overrides,
  })
}

function node(overrides: Partial<PositionedNode> = {}): PositionedNode {
  return { id: 'A', label: 'A', shape: 'rectangle', x: 90, y: 90, width: 20, height: 20, ...overrides }
}

describe('rendered edge label conflicts', () => {
  it('counts another collision even when an existing collision already has zero clearance', () => {
    const first = edge({ points: [{ x: 90, y: 0 }, { x: 90, y: 200 }] })
    const second = edge({ points: [{ x: 110, y: 0 }, { x: 110, y: 200 }] })
    expect(measureLabelConflicts({ nodes: [], edges: [labeled(), first] }, style)).toEqual({
      total: 1, labelLabel: 0, labelNode: 0, labelEdge: 1,
    })
    expect(measureLabelConflicts({ nodes: [], edges: [labeled(), first, second] }, style)).toEqual({
      total: 2, labelLabel: 0, labelNode: 0, labelEdge: 2,
    })
  })

  it('counts label pairs once and includes their eight-pixel padding', () => {
    // The text bands do not overlap, but their padded pills overlap by 4px.
    const other = labeled({ labelPosition: { x: 136, y: 100 } })
    expect(measureLabelConflicts({ nodes: [], edges: [labeled(), other] }, style)).toEqual({
      total: 1, labelLabel: 1, labelNode: 0, labelEdge: 0,
    })
  })

  it('scopes proposal scoring to changed labels or routes without counting unrelated collisions', () => {
    const positioned = {
      nodes: [node(), node({ id: 'far', x: 290 })],
      edges: [
        labeled(), labeled({ labelPosition: { x: 136, y: 100 } }),
        edge({ points: [{ x: 90, y: 0 }, { x: 90, y: 200 }] }),
        edge({ points: [{ x: 110, y: 0 }, { x: 110, y: 200 }] }),
        labeled({ labelPosition: { x: 300, y: 100 } }),
        edge({ points: [{ x: 300, y: 0 }, { x: 300, y: 200 }] }),
      ],
    }
    expect(measureLabelConflicts(positioned, style, new Set([2]))).toEqual({ total: 1, labelLabel: 0, labelNode: 0, labelEdge: 1 })
    expect(measureLabelConflicts(positioned, style, new Set([0]))).toEqual({ total: 4, labelLabel: 1, labelNode: 1, labelEdge: 2 })
    expect(measureLabelConflicts(positioned, style, new Set([1, 2]))).toEqual({ total: 2, labelLabel: 1, labelNode: 0, labelEdge: 1 })
    expect(measureLabelConflicts(positioned, style, new Set([4]))).toEqual({ total: 2, labelLabel: 0, labelNode: 1, labelEdge: 1 })
    expect(measureLabelConflicts(positioned, style, new Set())).toEqual({ total: 0, labelLabel: 0, labelNode: 0, labelEdge: 0 })
  })

  it('does not infer shared semantic label ownership from a bundle or matching text', () => {
    const bundled = labeled({ routeCertificate: { invariant: 'bundle', edgeIndex: 0, routeClass: 'primary-forward', bendCount: 1 } })
    const sibling = labeled({ target: 'C', routeCertificate: { invariant: 'bundle', edgeIndex: 1, routeClass: 'primary-forward', bendCount: 1 } })
    expect(measureLabelConflicts({ nodes: [], edges: [bundled, sibling] }, style).labelLabel).toBe(1)
  })

  it('includes own endpoint nodes when their bodies overlap the pill', () => {
    expect(measureLabelConflicts({ nodes: [node(), node({ id: 'B' })], edges: [labeled()] }, style)).toEqual({
      total: 2, labelLabel: 0, labelNode: 2, labelEdge: 0,
    })
  })

  it('excludes the own route and counts each other route only once', () => {
    const own = labeled({ points: [{ x: 0, y: 100 }, { x: 200, y: 100 }] })
    const other = edge({ points: [{ x: 90, y: 0 }, { x: 90, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 200 }] })
    expect(measureLabelConflicts({ nodes: [], edges: [own, other] }, style)).toEqual({
      total: 1, labelLabel: 0, labelNode: 0, labelEdge: 1,
    })
  })

  it('counts invisible link labels while ignoring invisible shafts', () => {
    const invisible = edge({ style: 'invisible', points: [{ x: 100, y: 0 }, { x: 100, y: 200 }] })
    expect(measureLabelConflicts({ nodes: [], edges: [labeled(), invisible] }, style).total).toBe(0)
    expect(measureLabelConflicts({ nodes: [node()], edges: [labeled({ style: 'invisible' })] }, style).labelNode).toBe(1)
  })

  it('matches the rendered path-midpoint fallback when a label has no placement', () => {
    const unplaced = labeled({ labelPosition: undefined, points: [{ x: 0, y: 100 }, { x: 200, y: 100 }] })
    expect(measureLabelConflicts({ nodes: [node()], edges: [unplaced] }, style).labelNode).toBe(1)
  })

  it('ignores boundary contacts and half-pixel grazes for labels and nodes', () => {
    for (const x of [120, 119.75, 119.5]) {
      expect(measureLabelConflicts({ nodes: [node({ x, width: 20 })], edges: [labeled()] }, style).total).toBe(0)
    }
    expect(measureLabelConflicts({ nodes: [node({ x: 119.4, width: 20 })], edges: [labeled()] }, style).labelNode).toBe(1)
    expect(measureLabelConflicts({ nodes: [], edges: [labeled(), labeled({ labelPosition: { x: 139.5, y: 100 } })] }, style).total).toBe(0)
  })

  it('uses a physical half-pixel path tolerance and handles diagonal segments', () => {
    for (const x of [120, 119.75, 119.5]) {
      const grazing = edge({ points: [{ x, y: -100000 }, { x, y: 100000 }] })
      expect(measureLabelConflicts({ nodes: [], edges: [labeled(), grazing] }, style).total).toBe(0)
    }
    const entering = edge({ points: [{ x: 119.4, y: -100000 }, { x: 119.4, y: 100000 }] })
    const diagonal = edge({ points: [{ x: 0, y: 0 }, { x: 200, y: 200 }] })
    expect(measureLabelConflicts({ nodes: [], edges: [labeled(), entering, diagonal] }, style).labelEdge).toBe(2)
  })

  it('ignores empty labels, degenerate paths, and the four-pixel halo outside the pill', () => {
    const point = edge({ points: [{ x: 100, y: 100 }, { x: 100, y: 100 }] })
    const haloOnly = edge({ points: [{ x: 123, y: 0 }, { x: 123, y: 200 }] })
    expect(measureLabelConflicts({ nodes: [], edges: [labeled(), point, haloOnly, labeled({ label: '' })] }, style).total).toBe(0)
  })
})

function graph(edges: PositionedEdge[], nodes: PositionedNode[] = []): PositionedGraph {
  return { edges, nodes, width: 400, height: 400, groups: [] }
}

describe('label conflict projections share geometry', () => {
  it('retains subpixel node bounds on both sides of the half-pixel conflict threshold', () => {
    // Pill right edge=120.25. The first box intrudes 0.55px, while the
    // second intrudes 0.25px; rounding either node x to 120 erases the distinction.
    for (const [x, expected] of [[119.7, 1], [120, 0]] as const) {
      const positioned = graph([labeled({ labelPosition: { x: 100.25, y: 100.25 } })], [node({ x, y: 90.25, width: 20.25, height: 20.25 })])
      const layout = positionedToRenderedLayout(positioned, 'flowchart')
      expect(layout.nodes[0]!.x).toBe(toFinite(positioned.nodes[0]!.x))
      expect(layout.nodes[0]!.y).toBe(toFinite(positioned.nodes[0]!.y))
      expect(layout.nodes[0]!.w).toBe(toFinite(positioned.nodes[0]!.width))
      expect(layout.nodes[0]!.h).toBe(toFinite(positioned.nodes[0]!.height))
      expect(measureLabelConflicts(positioned, style).labelNode).toBe(expected)
      expect(measureRenderedLabelConflicts(layout)).toEqual(measureLabelConflicts(positioned, style))
    }
  })

  it('projects the rendered midpoint fallback with retained label measurements', () => {
    const unplaced = labeled({ labelPosition: undefined, points: [{ x: 0.25, y: 100.25 }, { x: 200.25, y: 100.25 }] })
    const positioned = graph([unplaced], [node({ x: 90.25, y: 90.25 })])
    const layout = positionedToRenderedLayout(positioned, 'flowchart')
    expect(layout.edges[0]!.label).toMatchObject({ x: 100.25, y: 100.25, text: 'label', bounds: { x: 88.25, y: 93.25, w: 24, h: 14 } })
    expect(measureLabelConflicts(positioned, style).labelNode).toBe(1)
    expect(measureRenderedLabelConflicts(layout)).toEqual(measureLabelConflicts(positioned, style))
    expect(measureQuality(layout).labelConflicts).toEqual(measureLabelConflicts(positioned, style))
  })

  for (const kind of ['flowchart', 'state'] as const) {
    it(`${kind}: matches positioned and public padded-pill counts`, () => {
      const positioned = graph([
        labeled(), labeled({ target: 'C', labelPosition: { x: 136, y: 100 } }),
        edge({ points: [{ x: 90, y: 0 }, { x: 90, y: 200 }] }),
        edge({ style: 'invisible', points: [{ x: 110, y: 0 }, { x: 110, y: 200 }] }),
      ], [node()])
      const layout = positionedToRenderedLayout(positioned, kind)
      const counts = { total: 3, labelLabel: 1, labelNode: 1, labelEdge: 1 }
      expect(measureLabelConflicts(positioned, style)).toEqual(counts)
      expect(measureRenderedLabelConflicts(layout)).toEqual(counts)
      expect(measureQuality(layout).labelConflicts).toEqual(counts)
    })
  }

  it('public counts distinguish additional conflicts when minimum clearance stays zero', () => {
    const first = edge({ points: [{ x: 90, y: 0 }, { x: 90, y: 200 }] })
    const second = edge({ points: [{ x: 110, y: 0 }, { x: 110, y: 200 }] })
    const one = measureQuality(positionedToRenderedLayout(graph([labeled(), first]), 'flowchart'))
    const two = measureQuality(positionedToRenderedLayout(graph([labeled(), first, second]), 'flowchart'))
    expect(one.labelEdgeProximity).toBe(0)
    expect(two.labelEdgeProximity).toBe(0)
    expect(one.labelConflicts?.total).toBe(1)
    expect(two.labelConflicts?.total).toBe(2)
  })

  it('public clearance ignores hidden shafts while their labels still count', () => {
    const crossing = edge({ style: 'invisible', points: [{ x: 100, y: 0 }, { x: 100, y: 200 }] })
    const visibleLabel = measureQuality(positionedToRenderedLayout(graph([labeled(), crossing]), 'flowchart'))
    expect(visibleLabel.labelEdgeProximity).toBe(Infinity)
    expect(visibleLabel.labelConflicts?.total).toBe(0)
    const hiddenShaftLabel = measureQuality(positionedToRenderedLayout(graph([labeled({ style: 'invisible' })], [node()]), 'flowchart'))
    expect(hiddenShaftLabel.labelConflicts?.labelNode).toBe(1)
  })

  it('measures specialized text footprints without inventing pills or missing measurements', () => {
    const layout = positionedToRenderedLayout(graph([labeled()], [node()]), 'flowchart')
    for (const kind of ['class', 'er', 'sequence'] as const) {
      const other = { ...layout, kind }
      expect(measureRenderedLabelConflicts(other)?.labelNode).toBe(1)
      expect(measureQuality(other).labelMeasurement.measuredEdges).toBe(1)
    }
    delete layout.edges[0]!.label!.bounds
    expect(measureQuality(layout).labelConflicts).toBeUndefined()
    expect(measureQuality(layout).labelMeasurement.unmeasuredEdges).toBe(1)
  })
})
