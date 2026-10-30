import { shapeOutline } from '../shape-outline.ts'
import { geometryBounds, nodePaintBounds, unionSceneBounds } from '../scene/bounds.ts'
import { formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { STROKE_WIDTHS } from '../styles.ts'
import { invalidEndpointApproaches, MAX_PREFERENCE_EDGES, MAX_PREFERENCE_NODES } from './route-geometry.ts'
import type { Point, PositionedEdge, PositionedGraph, PositionedNode, PositionedGroup } from '../types.ts'
import type { RenderedLayout } from '../agent/types.ts'
import { LABEL_PILL_PADDING, LABEL_INTERIOR_TOLERANCE as INTERIOR_TOLERANCE, segmentEntersLabelRect, labelRect, labelHaloExtension } from '../shared/edge-label-geometry.ts'
import { calculatePathMidpoint } from './geometry.ts'
import { boxesMeet, edgeInk, finiteBox, writtenGeometry, type GraphPaintStyle } from './graph-paint-support.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'

export interface LabelConflictCounts {
  total: number
  labelLabel: number
  labelNode: number
  labelEdge: number
}

type Rect = { x: number; y: number; w: number; h: number }
type Label = { edgeIndex: number; rect: Rect }
type Route = { points: readonly Point[]; hidden: boolean }

function emptyCounts(): LabelConflictCounts {
  return { total: 0, labelLabel: 0, labelNode: 0, labelEdge: 0 }
}

// A physical tolerance, independent of segment length. Touching boundaries and
// subpixel grazes do not make a label unreadable.

function overlappingInteriors(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > INTERIOR_TOLERANCE &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > INTERIOR_TOLERANCE
}


/**
 * Count conflicting label/obstacle pairs, using the rendered eight-pixel pill
 * padding and retained text metrics. A minimum clearance of zero hides extra
 * collisions; these counts continue to distinguish candidates after the first.
 *
 * Each other label, node, or visible route counts once. Own routes are excluded
 * because their pill intentionally masks them. Invisible links still render
 * their labels, but their shafts are not obstacles. A bundle certificate or
 * matching text does not establish shared label ownership: positioned edges
 * currently retain no contract authorizing one label to stand for another.
 */
export function measureLabelConflicts(
  positioned: Pick<PositionedGraph, 'nodes' | 'edges'>,
  style: Parameters<typeof labelRect>[1],
  involved?: ReadonlySet<number>,
): LabelConflictCounts {
  const labels = positioned.edges.flatMap((edge, index) => {
    if (!edge.label) return []
    const rect = labelRect(edge.labelPosition ? edge : { ...edge, labelPosition: calculatePathMidpoint(edge.points) }, style)
    return rect ? [{ edgeIndex: index, rect }] : []
  })
  if (labels.length === 0) return emptyCounts()
  return countLabelConflicts(
    labels,
    positioned.nodes.map(node => ({ x: node.x, y: node.y, w: node.width, h: node.height })),
    positioned.edges.map(edge => ({ points: edge.points, hidden: edge.style === 'invisible' })),
    involved,
  )
}

/** Graphs paint padded pills; specialized families use retained text footprints.
 * Missing measurements remain unavailable, rather than becoming zero conflicts. */
export function measureRenderedLabelConflicts(layout: RenderedLayout): LabelConflictCounts | undefined {
  if (layout.edges.some(edge => edge.label?.text && !edge.label.bounds)) return undefined
  const padding = layout.kind === 'flowchart' || layout.kind === 'state' ? LABEL_PILL_PADDING : 0
  const labels = layout.edges.flatMap((edge, edgeIndex) => {
    const bounds = edge.label?.bounds
    return edge.label?.text && bounds ? [{
      edgeIndex,
      rect: {
        x: bounds.x - padding, y: bounds.y - padding,
        w: bounds.w + 2 * padding, h: bounds.h + 2 * padding,
      },
    }] : []
  })
  if (labels.length === 0) return emptyCounts()
  return countLabelConflicts(
    labels, layout.nodes,
    layout.edges.map(edge => ({ points: edge.path.map(([x, y]) => ({ x, y })), hidden: edge.visibility === 'hidden' })),
  )
}

function countLabelConflicts(labels: readonly Label[], nodes: readonly Rect[], routes: readonly Route[], involved?: ReadonlySet<number>): LabelConflictCounts {
  const counts = emptyCounts()
  const changedLabels = involved ? labels.filter(label => involved.has(label.edgeIndex)) : labels
  const changedRoutes = involved ? [...involved].filter(index => routes[index] !== undefined) : []
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    const changedLabel = !involved || involved.has(label.edgeIndex)
    const peers = changedLabel ? labels : changedLabels
    for (let j = changedLabel ? i + 1 : 0; j < peers.length; j++) {
      const other = peers[j]!
      if (!changedLabel && other.edgeIndex <= label.edgeIndex) continue
      if (overlappingInteriors(label.rect, other.rect)) counts.labelLabel++
    }
    if (changedLabel) for (const node of nodes) {
      if (overlappingInteriors(label.rect, node)) counts.labelNode++
    }
    for (let cursor = 0; cursor < (changedLabel ? routes.length : changedRoutes.length); cursor++) {
      const j = changedLabel ? cursor : changedRoutes[cursor]!
      const other = routes[j]!
      if (j === label.edgeIndex || other.hidden) continue
      for (let segment = 1; segment < other.points.length; segment++) {
        if (segmentEntersLabelRect(other.points[segment - 1]!, other.points[segment]!, label.rect)) {
          counts.labelEdge++
          break
        }
      }
    }
  }
  counts.total = counts.labelLabel + counts.labelNode + counts.labelEdge
  return counts
}

/** Optional route/seat proposals preserve every previously separated caption
 * pair. Counts alone could exchange a repaired conflict for a new one. Use the
 * written shaft/marker supports and full pill halo used by paint admission;
 * invisible routes still retain their authored captions as obstacles. */
export function preservesLabelInkSeparation(
  before: readonly PositionedEdge[],
  after: readonly PositionedEdge[],
  style: GraphPaintStyle,
  involved: ReadonlySet<number>,
  work: () => boolean,
): boolean {
  if (involved.size === 0 || !after.some(edge => edge.label)) return true
  const exhausted = Symbol('label-ink-work-exhausted')
  const pay = (): void => { if (!work()) throw exhausted }
  const labels = new Map<PositionedEdge, AxisAlignedBox | undefined>()
  const routes = new Map<PositionedEdge, ReturnType<typeof edgeInk>>()
  const label = (edge: PositionedEdge): AxisAlignedBox | undefined => {
    pay()
    if (!labels.has(edge)) {
      const rect = labelRect(edge, style), halo = labelHaloExtension(edge, style.lineWidth ?? 1)
      labels.set(edge, rect ? { x0: rect.x - halo, y0: rect.y - halo, x1: rect.x + rect.w + halo, y1: rect.y + rect.h + halo } : undefined)
    }
    return labels.get(edge)
  }
  const ink = (edge: PositionedEdge): ReturnType<typeof edgeInk> => {
    pay()
    if (!routes.has(edge)) routes.set(edge, edgeInk(edge, style, work))
    return routes.get(edge)
  }
  const overlaps = (box: AxisAlignedBox, obstacles: readonly AxisAlignedBox[]): boolean => obstacles.some(obstacle => { pay(); return boxesMeet(box, obstacle) })
  try {
    for (let index = 0; index < after.length; index++) {
      pay()
      const edge = after[index]!
      if (!edge.label) continue
      const box = label(edge)
      if (!finiteBox(box)) return false
      for (let peerIndex = 0; peerIndex < after.length; peerIndex++) {
        pay()
        if (!involved.has(index) && !involved.has(peerIndex)) continue
        const peer = after[peerIndex]!, route = ink(peer)
        if (!route) return false
        const shaftsMeet = peerIndex !== index && overlaps(box, route.shafts)
        if (shaftsMeet) {
          const oldBox = label(before[index]!), oldRoute = ink(before[peerIndex]!)
          if (!finiteBox(oldBox) || !oldRoute || !overlaps(oldBox, oldRoute.shafts)) return false
        }
        for (const marker of route.markers) {
          pay()
          if (!finiteBox(marker.bounds)) return false
          if (!boxesMeet(box, marker.bounds)) continue
          const oldBox = label(before[index]!), oldRoute = ink(before[peerIndex]!)
          const oldMarker = oldRoute?.markers.find(previous => { pay(); return previous.position === marker.position })
          if (!finiteBox(oldBox) || !finiteBox(oldMarker?.bounds) || !boxesMeet(oldBox, oldMarker.bounds)) return false
        }
        if (peerIndex <= index || !peer.label) continue
        const other = label(peer)
        if (!finiteBox(other)) return false
        if (boxesMeet(box, other)) {
          const oldBox = label(before[index]!), oldOther = label(before[peerIndex]!)
          if (!finiteBox(oldBox) || !finiteBox(oldOther) || !boxesMeet(oldBox, oldOther)) return false
        }
      }
    }
    return true
  } catch (error) {
    if (error === exhausted) return false
    throw error
  }
}

export const graphRouteChanged = (edge: PositionedEdge, previous: PositionedEdge): boolean => edge.points.length !== previous.points.length
  || edge.points.some((point, index) => point.x !== previous.points[index]!.x || point.y !== previous.points[index]!.y)

export function withinGraphInkBudget(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], groups: readonly PositionedGroup[]): boolean {
  if (nodes.length > MAX_PREFERENCE_NODES || edges.length > MAX_PREFERENCE_EDGES) return false
  let remaining = MAX_PREFERENCE_NODES - nodes.length
  const fits = (groups: readonly PositionedGroup[]): boolean => groups.every(group => --remaining >= 0 && fits(group.children))
  return fits(groups)
}

export function graphInkWork(): { remaining: number } {
  return { remaining: MAX_PREFERENCE_NODES * MAX_PREFERENCE_EDGES }
}

export function graphInkClear(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], beforeNodes: readonly PositionedNode[], beforeEdges: readonly PositionedEdge[], groups: readonly PositionedGroup[], style: GraphPaintStyle, budget = graphInkWork(), chargeWork?: (operations: number) => void): boolean {
  const changedNodes = nodes.map((node, index) => node.x !== beforeNodes[index]!.x || node.y !== beforeNodes[index]!.y)
  const changedEdges = edges.map((edge, index) => graphRouteChanged(edge, beforeEdges[index]!)
    || edge.labelPosition?.x !== beforeEdges[index]!.labelPosition?.x || edge.labelPosition?.y !== beforeEdges[index]!.labelPosition?.y)
  if (!changedNodes.some(Boolean) && !changedEdges.some(Boolean)) return true
  // The existing bounded quality-exploration scope also bounds this optional
  // publication proof. Oversized routes/pairs cannot consume unlimited work.
  const work = (): boolean => { chargeWork?.(1); return --budget.remaining >= 0 }
  const supports = new Map<PositionedEdge, ReturnType<typeof edgeInk>>()
  const ink = (edge: PositionedEdge): ReturnType<typeof edgeInk> => {
    if (!supports.has(edge)) supports.set(edge, edgeInk(edge, style, work))
    return supports.get(edge)
  }
  const cards = new Map<PositionedNode, AxisAlignedBox | undefined>()
  const card = (node: PositionedNode): AxisAlignedBox | undefined => {
    if (!cards.has(node)) {
      const piece = shapeOutline(node, { fill: node.inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)',
        stroke: node.inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)',
        strokeWidth: formatSvgNumericAttribute('stroke-width', node.inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth ?? STROKE_WIDTHS.innerBox)) }, style.cornerRadius)
      cards.set(node, nodePaintBounds({ kind: 'shape', id: node.id, role: 'node', geometry: writtenGeometry(piece.geometry), paint: piece.paint, ...(piece.childPaints ? { childPaints: piece.childPaints } : {}) }))
    }
    return cards.get(node)
  }
  try {
    // Retain incoming admission of moved-card borders against every other
    // live card, independently of route ownership.
    for (let index = 0; index < nodes.length; index++) {
      if (!changedNodes[index]) continue
      const box = card(nodes[index]!)
      if (!finiteBox(box)) return false
      for (let peerIndex = 0; peerIndex < nodes.length; peerIndex++) {
        if (peerIndex === index || changedNodes[peerIndex] && peerIndex < index) continue
        if (!work()) return false
        const peer = card(nodes[peerIndex]!)
        if (!finiteBox(peer) || boxesMeet(box, peer)) return false
      }
    }
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const node = nodes[nodeIndex]!
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
        const edge = edges[edgeIndex]!
        if (!changedNodes[nodeIndex] && !changedEdges[edgeIndex]) continue
        if (!work()) return false
        // A canonical contact still has to face outward. Prove each endpoint
        // separately so improving one cannot hide a new inward shaft at the other.
        if (edge.source === node.id && invalidEndpointApproaches(edge, node) > invalidEndpointApproaches(beforeEdges[edgeIndex]!, beforeNodes[nodeIndex]!)) return false
        if (edge.target === node.id && invalidEndpointApproaches(edge, undefined, node) > invalidEndpointApproaches(beforeEdges[edgeIndex]!, undefined, beforeNodes[nodeIndex]!)) return false
        const route = ink(edge)
        if (!route) return false
        const box = card(node)
        if (!finiteBox(box)) return false
        if (edge.source !== node.id && edge.target !== node.id) for (const support of route.shafts) if (!work() || boxesMeet(box, support)) return false
        for (const marker of route.markers) {
          const owner = marker.position === 'start' ? edge.source : edge.target
          if (owner !== node.id && (!work() || !finiteBox(marker.bounds) || boxesMeet(box, marker.bounds))) return false
        }
        const rect = edge.style === 'invisible' ? labelRect(edge, style) : null
        const halo = labelHaloExtension(edge, style.lineWidth ?? 1)
        const caption = route.label ?? (rect ? { x0: rect.x - halo, y0: rect.y - halo, x1: rect.x + rect.w + halo, y1: rect.y + rect.h + halo } : undefined)
        if (caption && (!work() || boxesMeet(box, caption))) return false
      }
    }
    const involved = new Set(changedEdges.flatMap((changed, index) => changed ? [index] : []))
    if (!preservesLabelInkSeparation(beforeEdges, edges, style, involved, work)) return false
    return graphHeadersClear(nodes, edges, beforeNodes, beforeEdges, groups, ink, card, work)
  } catch {
    // Invalid/unsupported artwork is handled by the mandatory final gate.
    // This optional cosmetic pass must not publish an unproved replacement.
    return false
  }
}

function graphHeadersClear(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], beforeNodes: readonly PositionedNode[], beforeEdges: readonly PositionedEdge[], groups: readonly PositionedGroup[], ink: (edge: PositionedEdge) => ReturnType<typeof edgeInk>, card: (node: PositionedNode) => AxisAlignedBox | undefined, work: () => boolean): boolean {
  const changedNodes = nodes.filter((node, index) => node.x !== beforeNodes[index]!.x || node.y !== beforeNodes[index]!.y)
  const changedEdges = edges.filter((edge, ordinal) => edge.style !== 'invisible' && graphRouteChanged(edge, beforeEdges[ordinal]!))
  const clear = (group: PositionedGroup): boolean => {
    if (!work()) return false
    if (!group.concurrencyRegion && group.width !== 0) {
      const height = group.headerHeight ?? group.height
      if (!Number.isFinite(group.width) || group.width < 0 || !Number.isFinite(height) || height < 0) return false
      if (height > 0 && group.width > 0) {
        // The semantic reservation stays live. Include its written rectangle
        // as well, so decimal emission cannot shrink the clearance proof.
        const band = unionSceneBounds({ x0: group.x, y0: group.y, x1: group.x + group.width, y1: group.y + height },
          geometryBounds(writtenGeometry({ kind: 'rect', x: group.x, y: group.y, width: group.width, height })))
        if (!finiteBox(band)) return false
        for (const node of changedNodes) {
          if (!work()) return false
          const painted = card(node)
          if (!finiteBox(painted)) return false
          const footprint = unionSceneBounds(painted, { x0: node.x, y0: node.y, x1: node.x + node.width, y1: node.y + node.height })!
          if (!finiteBox(footprint) || boxesMeet(footprint, band)) return false
        }
        for (const edge of changedEdges) {
          const supports = ink(edge)
          if (!supports) return false
          for (const support of supports.shafts) if (!work() || boxesMeet(support, band)) return false
          for (const marker of supports.markers) if (!work() || !finiteBox(marker.bounds) || boxesMeet(marker.bounds, band)) return false
        }
      }
    }
    return group.children.every(clear)
  }
  return groups.every(clear)
}
