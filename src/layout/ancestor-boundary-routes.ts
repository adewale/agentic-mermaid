import type { Point } from '../types.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { ChannelWork } from './channel-tracks.ts'
import { createSparseVisibilityGraph, type SparseQueryWorkspacePool } from './compound-sparse-visibility.ts'
import { simplifyOrthogonal, type RoutingBox, type Terminal } from './compound-visibility.ts'
import { pointOnMeasuredSegment, segmentEntersMeasuredBox } from './measured-route-safety.ts'
import { minimumLinkRankGap } from './link-rank-gap.ts'

type MeasuredGroup = NonNullable<MeasuredGraph['groups']>[number]
export interface AncestorBoundaryConnection {
  edge: number
  container: number
  interior: number
  containerEnd: 'source' | 'target'
  rowOffset: number
  labelInset: number
  minimumLead: number
  label?: { width: number; height: number }
}
export interface AncestorBoundaryPlan {
  connections: ReadonlyMap<number, AncestorBoundaryConnection>
  groups: NonNullable<MeasuredGraph['groups']>
  clearance: number
}
export interface AncestorBoundaryRoute { points: Point[]; labelPosition?: Point }
class AncestorCorridorMiss extends Error {}

/** A containing frame and its descendant cannot constrain their shared quotient
 * as two siblings. Reserve explicit interior entry/label corridors instead. */
export function planAncestorBoundaryConnections(
  input: MeasuredGraph, owners: Int32Array, work: ChannelWork, fail: (reason: string) => never,
): AncestorBoundaryPlan {
  const groups = input.groups!, leaves = input.nodes.length, clearance = Math.max(8, input.edgeSpacing ?? 6, input.minimumTerminalLead ?? 0)
  const connections = new Map<number, AncestorBoundaryConnection>(), rows = new Map<number, number>(), strips = new Map<number, number>(), leads = new Map<number, number>()
  const encloses = (container: number, endpoint: number): boolean => {
    for (let parent = owners[endpoint]!; parent >= 0; parent = owners[leaves + parent]!) {
      if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
      if (parent === container) return true
    }
    return false
  }
  for (const [index, edge] of input.edges.entries()) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
    const source = edge.source >= leaves && encloses(edge.source - leaves, edge.target)
    const target = edge.target >= leaves && encloses(edge.target - leaves, edge.source)
    if (!source && !target) continue
    // This occurrence is one reserved inward prefix, not a sibling edge with
    // one dummy vertex per private rank. Bound its actual coordinate gap.
    let minimumLead = clearance
    if (edge.minSpan !== 1) {
      if (!Number.isSafeInteger(edge.minSpan) || edge.minSpan < 1) throw new TypeError('Invalid measured compound edge dimensions')
      const rankGap = minimumLinkRankGap(edge.minSpan)
      if (!Number.isSafeInteger(rankGap) || rankGap < 0) fail('agentic local coordinate-range limit')
      minimumLead = Math.max(clearance, rankGap)
    }
    const container = (source ? edge.source : edge.target) - leaves, original = groups[container]!
    const before = rows.get(container) ?? 0, contentHeight = Math.max(edge.label?.height ?? 0, edge.boundaryMarker?.height ?? 0)
    const height = contentHeight + 2 * clearance, labelInset = Math.max(2 * clearance, (edge.boundaryMarker?.inset ?? 0) + clearance)
    if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
    connections.set(index, { edge: index, container, interior: source ? edge.target : edge.source, containerEnd: source ? 'source' : 'target',
      rowOffset: original.padding.top + before + clearance + contentHeight / 2, labelInset, minimumLead,
      ...(edge.label ? { label: { ...edge.label } } : {}) })
    rows.set(container, before + height)
    strips.set(container, Math.max(strips.get(container) ?? 0, labelInset + (edge.label?.width ?? 0) + 2 * clearance))
    leads.set(container, Math.max(leads.get(container) ?? 0, minimumLead))
  }
  return { connections, clearance, groups: connections.size ? groups.map((group, index): MeasuredGroup => rows.has(index)
    ? { ...group, headerHeight: group.headerHeight ?? group.padding.top,
      padding: { ...group.padding, top: group.padding.top + rows.get(index)!, left: Math.max(group.padding.left + strips.get(index)!, leads.get(index)! + clearance) } }
    : group) : groups }
}

/** Internal placeholders keep occurrence slots and planned labels complete.
 * They are replaced by physical routes before any positioned graph is public. */
export function projectAncestorBoundaryPlaceholder(
  plan: AncestorBoundaryPlan, edgeIndex: number, frames: readonly RoutingBox[], reserveVertices?: (amount: number) => void,
): AncestorBoundaryRoute {
  const connection = plan.connections.get(edgeIndex)!, frame = frames[connection.container]!, c = plan.clearance
  const y = frame.y + connection.rowOffset
  reserveVertices?.(connection.label ? 3 : 2)
  const points = [{ x: frame.x, y }, { x: frame.x + plan.groups[connection.container]!.padding.left - c, y }]
  return { points: connection.containerEnd === 'source' ? points : points.reverse(),
    ...(connection.label ? { labelPosition: { x: frame.x + connection.labelInset + connection.label.width / 2, y } } : {}) }
}

export interface AncestorBoundaryRoutingOptions {
  work: ChannelWork
  remainingVertices: number
  reserveVertices: (amount: number) => void
  queryWorkspaces?: SparseQueryWorkspacePool
  fail: (reason: string) => never
  /** The owning boundary router checks exact contacts with finalized peers. */
  accept: (candidate: AncestorBoundaryRoute) => boolean
}

/** Reuse the bounded visibility kernel with one deliberately inward frame
 * terminal. Only this enclosing frame reverses the normal; leaves and nested
 * group endpoints still meet their real exterior outlines. */
export function routeAncestorBoundaryConnection(
  input: MeasuredGraph, placed: AgenticLayout, owners: Int32Array, plan: AncestorBoundaryPlan, edgeIndex: number,
  options: AncestorBoundaryRoutingOptions,
): AncestorBoundaryRoute {
  const { work, fail } = options, connection = plan.connections.get(edgeIndex)!, c = plan.clearance
  const leaves = input.nodes.length, frames = placed.groups!, group = frames[connection.container]!
  let allocated = 0
  const reserve = (amount: number): void => {
    if (allocated + amount > options.remainingVertices) fail('agentic local cross-hierarchy visibility-expansion limit')
    options.reserveVertices(amount)
    allocated += amount
  }
  const charge = (): void => { if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit') }
  const point = (x: number, y: number): Point => { reserve(1); return { x, y } }
  const boxes: RoutingBox[] = input.nodes.map((node, index) => { charge(); return { ...placed.nodes[index]!, width: node.width, height: node.height } })
  const subjects = [...boxes, ...frames], interior = subjects[connection.interior]!
  const ancestors = new Set<number>()
  for (let parent = owners[connection.interior]!; parent >= 0; parent = owners[leaves + parent]!) { charge(); ancestors.add(parent) }
  const inflate = (box: RoutingBox, amount: number): RoutingBox => ({ x: box.x - amount, y: box.y - amount, width: box.width + 2 * amount, height: box.height + 2 * amount })
  const obstacles = boxes.map((box, index) => { charge(); return index === connection.interior ? box : inflate(box, c) })
  frames.forEach((frame, index) => {
    charge()
    if (!ancestors.has(index)) obstacles.push(index + leaves === connection.interior ? frame : inflate(frame, c))
    else {
      const header = plan.groups[index]!.headerHeight ?? plan.groups[index]!.padding.top
      if (header > 0) obstacles.push(inflate({ ...frame, height: header }, 2))
    }
  })
  for (const [index, edge] of input.edges.entries()) {
    charge()
    if (!edge.label) continue
    const reserved = plan.connections.get(index), frame = reserved && frames[reserved.container]
    const x = reserved && frame ? frame.x + reserved.labelInset + edge.label.width / 2 : placed.edges[index]?.labelPosition?.x
    const y = reserved && frame ? frame.y + reserved.rowOffset : placed.edges[index]?.labelPosition?.y
    if (edge.label && x !== undefined && y !== undefined) obstacles.push(inflate({ x: x - edge.label.width / 2,
      y: y - edge.label.height / 2, width: edge.label.width, height: edge.label.height }, 2))
  }
  const header = plan.groups[connection.container]!.headerHeight ?? plan.groups[connection.container]!.padding.top
  const bounds = { x: group.x, y: group.y + header + 2, width: group.width, height: group.height - header - 2 }
  const y = group.y + connection.rowOffset
  const framePort = point(group.x, y), anchor = point(group.x + plan.groups[connection.container]!.padding.left - c, y)
  let degree = 0, ordinal = 0
  for (const [index, edge] of input.edges.entries()) {
    charge()
    if (edge.source === connection.interior || edge.target === connection.interior) { degree++; if (index < edgeIndex) ordinal++ }
  }
  const fractions = [...new Set([(ordinal + 1) / (degree + 1), .5, .25, .75])]
  const terminals: Terminal[] = []
  const interiorGroup = connection.interior >= leaves ? plan.groups[connection.interior - leaves] : undefined
  const minimumY = interior.y + (interiorGroup ? (interiorGroup.headerHeight ?? interiorGroup.padding.top) + 2 : 0)
  for (const side of ['L', 'R', 'B', 'T'] as const) for (const fraction of fractions) {
    charge()
    if (side === 'T' && interiorGroup && (interiorGroup.headerHeight ?? interiorGroup.padding.top) > 0) continue
    const px = side === 'L' ? interior.x : side === 'R' ? interior.x + interior.width : interior.x + fraction * interior.width
    const py = side === 'T' ? interior.y : side === 'B' ? interior.y + interior.height : minimumY + fraction * (interior.y + interior.height - minimumY)
    const port = point(px, py), stub = point(px + (side === 'L' ? -c : side === 'R' ? c : 0), py + (side === 'T' ? -c : side === 'B' ? c : 0))
    if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
    terminals.push({ port, stub, penalty: 0 })
  }
  const kernelFail = (reason: string): never => {
    if (reason === 'cross-hierarchy route has no bounded clear corridor') throw new AncestorCorridorMiss(reason)
    return fail(reason)
  }
  const graph = createSparseVisibilityGraph(bounds, obstacles, terminals, [anchor], c, work, options.remainingVertices, kernelFail, reserve, false, undefined, options.queryWorkspaces)
  for (const terminal of terminals) {
    let accepted: AncestorBoundaryRoute | undefined
    const leadAllows = (a: Point, b: Point): boolean => {
      charge()
      const { port, stub } = terminal
      if (a.x === port.x && a.y === port.y && b.x === stub.x && b.y === stub.y) return true
      const horizontal = port.y === stub.y, sameAxis = horizontal ? a.y === b.y : a.x === b.x
      if (sameAxis) {
        if (horizontal ? a.y !== port.y : a.x !== port.x) return true
        const low = Math.max(Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y), Math.min(horizontal ? port.x : port.y, horizontal ? stub.x : stub.y))
        const high = Math.min(Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y), Math.max(horizontal ? port.x : port.y, horizontal ? stub.x : stub.y))
        return low > high || low === high && low === (horizontal ? stub.x : stub.y)
      }
      const x = horizontal ? a.x : port.x, y = horizontal ? port.y : a.y
      const contact = x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)
        && x >= Math.min(port.x, stub.x) && x <= Math.max(port.x, stub.x) && y >= Math.min(port.y, stub.y) && y <= Math.max(port.y, stub.y)
      return !contact || x === stub.x && y === stub.y
    }
    try {
      graph.route([terminal], anchor, path => {
        const ordered = connection.containerEnd === 'source' ? [framePort, ...path.toReversed()] : [...path, framePort]
        let count = 0, previous: Point | undefined
        for (const p of ordered) { charge(); if (!previous || previous.x !== p.x || previous.y !== p.y) count++; previous = p }
        reserve(count)
        const points = simplifyOrthogonal(ordered)
        const endpoint = connection.containerEnd === 'source' ? points[0]! : points.at(-1)!
        const adjacent = connection.containerEnd === 'source' ? points[1]! : points.at(-2)!
        if (endpoint.x !== group.x || endpoint.y !== y || adjacent.y !== y || adjacent.x - endpoint.x < connection.minimumLead) return false
        const body = connection.containerEnd === 'source' ? points.at(-1)! : points[0]!
        const next = connection.containerEnd === 'source' ? points.at(-2)! : points[1]!
        const outward = body.x >= interior.x && body.x <= interior.x + interior.width && body.y >= interior.y && body.y <= interior.y + interior.height && (
          body.x === interior.x && next.y === body.y && next.x < body.x
          || body.x === interior.x + interior.width && next.y === body.y && next.x > body.x
          || body.y === interior.y && next.x === body.x && next.y < body.y
          || body.y === interior.y + interior.height && next.x === body.x && next.y > body.y)
        if (!outward || Math.abs(next.x - body.x) + Math.abs(next.y - body.y) < c) return false
        const labelPosition = connection.label ? point(group.x + connection.labelInset + connection.label.width / 2, y) : undefined
        if (labelPosition && !points.some((p, index) => index > 0 && pointOnMeasuredSegment(labelPosition, points[index - 1]!, p))) return false
        for (const [index, frame] of frames.entries()) if (ancestors.has(index)) {
          const header = plan.groups[index]!.headerHeight ?? plan.groups[index]!.padding.top
          for (let i = 1; i < points.length; i++) { charge(); if (header > 0 && segmentEntersMeasuredBox(points[i - 1]!, points[i]!, { ...frame, height: header })) return false }
        }
        const candidate = { points, ...(labelPosition ? { labelPosition } : {}) }
        if (!options.accept(candidate)) return false
        accepted = candidate
        return true
      }, leadAllows)
    } catch (error) {
      // Only a topological miss is another bounded terminal candidate. Budget
      // failures and producer exceptions retain their original identity.
      if (!(error instanceof AncestorCorridorMiss)) throw error
    }
    if (accepted) return accepted
  }
  return fail('cross-hierarchy route has no bounded clear corridor')
}
