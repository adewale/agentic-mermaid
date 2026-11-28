import type { Direction, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import type { ResolvedRenderStyle } from '../../styles.ts'
import { shapeOutline } from '../../shape-outline.ts'
import { clipEdgeToShape } from '../../shape-clipping.ts'
import { nodePaintBounds, paintedStrokeExtent } from '../../scene/bounds.ts'
import { shape } from '../../scene/marks.ts'
import { formatSvgNumber } from '../../shared/svg-number.ts'
import { routeCandidateMarkerBlocker, routeMarkerPaintRegions } from '../route-marker-clearance.ts'
import { ARRIVAL_SLOT_PITCH, MIN_ARRIVAL_SLOT_PITCH, paintsAlike, terminalAssignment, type TerminalAssignment, type TerminalEnd } from '../terminal-assignment.ts'
import { retainConstructedBundleRoutes } from '../bundle-routes.ts'
import { opposingRoutePartners } from '../../shared/edge-overlaps.ts'
import { countPointPairCrossings } from '../../shared/edge-crossing-pair.ts'
import { bendCount, RECT_LIKE, terminalHookLength } from '../route-geometry.ts'
import { measureRouteContacts } from '../../shared/edge-crossings.ts'
import { hookedElbow } from './shared.ts'
import { joinTerminal } from './arrival-slots.ts'

/** Keeps a member's end off the corners of its face. */
const MEMBER_FACE_MARGIN = 5

/**
 * Find all groups (outermost first) that geometrically contain the given point.
 */
function findGroupsContainingPoint(
  x: number, y: number,
  groups: PositionedGroup[]
): PositionedGroup[] {
  const result: PositionedGroup[] = []
  for (const g of groups) {
    if (x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height) {
      result.push(g)
      result.push(...findGroupsContainingPoint(x, y, g.children))
    }
  }
  return result
}

/** Rebuilt bundles are optional. Their complete shaft and marker paint must
 * clear foreign artwork and full reserved header bands before publication. */
function bundlePathClear(
  edge: PositionedEdge,
  nodes: PositionedNode[],
  groups: readonly PositionedGroup[],
  style: ResolvedRenderStyle,
): boolean {
  const numericWidth = (authored: string | undefined, fallback: number): number | undefined => {
    if (authored !== undefined && !/^\s*[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(authored)) return undefined
    const n = authored === undefined ? fallback : Number.parseFloat(authored)
    return Number.isFinite(n) && n >= 0 ? Number(formatSvgNumber(n)) : undefined
  }
  const stroke = numericWidth(edge.inlineStyle?.['stroke-width'], style.lineWidth * (edge.style === 'thick' ? 2 : 1))
  const radius = style.edgeBendRadius
  if (stroke === undefined || !Number.isFinite(radius) || radius < 0) return false
  const extent = paintedStrokeExtent({ stroke: '#000', strokeWidth: String(stroke) }, true)
  if (extent === undefined) return false
  const pad = extent + radius
  const points = edge.points.map(p => ({ x: Number(formatSvgNumber(p.x)), y: Number(formatSvgNumber(p.y)) }))
  if (!points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return false
  const shafts = points.slice(1).map((b, i) => {
    const a = points[i]!
    return { x0: Math.min(a.x, b.x) - pad, x1: Math.max(a.x, b.x) + pad, y0: Math.min(a.y, b.y) - pad, y1: Math.max(a.y, b.y) + pad }
  })
  const overlap = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }): boolean => {
    const error = (Math.abs(a.x0) + Math.abs(a.x1) + Math.abs(a.y0) + Math.abs(a.y1) + Math.abs(b.x0) + Math.abs(b.x1) + Math.abs(b.y0) + Math.abs(b.y1)) * 1e-10 + 1e-9
    return !Number.isFinite(error) || a.x1 + error > b.x0 && a.x0 < b.x1 + error && a.y1 + error > b.y0 && a.y0 < b.y1 + error
  }
  const markers = routeMarkerPaintRegions(edge, style)
  if (!markers || markers.length !== Number(Boolean(edge.hasArrowStart)) + Number(Boolean(edge.hasArrowEnd))) return false
  for (const node of nodes) {
    const border = numericWidth(node.inlineStyle?.['stroke-width'], style.nodeLineWidth)
    if (border === undefined) return false
    const outline = shapeOutline(node, { fill: '#000', stroke: '#000', strokeWidth: String(border) }, style.cornerRadius)
    const box = nodePaintBounds(shape({ id: node.id, role: 'node', geometry: outline.geometry, paint: outline.paint,
      ...(outline.childPaints ? { childPaints: outline.childPaints } : {}) }))
    if (!box) return false
    if (node.id !== edge.source && node.id !== edge.target && shafts.some(shaft => overlap(shaft, box))) return false
    for (const marker of markers) {
      const owner = marker.position === 'start' ? edge.source : edge.target
      if (owner !== node.id && (!marker.bounds || overlap(marker.bounds, box))) return false
    }
  }
  const headerClear = (group: PositionedGroup): boolean => {
    const height = group.concurrencyRegion ? 0 : group.headerHeight ?? group.height
    if (height > 0) {
      const band = { x0: group.x, x1: group.x + group.width, y0: group.y, y1: group.y + height }
      if (shafts.some(shaft => overlap(shaft, band)) || markers.some(marker => !marker.bounds || overlap(marker.bounds, band))) return false
    }
    return group.children.every(headerClear)
  }
  return groups.every(headerClear)
}

/**
 * If `junction` falls inside a group that doesn't contain the reference node,
 * move it just outside the outermost such group boundary.
 */
function adjustJunctionForGroups(
  junctionMain: number,  // the junction coordinate along the flow axis (Y for TD, X for LR)
  refX: number,          // reference node center X (for finding its groups)
  refY: number,          // reference node center Y
  groups: PositionedGroup[],
  direction: Direction
): number {
  const GAP = 12
  const isLR = direction === 'LR'
  const isRL = direction === 'RL'
  const isBT = direction === 'BT'
  const isHorizontal = isLR || isRL

  // Groups containing the reference node
  const refGroupIds = new Set(findGroupsContainingPoint(refX, refY, groups).map(g => g.id))

  // Check where the junction point would be along the trunk
  const probeX = isHorizontal ? junctionMain : refX
  const probeY = isHorizontal ? refY : junctionMain
  const junctionGroups = findGroupsContainingPoint(probeX, probeY, groups)

  // Find outermost group containing the junction but NOT the reference node
  const crossingGroup = junctionGroups.find(g => !refGroupIds.has(g.id))
  if (!crossingGroup) return junctionMain

  // Move junction just outside this group
  if (isLR) return crossingGroup.x - GAP
  if (isRL) return crossingGroup.x + crossingGroup.width + GAP
  if (isBT) return crossingGroup.y + crossingGroup.height + GAP
  return crossingGroup.y - GAP // TD
}

/**
 * Bundle fan-out and fan-in edge paths so they share a common trunk segment.
 *
 * For fan-out (one source → N targets), all edges exit the source at the same
 * point, travel along a shared trunk, then branch to their individual targets.
 * The overlapping trunk segments render as a single visible line.
 *
 * Junction points are placed outside subgraph boundaries so branches split
 * before entering a group, not inside it.
 *
 * Constraints: edges in a bundle must share the same style and have no labels.
 * Self-loops and backward edges (against the graph direction) are excluded.
 *
 * Returns the set of edges whose paths the bundler owns, so the route-contract
 * pass never straightens a trunk-shared path.
 */
export function bundleEdgePaths(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  direction: Direction,
  style: ResolvedRenderStyle,
  terminals: TerminalAssignment = terminalAssignment(edges),
): Set<PositionedEdge> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const processed = new Set<PositionedEdge>()
  // A shared trunk also shares its endpoint glyph: every two members' shared
  // ends must be allowed to share one terminal. Repeated pairs are never members.
  const unshareable = (group: readonly PositionedEdge[], end: TerminalEnd, duplicates: ReadonlySet<PositionedEdge>): boolean => {
    const members = group.filter(edge => !duplicates.has(edge))
    return group.some(edge => edge.label) || members.some((a, i) => members.some((b, j) => j > i && !terminals.shares(a, b, end)))
  }
  // Two routes whose ink meets read as reaching each other's targets. That
  // reading misleads unless both crossed readings are real edges painted
  // alike (a complete bipartite join).
  const realEdge = (source: string, target: string, paint: PositionedEdge) => edges.some(edge => edge.source === source && edge.target === target
    && edge.style !== 'invisible' && paintsAlike(paint, edge)
    && edge.hasArrowStart === paint.hasArrowStart && edge.hasArrowEnd === paint.hasArrowEnd
    && (edge.startMarker ?? 'arrow') === (paint.startMarker ?? 'arrow') && (edge.endMarker ?? 'arrow') === (paint.endMarker ?? 'arrow'))
  const misleads = (member: PositionedEdge, other: PositionedEdge) => !paintsAlike(member, other)
    || !realEdge(member.source, other.target, member) || !realEdge(other.source, member.target, other)
  const admittedMembers = <T extends { edge: PositionedEdge }>(members: T[], candidates: Map<PositionedEdge, Point[]>): T[] => {
    for (const [edge, points] of candidates) {
      const source = nodeMap.get(edge.source)!, target = nodeMap.get(edge.target)!
      candidates.set(edge, clipEdgeToShape(clipEdgeToShape(points, source, true), target, false))
    }
    const staged = edges.map(edge => candidates.has(edge) ? { ...edge, points: candidates.get(edge)! } : edge)
    // Ink shared in opposite directions reads as a bus: each route seems to
    // reach the other's target. A trunk may run back along another edge only
    // where both readings are real edges painted alike (misleads), never
    // along e.g. the reverse route leaving the same port.
    const opposingAdded = (member: PositionedEdge, candidate: PositionedEdge): boolean => {
      const others = edges.filter(edge => edge !== member)
      const before = new Set(opposingRoutePartners(member, others))
      return opposingRoutePartners(candidate, others).some(other => !before.has(other) && misleads(member, other))
    }
    return members.filter(member => {
      const points = candidates.get(member.edge)!
      const candidate = staged[edges.indexOf(member.edge)]!
      return bundlePathClear(candidate, nodes, groups, style)
        && !routeCandidateMarkerBlocker(member.edge, points, staged, style, candidate)
        && !opposingAdded(member.edge, candidate)
    })
  }

  const isLR = direction === 'LR'
  const isRL = direction === 'RL'
  const isBT = direction === 'BT'
  const isHorizontal = isLR || isRL
  const memberHook = (members: ReadonlyArray<{ edge: PositionedEdge }>, end: 'start' | 'end'): number =>
    Math.max(...members.map(({ edge }) => terminalHookLength(style, edge, end)))

  // Lanes a member's own end may take across the flow: anywhere on a flat
  // face, else only its centre port.
  const across = isHorizontal ? 'y' : 'x'
  const lanes = (node: PositionedNode): [number, number] => {
    const start = node[across], size = across === 'x' ? node.width : node.height
    return RECT_LIKE.has(node.shape) && size > 2 * MEMBER_FACE_MARGIN ? [start + MEMBER_FACE_MARGIN, start + size - MEMBER_FACE_MARGIN] : [start + size / 2, start + size / 2]
  }
  /** The hub's lane when the member's own face can take it, so a member
   * aligned with the hub joins the trunk straight; else the member's centre. */
  const memberLane = (node: PositionedNode, hubLane: number, axis: 'x' | 'y'): number => {
    const [lo, hi] = lanes(node)
    return hubLane >= lo && hubLane <= hi ? hubLane : node[axis] + (axis === 'x' ? node.width : node.height) / 2
  }
  /** The outermost member, when its two ends share a lane across the flow
   * that lies beyond the hub's port on its own side: it can run straight on
   * its own, clear of the trunk and of every other branch. */
  const straightOutside = (members: ReadonlyArray<{ edge: PositionedEdge; node: PositionedNode }>, hubLane: number): PositionedEdge | undefined => {
    const centre = (node: PositionedNode) => node[across] + (across === 'x' ? node.width : node.height) / 2
    const ordered = [...members].sort((a, b) => centre(a.node) - centre(b.node))
    for (const [member, side] of [[ordered[0]!, -1], [ordered.at(-1)!, 1]] as const) {
      const source = nodeMap.get(member.edge.source), target = nodeMap.get(member.edge.target)
      if (!source || !target) continue
      const [a0, a1] = lanes(source), [b0, b1] = lanes(target)
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1)
      if (hi - lo >= ARRIVAL_SLOT_PITCH && (side > 0 ? lo >= hubLane + MIN_ARRIVAL_SLOT_PITCH : hi <= hubLane - MIN_ARRIVAL_SLOT_PITCH)) return member.edge
    }
    return undefined
  }

  // A bundle trades separate shafts for one trunk. It is worth publishing only
  // when the drawing loses nothing by the trade: no more crossings with
  // foreign shafts, no more bends, and no more contact. Contact is what the
  // crossing count cannot see: ink touching or running within the clearance
  // of an unrelated route (measureRouteContacts at the router clearance; a
  // shared run is worse than a touch), or an end landing beside, or on,
  // an end of a shared node it may not share a terminal with. Contact that
  // reads only real edges (misleads) is no loss. A foreign end that may share
  // a member's new terminal but would sit beside it joins it instead, when
  // its terminal run can slide there: one arrowhead replaces two overlapping
  // ones, so the slide's bends are not charged. Bends are charged against a
  // member's current route only while it is attached to its nodes; a route a
  // node mover left detached has no bends to keep.
  type Join = { points: Point[]; labelPosition: PositionedEdge['labelPosition'] }
  const onBox = (point: Point, node: PositionedNode | undefined) => !!node && point.x >= node.x - 1 && point.x <= node.x + node.width + 1
    && point.y >= node.y - 1 && point.y <= node.y + node.height + 1
  const attached = (edge: PositionedEdge) => onBox(edge.points[0]!, nodeMap.get(edge.source)) && onBox(edge.points.at(-1)!, nodeMap.get(edge.target))
  const endsOf = (edge: PositionedEdge, points: readonly Point[]) => [[edge.source, points[0]!, 'start'], [edge.target, points.at(-1)!, 'end']] as const
  const stageJoin = (other: PositionedEdge, node: string, at: Point, end: TerminalEnd, joins: Map<PositionedEdge, Join>): boolean => {
    const staged = joins.get(other)
    if (staged) {
      const tip = end === 'end' ? staged.points.at(-1)! : staged.points[0]!
      return Math.hypot(tip.x - at.x, tip.y - at.y) <= 1e-6
    }
    const host = nodeMap.get(node)
    if (!host) return false
    const saved: Join = { points: other.points, labelPosition: other.labelPosition }
    const joined = joinTerminal(other, host, at, end)
    if (joined) joins.set(other, { points: other.points, labelPosition: other.labelPosition })
    other.points = saved.points
    other.labelPosition = saved.labelPosition
    return joined
  }
  const related = (a: PositionedEdge, b: PositionedEdge) => [a.source, a.target].some(node => node === b.source || node === b.target)
  /** Contact between the ink of two unrelated routes; a shared run is worse
   * than a touch. */
  const inkContact = (a: PositionedEdge, aPoints: readonly Point[], b: PositionedEdge, bPoints: readonly Point[]): number => {
    if (!misleads(a, b)) return 0
    const met = measureRouteContacts([{ points: aPoints, ends: [a.source, a.target] }, { points: bPoints, ends: [b.source, b.target] }])
    return 2 * met.overlaps + met.touches
  }
  const contact = (member: PositionedEdge, points: readonly Point[], other: PositionedEdge, joins?: Map<PositionedEdge, Join>): number => {
    const memberEnds = endsOf(member, points), otherEnds = endsOf(other, other.points)
    if (!related(member, other)) return inkContact(member, points, other, other.points)
    let near = 0
    for (const [node, at, end] of memberEnds) for (const [peer, otherAt, otherEnd] of otherEnds) {
      if (peer !== node) continue
      const gap = Math.hypot(at.x - otherAt.x, at.y - otherAt.y)
      if (gap >= MIN_ARRIVAL_SLOT_PITCH) continue
      const shares = end === otherEnd && terminals.shares(member, other, end)
      if (shares && (gap <= 1e-6 || joins && stageJoin(other, node, at, end, joins))) continue
      near++
    }
    return near
  }
  /** The joins a bundle's trade needs, or undefined when it worsens the drawing. */
  const tradeJoins = (members: ReadonlyArray<{ edge: PositionedEdge }>, candidates: ReadonlyMap<PositionedEdge, Point[]>): Map<PositionedEdge, Join> | undefined => {
    const own = new Set(members.map(member => member.edge))
    const foreign = edges.filter(edge => !own.has(edge) && edge.style !== 'invisible' && edge.points.length >= 2)
    const joins = new Map<PositionedEdge, Join>()
    let crossings = 0, bends = 0
    for (const { edge } of members) {
      const after = candidates.get(edge)!
      if (attached(edge)) bends += bendCount(after) - bendCount(edge.points)
      for (const other of foreign) {
        crossings += countPointPairCrossings(after, other.points) - countPointPairCrossings(edge.points, other.points)
        if (contact(edge, after, other, joins) > contact(edge, edge.points, other) + 1e-6) return undefined
      }
    }
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      crossings -= countPointPairCrossings(members[i]!.edge.points, members[j]!.edge.points)
    }
    // A joined end moves its route: that route may gain no contact either.
    const placed = (edge: PositionedEdge) => candidates.get(edge) ?? joins.get(edge)?.points ?? edge.points
    for (const [edge, join] of joins) for (const other of edges) {
      if (other === edge || other.style === 'invisible' || other.points.length < 2 || related(edge, other)) continue
      if (inkContact(edge, join.points, other, placed(other)) > inkContact(edge, edge.points, other, placed(other))) return undefined
    }
    return crossings > 0 || bends > 0 ? undefined : joins
  }

  // --- Fan-out: group edges by shared source ---
  const fanOutGroups = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (!fanOutGroups.has(edge.source)) fanOutGroups.set(edge.source, [])
    fanOutGroups.get(edge.source)!.push(edge)
  }
  // A fan shares only part of a relationship. Repeated endpoint pairs need
  // their own lanes: rebuilding their complete paths would hide multiplicity.
  // Reuse the source buckets; a chain needs no per-source target map.
  const duplicateEdges = new Set<PositionedEdge>()
  for (const group of fanOutGroups.values()) {
    if (group.length < 2) continue
    const targets = new Map<string, PositionedEdge>()
    for (const edge of group) {
      const prior = targets.get(edge.target)
      if (prior) { duplicateEdges.add(prior); duplicateEdges.add(edge) }
      else targets.set(edge.target, edge)
    }
  }

  for (const [sourceId, group] of fanOutGroups) {
    if (group.length < 2) continue

    if (unshareable(group, 'start', duplicateEdges)) continue

    const source = nodeMap.get(sourceId)
    if (!source) continue

    // Only bundle edges going in the forward direction
    const forward = group.filter(e => {
      if (duplicateEdges.has(e)) return false
      const t = nodeMap.get(e.target)
      if (!t) return false
      if (isLR) return t.x > source.x + source.width
      if (isRL) return t.x + t.width < source.x
      if (isBT) return t.y + t.height < source.y
      return t.y > source.y + source.height // TD/TB
    })
    if (forward.length < 2) continue

    const srcCX = source.x + source.width / 2
    const srcCY = source.y + source.height / 2

    // Bundle contract: rebuild candidate paths, drop any member whose path
    // would pass through a node (it keeps its ELK route and the route-contract
    // pass certifies it), and re-derive the junction from the members that
    // remain — until the bundle is clear or too small to exist.
    let members = forward.map(e => ({ edge: e, node: nodeMap.get(e.target)! }))
    while (members.length >= 2) {
      const candidates = new Map<PositionedEdge, Point[]>()
      if (isHorizontal) {
        const exitX = isLR ? source.x + source.width : source.x
        const exitY = srcCY

        const nearestX = isLR
          ? Math.min(...members.map(t => t.node.x))
          : Math.max(...members.map(t => t.node.x + t.node.width))
        let junctionX = hookedElbow(exitX, nearestX, memberHook(members, 'start'), memberHook(members, 'end'))
        junctionX = adjustJunctionForGroups(junctionX, srcCX, srcCY, groups, direction)

        for (const { edge, node: target } of members) {
          const entryX = isLR ? target.x : target.x + target.width
          const entryY = memberLane(target, exitY, 'y')
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: junctionX, y: exitY },
            { x: junctionX, y: entryY },
            { x: entryX, y: entryY },
          ])
        }
      } else {
        const exitX = srcCX
        const exitY = isBT ? source.y : source.y + source.height

        const nearestY = isBT
          ? Math.max(...members.map(t => t.node.y + t.node.height))
          : Math.min(...members.map(t => t.node.y))
        let junctionY = hookedElbow(exitY, nearestY, memberHook(members, 'start'), memberHook(members, 'end'))
        junctionY = adjustJunctionForGroups(junctionY, srcCX, srcCY, groups, direction)

        for (const { edge, node: target } of members) {
          const entryX = memberLane(target, exitX, 'x')
          const entryY = isBT ? target.y + target.height : target.y
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: exitX, y: junctionY },
            { x: entryX, y: junctionY },
            { x: entryX, y: entryY },
          ])
        }
      }

      // A member that could run straight on its own keeps its route rather
      // than buy bends to join the trunk.
      const alone = straightOutside(members, isHorizontal ? srcCY : srcCX)
      if (alone && bendCount(candidates.get(alone)!) > 0) { members = members.filter(member => member.edge !== alone); continue }
      const clear = admittedMembers(members, candidates)
      if (clear.length === members.length) {
        const joins = tradeJoins(members, candidates)
        if (!joins) break
        for (const { edge } of members) {
          edge.points = candidates.get(edge)!
        }
        for (const [edge, join] of joins) {
          edge.points = join.points
          edge.labelPosition = join.labelPosition
        }
        retainConstructedBundleRoutes(members.map(member => member.edge), processed)
        break
      }
      members = clear
    }
  }

  // --- Fan-in: group edges by shared target (skip already-bundled edges) ---
  const fanInGroups = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (processed.has(edge) || edge.source === edge.target) continue
    if (!fanInGroups.has(edge.target)) fanInGroups.set(edge.target, [])
    fanInGroups.get(edge.target)!.push(edge)
  }

  for (const [targetId, group] of fanInGroups) {
    if (group.length < 2) continue

    if (unshareable(group, 'end', duplicateEdges)) continue

    const target = nodeMap.get(targetId)
    if (!target) continue

    const forward = group.filter(e => {
      if (duplicateEdges.has(e)) return false
      const s = nodeMap.get(e.source)
      if (!s) return false
      if (isLR) return s.x + s.width < target.x
      if (isRL) return s.x > target.x + target.width
      if (isBT) return s.y > target.y + target.height
      return s.y + s.height < target.y // TD/TB
    })
    if (forward.length < 2) continue

    const tgtCX = target.x + target.width / 2
    const tgtCY = target.y + target.height / 2

    // Same bundle contract as fan-out: shrink the bundle until every rebuilt
    // path proves clear of other nodes.
    let members = forward.map(e => ({ edge: e, node: nodeMap.get(e.source)! }))
    while (members.length >= 2) {
      const candidates = new Map<PositionedEdge, Point[]>()
      if (isHorizontal) {
        const entryX = isLR ? target.x : target.x + target.width
        const entryY = tgtCY

        const farthestX = isLR
          ? Math.max(...members.map(s => s.node.x + s.node.width))
          : Math.min(...members.map(s => s.node.x))
        let junctionX = hookedElbow(farthestX, entryX, memberHook(members, 'start'), memberHook(members, 'end'))
        junctionX = adjustJunctionForGroups(junctionX, tgtCX, tgtCY, groups, direction)

        for (const { edge, node: src } of members) {
          const exitX = isLR ? src.x + src.width : src.x
          const exitY = memberLane(src, entryY, 'y')
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: junctionX, y: exitY },
            { x: junctionX, y: entryY },
            { x: entryX, y: entryY },
          ])
        }
      } else {
        const entryX = tgtCX
        const entryY = isBT ? target.y + target.height : target.y

        const farthestY = isBT
          ? Math.min(...members.map(s => s.node.y))
          : Math.max(...members.map(s => s.node.y + s.node.height))
        let junctionY = hookedElbow(farthestY, entryY, memberHook(members, 'start'), memberHook(members, 'end'))
        junctionY = adjustJunctionForGroups(junctionY, tgtCX, tgtCY, groups, direction)

        for (const { edge, node: src } of members) {
          const exitX = memberLane(src, entryX, 'x')
          const exitY = isBT ? src.y : src.y + src.height
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: exitX, y: junctionY },
            { x: entryX, y: junctionY },
            { x: entryX, y: entryY },
          ])
        }
      }

      // A member that could run straight on its own keeps its route rather
      // than buy bends to join the trunk.
      const alone = straightOutside(members, isHorizontal ? tgtCY : tgtCX)
      if (alone && bendCount(candidates.get(alone)!) > 0) { members = members.filter(member => member.edge !== alone); continue }
      const clear = admittedMembers(members, candidates)
      if (clear.length === members.length) {
        const joins = tradeJoins(members, candidates)
        if (!joins) break
        for (const { edge } of members) {
          edge.points = candidates.get(edge)!
        }
        for (const [edge, join] of joins) {
          edge.points = join.points
          edge.labelPosition = join.labelPosition
        }
        retainConstructedBundleRoutes(members.map(member => member.edge), processed)
        break
      }
      members = clear
    }
  }

  return processed
}
