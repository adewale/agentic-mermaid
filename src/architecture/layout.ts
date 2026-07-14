import { applyTextTransform, estimateTextWidth } from '../styles.ts'
import type { Point, RenderOptions } from '../types.ts'
import { ARCHITECTURE_DEFAULT_LAYER_SPACING, ARCHITECTURE_DEFAULT_NODE_SPACING } from './config.ts'
import type { ArchitectureLayoutMetrics } from './config.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { architectureToMermaidGraph } from './parser.ts'
import type {
  ArchitectureChildRef,
  ArchitectureDiagram,
  ArchitectureEndpoint,
  ArchitectureGroup,
  ArchitectureService,
  PositionedArchitectureDiagram,
  PositionedArchitectureEdge,
  PositionedArchitectureGroup,
  PositionedArchitectureJunction,
  PositionedArchitectureService,
} from './types.ts'

const EDGE_EXIT_GAP = 16
const GROUP_EDGE_PAD = 18
const TITLE_FONT_SIZE = 18
const TITLE_FONT_WEIGHT = 600
const TITLE_Y = 20
const TITLE_SIDE_PADDING = 40

interface LayoutGroup {
  id: string
  x: number
  y: number
  width: number
  height: number
  children: LayoutGroup[]
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface ResolvedEndpoint {
  anchor: Point
  exit: Point
}

/**
 * Lay out an architecture diagram by reusing the graph/subgraph placement
 * engine, then re-projecting the result into architecture-specific primitives.
 */
export function layoutArchitectureDiagram(
  diagram: ArchitectureDiagram,
  options: RenderOptions = {},
  metrics?: ArchitectureLayoutMetrics,
): PositionedArchitectureDiagram {
  const graph = architectureToMermaidGraph(diagram)
  const positioned = layoutGraphSync(graph, {
    padding: options.padding ?? 40,
    nodeSpacing: options.nodeSpacing ?? ARCHITECTURE_DEFAULT_NODE_SPACING,
    layerSpacing: options.layerSpacing ?? ARCHITECTURE_DEFAULT_LAYER_SPACING,
    preserveSubgraphChildOrder: true,
    styleFace: metrics ? {
      node: {
        fontSize: metrics.serviceFontSize,
        fontWeight: metrics.serviceFontWeight,
        letterSpacing: metrics.serviceLetterSpacing,
        textTransform: metrics.serviceTextTransform,
        paddingX: metrics.servicePaddingX,
        paddingY: metrics.servicePaddingY,
        cornerRadius: metrics.serviceCornerRadius,
        lineWidth: metrics.serviceLineWidth,
      },
      edge: {
        fontSize: metrics.edgeFontSize,
        fontWeight: metrics.edgeFontWeight,
        letterSpacing: metrics.edgeLetterSpacing,
        textTransform: metrics.edgeTextTransform,
        lineWidth: metrics.edgeLineWidth,
        bendRadius: metrics.edgeBendRadius,
      },
      group: {
        fontSize: metrics.groupFontSize,
        fontWeight: metrics.groupFontWeight,
        letterSpacing: metrics.groupLetterSpacing,
        fontFamily: metrics.groupFont,
        textTransform: metrics.groupTextTransform,
        paddingX: metrics.groupPaddingX,
        paddingY: metrics.groupPaddingY,
        cornerRadius: metrics.groupCornerRadius,
        lineWidth: metrics.groupLineWidth,
      },
    } : undefined,
  })

  const servicesById = new Map(diagram.services.map((service) => [service.id, service]))
  const groupsById = new Map(diagram.groups.map((group) => [group.id, group]))
  const junctionIds = new Set(diagram.junctions.map((junction) => junction.id))

  const services: PositionedArchitectureService[] = []
  const junctions: PositionedArchitectureJunction[] = []
  const serviceBounds = new Map<string, Bounds>()
  const junctionBounds = new Map<string, Bounds>()

  for (const node of positioned.nodes) {
    const bounds = { x: node.x, y: node.y, width: node.width, height: node.height }
    if (servicesById.has(node.id)) {
      const service = servicesById.get(node.id)!
      services.push({ ...bounds, id: service.id, label: service.label, icon: service.icon, parentId: service.parentId })
      serviceBounds.set(node.id, bounds)
    } else if (junctionIds.has(node.id)) {
      const junction = diagram.junctions.find((entry) => entry.id === node.id)!
      junctions.push({ ...bounds, id: junction.id, parentId: junction.parentId })
      junctionBounds.set(node.id, bounds)
    }
  }

  // Keep architecture SVG layering stable even when the graph engine changes
  // compound-node layout order: root services render before grouped services,
  // then source order decides ties.
  const serviceOrder = new Map(diagram.services.map((service, index) => [service.id, index]))
  services.sort((a, b) => {
    const topLevelDelta = Number(Boolean(a.parentId)) - Number(Boolean(b.parentId))
    return topLevelDelta || (serviceOrder.get(a.id) ?? 0) - (serviceOrder.get(b.id) ?? 0)
  })

  // Upstream `align row|column` is a geometry constraint, not parser
  // tolerance. Apply it after the graph engine establishes a deterministic
  // order and before group bounds/architecture routes are frozen. Members are
  // packed in directive order on the free axis, so collapsing a vertical stack
  // into a row (or vice versa) cannot create sibling overlap.
  applyArchitectureAlignments(
    diagram,
    services,
    junctions,
    options.nodeSpacing ?? ARCHITECTURE_DEFAULT_NODE_SPACING,
  )
  // Alignment mutates positioned items after their initial bounds maps were
  // built. Refresh the route lookup so every side anchor follows the aligned
  // card/ring rather than the pre-constraint ELK coordinate.
  for (const service of services) serviceBounds.set(service.id, service)
  for (const junction of junctions) junctionBounds.set(junction.id, junction)

  const flatGroups = new Map<string, PositionedArchitectureGroup>()
  const groups = positioned.groups.map((group) => mapGroup(group, groupsById, flatGroups))
  expandGroupBounds(groups, services, junctions, diagram.alignments.length > 0)
  const sideConstraintsChanged = applyArchitectureSideConstraints(
    diagram,
    services,
    junctions,
    flatGroups,
    options.nodeSpacing ?? ARCHITECTURE_DEFAULT_NODE_SPACING,
  )
  if (sideConstraintsChanged) {
    // Port constraints can reorder a child or a whole nested group. Refit once
    // more before resolving `{group}` anchors and route obstacles.
    expandGroupBounds(groups, services, junctions, true)
    for (const service of services) serviceBounds.set(service.id, service)
    for (const junction of junctions) junctionBounds.set(junction.id, junction)
  }

  const positionedJunctionsById = new Map(junctions.map(junction => [junction.id, junction]))
  const edges = diagram.edges.map((edge) =>
    routeArchitectureEdge(
      edge,
      servicesById,
      serviceBounds,
      junctionBounds,
      flatGroups,
      services,
      positionedJunctionsById,
    )
  )
  separateEdgeLabels(edges, services, metrics)

  const titleText = diagram.title
    ? applyTextTransform(diagram.title, metrics?.groupTextTransform)
    : undefined
  let width = positioned.width
  let height = positioned.height
  if (diagram.alignments.length > 0 || sideConstraintsChanged) {
    // Alignment may collapse several old ranks into one; derive the canvas
    // from post-constraint geometry instead of retaining ELK's stale extent.
    width = Math.max(
      80,
      ...services.map(service => service.x + service.width + 40),
      ...junctions.map(junction => junction.x + junction.width + 40),
      ...groups.map(group => group.x + group.width + 40),
    )
    height = Math.max(
      80,
      ...services.map(service => service.y + service.height + 40),
      ...junctions.map(junction => junction.y + junction.height + 40),
      ...groups.map(group => group.y + group.height + 40),
    )
  }
  if (titleText) {
    width = Math.max(width, estimateTextWidth(titleText, metrics?.groupFontSize ?? TITLE_FONT_SIZE, metrics?.groupFontWeight ?? TITLE_FONT_WEIGHT) + TITLE_SIDE_PADDING * 2)
    height = Math.max(height, TITLE_Y + TITLE_FONT_SIZE + 20)
  }
  for (const edge of edges) {
    for (const point of edge.points) {
      width = Math.max(width, point.x + 40)
      height = Math.max(height, point.y + 40)
    }
    if (edge.labelPosition) {
      width = Math.max(width, edge.labelPosition.x + 72)
      height = Math.max(height, edge.labelPosition.y + 28)
    }
  }

  return {
    width,
    height,
    ...(titleText ? { title: { text: titleText, x: width / 2, y: TITLE_Y } } : {}),
    groups,
    services,
    junctions,
    edges,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
  }
}

type AlignableArchitectureItem = PositionedArchitectureService | PositionedArchitectureJunction

function applyArchitectureAlignments(
  diagram: ArchitectureDiagram,
  services: PositionedArchitectureService[],
  junctions: PositionedArchitectureJunction[],
  spacing: number,
): void {
  const byId = new Map<string, AlignableArchitectureItem>()
  for (const service of services) byId.set(service.id, service)
  for (const junction of junctions) byId.set(junction.id, junction)

  const rowConstrained = new Set(
    diagram.alignments.filter(alignment => alignment.axis === 'row').flatMap(alignment => alignment.members),
  )

  // Constraints are declarative: source order must not change the solution.
  // Establish row lanes first, then project column components onto them.
  const orderedAlignments = [
    ...diagram.alignments.filter(alignment => alignment.axis === 'row'),
    ...diagram.alignments.filter(alignment => alignment.axis === 'column'),
  ]
  for (const alignment of orderedAlignments) {
    const members = alignment.members
      .map(id => byId.get(id))
      .filter((item): item is AlignableArchitectureItem => item !== undefined)
    if (members.length < 2) continue // parser validation makes this defensive

    if (alignment.axis === 'row') {
      const centerY = Math.min(...members.map(item => item.y + item.height / 2))
      let cursor = Math.min(...members.map(item => item.x))
      for (const item of members) {
        item.x = cursor
        item.y = centerY - item.height / 2
        cursor += item.width + spacing
      }
    } else {
      const centerX = Math.min(...members.map(item => item.x + item.width / 2))
      const mayPackY = members.every(item => !rowConstrained.has(item.id))
      let cursor = Math.min(...members.map(item => item.y))
      for (const item of members) {
        item.x = centerX - item.width / 2
        if (mayPackY) {
          item.y = cursor
          cursor += item.height + spacing
        }
      }
    }
  }

  // A column assignment can pull neighboring members of an already-aligned
  // row back into each other. Re-pack rows by translating the member's whole
  // column component, preserving both constraints instead of letting the last
  // directive win. Unconstrained members are singleton components.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const p = parent.get(id) ?? id
    if (p === id) { parent.set(id, id); return id }
    const root = find(p)
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string): void => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  for (const alignment of diagram.alignments) {
    if (alignment.axis !== 'column') continue
    for (let i = 1; i < alignment.members.length; i++) union(alignment.members[0]!, alignment.members[i]!)
  }
  for (const alignment of diagram.alignments) {
    if (alignment.axis !== 'row') continue
    const members = alignment.members.map(id => byId.get(id)).filter((item): item is AlignableArchitectureItem => item !== undefined)
    let cursor = -Infinity
    for (const member of members) {
      if (member.x < cursor) {
        const delta = cursor - member.x
        const component = find(member.id)
        for (const item of byId.values()) {
          if (find(item.id) === component) item.x += delta
        }
      }
      cursor = member.x + member.width + spacing
    }
  }

  // Collapsing a stack into a row can land on an unrelated item that occupied
  // the row's original middle rank. Move that obstacle's whole row component
  // below the aligned lane. This preserves any other row/column constraints
  // while guaranteeing the hint never hides a sibling (the db2/MCP case).
  const rowParent = new Map<string, string>()
  const rowFind = (id: string): string => {
    const p = rowParent.get(id) ?? id
    if (p === id) { rowParent.set(id, id); return id }
    const root = rowFind(p)
    rowParent.set(id, root)
    return root
  }
  const rowUnion = (a: string, b: string): void => {
    const ra = rowFind(a), rb = rowFind(b)
    if (ra !== rb) rowParent.set(rb, ra)
  }
  for (const alignment of diagram.alignments) {
    if (alignment.axis !== 'row') continue
    for (let i = 1; i < alignment.members.length; i++) rowUnion(alignment.members[0]!, alignment.members[i]!)
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const alignment of diagram.alignments) {
      if (alignment.axis !== 'row') continue
      const members = alignment.members.map(id => byId.get(id)).filter((item): item is AlignableArchitectureItem => item !== undefined)
      if (members.length < 2) continue
      const laneRoot = rowFind(members[0]!.id)
      const laneLeft = Math.min(...members.map(item => item.x))
      const laneRight = Math.max(...members.map(item => item.x + item.width))
      const laneTop = Math.min(...members.map(item => item.y))
      const laneBottom = Math.max(...members.map(item => item.y + item.height))
      for (const obstacle of byId.values()) {
        if (rowFind(obstacle.id) === laneRoot) continue
        const overlaps = obstacle.x < laneRight && obstacle.x + obstacle.width > laneLeft
          && obstacle.y < laneBottom && obstacle.y + obstacle.height > laneTop
        if (!overlaps) continue
        const obstacleRoot = rowFind(obstacle.id)
        const component = [...byId.values()].filter(item => rowFind(item.id) === obstacleRoot)
        const componentTop = Math.min(...component.map(item => item.y))
        const delta = laneBottom + spacing - componentTop
        for (const item of component) item.y += delta
      }
    }
  }
}

type SideConstraintAxis = 'x' | 'y'

interface ArchitectureSideConstraint {
  axis: SideConstraintAxis
  parentId?: string
  before: string
  after: string
  depth: number
}

/**
 * Treat authored endpoint faces as deterministic sibling-order constraints.
 * Constraints are solved at the endpoints' lowest common container: an edge
 * between nested groups moves those groups as units, while an edge inside one
 * group reorders only that group's direct children. Row/column alignment
 * components move together on their fixed axis. Cyclic or intrinsically
 * conflicting constraints remain renderable and are reported on the edge's
 * route certificate as `placement: conflicted`.
 */
function applyArchitectureSideConstraints(
  diagram: ArchitectureDiagram,
  services: PositionedArchitectureService[],
  junctions: PositionedArchitectureJunction[],
  groups: Map<string, PositionedArchitectureGroup>,
  spacing: number,
): boolean {
  let changed = false
  const groupMeta = new Map(diagram.groups.map(group => [group.id, group]))
  const serviceMeta = new Map(diagram.services.map(service => [service.id, service]))
  const junctionMeta = new Map(diagram.junctions.map(junction => [junction.id, junction]))
  const positionedServices = new Map(services.map(service => [service.id, service]))
  const positionedJunctions = new Map(junctions.map(junction => [junction.id, junction]))
  const unitKey = (kind: ArchitectureChildRef['kind'], id: string): string => `${kind}:${id}`
  const splitUnitKey = (key: string): { kind: ArchitectureChildRef['kind']; id: string } => {
    const separator = key.indexOf(':')
    return { kind: key.slice(0, separator) as ArchitectureChildRef['kind'], id: key.slice(separator + 1) }
  }

  const groupAncestors = (parentId: string | undefined): string[] => {
    const reversed: string[] = []
    let current = parentId
    while (current) {
      reversed.push(unitKey('group', current))
      current = groupMeta.get(current)?.parentId
    }
    return reversed.reverse()
  }
  const itemPath = (id: string, boundary: ArchitectureEndpoint['boundary'] = 'item'): string[] | null => {
    const service = serviceMeta.get(id)
    if (service) {
      const ancestors = groupAncestors(service.parentId)
      return boundary === 'group' ? ancestors : [...ancestors, unitKey('service', id)]
    }
    const junction = junctionMeta.get(id)
    if (junction) return [...groupAncestors(junction.parentId), unitKey('junction', id)]
    return null
  }

  const constraints: ArchitectureSideConstraint[] = []
  for (const edge of diagram.edges) {
    const sourcePath = itemPath(edge.source.id, edge.source.boundary)
    const targetPath = itemPath(edge.target.id, edge.target.boundary)
    if (!sourcePath || !targetPath) continue
    let common = 0
    while (common < sourcePath.length && common < targetPath.length && sourcePath[common] === targetPath[common]) common++
    // One effective endpoint is the other's ancestor (for example a group
    // boundary pointing back into that same group). There is no sibling move
    // that can satisfy it; retain geometry and classify the legal conflict.
    if (common >= sourcePath.length || common >= targetPath.length) continue
    const parentId = common === 0 ? undefined : splitUnitKey(sourcePath[common - 1]!).id
    const sourceUnit = sourcePath[common]!
    const targetUnit = targetPath[common]!
    const addForSide = (current: string, other: string, side: ArchitectureEndpoint['side']): void => {
      const axis: SideConstraintAxis = side === 'L' || side === 'R' ? 'x' : 'y'
      const currentBeforeOther = side === 'R' || side === 'B'
      constraints.push({
        axis,
        parentId,
        before: currentBeforeOther ? current : other,
        after: currentBeforeOther ? other : current,
        depth: common,
      })
    }
    addForSide(sourceUnit, targetUnit, edge.source.side)
    addForSide(targetUnit, sourceUnit, edge.target.side)
  }

  const siblingRefs = (parentId: string | undefined): ArchitectureChildRef[] =>
    parentId ? groupMeta.get(parentId)?.children ?? [] : diagram.rootChildren
  const unitBounds = (key: string): Bounds | undefined => {
    const { kind, id } = splitUnitKey(key)
    if (kind === 'group') return groups.get(id)
    if (kind === 'service') return positionedServices.get(id)
    return positionedJunctions.get(id)
  }
  const translateUnit = (key: string, axis: SideConstraintAxis, delta: number): void => {
    if (Math.abs(delta) <= ROUTE_EPSILON) return
    const { kind, id } = splitUnitKey(key)
    if (kind === 'service') {
      const service = positionedServices.get(id)
      if (service) service[axis] += delta
      return
    }
    if (kind === 'junction') {
      const junction = positionedJunctions.get(id)
      if (junction) junction[axis] += delta
      return
    }
    const moveGroup = (groupId: string): void => {
      const group = groups.get(groupId)
      if (group) group[axis] += delta
      for (const child of groupMeta.get(groupId)?.children ?? []) {
        if (child.kind === 'group') moveGroup(child.id)
        else translateUnit(unitKey(child.kind, child.id), axis, delta)
      }
    }
    moveGroup(id)
  }
  const roots = [...groups.values()].filter(group => !group.parentId)

  const grouped = new Map<string, ArchitectureSideConstraint[]>()
  for (const constraint of constraints) {
    const key = `${constraint.depth}:${constraint.parentId ?? ''}:${constraint.axis}`
    const entries = grouped.get(key) ?? []
    entries.push(constraint)
    grouped.set(key, entries)
  }
  const orderedGroups = [...grouped.values()].sort((a, b) =>
    b[0]!.depth - a[0]!.depth
      || (a[0]!.parentId ?? '').localeCompare(b[0]!.parentId ?? '')
      || a[0]!.axis.localeCompare(b[0]!.axis))

  for (const entries of orderedGroups) {
    const { axis, parentId } = entries[0]!
    const siblingKeys = siblingRefs(parentId).map(ref => unitKey(ref.kind, ref.id)).filter(key => unitBounds(key) !== undefined)
    if (siblingKeys.length < 2) continue

    // Preserve declared row/column equal-coordinate components on their fixed
    // axis by moving the component as one packing unit.
    const parent = new Map(siblingKeys.map(key => [key, key]))
    const find = (key: string): string => {
      const current = parent.get(key) ?? key
      if (current === key) return current
      const root = find(current)
      parent.set(key, root)
      return root
    }
    const union = (a: string, b: string): void => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent.set(rb, ra < rb ? ra : rb)
    }
    const fixedAlignment = axis === 'x' ? 'column' : 'row'
    for (const alignment of diagram.alignments) {
      if (alignment.axis !== fixedAlignment) continue
      const directUnits = alignment.members.map(member => {
        const path = itemPath(member)
        if (!path) return undefined
        if (!parentId) return path[0]
        const parentKey = unitKey('group', parentId)
        const parentIndex = path.indexOf(parentKey)
        return parentIndex >= 0 ? path[parentIndex + 1] : undefined
      }).filter((key): key is string => key !== undefined && parent.has(key))
      for (let i = 1; i < directUnits.length; i++) union(directUnits[0]!, directUnits[i]!)
    }

    const componentMembers = new Map<string, string[]>()
    for (const key of siblingKeys) {
      const root = find(key)
      const members = componentMembers.get(root) ?? []
      members.push(key)
      componentMembers.set(root, members)
    }
    const componentBounds = (root: string): Bounds => {
      const bounds = componentMembers.get(root)!.map(key => unitBounds(key)!)
      const minX = Math.min(...bounds.map(bound => bound.x))
      const minY = Math.min(...bounds.map(bound => bound.y))
      const maxX = Math.max(...bounds.map(bound => bound.x + bound.width))
      const maxY = Math.max(...bounds.map(bound => bound.y + bound.height))
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    const arcs = new Map<string, Set<string>>()
    let intrinsicConflict = false
    for (const entry of entries) {
      const before = find(entry.before)
      const after = find(entry.after)
      if (before === after) { intrinsicConflict = true; break }
      const targets = arcs.get(before) ?? new Set<string>()
      targets.add(after)
      arcs.set(before, targets)
    }
    if (intrinsicConflict) continue

    const components = [...componentMembers.keys()]
    const constraintSatisfied = (before: string, after: string): boolean => {
      const a = componentBounds(before), b = componentBounds(after)
      return axis === 'x'
        ? a.x + a.width + spacing <= b.x + ROUTE_EPSILON
        : a.y + a.height + spacing <= b.y + ROUTE_EPSILON
    }
    if ([...arcs].every(([before, afters]) => [...afters].every(after => constraintSatisfied(before, after)))) continue

    const indegree = new Map(components.map(component => [component, 0]))
    for (const afters of arcs.values()) for (const after of afters) indegree.set(after, (indegree.get(after) ?? 0) + 1)
    const order: string[] = []
    while (order.length < components.length) {
      const available = components.filter(component => !order.includes(component) && indegree.get(component) === 0)
        .sort((a, b) => {
          const aa = componentBounds(a), bb = componentBounds(b)
          const delta = axis === 'x' ? aa.x - bb.x : aa.y - bb.y
          return delta || a.localeCompare(b)
        })
      if (available.length === 0) break
      const next = available[0]!
      order.push(next)
      for (const after of arcs.get(next) ?? []) indegree.set(after, indegree.get(after)! - 1)
    }
    // A cycle means the Mermaid sides are jointly impossible. Rendering is
    // still legal; leave placement intact and let the typed certificate say so.
    if (order.length !== components.length) continue

    const initialBounds = components.map(componentBounds)
    let cursor = Math.min(...initialBounds.map(bound => axis === 'x' ? bound.x : bound.y))
    for (const component of order) {
      const bounds = componentBounds(component)
      const start = axis === 'x' ? bounds.x : bounds.y
      const delta = cursor - start
      if (Math.abs(delta) > ROUTE_EPSILON) changed = true
      for (const key of componentMembers.get(component)!) translateUnit(key, axis, delta)
      cursor += (axis === 'x' ? bounds.width : bounds.height) + spacing
    }
    // A nested reorder can enlarge its container; refresh before a parent-level
    // constraint uses that group as one sibling unit.
    expandGroupBounds(roots, services, junctions, true)
  }

  // A child reorder can enlarge its parent into a formerly clear sibling (for
  // example two root groups stacked vertically). Resolve those secondary
  // overlaps bottom-up. Row-aligned siblings form one component so cleanup
  // cannot silently break an explicit alignment.
  const contexts: Array<{ parentId?: string; depth: number }> = [
    ...diagram.groups.map(group => ({ parentId: group.id, depth: groupAncestors(group.id).length })),
    { parentId: undefined, depth: 0 },
  ].sort((a, b) => b.depth - a.depth || (a.parentId ?? '').localeCompare(b.parentId ?? ''))
  const overlaps = (a: Bounds, b: Bounds): boolean =>
    a.x < b.x + b.width - ROUTE_EPSILON && b.x < a.x + a.width - ROUTE_EPSILON
      && a.y < b.y + b.height - ROUTE_EPSILON && b.y < a.y + a.height - ROUTE_EPSILON

  for (const context of contexts) {
    const siblingKeys = siblingRefs(context.parentId).map(ref => unitKey(ref.kind, ref.id)).filter(key => unitBounds(key) !== undefined)
    if (siblingKeys.length < 2) continue
    const parent = new Map(siblingKeys.map(key => [key, key]))
    const find = (key: string): string => {
      const current = parent.get(key) ?? key
      if (current === key) return current
      const root = find(current)
      parent.set(key, root)
      return root
    }
    const union = (a: string, b: string): void => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent.set(rb, ra < rb ? ra : rb)
    }
    for (const alignment of diagram.alignments) {
      if (alignment.axis !== 'row') continue
      const directUnits = alignment.members.map(member => {
        const path = itemPath(member)
        if (!path) return undefined
        if (!context.parentId) return path[0]
        const parentIndex = path.indexOf(unitKey('group', context.parentId))
        return parentIndex >= 0 ? path[parentIndex + 1] : undefined
      }).filter((key): key is string => key !== undefined && parent.has(key))
      for (let i = 1; i < directUnits.length; i++) union(directUnits[0]!, directUnits[i]!)
    }
    const members = new Map<string, string[]>()
    for (const key of siblingKeys) {
      const root = find(key)
      const values = members.get(root) ?? []
      values.push(key)
      members.set(root, values)
    }
    const boundsFor = (root: string): Bounds => {
      const values = members.get(root)!.map(key => unitBounds(key)!)
      const x = Math.min(...values.map(value => value.x))
      const y = Math.min(...values.map(value => value.y))
      const right = Math.max(...values.map(value => value.x + value.width))
      const bottom = Math.max(...values.map(value => value.y + value.height))
      return { x, y, width: right - x, height: bottom - y }
    }
    const order = [...members.keys()].sort((a, b) => {
      const aa = boundsFor(a), bb = boundsFor(b)
      return aa.y - bb.y || aa.x - bb.x || a.localeCompare(b)
    })
    const placed: string[] = []
    for (const root of order) {
      for (let pass = 0; pass <= placed.length; pass++) {
        const bounds = boundsFor(root)
        const blockers = placed.map(boundsFor).filter(other => overlaps(bounds, other))
        if (blockers.length === 0) break
        const targetY = Math.max(...blockers.map(other => other.y + other.height + spacing))
        const delta = targetY - bounds.y
        for (const key of members.get(root)!) translateUnit(key, 'y', delta)
        changed = true
      }
      placed.push(root)
    }
    expandGroupBounds(roots, services, junctions, true)
  }
  return changed
}

function mapGroup(
  group: LayoutGroup,
  groupsById: Map<string, ArchitectureGroup>,
  flatGroups: Map<string, PositionedArchitectureGroup>,
): PositionedArchitectureGroup {
  const meta = groupsById.get(group.id)
  const mapped: PositionedArchitectureGroup = {
    id: group.id,
    label: meta?.label ?? group.id,
    icon: meta?.icon,
    parentId: meta?.parentId,
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
    children: group.children.map((child) => mapGroup(child, groupsById, flatGroups)),
  }
  flatGroups.set(mapped.id, mapped)
  return mapped
}

function expandGroupBounds(
  groups: PositionedArchitectureGroup[],
  services: PositionedArchitectureService[],
  junctions: PositionedArchitectureJunction[],
  refitAfterAlignment: boolean,
): void {
  for (const group of groups) expandSingleGroup(group, services, junctions, refitAfterAlignment)
}

function expandSingleGroup(
  group: PositionedArchitectureGroup,
  services: PositionedArchitectureService[],
  junctions: PositionedArchitectureJunction[],
  refitAfterAlignment: boolean,
): Bounds {
  const childBounds: Bounds[] = []
  for (const child of group.children) childBounds.push(expandSingleGroup(child, services, junctions, refitAfterAlignment))
  for (const service of services) {
    if (service.parentId === group.id) childBounds.push(service)
  }
  for (const junction of junctions) {
    if (junction.parentId === group.id) childBounds.push(junction)
  }

  if (childBounds.length === 0) return group

  // Re-fit the group around its members with a GROUP_EDGE_PAD interior margin.
  // The graph projection can seat a wider member flush against (or poking past)
  // the group box on same-side edge patterns; padding every member edge keeps
  // each service fully inside the drawable interior instead of drawn onto the
  // group border (#90). The graph engine already reserves the header strip, so
  // the padded top never rises above group.y and the header stays clear.
  const minX = Math.min(group.x, ...childBounds.map(child => child.x - GROUP_EDGE_PAD))
  const minY = Math.min(group.y, ...childBounds.map(child => child.y - GROUP_EDGE_PAD))
  const maxX = Math.max(group.x + group.width, ...childBounds.map(child => child.x + child.width + GROUP_EDGE_PAD))
  const maxY = refitAfterAlignment
    ? Math.max(group.y + 48, ...childBounds.map(child => child.y + child.height + GROUP_EDGE_PAD))
    : Math.max(group.y + group.height, ...childBounds.map(child => child.y + child.height + GROUP_EDGE_PAD))

  group.x = minX
  group.y = minY
  group.width = maxX - minX
  group.height = maxY - minY
  return group
}

function routeArchitectureEdge(
  edge: ArchitectureDiagram['edges'][number],
  servicesById: Map<string, ArchitectureService>,
  serviceBounds: Map<string, Bounds>,
  junctionBounds: Map<string, Bounds>,
  groups: Map<string, PositionedArchitectureGroup>,
  services: PositionedArchitectureService[],
  junctionsById: Map<string, PositionedArchitectureJunction>,
): PositionedArchitectureEdge {
  const source = resolveEndpoint(edge.source, servicesById, serviceBounds, junctionBounds, groups)
  const target = resolveEndpoint(edge.target, servicesById, serviceBounds, junctionBounds, groups)
  const obstacles = architectureRouteObstacles(edge, servicesById, groups, services, junctionsById)
  const directMiddle = simplifyOrthogonalPoints([
    source.exit,
    ...routeBetween(source.exit, target.exit, edge.source.side, edge.target.side),
    target.exit,
  ])
  const middle = routeClearsObstacles(directMiddle, obstacles)
    ? directMiddle
    : routeOrthogonalAroundObstacles(source.exit, target.exit, obstacles) ?? directMiddle
  const points = simplifyOrthogonalPoints([
    source.anchor,
    ...middle,
    target.anchor,
  ])
  const sourceFacesTarget = sideFacesPoint(source.anchor, edge.source.side, target.anchor)
  const targetFacesSource = sideFacesPoint(target.anchor, edge.target.side, source.anchor)

  return {
    source: edge.source,
    target: edge.target,
    label: edge.label,
    hasArrowStart: edge.hasArrowStart,
    hasArrowEnd: edge.hasArrowEnd,
    points,
    labelPosition: edge.label ? edgeMidpoint(points) : undefined,
    placement: sourceFacesTarget && targetFacesSource ? 'satisfied' : 'conflicted',
    sourceFacesTarget,
    targetFacesSource,
    obstacleFree: routeClearsObstacles(points, obstacles),
  }
}

interface RouteObstacle extends Bounds {
  id: string
  kind: 'service' | 'junction' | 'group'
}

const ROUTE_CLEARANCE = 6
const ROUTE_EPSILON = 0.001

/**
 * Node cards, junctions, and unrelated group interiors are hard route
 * obstacles. Ancestor groups of either endpoint are excluded: an item-level
 * edge must be able to leave its own container, while `{group}` endpoints are
 * anchored to that container boundary explicitly.
 */
function architectureRouteObstacles(
  edge: ArchitectureDiagram['edges'][number],
  servicesById: Map<string, ArchitectureService>,
  groups: Map<string, PositionedArchitectureGroup>,
  services: PositionedArchitectureService[],
  junctionsById: Map<string, PositionedArchitectureJunction>,
): RouteObstacle[] {
  const excludedGroups = new Set<string>()
  const addAncestors = (parentId: string | undefined): void => {
    let current = parentId
    while (current) {
      if (excludedGroups.has(current)) break
      excludedGroups.add(current)
      current = groups.get(current)?.parentId
    }
  }
  addAncestors(servicesById.get(edge.source.id)?.parentId ?? junctionsById.get(edge.source.id)?.parentId)
  addAncestors(servicesById.get(edge.target.id)?.parentId ?? junctionsById.get(edge.target.id)?.parentId)

  const inflate = (id: string, kind: RouteObstacle['kind'], bounds: Bounds): RouteObstacle => ({
    id,
    kind,
    x: bounds.x - ROUTE_CLEARANCE,
    y: bounds.y - ROUTE_CLEARANCE,
    width: bounds.width + ROUTE_CLEARANCE * 2,
    height: bounds.height + ROUTE_CLEARANCE * 2,
  })
  const obstacles: RouteObstacle[] = []
  for (const service of services) {
    if (service.id === edge.source.id || service.id === edge.target.id) continue
    obstacles.push(inflate(service.id, 'service', service))
  }
  for (const junction of junctionsById.values()) {
    if (junction.id === edge.source.id || junction.id === edge.target.id) continue
    obstacles.push(inflate(junction.id, 'junction', junction))
  }
  for (const group of groups.values()) {
    if (excludedGroups.has(group.id)) continue
    obstacles.push(inflate(group.id, 'group', group))
  }
  return obstacles
}

function sideFacesPoint(anchor: Point, side: ArchitectureEndpoint['side'], other: Point): boolean {
  switch (side) {
    case 'L': return other.x < anchor.x - ROUTE_EPSILON
    case 'R': return other.x > anchor.x + ROUTE_EPSILON
    case 'T': return other.y < anchor.y - ROUTE_EPSILON
    case 'B': return other.y > anchor.y + ROUTE_EPSILON
  }
}

function routeClearsObstacles(points: Point[], obstacles: RouteObstacle[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (obstacles.some(obstacle => segmentCrossesObstacleInterior(points[i - 1]!, points[i]!, obstacle))) return false
  }
  return true
}

function segmentCrossesObstacleInterior(a: Point, b: Point, obstacle: Bounds): boolean {
  if (Math.abs(a.y - b.y) <= ROUTE_EPSILON) {
    return a.y > obstacle.y + ROUTE_EPSILON
      && a.y < obstacle.y + obstacle.height - ROUTE_EPSILON
      && Math.min(a.x, b.x) < obstacle.x + obstacle.width - ROUTE_EPSILON
      && Math.max(a.x, b.x) > obstacle.x + ROUTE_EPSILON
  }
  if (Math.abs(a.x - b.x) <= ROUTE_EPSILON) {
    return a.x > obstacle.x + ROUTE_EPSILON
      && a.x < obstacle.x + obstacle.width - ROUTE_EPSILON
      && Math.min(a.y, b.y) < obstacle.y + obstacle.height - ROUTE_EPSILON
      && Math.max(a.y, b.y) > obstacle.y + ROUTE_EPSILON
  }
  return true
}

interface RouteQueueEntry {
  state: number
  cost: number
}

/** Deterministic binary min-heap used by the continuous-grid router. */
class RouteMinHeap {
  private entries: RouteQueueEntry[] = []

  push(entry: RouteQueueEntry): void {
    this.entries.push(entry)
    let index = this.entries.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!this.before(entry, this.entries[parent]!)) break
      this.entries[index] = this.entries[parent]!
      index = parent
    }
    this.entries[index] = entry
  }

  pop(): RouteQueueEntry | undefined {
    const first = this.entries[0]
    const last = this.entries.pop()
    if (!first || !last || this.entries.length === 0) return first
    let index = 0
    this.entries[0] = last
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.entries.length) break
      let child = left
      if (right < this.entries.length && this.before(this.entries[right]!, this.entries[left]!)) child = right
      if (!this.before(this.entries[child]!, this.entries[index]!)) break
      const swap = this.entries[index]!
      this.entries[index] = this.entries[child]!
      this.entries[child] = swap
      index = child
    }
    return first
  }

  private before(a: RouteQueueEntry, b: RouteQueueEntry): boolean {
    return a.cost < b.cost || (a.cost === b.cost && a.state < b.state)
  }
}

/**
 * Visibility-grid Manhattan router. Candidate coordinates are endpoint lanes
 * and inflated obstacle faces; Dijkstra minimizes length, then bends, with
 * stable numeric tie-breaking. No randomness or object iteration order enters
 * the route.
 */
function routeOrthogonalAroundObstacles(
  start: Point,
  end: Point,
  obstacles: RouteObstacle[],
): Point[] | null {
  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap(obstacle => [obstacle.x, obstacle.x + obstacle.width])])].sort((a, b) => a - b)
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap(obstacle => [obstacle.y, obstacle.y + obstacle.height])])].sort((a, b) => a - b)
  const points: Point[] = []
  const indexByCoordinate = new Map<string, number>()
  const key = (x: number, y: number): string => `${x}\u0000${y}`
  const insideObstacle = (x: number, y: number): boolean => obstacles.some(obstacle =>
    x > obstacle.x + ROUTE_EPSILON && x < obstacle.x + obstacle.width - ROUTE_EPSILON
      && y > obstacle.y + ROUTE_EPSILON && y < obstacle.y + obstacle.height - ROUTE_EPSILON)

  for (const y of ys) {
    for (const x of xs) {
      if (insideObstacle(x, y) && !(x === start.x && y === start.y) && !(x === end.x && y === end.y)) continue
      indexByCoordinate.set(key(x, y), points.length)
      points.push({ x, y })
    }
  }
  const startIndex = indexByCoordinate.get(key(start.x, start.y))
  const endIndex = indexByCoordinate.get(key(end.x, end.y))
  if (startIndex === undefined || endIndex === undefined) return null

  const adjacency: Array<Array<{ point: number; direction: 1 | 2; length: number }>> = points.map(() => [])
  const connectVisible = (indices: number[], direction: 1 | 2): void => {
    for (let i = 1; i < indices.length; i++) {
      const aIndex = indices[i - 1]!
      const bIndex = indices[i]!
      const a = points[aIndex]!
      const b = points[bIndex]!
      if (obstacles.some(obstacle => segmentCrossesObstacleInterior(a, b, obstacle))) continue
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      adjacency[aIndex]!.push({ point: bIndex, direction, length })
      adjacency[bIndex]!.push({ point: aIndex, direction, length })
    }
  }
  for (const y of ys) {
    const row = points.map((point, index) => ({ point, index })).filter(entry => entry.point.y === y).sort((a, b) => a.point.x - b.point.x).map(entry => entry.index)
    connectVisible(row, 1)
  }
  for (const x of xs) {
    const column = points.map((point, index) => ({ point, index })).filter(entry => entry.point.x === x).sort((a, b) => a.point.y - b.point.y).map(entry => entry.index)
    connectVisible(column, 2)
  }

  // Direction states: 0 = none/start, 1 = horizontal, 2 = vertical.
  const stateCount = points.length * 3
  const distance = new Array<number>(stateCount).fill(Infinity)
  const previous = new Array<number>(stateCount).fill(-1)
  const startState = startIndex * 3
  distance[startState] = 0
  const queue = new RouteMinHeap()
  queue.push({ state: startState, cost: 0 })
  let finalState = -1
  while (true) {
    const current = queue.pop()
    if (!current) break
    if (current.cost !== distance[current.state]) continue
    const pointIndex = Math.floor(current.state / 3)
    const previousDirection = current.state % 3
    if (pointIndex === endIndex) { finalState = current.state; break }
    for (const neighbor of adjacency[pointIndex]!) {
      const nextState = neighbor.point * 3 + neighbor.direction
      const bendPenalty = previousDirection !== 0 && previousDirection !== neighbor.direction ? 8 : 0
      const nextCost = current.cost + neighbor.length + bendPenalty
      if (nextCost >= distance[nextState]!) continue
      distance[nextState] = nextCost
      previous[nextState] = current.state
      queue.push({ state: nextState, cost: nextCost })
    }
  }
  if (finalState < 0) return null

  const reversed: Point[] = []
  for (let state = finalState; state >= 0; state = previous[state]!) {
    reversed.push(points[Math.floor(state / 3)]!)
    if (state === startState) break
  }
  return simplifyOrthogonalPoints(reversed.reverse())
}

/**
 * Edge labels default to their route midpoints; two edges running the same
 * corridor put both labels in the same spot (2026-07 overlap audit: the
 * curated Event Spine sample's `private link`/`persists events` pair, 37% of
 * fuzzed diagrams). Slide the later label along its OWN polyline to the first
 * arc position (center-out, deterministic) whose box clears every earlier
 * label box and every service box; leave it when nothing clears (surfaced by
 * eval/overlap-audit rather than hidden).
 */
function separateEdgeLabels(
  edges: PositionedArchitectureEdge[],
  services: PositionedArchitectureService[],
  metrics?: ArchitectureLayoutMetrics,
): void {
  interface Box { x0: number; y0: number; x1: number; y1: number }
  const FS = metrics?.edgeFontSize ?? 11
  const FW = metrics?.edgeFontWeight ?? 400
  const PAD = 6
  const boxAt = (label: string, cx: number, cy: number): Box => {
    const visible = applyTextTransform(label, metrics?.edgeTextTransform)
    const w = estimateTextWidth(visible, FS, FW) + PAD * 2
    const h = FS + PAD * 2
    return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }
  }
  const intersects = (a: Box, b: Box): boolean =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
  const serviceBoxes: Box[] = services.map(sv => ({ x0: sv.x, y0: sv.y, x1: sv.x + sv.width, y1: sv.y + sv.height }))
  const labeled = edges.filter(e => e.label && e.labelPosition && e.points.length >= 2)
  const placed: Box[] = []
  for (const edge of labeled) {
    const current = boxAt(edge.label!, edge.labelPosition!.x, edge.labelPosition!.y)
    const collides = (b: Box): boolean => placed.some(o => intersects(b, o)) || serviceBoxes.some(o => intersects(b, o))
    if (!collides(current)) { placed.push(current); continue }
    // Arc-length candidates along the polyline, center-out.
    const pts = edge.points
    const segLens: number[] = []
    let total = 0
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y); segLens.push(l); total += l }
    const at = (dist: number): { x: number; y: number } => {
      let d = dist
      for (let i = 0; i < segLens.length; i++) {
        if (d <= segLens[i]! || i === segLens.length - 1) {
          const t = segLens[i]! === 0 ? 0 : Math.max(0, Math.min(1, d / segLens[i]!))
          return { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t }
        }
        d -= segLens[i]!
      }
      return pts[pts.length - 1]!
    }
    const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.15, 0.85]
    let chosen = current
    for (const f of fractions) {
      const q = at(total * f)
      const b = boxAt(edge.label!, q.x, q.y)
      if (!collides(b)) { edge.labelPosition = { x: q.x, y: q.y }; chosen = b; break }
    }
    placed.push(chosen)
  }
}

function resolveEndpoint(
  endpoint: ArchitectureEndpoint,
  servicesById: Map<string, ArchitectureService>,
  serviceBounds: Map<string, Bounds>,
  junctionBounds: Map<string, Bounds>,
  groups: Map<string, PositionedArchitectureGroup>,
): ResolvedEndpoint {
  if (endpoint.boundary === 'group') {
    const service = servicesById.get(endpoint.id)!
    const serviceBoundsEntry = serviceBounds.get(endpoint.id)!
    const group = groups.get(service.parentId!)!
    const anchor = groupAnchor(group, serviceBoundsEntry, endpoint.side)
    return { anchor, exit: movePoint(anchor, endpoint.side, EDGE_EXIT_GAP) }
  }

  const serviceBoundsEntry = serviceBounds.get(endpoint.id)
  if (serviceBoundsEntry) {
    const anchor = rectAnchor(serviceBoundsEntry, endpoint.side)
    return { anchor, exit: movePoint(anchor, endpoint.side, EDGE_EXIT_GAP) }
  }

  const junctionBoundsEntry = junctionBounds.get(endpoint.id)
  if (!junctionBoundsEntry) {
    throw new Error(`Unknown architecture endpoint "${endpoint.id}"`)
  }

  const anchor = circleAnchor(junctionBoundsEntry, endpoint.side)
  return { anchor, exit: movePoint(anchor, endpoint.side, EDGE_EXIT_GAP * 0.75) }
}

function rectAnchor(bounds: Bounds, side: ArchitectureEndpoint['side']): Point {
  switch (side) {
    case 'L': return { x: bounds.x, y: bounds.y + bounds.height / 2 }
    case 'R': return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
    case 'T': return { x: bounds.x + bounds.width / 2, y: bounds.y }
    case 'B': return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }
  }
}

function circleAnchor(bounds: Bounds, side: ArchitectureEndpoint['side']): Point {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const r = Math.min(bounds.width, bounds.height) / 2

  switch (side) {
    case 'L': return { x: cx - r, y: cy }
    case 'R': return { x: cx + r, y: cy }
    case 'T': return { x: cx, y: cy - r }
    case 'B': return { x: cx, y: cy + r }
  }
}

function groupAnchor(group: PositionedArchitectureGroup, child: Bounds, side: ArchitectureEndpoint['side']): Point {
  const childCx = child.x + child.width / 2
  const childCy = child.y + child.height / 2

  switch (side) {
    case 'L':
      return {
        x: group.x,
        y: clamp(childCy, group.y + GROUP_EDGE_PAD, group.y + group.height - GROUP_EDGE_PAD),
      }
    case 'R':
      return {
        x: group.x + group.width,
        y: clamp(childCy, group.y + GROUP_EDGE_PAD, group.y + group.height - GROUP_EDGE_PAD),
      }
    case 'T':
      return {
        x: clamp(childCx, group.x + GROUP_EDGE_PAD, group.x + group.width - GROUP_EDGE_PAD),
        y: group.y,
      }
    case 'B':
      return {
        x: clamp(childCx, group.x + GROUP_EDGE_PAD, group.x + group.width - GROUP_EDGE_PAD),
        y: group.y + group.height,
      }
  }
}

function routeBetween(
  start: Point,
  end: Point,
  sourceSide: ArchitectureEndpoint['side'],
  targetSide: ArchitectureEndpoint['side'],
): Point[] {
  if (start.x === end.x || start.y === end.y) return []

  const sourceAxis = sideAxis(sourceSide)
  const targetAxis = sideAxis(targetSide)

  if (sourceAxis !== targetAxis) {
    return sourceAxis === 'horizontal'
      ? [{ x: end.x, y: start.y }]
      : [{ x: start.x, y: end.y }]
  }

  if (sourceAxis === 'horizontal') {
    const midX = (start.x + end.x) / 2
    return [
      { x: midX, y: start.y },
      { x: midX, y: end.y },
    ]
  }

  const midY = (start.y + end.y) / 2
  return [
    { x: start.x, y: midY },
    { x: end.x, y: midY },
  ]
}

function sideAxis(side: ArchitectureEndpoint['side']): 'horizontal' | 'vertical' {
  return side === 'L' || side === 'R' ? 'horizontal' : 'vertical'
}

function movePoint(point: Point, side: ArchitectureEndpoint['side'], distance: number): Point {
  switch (side) {
    case 'L': return { x: point.x - distance, y: point.y }
    case 'R': return { x: point.x + distance, y: point.y }
    case 'T': return { x: point.x, y: point.y - distance }
    case 'B': return { x: point.x, y: point.y + distance }
  }
}

function simplifyOrthogonalPoints(points: Point[]): Point[] {
  const simplified: Point[] = []

  for (const point of points) {
    const last = simplified[simplified.length - 1]
    if (last && last.x === point.x && last.y === point.y) {
      continue
    }
    simplified.push(point)
  }

  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < simplified.length - 1; i++) {
      const prev = simplified[i - 1]!
      const curr = simplified[i]!
      const next = simplified[i + 1]!
      const sameX = prev.x === curr.x && curr.x === next.x
      const sameY = prev.y === curr.y && curr.y === next.y
      if (sameX || sameY) {
        simplified.splice(i, 1)
        changed = true
        break
      }
    }
  }

  return simplified
}

function edgeMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!

  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += segmentLength(points[i - 1]!, points[i]!)
  }

  let remaining = total / 2
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1]!
    const end = points[i]!
    const length = segmentLength(start, end)
    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      }
    }
    remaining -= length
  }

  return points[points.length - 1]!
}

function segmentLength(a: Point, b: Point): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
