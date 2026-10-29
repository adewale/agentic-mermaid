import type { MermaidGraph, MermaidSubgraph, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { classifyRoutes, shapePorts, simplifyPolyline } from '../../route-contracts.ts'
import { DEFAULTS, calculatePathMidpoint, findSubgraph, layoutFlow, nodeCrossCenter, nodeCrossSize, nodeMainCenter, nodeMainSize } from '../geometry.ts'
import { doglegBetween, routeClearOfNodes } from './shared.ts'
import { minimumLinkRankGap } from '../link-rank-gap.ts'
import { onShapeOutline, segmentThroughShape } from '../../layout-rubric.ts'
import { isOutwardShapeApproach } from '../../shape-clipping.ts'
import { LayoutCertificationError } from '../certification-error.ts'
import { formatSvgNumber } from '../../shared/svg-number.ts'

export function honorLinkRankDistance(nodes: PositionedNode[], edges: PositionedEdge[], groups: PositionedGroup[], graph: MermaidGraph): void {
  if (!graph.edges.some(e => (e.length ?? 1) > 1)) return
  const classes = classifyRoutes(graph)
  const f = layoutFlow(graph.direction)
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const groupMap = new Map<string, PositionedGroup>()
  const flattenGroups = (gs: PositionedGroup[]): void => { for (const g of gs) { groupMap.set(g.id, g); flattenGroups(g.children) } }
  flattenGroups(groups)

  // A subgraph endpoint (`container` edge) expands to every node it encloses, so
  // shoving the unit moves the whole box. `cross-hierarchy` and `container` links
  // set rank distance just like `primary-forward`. A feedback edge constrains the
  // same two ranks in their geometric (forward) order: reverse its endpoints for
  // spacing, while leaving its authored direction and feedback route untouched.
  const collectMembers = (sg: MermaidSubgraph, acc: string[]): void => {
    for (const id of sg.nodeIds) acc.push(id)
    for (const child of sg.children) collectMembers(child, acc)
  }
  const unitNodes = (id: string): string[] => {
    if (nodeMap.has(id)) return [id]
    const sg = findSubgraph(graph.subgraphs, id)
    if (!sg) return []
    const acc: string[] = []
    collectMembers(sg, acc)
    return acc
  }

  // Subgraph membership path (outermost → innermost) for every node id.
  const scopeChainOf = new Map<string, string[]>()
  const walkScopes = (sgs: MermaidSubgraph[], ancestors: string[]): void => {
    for (const sg of sgs) {
      const chain = [...ancestors, sg.id]
      for (const id of sg.nodeIds) scopeChainOf.set(id, chain)
      walkScopes(sg.children, chain)
    }
  }
  walkScopes(graph.subgraphs, [])

  // The rigid unit a lengthened link moves: an individual node when the link
  // stays within the endpoints' shared scope, but the whole enclosing subgraph
  // when the link crosses into it — a subgraph (especially one with its own
  // direction override) is laid out as a unit, so shoving one inner node along
  // the outer axis would shear its internal arrangement.
  const movableUnit = (src: string, tgt: string): string[] => {
    if (groupMap.has(tgt)) return unitNodes(tgt)
    const tgtChain = scopeChainOf.get(tgt) ?? []
    const srcScopes = new Set(scopeChainOf.get(src) ?? [])
    if (groupMap.has(src)) srcScopes.add(src)
    for (const sgId of tgtChain) if (!srcScopes.has(sgId)) return unitNodes(sgId)
    return [tgt]
  }
  type RankConstraint = { source: string; target: string }
  const rankConstraint = (i: number): RankConstraint => {
    const edge = graph.edges[i]!
    if (classes[i] === 'feedback') return { source: edge.target, target: edge.source }
    return { source: edge.source, target: edge.target }
  }

  // Main-axis entry/exit of an endpoint that may be a node OR a subgraph box.
  const mainSpan = (id: string): { start: number; size: number } | null => {
    const n = nodeMap.get(id)
    if (n) return { start: n[f.main], size: nodeMainSize(n, graph.direction) }
    const g = groupMap.get(id)
    if (g) return { start: g[f.main], size: f.main === 'x' ? g.width : g.height }
    return null
  }
  const endpointEntry = (id: string): number | null => { const s = mainSpan(id); return s ? (f.sign === 1 ? s.start : s.start + s.size) : null }
  const endpointExit = (id: string): number | null => { const s = mainSpan(id); return s ? (f.sign === 1 ? s.start + s.size : s.start) : null }
  const isForwardish = (src: string, tgt: string): boolean => {
    const ex = endpointExit(src), en = endpointEntry(tgt)
    return ex !== null && en !== null && (en - ex) * f.sign > 0
  }

  // Forward adjacency over node ids, with subgraph endpoints expanded to members.
  const outgoing = new Map<string, string[]>()
  for (let i = 0; i < graph.edges.length; i++) {
    const constraint = rankConstraint(i)
    if (!isForwardish(constraint.source, constraint.target)) continue
    for (const u of unitNodes(constraint.source)) for (const v of unitNodes(constraint.target)) {
      if (!outgoing.has(u)) outgoing.set(u, [])
      outgoing.get(u)!.push(v)
    }
  }

  const mainDelta = new Map<string, number>() // net main-axis shift applied per node
  const changed = new Set<PositionedNode>()
  const moveSet = (starts: string[], delta: number): void => {
    if (Math.abs(delta) < 0.5) return
    const seen = new Set<string>()
    const stack = [...starts]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const n = nodeMap.get(id)
      if (n) {
        const previous = n[f.main]
        n[f.main] += delta
        if (n[f.main] !== previous) changed.add(n)
        mainDelta.set(id, (mainDelta.get(id) ?? 0) + delta)
      }
      for (const next of outgoing.get(id) ?? []) stack.push(next)
    }
  }

  // Capture each container's per-side insets (ELK's padding + label allowance)
  // before any node moves, so we can rebuild the box around the shifted members
  // afterwards without guessing the padding. Bottom-up so a parent box always
  // sees its children's rebuilt boxes.
  interface BoxBounds { x: number; y: number; r: number; b: number }
  interface Inset { l: number; t: number; r: number; b: number }
  const insetByGroup = new Map<string, Inset>()
  const groupMemberBounds = (group: PositionedGroup): BoxBounds | null => {
    let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity
    const sg = findSubgraph(graph.subgraphs, group.id)
    for (const id of sg?.nodeIds ?? []) {
      const n = nodeMap.get(id)
      if (!n) continue
      x = Math.min(x, n.x); y = Math.min(y, n.y)
      r = Math.max(r, n.x + n.width); b = Math.max(b, n.y + n.height)
    }
    for (const child of group.children) {
      x = Math.min(x, child.x); y = Math.min(y, child.y)
      r = Math.max(r, child.x + child.width); b = Math.max(b, child.y + child.height)
    }
    return Number.isFinite(x) ? { x, y, r, b } : null
  }
  const recordGroupInsets = (group: PositionedGroup): void => {
    for (const child of group.children) recordGroupInsets(child)
    const bb = groupMemberBounds(group)
    if (bb) insetByGroup.set(group.id, { l: bb.x - group.x, t: bb.y - group.y, r: group.x + group.width - bb.r, b: group.y + group.height - bb.b })
  }
  const regrowGroup = (group: PositionedGroup): void => {
    for (const child of group.children) regrowGroup(child) // rebuild children first
    const bb = groupMemberBounds(group)
    const ins = insetByGroup.get(group.id)
    if (!bb || !ins) return
    group.x = bb.x - ins.l
    group.y = bb.y - ins.t
    group.width = bb.r + ins.r - group.x
    group.height = bb.b + ins.b - group.y
  }
  for (const group of groups) recordGroupInsets(group)

  // ELK hands us non-overlapping boxes; the shove must hand them on. A moved
  // node can land on (or sweep past) a node outside its downstream closure —
  // the boxes then overlap and everything near them degenerates (nodeOverlaps,
  // then edgeThroughNode; issue #81). Snapshot the overlapping pairs (the
  // rubric's >0.5px box predicate) before any move so the repair below can be
  // scoped to exactly the pairs this pass introduces.
  const boxesOverlap = (a: PositionedNode, b: PositionedNode): boolean => {
    const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return ox > 0.5 && oy > 0.5
  }
  const pairKey = (a: PositionedNode, b: PositionedNode): string => (a.id < b.id ? `${a.id}\0${b.id}` : `${b.id}\0${a.id}`)
  const preShovePairs = new Set<string>()
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (boxesOverlap(nodes[i]!, nodes[j]!)) preShovePairs.add(pairKey(nodes[i]!, nodes[j]!))
  }
  interface ActivePair { a: PositionedNode; b: PositionedNode; key: string; index: number }
  // Index identity stays separate from the legacy string ordering/exclusion
  // key, which can collide for directly supplied IDs containing delimiters.
  const activePairs = new Map<number, ActivePair>()
  const refreshPair = (i: number, j: number): void => {
    const a = nodes[i]!, b = nodes[j]!, index = i * nodes.length + j
    const key = pairKey(a, b)
    if (preShovePairs.has(key) || !boxesOverlap(a, b)) activePairs.delete(index)
    else if (!activePairs.has(index)) activePairs.set(index, { a, b, key, index })
  }
  const refreshChangedPairs = (): void => {
    if (!changed.size) return
    if (changed.size > nodes.length / 2) {
      // Dense movement favors one simple triangular pass.
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) refreshPair(i, j)
    } else {
      for (let i = 0; i < nodes.length; i++) {
        if (!changed.has(nodes[i]!)) continue
        for (let j = 0; j < nodes.length; j++) {
          if (i === j || (j < i && changed.has(nodes[j]!))) continue
          refreshPair(Math.min(i, j), Math.max(i, j))
        }
      }
    }
    changed.clear()
  }

  for (let i = 0; i < graph.edges.length; i++) {
    const spec = graph.edges[i]!
    const constraint = rankConstraint(i)
    const length = spec.length ?? 1
    if (length <= 1) continue
    if (!isForwardish(constraint.source, constraint.target)) continue
    const exitS = endpointExit(constraint.source), entryT = endpointEntry(constraint.target)
    if (exitS === null || entryT === null) continue
    const currentGap = (entryT - exitS) * f.sign
    const minGap = minimumLinkRankGap(length, DEFAULTS.layerSpacing)
    if (currentGap < minGap) moveSet(movableUnit(constraint.source, constraint.target), (minGap - currentGap) * f.sign)
  }
  // Containment does not impose a forward sibling rank. With no actual move,
  // its existing inside-facing frame route must not be rebuilt as a dogleg.
  if (!changed.size) return
  refreshChangedPairs()

  // Treat the shove as physical: whatever it lands on is pushed ahead, never
  // sat on. The ahead node of each shove-introduced overlap moves further
  // forward (never backward — a backward move could re-compress a gap the loop
  // above just honoured), as a unit with its outermost subgraph that excludes
  // the other node. Forward-only motion cannot cycle, so the fixpoint
  // terminates; the round cap is a defensive bound, not an expected exit.
  const separationUnit = (id: string, other: string): string[] => {
    const otherScopes = new Set(scopeChainOf.get(other) ?? [])
    for (const sgId of scopeChainOf.get(id) ?? []) if (!otherScopes.has(sgId)) return unitNodes(sgId)
    return [id]
  }
  for (let round = 0; round < nodes.length * 4; round++) {
    let first: ActivePair | undefined
    for (const pair of activePairs.values()) {
      if (!first || pair.key < first.key || (pair.key === first.key && pair.index < first.index)) first = pair
    }
    if (!first) break
    const { a, b } = first
    const flowGap = (nodeMainCenter(a, graph.direction) - nodeMainCenter(b, graph.direction)) * f.sign
    const [behind, ahead] = (flowGap !== 0 ? flowGap > 0 : a.id > b.id) ? [b, a] : [a, b]
    const delta = f.sign === 1
      ? behind[f.main] + nodeMainSize(behind, graph.direction) + DEFAULTS.nodeSpacing - ahead[f.main]
      : ahead[f.main] + nodeMainSize(ahead, graph.direction) + DEFAULTS.nodeSpacing - behind[f.main]
    moveSet(separationUnit(ahead.id, behind.id), f.sign === 1 ? delta : -delta)
    refreshChangedPairs()
  }

  // Group boxes are still at their original positions until regrowth. Keep
  // only their scalar main spans, and only after an actual rank shove.
  const originalGroupSpans = new Map<string, { start: number; size: number }>()
  for (const [id, group] of groupMap) originalGroupSpans.set(id, { start: group[f.main], size: f.main === 'x' ? group.width : group.height })

  // Grow/translate every container so it still encloses its (possibly moved) members.
  for (const group of groups) regrowGroup(group)

  // Feedback edges escape to a lane just outside the node band on the
  // max-cross side (matching ELK's deterministic feedbackEdges placement). The
  // lane must clear every node so the back edge never grazes an intermediate
  // box after the gap widens.
  const FEEDBACK_LANE_GAP = 10
  const crossMaxEdge = (n: PositionedNode): number => nodeCrossCenter(n, graph.direction) + nodeCrossSize(n, graph.direction) / 2
  const crossMinEdge = (n: PositionedNode): number => nodeCrossCenter(n, graph.direction) - nodeCrossSize(n, graph.direction) / 2
  const laneCross = Math.max(...nodes.map(crossMaxEdge)) + FEEDBACK_LANE_GAP
  const laneCrossMin = Math.min(...nodes.map(crossMinEdge)) - FEEDBACK_LANE_GAP
  const point = (mainV: number, crossV: number): Point =>
    f.main === 'x' ? { x: mainV, y: crossV } : { x: crossV, y: mainV }

  // Attach point on the flow side of an endpoint that may be a node or a box.
  const flowPort = (id: string, side: 'N' | 'E' | 'S' | 'W'): Point | null => {
    const n = nodeMap.get(id)
    if (n) return shapePorts(n)[side]
    const g = groupMap.get(id)
    if (!g) return null
    const cx = g.x + g.width / 2, cy = g.y + g.height / 2
    switch (side) {
      case 'E': return { x: g.x + g.width, y: cy }
      case 'W': return { x: g.x, y: cy }
      case 'S': return { x: cx, y: g.y + g.height }
      default: return { x: cx, y: g.y }
    }
  }

  // Reconnection must respect the same full live header bands as final
  // admission, including endpoint ancestors and bands taller than their frame.
  const headersClear = (points: readonly Point[]): boolean => {
    for (const group of groupMap.values()) {
      if (group.concurrencyRegion || group.width === 0) continue
      const height = group.headerHeight ?? group.height
      if (!Number.isFinite(height) || height < 0) return false
      if (height === 0 || group.width <= 0) continue
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]!, b = points[index]!
        if (Math.max(a.x, b.x) > group.x && Math.min(a.x, b.x) < group.x + group.width
          && Math.max(a.y, b.y) > group.y && Math.min(a.y, b.y) < group.y + height) return false
      }
    }
    return true
  }

  // Free-channel centers: midpoints of the gaps between sorted box boundaries
  // along an axis — deterministic, obstacle-derived homes for detour segments
  // when a canonical route below is blocked. Intervals an orthogonal segment
  // cannot actually fit through (≤2px, given the 1px route clearance) are
  // skipped; blocked candidates are weeded out by routeClearOfNodes anyway.
  const channelCenters = (axis: 'x' | 'y'): number[] => {
    const stops = new Set<number>()
    for (const n of nodes) { stops.add(n[axis]); stops.add(n[axis] + (axis === 'x' ? n.width : n.height)) }
    for (const group of groupMap.values()) {
      const height = group.concurrencyRegion ? 0 : group.headerHeight ?? group.height
      if (!(height > 0 && Number.isFinite(height) && group.width > 0)) continue
      stops.add(group[axis]); stops.add(group[axis] + (axis === 'x' ? group.width : height))
    }
    const sorted = [...stops].sort((a, b) => a - b)
    const centers: number[] = []
    for (let i = 1; i < sorted.length; i++) if (sorted[i]! - sorted[i - 1]! > 2) centers.push((sorted[i]! + sorted[i - 1]!) / 2)
    // Midpoints alone cannot bypass two aligned ancestor headers. Reuse the
    // existing outer-lane clearance, still capped by byProximity's 16 choices.
    if (axis === f.cross && groupMap.size && sorted.length > 0) {
      centers.push(sorted[0]! - FEEDBACK_LANE_GAP, sorted.at(-1)! + FEEDBACK_LANE_GAP)
    }
    return centers
  }
  const crossAxis: 'x' | 'y' = f.main === 'x' ? 'y' : 'x'
  const byProximity = (values: number[], anchor: number): number[] =>
    [...values].sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b).slice(0, 16)

  const groupParents = new Map<string, string | undefined>()
  const retainParents = (items: MermaidSubgraph[], parent?: string): void => {
    for (const group of items) { groupParents.set(group.id, parent); retainParents(group.children, group.id) }
  }
  retainParents(graph.subgraphs)
  const containsEndpoint = (group: string, endpoint: string): boolean => {
    if ((scopeChainOf.get(endpoint) ?? []).includes(group)) return true
    for (let parent = groupParents.get(endpoint); parent !== undefined; parent = groupParents.get(parent)) if (parent === group) return true
    return false
  }
  const ownBodiesClear = (points: Point[], edge: PositionedEdge): boolean => {
    for (const id of [edge.source, edge.target]) {
      const node = nodeMap.get(id)
      if (!node) continue
      for (let index = 1; index < points.length; index++) if (segmentThroughShape(points[index - 1]!, points[index]!, node)) return false
    }
    return true
  }
  const contactDelta = (id: string): number | undefined => {
    const node = nodeMap.get(id), group = groupMap.get(id), original = originalGroupSpans.get(id)
    return node ? mainDelta.get(id) ?? 0 : group && original ? group[f.main] - original.start : undefined
  }
  interface StretchSpan { start: number; size: number; delta: number }
  const stretchSpan = (id: string, other: string): StretchSpan | null => {
    const node = nodeMap.get(id), delta = mainDelta.get(id) ?? 0
    const otherScopes = new Set(scopeChainOf.get(other) ?? [])
    if (groupMap.has(other)) otherScopes.add(other)
    const owner = groupMap.has(id) ? id : (scopeChainOf.get(id) ?? []).find(scope => !otherScopes.has(scope))
    if (owner && groupMap.has(owner)) {
      const original = originalGroupSpans.get(owner)!, group = groupMap.get(owner)!, members = unitNodes(owner)
      const shift = members.length ? mainDelta.get(members[0]!) ?? 0 : 0
      if (members.every(member => (mainDelta.get(member) ?? 0) === shift)
        && (f.main === 'x' ? group.width : group.height) === original.size) {
        // Regrowth can round a frame differently from adding the requested
        // node delta. Its retained physical displacement owns boundary ports.
        return { ...original, delta: group[f.main] - original.start }
      }
      if (!node) return null
    }
    return node ? { start: node[f.main] - delta, size: nodeMainSize(node, graph.direction), delta } : null
  }
  const stretchRetainedRoute = (edge: PositionedEdge): Point[] | null => {
    const source = stretchSpan(edge.source, edge.target), target = stretchSpan(edge.target, edge.source)
    if (!source || !target || edge.points.length < 2) return null
    const [left, right] = source.start <= target.start ? [source, target] : [target, source]
    const lowEnd = left.start + left.size, highStart = right.start
    const oldGap = highStart - lowEnd, newGap = highStart + right.delta - (lowEnd + left.delta)
    // Overlapping/ambiguous units or a collapsed mapping cannot preserve the
    // original route topology. Let the existing bounded constructors try.
    const uniform = source.delta === target.delta && Number.isFinite(source.delta)
    if (!uniform && !(oldGap > 0 && newGap > 0 && [lowEnd, highStart, oldGap, newGap, left.delta, right.delta].every(Number.isFinite))) return null
    const scale = uniform ? 1 : newGap / oldGap
    if (!(scale > 0 && Number.isFinite(scale))) return null
    const project = (value: number): number => uniform ? value + source.delta
      : value <= lowEnd ? value + left.delta : value >= highStart ? value + right.delta
        : lowEnd + left.delta + (value - lowEnd) * scale
    const points = edge.points.map(point => ({ ...point, [f.main]: project(point[f.main]) }))
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null
    // Positive mathematical slope must also retain strict coordinate order
    // in Float64; a rounded collapse could create a new route contact.
    const order = edge.points.map(point => point[f.main]).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    for (let index = 1; index < order.length; index++) if (order[index]! > order[index - 1]!
      && !(project(order[index]!) > project(order[index - 1]!))) return null
    // Hierarchical ELK sections can join one arithmetic roundoff apart. Keep
    // their raw contacts, accepting only seams that also paint at the same
    // coordinate; a real diagonal still cannot borrow this cardinal proof.
    const sameCoordinate = (a: number, b: number): boolean => a === b
      || Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) && formatSvgNumber(a) === formatSvgNumber(b)
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!
      if (!sameCoordinate(a.x, b.x) && !sameCoordinate(a.y, b.y)) return null
      for (const node of nodes) if (segmentThroughShape(a, b, node)) return null
    }
    const sourceDelta = contactDelta(edge.source), targetDelta = contactDelta(edge.target)
    if (sourceDelta === undefined || targetDelta === undefined
      || points[0]![f.main] !== edge.points[0]![f.main] + sourceDelta
      || points.at(-1)![f.main] !== edge.points.at(-1)![f.main] + targetDelta) return null
    if (!contactsClear(points, edge)) return null
    const ends = new Set([edge.source, edge.target])
    return routeClearOfNodes(points, nodes, ends) && headersClear(points) ? points : null
  }

  const translatedContact = (id: string, old: Point | undefined): Point | null => {
    if (!old) return null
    const delta = contactDelta(id)
    if (delta === undefined) return null
    return { ...old, [f.main]: old[f.main] + delta }
  }
  const contactsClear = (points: Point[], edge: PositionedEdge): boolean => {
    for (const [id, start] of [[edge.source, true], [edge.target, false]] as const) {
      const node = nodeMap.get(id), group = groupMap.get(id)
      const owner = node ?? (group ? { id: group.id, label: group.label, shape: 'rectangle' as const, x: group.x, y: group.y, width: group.width, height: group.height } : undefined)
      if (!owner) return false
      const port = start ? points[0] : points.at(-1)
      if (!port) return false
      let neighbor: Point | undefined
      for (let index = start ? 1 : points.length - 2; index >= 0 && index < points.length; index += start ? 1 : -1) {
        const point = points[index]!
        if (point.x !== port.x || point.y !== port.y) { neighbor = point; break }
      }
      if (!neighbor || !onShapeOutline(owner, port)) return false
      // A frame connected to its own descendant is contacted from its inside.
      // All leaf contacts and external frame contacts retain outward normals.
      const inward = !node && containsEndpoint(id, start ? edge.target : edge.source)
      const ray = inward ? { x: port.x - (neighbor.x - port.x), y: port.y - (neighbor.y - port.y) } : neighbor
      if (!Number.isFinite(ray.x) || !Number.isFinite(ray.y) || !isOutwardShapeApproach(owner, port, ray)) return false
    }
    return true
  }

  // Reconnect every edge after the rank-distance move so no endpoint is left
  // pointing at a node's pre-move position (which would trip the route-staleness
  // certifier). Primary-forward / cross-hierarchy / container links get a forward
  // dogleg between their (node or box) ports; feedback (back) edges re-loop
  // through the outer lane; self-loops ride along with their moved node.
  // applyRouteContracts certifies the final geometry.
  for (const edge of edges) {
    const cls = edge.edgeIndex !== undefined ? (classes[edge.edgeIndex] ?? 'primary-forward') : 'primary-forward'
    if (cls === 'self-loop') {
      const delta = mainDelta.get(edge.source) ?? 0
      if (delta !== 0) edge.points = edge.points.map(point => ({ ...point, [f.main]: point[f.main] + delta }))
      if (delta !== 0 && edge.labelPosition) edge.labelPosition[f.main] += delta
      continue
    }
    const preserveContacts = groupMap.size > 0 && (cls === 'cross-hierarchy' || cls === 'container')
    const retained = preserveContacts ? stretchRetainedRoute(edge) : null
    if (retained) {
      edge.points = retained
      if (edge.label) edge.labelPosition = calculatePathMidpoint(retained)
      continue
    }
    if (cls === 'feedback') {
      const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
      if (!source || !target) continue
      // Feedback U-detour: drop to the outer lane at the source, run back along
      // it, and rise into the target — both anchored at the max-cross side. A
      // riser can cross a bystander sitting between the node and the lane
      // (issue #81's no-overlap residual). When — and only when — the max-side
      // U is blocked, fall back deterministically: the min-side lane, then a
      // rung variant per lane that leaves the lane at a free channel and
      // approaches the blocked endpoint through a clear column (the center
      // anchors stay on-outline for every shape, unlike sliding a riser
      // off-center). If everything is blocked, keep the canonical max-side
      // route for the post-freeze net to repair.
      const mSrc = nodeMainCenter(source, graph.direction), mTgt = nodeMainCenter(target, graph.direction)
      const uDetour = (lane: number, edgeCross: (n: PositionedNode) => number): Point[] => [
        point(mSrc, edgeCross(source)), point(mSrc, lane), point(mTgt, lane), point(mTgt, edgeCross(target)),
      ]
      const rungTarget = (lane: number, edgeCross: (n: PositionedNode) => number, mRung: number, col: number): Point[] => [
        point(mSrc, edgeCross(source)), point(mSrc, lane), point(mRung, lane), point(mRung, col), point(mTgt, col), point(mTgt, edgeCross(target)),
      ]
      const rungSource = (lane: number, edgeCross: (n: PositionedNode) => number, mRung: number, col: number): Point[] => [
        point(mSrc, edgeCross(source)), point(mSrc, col), point(mRung, col), point(mRung, lane), point(mTgt, lane), point(mTgt, edgeCross(target)),
      ]
      const ends = new Set([edge.source, edge.target])
      const clear = (pts: Point[]): boolean => routeClearOfNodes(simplifyPolyline(pts), nodes, ends) && headersClear(pts)
      const lanes: Array<[number, (n: PositionedNode) => number]> = [[laneCross, crossMaxEdge], [laneCrossMin, crossMinEdge]]
      let route: Point[] | undefined
      for (const [lane, edgeCross] of lanes) {
        const candidate = uDetour(lane, edgeCross)
        if (clear(candidate)) { route = candidate; break }
      }
      if (!route) {
        const rungMains = byProximity(channelCenters(f.main === 'x' ? 'x' : 'y'), mTgt)
        search: for (const [lane, edgeCross] of lanes) {
          const cols = byProximity(channelCenters(crossAxis), edgeCross(target))
          for (const build of [rungTarget, rungSource]) {
            for (const mRung of rungMains) {
              for (const col of cols) {
                const candidate = build(lane, edgeCross, mRung, col)
                if (clear(candidate)) { route = simplifyPolyline(candidate); break search }
              }
            }
          }
        }
      }
      edge.points = route ?? uDetour(laneCross, crossMaxEdge)
      if (edge.label) edge.labelPosition = calculatePathMidpoint(edge.points)
      continue
    }
    const start = preserveContacts ? translatedContact(edge.source, edge.points[0]) : flowPort(edge.source, f.sourceSide)
    const end = preserveContacts ? translatedContact(edge.target, edge.points.at(-1)) : flowPort(edge.target, f.targetSide)
    if (!start || !end) continue
    // A midpoint elbow can put the dogleg's cross run or its entry riser
    // through a bystander box. When — and only when — the midpoint dogleg is
    // blocked, fall back deterministically: single elbows at free-channel
    // centers between the ports (nearest the midpoint first), then a
    // double-elbow staircase whose cross run rides a free column (the rep2
    // shape in eval/degenerate-etn: a bystander sitting over the target's
    // entry port, threadable only through the channel beside it). If every
    // variant is blocked, keep the midpoint for the post-freeze net to repair.
    const ends = new Set([edge.source, edge.target])
    const clear = (pts: Point[]): boolean => routeClearOfNodes(pts, nodes, ends) && headersClear(pts) && (!preserveContacts || contactsClear(pts, edge) && ownBodiesClear(pts, edge))
    const lo = Math.min(start[f.main], end[f.main]), hi = Math.max(start[f.main], end[f.main])
    let route = doglegBetween(start, end, graph.direction, (lo + hi) / 2)
    let proved = clear(route)
    if (!proved) {
      let found: Point[] | undefined
      const mains = byProximity(channelCenters(f.main === 'x' ? 'x' : 'y').filter(m => m > lo && m < hi), (lo + hi) / 2)
      for (const m of mains) {
        const candidate = doglegBetween(start, end, graph.direction, m)
        if (clear(candidate)) { found = candidate; break }
      }
      if (!found) {
        const cS = start[crossAxis], cE = end[crossAxis]
        const cols = byProximity(channelCenters(crossAxis), (cS + cE) / 2)
        staircase: for (const col of cols) {
          for (const m1 of mains) {
            for (const m2 of byProximity(mains.filter(m => (m - m1) * f.sign > 0), end[f.main])) {
              const candidate = simplifyPolyline([start, point(m1, cS), point(m1, col), point(m2, col), point(m2, cE), end])
              if (clear(candidate)) { found = candidate; break staircase }
            }
          }
        }
      }
      if (found) { route = found; proved = true }
    }
    if (preserveContacts && !proved) throw new LayoutCertificationError([{
      strategy: 'link-rank-reconnect', violations: [`edge ${edge.source}->${edge.target}: no proven contact-preserving route after rank move`],
    }])
    edge.points = route
    if (edge.label) edge.labelPosition = calculatePathMidpoint(edge.points)
  }
}
