import { extendTerminalRuns } from '../layout/terminal-clearance.ts'
import { architectureMarkerTerminal } from './markers.ts'
import { architectureIconFallbackBlock } from './icon-layout.ts'
import { assertArchitectureDiagramWork } from '../shared/diagram-limits.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import type { Point, RenderOptions } from '../types.ts'
import { ARCHITECTURE_DEFAULT_LAYER_SPACING, ARCHITECTURE_DEFAULT_NODE_SPACING, DEFAULT_ARCHITECTURE_VISUAL, architectureLayoutMetrics } from './config.ts'
import type { ArchitectureLayoutMetrics } from './config.ts'
import { layoutElkGraphPlacementSync, layoutNativeGraphPlacementSync } from '../layout-engine.ts'
import { runMeasuredGraphBackend } from '../layout/backend.ts'
import { architectureToMermaidGraph } from './parser.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { improveArchitectureSiblingSlots } from '../layout/agentic-layered.ts'
import { countOpposingRouteOverlaps, countParallelRouteOverlaps } from '../layout-rubric.ts'
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
const JUNCTION_PLACEMENT_PADDING = 6
/** The least interior an empty group keeps below its header. */
const EMPTY_GROUP_BODY = { width: 80, height: 24 }
/** The title is drawn at this size and weight in every style (renderer.ts),
 * so the canvas reserves it at the same metrics. */
export const ARCHITECTURE_TITLE_FONT_SIZE = 18
export const ARCHITECTURE_TITLE_FONT_WEIGHT = 600
const TITLE_Y = 20
const TITLE_SIDE_PADDING = 40

interface LayoutGroup {
  headerHeight?: number
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
  assertArchitectureDiagramWork(diagram)
  const typography = metrics ?? architectureLayoutMetrics(DEFAULT_ARCHITECTURE_VISUAL)
  const roleBlock = (source: string, role: 'service' | 'group' | 'edge') => preparePixelText(source, {
    display: 'formatted', transform: typography[`${role}TextTransform`], fontSize: typography[`${role}FontSize`],
    fontWeight: typography[`${role}FontWeight`], letterSpacing: typography[`${role}LetterSpacing`],
    fontFamily: role === 'group' ? typography.groupFont : undefined,
  })
  const serviceText = new Map(diagram.services.map(service => [service.id, roleBlock(service.label, 'service')]))
  const groupText = new Map(diagram.groups.map(group => [group.id, roleBlock(group.label, 'group')]))
  const edgeText = diagram.edges.map(edge => edge.label === undefined ? undefined : roleBlock(edge.label, 'edge'))
  const graph = architectureToMermaidGraph(diagram)
  const requestedHeaderMinimum = options.architecture?.visual?.groupHeaderHeight
  if (requestedHeaderMinimum !== undefined && (!Number.isFinite(requestedHeaderMinimum) || requestedHeaderMinimum <= 0)) throw new RangeError('Invalid Architecture group-header minimum')
  const reservedHeaderPadding = requestedHeaderMinimum === undefined ? undefined : Math.max(GROUP_EDGE_PAD, typography.groupPaddingY)
  const junctionDiameter = 2 * (typography.junctionOuterRadius ?? DEFAULT_ARCHITECTURE_VISUAL.junctionOuterRadius)
  for (const [id, block] of serviceText) graph.nodes.get(id)!.label = block.text
  const iconTextBlocks = new Map(diagram.services.filter(service => service.iconText !== undefined).map(service => [service.id, preparePixelText(service.iconText!, {
    display: 'literal', fontSize: typography.serviceFontSize, fontWeight: 700,
  })]))
  for (const [id, iconBlock] of iconTextBlocks) {
    const labelBlock = serviceText.get(id)!
    // Placement reserves the combined footprint; lowering retains two text
    // blocks so literal icon text never acquires label formatting semantics.
    graph.nodes.get(id)!.labelBlock = { ...labelBlock, width: labelBlock.width + iconBlock.width + (iconBlock.width ? 10 : 0), height: Math.max(labelBlock.height, iconBlock.height) }
  }
  // An empty group still owns a visible frame: give placement an unpainted
  // body the width of its header, which no authored id (no colon) can name.
  const emptyGroupBodies = new Map<string, { width: number; height: number }>()
  const prepareGroup = (group: typeof graph.subgraphs[number]): void => {
    group.label = groupText.get(group.id)!.text
    if (requestedHeaderMinimum !== undefined) group.headerMinHeight = requestedHeaderMinimum
    if (group.nodeIds.length === 0 && group.children.length === 0) {
      const id = `empty-group:${group.id}`
      graph.nodes.set(id, { id, label: '', shape: 'rectangle' })
      group.nodeIds.push(id)
      emptyGroupBodies.set(id, { width: Math.max(EMPTY_GROUP_BODY.width, groupText.get(group.id)!.width + (group.titleOffset ?? 0)), height: EMPTY_GROUP_BODY.height })
    }
    group.children.forEach(prepareGroup)
  }
  graph.subgraphs.forEach(prepareGroup)
  graph.edges.forEach((edge, index) => { edge.label = edgeText[index]?.text })
  const placementOptions = {
    // Keep placement clearance separate from the drawn surface. Larger rings
    // reserve their own footprint instead of borrowing State's fixed size.
    nodeSizes: new Map([...diagram.junctions.map(junction => [junction.id, {
      width: junctionDiameter + 2 * JUNCTION_PLACEMENT_PADDING,
      height: junctionDiameter + 2 * JUNCTION_PLACEMENT_PADDING,
    }] as const), ...emptyGroupBodies]),
    padding: options.padding ?? 40,
    nodeSpacing: options.nodeSpacing ?? ARCHITECTURE_DEFAULT_NODE_SPACING,
    layerSpacing: options.layerSpacing ?? ARCHITECTURE_DEFAULT_LAYER_SPACING,
    // The graph's temporary routes do not describe the side-constrained paths
    // below. Their cosmetic score cannot rank Architecture's final artifact.
    compareRoutePreferences: false,
    styleFace: metrics ? {
      node: {
        fontSize: metrics.serviceFontSize,
        fontWeight: metrics.serviceFontWeight,
        letterSpacing: metrics.serviceLetterSpacing,
        textTransform: undefined,
        paddingX: metrics.servicePaddingX,
        paddingY: metrics.servicePaddingY,
        cornerRadius: metrics.serviceCornerRadius,
        lineWidth: metrics.serviceLineWidth,
      },
      edge: {
        fontSize: metrics.edgeFontSize,
        fontWeight: metrics.edgeFontWeight,
        letterSpacing: metrics.edgeLetterSpacing,
        textTransform: undefined,
        lineWidth: metrics.edgeLineWidth,
        bendRadius: metrics.edgeBendRadius,
      },
      group: {
        fontSize: metrics.groupFontSize,
        fontWeight: metrics.groupFontWeight,
        letterSpacing: metrics.groupLetterSpacing,
        fontFamily: metrics.groupFont,
        textTransform: undefined,
        paddingX: metrics.groupPaddingX,
        paddingY: metrics.groupPaddingY,
        cornerRadius: metrics.groupCornerRadius,
        lineWidth: metrics.groupLineWidth,
      },
    } : undefined,
  }
  const servicesById = new Map(diagram.services.map((service) => [service.id, service]))
  const groupsById = new Map(diagram.groups.map((group) => [group.id, group]))
  const junctionsById = new Map(diagram.junctions.map((junction) => [junction.id, junction]))

  // Backend selection owns the completed family artifact. A raw placement
  // cannot publish success before its actual alignments, contacts and headers
  // have passed; fallback reuses this request's prepared graph and text.
  const finish = (positioned: ReturnType<typeof layoutNativeGraphPlacementSync>, nativePlacement: boolean): PositionedArchitectureDiagram => {
    const services: PositionedArchitectureService[] = []
    const junctions: PositionedArchitectureJunction[] = []
    const serviceBounds = new Map<string, PositionedArchitectureService>()
    const junctionBounds = new Map<string, PositionedArchitectureJunction>()

    for (const node of positioned.nodes) {
      if (servicesById.has(node.id)) {
        const service = servicesById.get(node.id)!
        const placed: PositionedArchitectureService = { x: node.x, y: node.y, width: node.width, height: node.height, id: service.id, label: service.label, labelBlock: serviceText.get(service.id), ...(service.iconText !== undefined ? { iconText: service.iconText, iconTextBlock: iconTextBlocks.get(service.id) } : {}), iconFallbackBlock: architectureIconFallbackBlock(service.icon, typography.serviceIconSize ?? DEFAULT_ARCHITECTURE_VISUAL.serviceIconSize), icon: service.icon, parentId: service.parentId }
        services.push(placed)
        serviceBounds.set(node.id, placed)
      } else if (junctionsById.has(node.id)) {
        const junction = junctionsById.get(node.id)!
        const placed: PositionedArchitectureJunction = {
          x: node.x + (node.width - junctionDiameter) / 2,
          y: node.y + (node.height - junctionDiameter) / 2,
          width: junctionDiameter,
          height: junctionDiameter,
          id: junction.id,
          parentId: junction.parentId,
        }
        junctions.push(placed)
        junctionBounds.set(node.id, placed)
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
    // order and before group bounds/architecture routes are frozen. Directive
    // order seeds the free-axis positions; complete-component gap repair then
    // preserves visibility when row and column requests intersect.
    applyArchitectureAlignments(
      diagram,
      services,
      junctions,
      options.nodeSpacing ?? ARCHITECTURE_DEFAULT_NODE_SPACING,
    )
    // Arrays and route lookups share the actual positioned items, so every
    // alignment/side-constraint move updates their authored contacts together.

    const flatGroups = new Map<string, PositionedArchitectureGroup>()
    const groups = positioned.groups.map((group) => mapGroup(group, groupsById, flatGroups))
    for (const group of flatGroups.values()) {
      group.labelBlock = groupText.get(group.id)
      group.iconFallbackBlock = architectureIconFallbackBlock(group.icon, typography.iconSize ?? DEFAULT_ARCHITECTURE_VISUAL.iconSize)
    }
    expandGroupBounds(groups, services, junctions, diagram.alignments.length > 0, reservedHeaderPadding)
    let legalSlots: (() => boolean) | undefined
    const sideConstraintsChanged = applyArchitectureSideConstraints(
      diagram,
      services,
      junctions,
      flatGroups,
      options.nodeSpacing ?? ARCHITECTURE_DEFAULT_NODE_SPACING,
      servicesById,
      groupsById,
      junctionsById,
      serviceBounds,
      junctionBounds,
      nativePlacement ? validate => { legalSlots = validate } : undefined,
      reservedHeaderPadding,
    )
    if (sideConstraintsChanged) {
      // Port constraints can reorder a child or a whole nested group. Refit once
      // more before resolving `{group}` anchors and route obstacles.
      expandGroupBounds(groups, services, junctions, true, reservedHeaderPadding)
    }

    if (diagram.alignments.length) {
      // Side ordering and container cleanup must preserve every fixed-axis
      // component before final contacts and route obstacles are derived.
      const alignedItems = new Map([...services, ...junctions].map(item => [item.id, item]))
      const alignmentFailures = diagram.alignments.flatMap(alignment => {
        const centers = alignment.members.map(id => {
          const item = alignedItems.get(id)!
          return alignment.axis === 'row' ? item.y + item.height / 2 : item.x + item.width / 2
        })
        return Math.max(...centers) - Math.min(...centers) <= ROUTE_EPSILON ? [] : [`${alignment.axis} alignment lost for ${alignment.members.join(', ')}`]
      })
      if (alignmentFailures.length) throw new LayoutCertificationError([{ strategy: 'architecture-final-alignments', violations: alignmentFailures }])
    }

    const routeEdges = () => diagram.edges.map((edge) =>
      routeArchitectureEdge(
        edge,
        servicesById,
        serviceBounds,
        junctionBounds,
        flatGroups,
        services,
        junctionBounds,
        { start: edge.hasArrowStart ? architectureMarkerTerminal('architecture-arrow-start', typography.edgeLineWidth, 'start') : 0, end: edge.hasArrowEnd ? architectureMarkerTerminal('architecture-arrow-end', typography.edgeLineWidth, 'end') : 0 },
        typography.edgeBendRadius,
      )
    )
    let edges = routeEdges()
    if (legalSlots) edges = improveArchitectureSiblingSlots(diagram, services, edges, routeEdges, legalSlots, routes => {
      // Private all-pair shaft grouping, with the public predicates' unchanged
      // thresholds. Keep generic metric dependencies out of the optional solver.
      const ink = routes.map(({ points }) => ({ points, style: 'solid' as const, source: '', target: '_' }))
      return countOpposingRouteOverlaps(ink) || countParallelRouteOverlaps(ink)
    })
    edges.forEach((edge, index) => { edge.labelBlock = edgeText[index] })
    separateEdgeLabels(edges, services, metrics)

    const titleBlock = diagram.title ? preparePixelText(diagram.title, {
      display: 'formatted', transform: metrics?.groupTextTransform,
      fontSize: ARCHITECTURE_TITLE_FONT_SIZE, fontWeight: ARCHITECTURE_TITLE_FONT_WEIGHT, safeFont: true,
    }) : undefined
    const titleText = titleBlock?.text
    const titleHeight = titleBlock ? titleBlock.height - (titleBlock.lineHeight - titleBlock.fontSize) : 0
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
      width = Math.max(width, titleBlock!.width + TITLE_SIDE_PADDING * 2)
      // The centered title owns its complete block. Move the graph as one unit
      // so nested groups, ports and routed labels retain their relative geometry.
      const titleTop = TITLE_Y - ARCHITECTURE_TITLE_FONT_SIZE / 2
      const contentTop = Math.min(...services.map(s => s.y), ...junctions.map(j => j.y), ...[...flatGroups.values()].map(g => g.y))
      const shiftY = Math.max(0, titleTop + titleHeight + 11 - contentTop)
      const shiftGroup = (group: PositionedArchitectureGroup): void => {
        group.y += shiftY
        group.children.forEach(shiftGroup)
      }
      groups.forEach(shiftGroup)
      for (const service of services) service.y += shiftY
      for (const junction of junctions) junction.y += shiftY
      for (const edge of edges) {
        for (const point of edge.points) point.y += shiftY
        if (edge.labelPosition) edge.labelPosition.y += shiftY
      }
      height = Math.max(height + shiftY, titleTop + titleHeight + 20)
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

    for (const service of services) {
      const iconX = service.x + typography.servicePaddingX
      service.labelPosition = {
        x: service.iconTextBlock
          ? iconX + service.iconTextBlock.width + (service.iconTextBlock.width ? 10 : 0)
          : service.icon
          ? iconX + (typography.serviceIconSize ?? DEFAULT_ARCHITECTURE_VISUAL.serviceIconSize) + Math.max(10, typography.servicePaddingX * 0.7)
          : iconX,
        y: service.y + service.height / 2,
      }
    }
    // Route proposals are checked again after all side constraints, slot moves
    // and title translations, against the actual final family header geometry.
    const headers = [...flatGroups.values()].flatMap(group => {
      const header = architectureHeaderObstacle(group)
      return header ? [header] : []
    })
    const headerFailures = edges.flatMap(edge => headers
      .filter(header => !routeClearsObstacles(edge.points, [header]))
      .map(header => `edge ${edge.source.id}->${edge.target.id}: crosses group ${header.id} header`))
    if (reservedHeaderPadding !== undefined) for (const group of flatGroups.values()) {
      const children = [...group.children, ...services.filter(service => service.parentId === group.id), ...junctions.filter(junction => junction.parentId === group.id)]
      for (const child of children) if (child.y < group.y + group.headerHeight! + reservedHeaderPadding) headerFailures.push(`group ${group.id}: child ${child.id} lacks reserved header clearance`)
    }
    if (headerFailures.length) throw new LayoutCertificationError([{ strategy: 'architecture-final-headers', violations: headerFailures }])
    return {
      width,
      height,
      ...(titleText ? { title: { text: titleText, x: width / 2, y: TITLE_Y + (titleHeight - ARCHITECTURE_TITLE_FONT_SIZE) / 2, block: titleBlock } } : {}),
      groups,
      services,
      junctions,
      edges,
      accessibilityTitle: diagram.accessibilityTitle,
      accessibilityDescription: diagram.accessibilityDescription,
    }
  }
  return runMeasuredGraphBackend(options,
    () => finish(layoutNativeGraphPlacementSync(graph, placementOptions), true),
    () => finish(layoutElkGraphPlacementSync(graph, { ...placementOptions, preserveSubgraphChildOrder: true }), false),
    true,
  )
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

  // Fixed-axis requests are declarative. Seed row lanes first, then project
  // columns; complete component normalization below preserves intersections.
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
  if (diagram.alignments.length) {
    // Distinct items cannot share both authored center coordinates. Reject
    // this contradiction instead of repeatedly separating one requested axis.
    const centers = new Map<string, Map<string, string>>()
    for (const item of byId.values()) {
      const row = rowFind(item.id), column = find(item.id)
      let columns = centers.get(row)
      if (!columns) { columns = new Map(); centers.set(row, columns) }
      const previous = columns.get(column)
      if (previous !== undefined) throw new LayoutCertificationError([{ strategy: 'architecture-alignments', violations: [`incompatible row and column constraints tie distinct items ${previous} and ${item.id}`] }])
      columns.set(column, item.id)
    }
  }
  // Overlapping directives denote one fixed-axis component. Sequential
  // pair projection can leave an earlier member at an obsolete center.
  // Normalize the complete components before the existing free-axis repair.
  if (diagram.alignments.length) {
    for (const axis of ['row', 'column'] as const) {
      const component = axis === 'row' ? rowFind : find
      const centers = new Map<string, number>()
      for (const item of byId.values()) {
        const root = component(item.id), value = axis === 'row' ? item.y + item.height / 2 : item.x + item.width / 2
        centers.set(root, Math.min(centers.get(root) ?? Infinity, value))
      }
      for (const item of byId.values()) {
        const center = centers.get(component(item.id))!
        const previous = axis === 'row' ? item.y + item.height / 2 : item.x + item.width / 2
        if (Math.abs(previous - center) <= ROUTE_EPSILON) continue
        if (axis === 'row') item.y = center - item.height / 2
        else item.x = center - item.width / 2
      }
    }
  }
  if (diagram.alignments.length) for (const axis of ['row', 'column'] as const) {
    const fixed = axis === 'row' ? rowFind : find, movable = axis === 'row' ? find : rowFind
    const coordinate = axis === 'row' ? 'x' : 'y', extent = axis === 'row' ? 'width' : 'height'
    const components = new Map<string, AlignableArchitectureItem[]>(), lanes = new Map<string, AlignableArchitectureItem[]>()
    for (const item of byId.values()) {
      const root = movable(item.id), lane = fixed(item.id)
      const members = components.get(root) ?? []; members.push(item); components.set(root, members)
      const row = lanes.get(lane) ?? []; row.push(item); lanes.set(lane, row)
    }
    const centers = new Map<string, number>(), names = new Map<string, string>()
    for (const [root, members] of components) {
      centers.set(root, Math.min(...members.map(item => item[coordinate] + item[extent] / 2)))
      names.set(root, members.map(item => item.id).sort(compareCodePointStrings)[0]!)
    }
    // Alignment constrains centers, not free-axis precedence. Choose one
    // deterministic component order for ALL lanes, so every required gap
    // propagates forward once, including cross-axis component translations.
    const order = [...components.keys()].sort((a, b) => centers.get(a)! - centers.get(b)! || compareCodePointStrings(names.get(a)!, names.get(b)!))
    const rank = new Map(order.map((root, index) => [root, index]))
    const predecessors = new Map<string, Array<{ before: AlignableArchitectureItem; after: AlignableArchitectureItem }>>()
    for (const members of lanes.values()) {
      members.sort((a, b) => rank.get(movable(a.id))! - rank.get(movable(b.id))!)
      for (let index = 1; index < members.length; index++) {
        const before = members[index - 1]!, after = members[index]!, root = movable(after.id)
        const previous = predecessors.get(root) ?? []; previous.push({ before, after }); predecessors.set(root, previous)
      }
    }
    for (const root of order) {
      let delta = 0
      for (const { before, after } of predecessors.get(root) ?? []) delta = Math.max(delta, before[coordinate] + before[extent] + spacing - after[coordinate])
      if (delta > 0) for (const item of components.get(root)!) item[coordinate] += delta
    }
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
  serviceMeta: Map<string, ArchitectureService>,
  groupMeta: Map<string, ArchitectureGroup>,
  junctionMeta: Map<string, ArchitectureDiagram['junctions'][number]>,
  positionedServices: Map<string, Bounds>,
  positionedJunctions: Map<string, Bounds>,
  retainLegality?: (validate: () => boolean) => void,
  reservedHeaderPadding?: number,
): boolean {
  let changed = false
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
    if (kind !== 'group') {
      const item = kind === 'service' ? positionedServices.get(id) : positionedJunctions.get(id)
      if (item) item[axis] += delta
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
  const siblingKeysFor = (parentId?: string): string[] =>
    siblingRefs(parentId).map(ref => unitKey(ref.kind, ref.id)).filter(key => unitBounds(key) !== undefined)

  // Reuse the same alignment components for authored-side ordering and both
  // cleanup axes. Nested members constrain their direct child at this level.
  const alignmentComponents = (siblingKeys: string[], parentId: string | undefined, axis: 'row' | 'column') => {
    const parent = new Map(siblingKeys.map(key => [key, key]))
    const find = (key: string): string => {
      const next = parent.get(key) ?? key
      if (next === key) return key
      const root = find(next)
      parent.set(key, root)
      return root
    }
    for (const alignment of diagram.alignments) {
      if (alignment.axis !== axis) continue
      const keys = alignment.members.map(member => {
        const path = itemPath(member)
        if (!path) return undefined
        if (!parentId) return path[0]
        const index = path.indexOf(unitKey('group', parentId))
        return index >= 0 ? path[index + 1] : undefined
      }).filter((key): key is string => key !== undefined && parent.has(key))
      for (const key of keys.slice(1)) parent.set(find(key), find(keys[0]!))
    }
    const members = new Map<string, string[]>()
    for (const key of siblingKeys) {
      const root = find(key)
      const values = members.get(root) ?? []
      values.push(key)
      members.set(root, values)
    }
    const bounds = (root: string): Bounds => {
      const values = members.get(root)!.map(key => unitBounds(key)!)
      const x = Math.min(...values.map(value => value.x))
      const y = Math.min(...values.map(value => value.y))
      const right = Math.max(...values.map(value => value.x + value.width))
      const bottom = Math.max(...values.map(value => value.y + value.height))
      return { x, y, width: right - x, height: bottom - y }
    }
    return { find, members, bounds }
  }

  const grouped = new Map<string, ArchitectureSideConstraint[]>()
  for (const constraint of constraints) {
    const key = `${constraint.depth}:${constraint.parentId ?? ''}:${constraint.axis}`
    const entries = grouped.get(key) ?? []
    entries.push(constraint)
    grouped.set(key, entries)
  }
  const orderedGroups = [...grouped.values()].sort((a, b) =>
    b[0]!.depth - a[0]!.depth
      || compareCodePointStrings(a[0]!.parentId ?? '', b[0]!.parentId ?? '')
      || compareCodePointStrings(a[0]!.axis, b[0]!.axis))

  for (const entries of orderedGroups) {
    const { axis, parentId } = entries[0]!
    const siblingKeys = siblingKeysFor(parentId)
    if (siblingKeys.length < 2) continue

    // Preserve declared row/column equal-coordinate components on their fixed
    // axis by moving the component as one packing unit.
    const { find, members: componentMembers, bounds: componentBounds } =
      alignmentComponents(siblingKeys, parentId, axis === 'x' ? 'column' : 'row')

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
          return delta || compareCodePointStrings(a, b)
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
    expandGroupBounds(roots, services, junctions, true, reservedHeaderPadding)
  }

  // A reorder inside one group can move an aligned member without its peers
  // in other groups. Reconcile at their lowest common container, translating
  // whole child groups so their internal ordering and endpoint faces survive.
  let alignmentsChanged = false
  for (const alignment of diagram.alignments) {
    const axis = alignment.axis === 'row' ? 'y' : 'x'
    const size = axis === 'y' ? 'height' : 'width'
    const entries = [...new Set(alignment.members)].flatMap(id => {
      const path = itemPath(id)
      const item = positionedServices.get(id) ?? positionedJunctions.get(id)
      return path && item ? [{ path, item }] : []
    })
    const align = (values: typeof entries, depth: number): void => {
      if (values.length < 2) return
      const limit = Math.min(...values.map(value => value.path.length))
      while (depth < limit && values.every(value => value.path[depth] === values[0]!.path[depth])) depth++
      if (depth >= limit) return
      const units = new Map<string, typeof entries>()
      for (const value of values) {
        const key = value.path[depth]!
        const members = units.get(key) ?? []
        members.push(value)
        units.set(key, members)
      }
      for (const members of units.values()) align(members, depth + 1)
      const center = Math.max(...values.map(value => value.item[axis] + value.item[size] / 2))
      for (const [key, members] of units) {
        const delta = center - (members[0]!.item[axis] + members[0]!.item[size] / 2)
        if (delta > ROUTE_EPSILON) { translateUnit(key, axis, delta); alignmentsChanged = changed = true }
      }
    }
    align(entries, 0)
  }
  if (alignmentsChanged) expandGroupBounds(roots, services, junctions, true, reservedHeaderPadding)

  // A child reorder can enlarge its parent into a formerly clear sibling (for
  // example two root groups stacked vertically). Resolve those secondary
  // overlaps bottom-up. Row-aligned siblings form one component so cleanup
  // cannot silently break an explicit alignment.
  const contexts: Array<{ parentId?: string; depth: number }> = [
    ...diagram.groups.map(group => ({ parentId: group.id, depth: groupAncestors(group.id).length })),
    { parentId: undefined, depth: 0 },
  ].sort((a, b) => b.depth - a.depth || compareCodePointStrings(a.parentId ?? '', b.parentId ?? ''))
  const overlaps = (a: Bounds, b: Bounds): boolean =>
    a.x < b.x + b.width - ROUTE_EPSILON && b.x < a.x + a.width - ROUTE_EPSILON
      && a.y < b.y + b.height - ROUTE_EPSILON && b.y < a.y + a.height - ROUTE_EPSILON

  for (const context of contexts) {
    const siblingKeys = siblingKeysFor(context.parentId)
    if (siblingKeys.length < 2) continue
    const { members, bounds: boundsFor } = alignmentComponents(siblingKeys, context.parentId, 'row')
    // Equal row centers constrain y, not x. Their expanded group frames can
    // overlap even when the aligned services themselves are clear. Separate
    // those siblings horizontally, moving column-aligned units together.
    const { find: column, members: columns } = alignmentComponents(siblingKeys, context.parentId, 'column')
    for (let pass = 0; pass < siblingKeys.length; pass++) {
      let moved = false
      for (const row of members.values()) {
        const order = [...row].sort((a, b) => unitBounds(a)!.x - unitBounds(b)!.x || compareCodePointStrings(a, b))
        let cursor = -Infinity
        const seen = new Set<string>()
        for (const key of order) {
          const component = column(key)
          if (seen.has(component)) continue
          seen.add(component)
          const bounds = unitBounds(key)!
          if (bounds.x < cursor - ROUTE_EPSILON) {
            const delta = cursor - bounds.x
            for (const sibling of columns.get(component)!) translateUnit(sibling, 'x', delta)
            moved = changed = true
          }
          cursor = bounds.x + bounds.width + spacing
        }
      }
      if (!moved) break
    }
    const order = [...members.keys()].sort((a, b) => {
      const aa = boundsFor(a), bb = boundsFor(b)
      return aa.y - bb.y || aa.x - bb.x || compareCodePointStrings(a, b)
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
    expandGroupBounds(roots, services, junctions, true, reservedHeaderPadding)
  }
  // Native optional slot trials reuse exactly the authored constraints and
  // sibling geometry already owned by this pass. No trial refits groups.
  retainLegality?.(() => constraints.every(({ axis, before, after }) => {
    const a = unitBounds(before)!, b = unitBounds(after)!
    return a[axis] + (axis === 'x' ? a.width : a.height) + spacing <= b[axis] + ROUTE_EPSILON
  }) && (reservedHeaderPadding === undefined || [...groups.values()].every(group => siblingRefs(group.id).every(ref => {
    const child = unitBounds(unitKey(ref.kind, ref.id))
    return child === undefined || child.y >= group.y + group.headerHeight! + reservedHeaderPadding
  }))) && contexts.every(context => {
    const bounds = siblingRefs(context.parentId).map(ref => unitBounds(unitKey(ref.kind, ref.id))).filter((bound): bound is Bounds => bound !== undefined)
    return bounds.every((bound, index) => bounds.slice(index + 1).every(other => !overlaps(bound, other)))
  }))
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
    headerHeight: group.headerHeight,
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
  reservedHeaderPadding?: number,
): void {
  for (const group of groups) expandSingleGroup(group, services, junctions, refitAfterAlignment, reservedHeaderPadding)
}

function expandSingleGroup(
  group: PositionedArchitectureGroup,
  services: PositionedArchitectureService[],
  junctions: PositionedArchitectureJunction[],
  refitAfterAlignment: boolean,
  reservedHeaderPadding?: number,
): Bounds {
  const childBounds: Bounds[] = []
  for (const child of group.children) childBounds.push(expandSingleGroup(child, services, junctions, refitAfterAlignment, reservedHeaderPadding))
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
  const topPadding = reservedHeaderPadding === undefined ? GROUP_EDGE_PAD : group.headerHeight! + reservedHeaderPadding
  const minY = Math.min(group.y, ...childBounds.map(child => child.y - topPadding))
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
  terminal: { start: number; end: number },
  radius: number,
): PositionedArchitectureEdge {
  const source = resolveEndpoint(edge.source, servicesById, serviceBounds, junctionBounds, groups, terminal.start ? terminal.start + radius : 0)
  const target = resolveEndpoint(edge.target, servicesById, serviceBounds, junctionBounds, groups, terminal.end ? terminal.end + radius : 0)
  const obstacles = architectureRouteObstacles(edge, servicesById, groups, services, junctionsById)
  // Only the anchor-to-exit lead may touch its incident card. The middle
  // route must remain outside both endpoints so it cannot reverse through
  // the target and hide an arrowhead under the card's paint.
  for (const endpoint of [edge.source, edge.target]) {
    const group = endpoint.boundary === 'group' ? groups.get(servicesById.get(endpoint.id)!.parentId!) : undefined
    const bounds = group ?? serviceBounds.get(endpoint.id) ?? junctionBounds.get(endpoint.id)!
    obstacles.push({ ...bounds, id: group?.id ?? endpoint.id, kind: group ? 'group' : serviceBounds.has(endpoint.id) ? 'service' : 'junction' })
  }
  // A fixed exit can land inside the clearance envelope of a neighboring
  // card. Stop at that envelope so the visibility search has a reachable
  // start/end, while retaining the authored attachment side.
  for (const [endpoint, side] of [[source, edge.source.side], [target, edge.target.side]] as const) {
    const horizontal = side === 'L' || side === 'R'
    const forward = side === 'R' || side === 'B'
    let distance = Math.abs(horizontal ? endpoint.exit.x - endpoint.anchor.x : endpoint.exit.y - endpoint.anchor.y)
    for (const obstacle of obstacles) {
      const cross = horizontal ? endpoint.anchor.y : endpoint.anchor.x
      const lo = horizontal ? obstacle.y : obstacle.x
      const size = horizontal ? obstacle.height : obstacle.width
      if (cross <= lo + ROUTE_EPSILON || cross >= lo + size - ROUTE_EPSILON) continue
      const face = horizontal ? obstacle.x + (forward ? 0 : obstacle.width) : obstacle.y + (forward ? 0 : obstacle.height)
      const gap = (face - (horizontal ? endpoint.anchor.x : endpoint.anchor.y)) * (forward ? 1 : -1)
      if (gap > ROUTE_EPSILON) distance = Math.min(distance, gap)
    }
    endpoint.exit = movePoint(endpoint.anchor, side, distance)
  }
  const directMiddle = simplifyOrthogonalPoints([
    source.exit,
    ...routeBetween(source.exit, target.exit, edge.source.side, edge.target.side),
    target.exit,
  ])
  const middle = routeClearsObstacles(directMiddle, obstacles)
    ? directMiddle
    : routeOrthogonalAroundObstacles(source.exit, target.exit, obstacles) ?? directMiddle
  let points = simplifyOrthogonalPoints([
    source.anchor,
    ...middle,
    target.anchor,
  ])
  const extended = extendTerminalRuns(points, terminal)
  if (extended && extended !== points && routeClearsObstacles(extended, obstacles)) points = extended
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
  kind: 'service' | 'junction' | 'group' | 'group-header'
}

const ROUTE_CLEARANCE = 6
const ROUTE_EPSILON = 0.001

/** The family renderer uses this retained measured band verbatim. */
function architectureHeaderObstacle(group: PositionedArchitectureGroup): RouteObstacle | undefined {
  const height = group.headerHeight
  // The writer uses the retained band height independently of its frame.
  if (height === undefined || !Number.isFinite(height) || height < 0) {
    throw new LayoutCertificationError([{ strategy: 'architecture-final-headers', violations: [`group ${group.id}: missing or invalid measured header height`] }])
  }
  return height > 0 ? { id: group.id, kind: 'group-header', x: group.x, y: group.y, width: group.width, height } : undefined
}

/**
 * Node cards, junctions, and unrelated group interiors are hard route
 * obstacles. An endpoint ancestor keeps its measured header as an obstacle:
 * an item-level edge may leave the body but cannot traverse its title band.
 * A `{group}` north exterior contact touches only the open band boundary.
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
    if (excludedGroups.has(group.id)) {
      const header = architectureHeaderObstacle(group)
      if (header) obstacles.push(header)
    } else obstacles.push(inflate(group.id, 'group', group))
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

function segmentCrossesObstacleInterior(a: Point, b: Point, obstacle: RouteObstacle): boolean {
  if (obstacle.kind === 'group-header') {
    let low = 0, high = 1
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, obstacle.x, obstacle.x + obstacle.width],
      [a.y, b.y - a.y, obstacle.y, obstacle.y + obstacle.height],
    ]) {
      if (delta === 0) { if (start! <= min! || start! >= max!) return false; continue }
      const first = (min! - start!) / delta!, last = (max! - start!) / delta!
      low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last))
      if (low >= high) return false
    }
    return low < high
  }
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
  const insideObstacle = (x: number, y: number): boolean => obstacles.some(obstacle => {
    const inset = obstacle.kind === 'group-header' ? 0 : ROUTE_EPSILON
    return x > obstacle.x + inset && x < obstacle.x + obstacle.width - inset
      && y > obstacle.y + inset && y < obstacle.y + obstacle.height - inset
  })

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
  const boxAt = (edge: PositionedArchitectureEdge, cx: number, cy: number): Box => {
    const block = edge.labelBlock ?? preparePixelText(edge.label!, { display: 'formatted', fontSize: FS, fontWeight: FW, letterSpacing: metrics?.edgeLetterSpacing })
    const w = block.width + PAD * 2
    const h = block.height + PAD * 2
    return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }
  }
  const intersects = (a: Box, b: Box): boolean =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
  const serviceBoxes: Box[] = services.map(sv => ({ x0: sv.x, y0: sv.y, x1: sv.x + sv.width, y1: sv.y + sv.height }))
  const labeled = edges.filter(e => e.label && e.labelPosition && e.points.length >= 2)
  const placed: Box[] = []
  for (const edge of labeled) {
    const current = boxAt(edge, edge.labelPosition!.x, edge.labelPosition!.y)
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
      const b = boxAt(edge, q.x, q.y)
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
  lead = 0,
): ResolvedEndpoint {
  if (endpoint.boundary === 'group') {
    const service = servicesById.get(endpoint.id)!
    const serviceBoundsEntry = serviceBounds.get(endpoint.id)!
    const group = groups.get(service.parentId!)!
    const anchor = groupAnchor(group, serviceBoundsEntry, endpoint.side)
    return { anchor, exit: movePoint(anchor, endpoint.side, Math.max(EDGE_EXIT_GAP, lead)) }
  }

  const serviceBoundsEntry = serviceBounds.get(endpoint.id)
  if (serviceBoundsEntry) {
    const anchor = rectAnchor(serviceBoundsEntry, endpoint.side)
    return { anchor, exit: movePoint(anchor, endpoint.side, Math.max(EDGE_EXIT_GAP, lead)) }
  }

  const junctionBoundsEntry = junctionBounds.get(endpoint.id)
  if (!junctionBoundsEntry) {
    throw new Error(`Unknown architecture endpoint "${endpoint.id}"`)
  }

  const anchor = circleAnchor(junctionBoundsEntry, endpoint.side)
  return { anchor, exit: movePoint(anchor, endpoint.side, Math.max(EDGE_EXIT_GAP * 0.75, lead)) }
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

export function simplifyOrthogonalPoints(points: Point[]): Point[] {
  const simplified: Point[] = []
  let previousInput: Point | undefined
  for (const point of points) {
    // Deduplicate authored neighbors before reducing collinearity: a U-turn
    // can introduce equal endpoints which the old reduction retained.
    if (previousInput && previousInput.x === point.x && previousInput.y === point.y) continue
    previousInput = point
    while (simplified.length > 1) {
      const prev = simplified[simplified.length - 2]!, curr = simplified[simplified.length - 1]!
      if ((prev.x === curr.x && curr.x === point.x) || (prev.y === curr.y && curr.y === point.y)) simplified.pop()
      else break
    }
    simplified.push(point)
  }
  return simplified
}

/** The point halfway along an edge route, measuring each segment by its
 * Manhattan length (routes are orthogonal). The renderer uses it too, for
 * edges that reach it without a laid-out label position. */
export function edgeMidpoint(points: Point[]): Point {
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
