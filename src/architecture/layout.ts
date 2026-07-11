import { applyTextTransform, estimateTextWidth } from '../styles.ts'
import type { Point, RenderOptions } from '../types.ts'
import { ARCHITECTURE_DEFAULT_LAYER_SPACING, ARCHITECTURE_DEFAULT_NODE_SPACING } from './config.ts'
import type { ArchitectureLayoutMetrics } from './config.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { architectureToMermaidGraph } from './parser.ts'
import type {
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
    componentSpacing: options.componentSpacing,
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

  const edges = diagram.edges.map((edge) =>
    routeArchitectureEdge(edge, servicesById, serviceBounds, junctionBounds, flatGroups)
  )
  separateEdgeLabels(edges, services, metrics)

  const titleText = diagram.title
    ? applyTextTransform(diagram.title, metrics?.groupTextTransform)
    : undefined
  let width = positioned.width
  let height = positioned.height
  if (diagram.alignments.length > 0) {
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
): PositionedArchitectureEdge {
  const source = resolveEndpoint(edge.source, servicesById, serviceBounds, junctionBounds, groups)
  const target = resolveEndpoint(edge.target, servicesById, serviceBounds, junctionBounds, groups)
  const points = simplifyOrthogonalPoints([
    source.anchor,
    source.exit,
    ...routeBetween(source.exit, target.exit, edge.source.side, edge.target.side),
    target.exit,
    target.anchor,
  ])

  return {
    source: edge.source,
    target: edge.target,
    label: edge.label,
    hasArrowStart: edge.hasArrowStart,
    hasArrowEnd: edge.hasArrowEnd,
    points,
    labelPosition: edge.label ? edgeMidpoint(points) : undefined,
  }
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
