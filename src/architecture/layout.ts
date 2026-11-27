import { extendTerminalRuns } from '../layout/terminal-clearance.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { routeOrthogonal, type RouterDirection } from '../layout/orthogonal-router.ts'
import { architectureMarkerTerminal } from './markers.ts'
import { architectureIconFallbackBlock } from './icon-layout.ts'
import { assertArchitectureDiagramWork } from '../shared/diagram-limits.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import type { Point, RenderOptions } from '../types.ts'
import { ARCHITECTURE_DEFAULT_LAYER_SPACING, ARCHITECTURE_DEFAULT_NODE_SPACING, DEFAULT_ARCHITECTURE_VISUAL, architectureLayoutMetrics } from './config.ts'
import type { ArchitectureLayoutMetrics } from './config.ts'
import { layoutElkGraphPlacementSync } from '../layout-engine.ts'
import { runElkGraphBackend } from '../layout/backend.ts'
import { architectureToMermaidGraph } from './parser.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
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
/** Padding of the box the renderer paints behind an edge label. */
export const EDGE_LABEL_PADDING = 7
/** The least room between an edge label's box and the canvas edge. */
const LABEL_CANVAS_MARGIN = 8
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

  // Selection owns the completed family artifact. A raw placement cannot
  // publish success before its alignments, contacts and headers have passed.
  const finish = (positioned: ReturnType<typeof layoutElkGraphPlacementSync>): PositionedArchitectureDiagram => {
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
      edgeText,
      reservedHeaderPadding,
    )
    if (sideConstraintsChanged) {
      // Port constraints can reorder a child or a whole nested group. Refit once
      // more before resolving `{group}` anchors and route obstacles.
      expandGroupBounds(groups, services, junctions, true, reservedHeaderPadding)
    }
    const contactsSnapped = snapNearlyAlignedContacts(diagram, services, junctions, flatGroups, options.nodeSpacing ?? ARCHITECTURE_DEFAULT_NODE_SPACING, reservedHeaderPadding)

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

    const routeOnce = (drawnFor: (index: number) => readonly Point[][], apartFor: (index: number, routed: readonly PositionedArchitectureEdge[]) => readonly Point[][] = () => []) => diagram.edges.reduce<PositionedArchitectureEdge[]>((routed, edge, index) => (routed.push(
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
        drawnFor(index),
        apartFor(index, routed),
      )), routed), [])
    // A detour should not cross the other relations. Route once without them,
    // then route again knowing every other relation's route: only detours
    // read them, and direct routes come out the same. The second pass also
    // keeps each route off the ink of the relations authored before it, as
    // they are finally drawn: the later relation yields, so two relations
    // never both move to one new line. Relations that share an authored
    // contact share its lead.
    const routeEdges = () => {
      const first = routeOnce(() => [])
      const others = first.map(edge => edge.points)
      const contact = (end: ArchitectureEndpoint): string => `${end.boundary ?? 'item'}:${end.id}:${end.side}`
      const sharesContact = (a: ArchitectureDiagram['edges'][number], b: ArchitectureDiagram['edges'][number]): boolean =>
        [a.source, a.target].some(end => [b.source, b.target].some(other => contact(end) === contact(other)))
      return routeOnce(index => others.filter((_, other) => other !== index), (index, routed) =>
        routed.filter((_, other) => !sharesContact(diagram.edges[index]!, diagram.edges[other]!)).map(edge => edge.points))
    }
    const edges = routeEdges()
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
    if (diagram.alignments.length > 0 || sideConstraintsChanged || contactsSnapped) {
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
    // Every edge label's painted box, card, junction, group frame and route
    // lies on the canvas. Packing can leave a route near the canvas edge, a
    // label seated on it then reaches past the left or top edge, and lining
    // relations up can move a unit past it: move the whole drawing in by
    // what it needs.
    const labelBoxes = edges.flatMap(edge => edge.labelPosition && edge.labelBlock ? [{
      x0: edge.labelPosition.x - edge.labelBlock.width / 2 - EDGE_LABEL_PADDING, y0: edge.labelPosition.y - edge.labelBlock.height / 2 - EDGE_LABEL_PADDING,
      x1: edge.labelPosition.x + edge.labelBlock.width / 2 + EDGE_LABEL_PADDING, y1: edge.labelPosition.y + edge.labelBlock.height / 2 + EDGE_LABEL_PADDING,
    }] : [])
    const drawn = [...services, ...junctions, ...flatGroups.values(), ...edges.flatMap(edge => edge.points.map(point => ({ ...point, width: 0, height: 0 })))]
    const inX = Math.max(0, LABEL_CANVAS_MARGIN - Math.min(Infinity, ...labelBoxes.map(box => box.x0), ...drawn.map(box => box.x)))
    const inY = Math.max(0, LABEL_CANVAS_MARGIN - Math.min(Infinity, ...labelBoxes.map(box => box.y0), ...drawn.map(box => box.y)))
    if (inX > 0 || inY > 0) {
      const shiftGroup = (group: PositionedArchitectureGroup): void => {
        group.x += inX; group.y += inY
        group.children.forEach(shiftGroup)
      }
      groups.forEach(shiftGroup)
      for (const item of [...services, ...junctions]) { item.x += inX; item.y += inY }
      for (const edge of edges) {
        for (const point of edge.points) { point.x += inX; point.y += inY }
        if (edge.labelPosition) { edge.labelPosition.x += inX; edge.labelPosition.y += inY }
      }
      for (const box of labelBoxes) { box.x0 += inX; box.x1 += inX; box.y0 += inY; box.y1 += inY }
      width += inX
      height += inY
    }
    for (const box of labelBoxes) {
      width = Math.max(width, box.x1 + LABEL_CANVAS_MARGIN)
      height = Math.max(height, box.y1 + LABEL_CANVAS_MARGIN)
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
  return runElkGraphBackend(options,
    () => finish(layoutElkGraphPlacementSync(graph, { ...placementOptions, preserveSubgraphChildOrder: true })),
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
  /** The least room between the two units: the node spacing, or what the
   * relation's label needs to sit between them along this axis. */
  gap: number
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
  edgeLabels: readonly ({ width: number; height: number } | undefined)[],
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
  for (const [index, edge] of diagram.edges.entries()) {
    const sourcePath = itemPath(edge.source.id, edge.source.boundary)
    const targetPath = itemPath(edge.target.id, edge.target.boundary)
    if (!sourcePath || !targetPath) continue
    // A label is seated on its own route between the two units, so their gap
    // along an axis holds the label's extent on it, its painted padding and a
    // route clearance either side.
    const label = edgeLabels[index]
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
        gap: label ? Math.max(spacing, (axis === 'x' ? label.width : label.height) + 2 * (EDGE_LABEL_PADDING + ROUTE_CLEARANCE)) : spacing,
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
    const gaps = new Map<string, number>()
    const gapOf = (before: string, after: string): number => gaps.get(`${before}\0${after}`) ?? spacing
    let intrinsicConflict = false
    for (const entry of entries) {
      const before = find(entry.before)
      const after = find(entry.after)
      if (before === after) { intrinsicConflict = true; break }
      const targets = arcs.get(before) ?? new Set<string>()
      targets.add(after)
      arcs.set(before, targets)
      gaps.set(`${before}\0${after}`, Math.max(gapOf(before, after), entry.gap))
    }
    if (intrinsicConflict) continue

    const components = [...componentMembers.keys()]
    const constraintSatisfied = (before: string, after: string): boolean => {
      const a = componentBounds(before), b = componentBounds(after)
      return axis === 'x'
        ? a.x + a.width + gapOf(before, after) <= b.x + ROUTE_EPSILON
        : a.y + a.height + gapOf(before, after) <= b.y + ROUTE_EPSILON
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

    // Pack the constrained units by longest path: a unit starts one spacing
    // past the last unit it must follow, and a unit that follows none starts
    // where the first constrained unit did. A unit no face constrains on
    // this axis keeps its place, so satisfying one relation never pushes an
    // unrelated sibling off the line of another (pele#138); the overlap
    // cleanup below separates any units this brings together.
    const predecessors = new Map(components.map(component => [component, [] as string[]]))
    for (const [before, afters] of arcs) for (const after of afters) predecessors.get(after)!.push(before)
    const constrained = new Set([...arcs].flatMap(([before, afters]) => [before, ...afters]))
    const startOf = (bounds: Bounds): number => axis === 'x' ? bounds.x : bounds.y
    const origin = Math.min(...[...constrained].map(component => startOf(componentBounds(component))))
    for (const component of order) {
      if (!constrained.has(component)) continue
      const start = startOf(componentBounds(component))
      const required = Math.max(origin, ...predecessors.get(component)!.map(before => {
        const placed = componentBounds(before)
        return startOf(placed) + (axis === 'x' ? placed.width : placed.height) + gapOf(before, component)
      }))
      const delta = required - start
      if (Math.abs(delta) <= ROUTE_EPSILON) continue
      changed = true
      for (const key of componentMembers.get(component)!) translateUnit(key, axis, delta)
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
    // Any two siblings side by side (their y spans overlap, their x spans do
    // not) keep the node spacing between them. The right one moves right with
    // its column, and so does a unit a face places after it, so no x order
    // a face already has reverses (conflicting faces have none to keep).
    const xFaces = constraints.filter(constraint => {
      if (constraint.axis !== 'x' || constraint.parentId !== context.parentId) return false
      const before = unitBounds(constraint.before), after = unitBounds(constraint.after)
      return before !== undefined && after !== undefined && before.x + before.width <= after.x + ROUTE_EPSILON
    })
    for (let pass = 0; pass < siblingKeys.length; pass++) {
      let moved = false
      const order = [...siblingKeys].sort((a, b) => unitBounds(a)!.x - unitBounds(b)!.x || compareCodePointStrings(a, b))
      for (const [index, key] of order.entries()) {
        const bounds = unitBounds(key)!
        let required = -Infinity
        for (const other of order.slice(0, index)) {
          const placed = unitBounds(other)!
          if (column(other) === column(key) || placed.x + placed.width > bounds.x + ROUTE_EPSILON) continue
          if (placed.y < bounds.y + bounds.height - ROUTE_EPSILON && bounds.y < placed.y + placed.height - ROUTE_EPSILON) required = Math.max(required, placed.x + placed.width + spacing)
        }
        for (const face of xFaces) {
          const before = face.after === key ? unitBounds(face.before) : undefined
          if (before) required = Math.max(required, before.x + before.width + face.gap)
        }
        if (bounds.x >= required - ROUTE_EPSILON) continue
        const delta = required - bounds.x
        for (const sibling of columns.get(column(key))!) translateUnit(sibling, 'x', delta)
        moved = changed = true
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
        // Every other pair keeps the node spacing too, measured between the
        // nearest points of the two boxes: a unit below another moves down
        // until it is that far away.
        const gapX = (other: Bounds): number => Math.max(0, other.x - bounds.x - bounds.width, bounds.x - other.x - other.width)
        const gapY = (other: Bounds): number => Math.max(0, other.y - bounds.y - bounds.height, bounds.y - other.y - other.height)
        const blockers = placed.map(boundsFor).filter(other => overlaps(bounds, other) || Math.hypot(gapX(other), gapY(other)) < spacing - ROUTE_EPSILON)
        if (blockers.length === 0) break
        const targetY = Math.max(...blockers.map(other => other.y + other.height + Math.sqrt(Math.max(0, spacing * spacing - gapX(other) ** 2))))
        const delta = targetY - bounds.y
        for (const key of members.get(root)!) translateUnit(key, 'y', delta)
        changed = true
      }
      placed.push(root)
    }
    expandGroupBounds(roots, services, junctions, true, reservedHeaderPadding)
  }

  // Faces fix the order along a relation's axis and leave the other axis to
  // wherever placement put each unit, so a child could sit far to one side of
  // the face it hangs from and its relation bend across others (mermaid#1212).
  // Line up each relation between facing sides: move the target's unit (or
  // else the source's) across the axis until the two contacts are level. A
  // unit moves at most once per axis and keeps still once another lines up
  // with it; a move must keep every sibling at the node spacing (or as far as
  // it was), stay inside its group's padding, leave explicit alignments alone
  // and keep every face order it satisfied. A labelled relation keeps its
  // bend: its label and arrowheads need a longer run than a straight one
  // between units a spacing apart would give them.
  const pinned = { x: new Set<string>(), y: new Set<string>() }
  // A move never takes a unit above or left of the drawing's top-left corner,
  // which keeps the canvas margin placement gave it.
  const corner = siblingKeysFor(undefined).map(key => unitBounds(key)!).reduce((min, box) => ({ x: Math.min(min.x, box.x), y: Math.min(min.y, box.y) }), { x: Infinity, y: Infinity })
  const contact = (id: string, axis: SideConstraintAxis): number | undefined => {
    const item = positionedServices.get(id) ?? positionedJunctions.get(id)
    return item ? item[axis] + (axis === 'x' ? item.width : item.height) / 2 : undefined
  }
  // Lining up is only worth it when the straight run it makes is drawable:
  // clear of every other card and junction, every header band and every
  // group that contains neither end.
  const straightRunClear = (edge: ArchitectureDiagram['edges'][number]): boolean => {
    const source = positionedServices.get(edge.source.id) ?? positionedJunctions.get(edge.source.id)!
    const target = positionedServices.get(edge.target.id) ?? positionedJunctions.get(edge.target.id)!
    const a = rectAnchor(source, edge.source.side), b = rectAnchor(target, edge.target.side)
    const run = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    const enters = (box: Bounds): boolean => run.x < box.x + box.width - ROUTE_EPSILON && run.x + run.width > box.x + ROUTE_EPSILON
      && run.y < box.y + box.height - ROUTE_EPSILON && run.y + run.height > box.y + ROUTE_EPSILON
    const ends = new Set([...itemPath(edge.source.id) ?? [], ...itemPath(edge.target.id) ?? []])
    for (const item of [...positionedServices.values(), ...positionedJunctions.values()]) if (item !== source && item !== target && enters(item)) return false
    for (const group of groups.values()) {
      const own = ends.has(unitKey('group', group.id))
      if (enters(own ? { ...group, height: group.headerHeight ?? 0 } : group)) return false
    }
    return true
  }
  // How far out of line, in total, the facing contacts are of every relation
  // between this unit and a unit outside it: a move must not raise it, so lining
  // up one relation of a fan never pulls the hub off its middle (corpus fan-ins).
  const misalignment = (unit: string, axis: SideConstraintAxis): number => {
    let total = 0
    for (const [index, edge] of diagram.edges.entries()) {
      if (edgeLabels[index] || edge.source.boundary === 'group' || edge.target.boundary === 'group' || OPPOSITE_SIDE[edge.source.side] !== edge.target.side) continue
      if ((edge.source.side === 'L' || edge.source.side === 'R' ? 'y' : 'x') !== axis) continue
      const inSource = itemPath(edge.source.id)?.includes(unit) ?? false, inTarget = itemPath(edge.target.id)?.includes(unit) ?? false
      if (inSource === inTarget) continue
      const from = contact(edge.source.id, axis), to = contact(edge.target.id, axis)
      if (from !== undefined && to !== undefined) total += Math.abs(from - to)
    }
    return total
  }
  const nearest = (a: Bounds, b: Bounds): number => Math.hypot(Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width), Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height))
  for (const [index, edge] of diagram.edges.entries()) {
    if (edgeLabels[index] || edge.source.boundary === 'group' || edge.target.boundary === 'group' || OPPOSITE_SIDE[edge.source.side] !== edge.target.side) continue
    const sourcePath = itemPath(edge.source.id), targetPath = itemPath(edge.target.id)
    if (!sourcePath || !targetPath) continue
    let common = 0
    while (common < sourcePath.length && common < targetPath.length && sourcePath[common] === targetPath[common]) common++
    if (common >= sourcePath.length || common >= targetPath.length) continue
    const parentId = common === 0 ? undefined : splitUnitKey(sourcePath[common - 1]!).id
    const axis: SideConstraintAxis = edge.source.side === 'L' || edge.source.side === 'R' ? 'y' : 'x'
    const from = contact(edge.source.id, axis), to = contact(edge.target.id, axis)
    if (from === undefined || to === undefined || Math.abs(from - to) <= ROUTE_EPSILON) continue
    const siblings = siblingKeysFor(parentId)
    const parent = parentId ? groups.get(parentId) : undefined
    const topPadding = reservedHeaderPadding === undefined ? GROUP_EDGE_PAD : (parent?.headerHeight ?? 0) + reservedHeaderPadding
    const faces = constraints.filter(constraint => constraint.axis === axis && constraint.parentId === parentId)
    const holds = (constraint: ArchitectureSideConstraint): boolean => {
      const before = unitBounds(constraint.before), after = unitBounds(constraint.after)
      return !!before && !!after && (axis === 'x' ? before.x + before.width : before.y + before.height) + constraint.gap <= (axis === 'x' ? after.x : after.y) + ROUTE_EPSILON
    }
    const aligned = (unit: string): boolean => diagram.alignments.some(alignment => alignment.axis === (axis === 'y' ? 'row' : 'column')
      && alignment.members.some(member => itemPath(member)?.includes(unit)))
    for (const [unit, anchor, delta] of [[targetPath[common]!, sourcePath[common]!, from - to], [sourcePath[common]!, targetPath[common]!, to - from]] as const) {
      if (pinned[axis].has(unit) || aligned(unit)) continue
      const bounds = unitBounds(unit)!
      const moved = { ...bounds, [axis]: bounds[axis] + delta }
      if (parent && (moved.x - GROUP_EDGE_PAD < parent.x - ROUTE_EPSILON || moved.y - topPadding < parent.y - ROUTE_EPSILON
        || moved.x + moved.width + GROUP_EDGE_PAD > parent.x + parent.width + ROUTE_EPSILON || moved.y + moved.height + GROUP_EDGE_PAD > parent.y + parent.height + ROUTE_EPSILON)) continue
      if (moved.x < corner.x - ROUTE_EPSILON || moved.y < corner.y - ROUTE_EPSILON) continue
      if (siblings.some(other => other !== unit && nearest(moved, unitBounds(other)!) < Math.min(spacing, nearest(bounds, unitBounds(other)!)) - ROUTE_EPSILON)) continue
      const kept = faces.filter(holds)
      const offBefore = misalignment(unit, axis)
      translateUnit(unit, axis, delta)
      if (kept.some(constraint => !holds(constraint)) || !straightRunClear(edge) || misalignment(unit, axis) > offBefore + ROUTE_EPSILON) { translateUnit(unit, axis, -delta); continue }
      pinned[axis].add(unit).add(anchor)
      changed = true
      break
    }
  }
  expandGroupBounds(roots, services, junctions, true, reservedHeaderPadding)
  return changed
}


/** Facing contacts this close would join with a jog that reads as a glitch. */
const CONTACT_SNAP = 2
const OPPOSITE_SIDE: Record<ArchitectureEndpoint['side'], ArchitectureEndpoint['side']> = { L: 'R', R: 'L', T: 'B', B: 'T' }

/**
 * Line up the facing contacts of a relation whose units placement left at
 * most CONTACT_SNAP out of line, so its route runs straight. Contacts stay at
 * their side centres; one endpoint unit moves instead, and only when that
 * keeps it inside its group's padding, keeps every distance it had or the
 * node spacing, leaves its fixed alignment axis alone and puts none of its
 * other relations out of line.
 */
function snapNearlyAlignedContacts(
  diagram: ArchitectureDiagram,
  services: PositionedArchitectureService[],
  junctions: PositionedArchitectureJunction[],
  groups: Map<string, PositionedArchitectureGroup>,
  spacing: number,
  reservedHeaderPadding?: number,
): boolean {
  const items = new Map<string, PositionedArchitectureService | PositionedArchitectureJunction>([...services, ...junctions].map(item => [item.id, item]))
  const aligned = (id: string, axis: 'x' | 'y'): boolean => diagram.alignments.some(alignment => alignment.axis === (axis === 'y' ? 'row' : 'column') && alignment.members.includes(id))
  const offAxis = (edge: ArchitectureDiagram['edges'][number]): { axis: 'x' | 'y'; offset: number } | undefined => {
    const source = items.get(edge.source.id), target = items.get(edge.target.id)
    if (!source || !target || edge.source.boundary === 'group' || edge.target.boundary === 'group' || OPPOSITE_SIDE[edge.source.side] !== edge.target.side) return undefined
    const axis = edge.source.side === 'L' || edge.source.side === 'R' ? 'y' : 'x'
    const size = axis === 'y' ? 'height' : 'width'
    return { axis, offset: target[axis] + target[size] / 2 - source[axis] - source[size] / 2 }
  }
  const distance = (a: Bounds, b: Bounds): number => Math.hypot(Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width), Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height))
  let snapped = false
  for (const edge of diagram.edges) {
    const misaligned = offAxis(edge)
    if (!misaligned || Math.abs(misaligned.offset) <= ROUTE_EPSILON || Math.abs(misaligned.offset) > CONTACT_SNAP) continue
    const { axis, offset } = misaligned
    for (const [id, delta] of [[edge.target.id, -offset], [edge.source.id, offset]] as const) {
      const item = items.get(id)!
      if (aligned(id, axis)) continue
      const moved = { x: item.x, y: item.y, width: item.width, height: item.height, [axis]: item[axis] + delta }
      const group = item.parentId ? groups.get(item.parentId) : undefined
      const topPadding = reservedHeaderPadding === undefined ? GROUP_EDGE_PAD : (group?.headerHeight ?? 0) + reservedHeaderPadding
      if (group && (moved.x - GROUP_EDGE_PAD < group.x - ROUTE_EPSILON || moved.y - topPadding < group.y - ROUTE_EPSILON
        || moved.x + moved.width + GROUP_EDGE_PAD > group.x + group.width + ROUTE_EPSILON || moved.y + moved.height + GROUP_EDGE_PAD > group.y + group.height + ROUTE_EPSILON)) continue
      const neighbours: Bounds[] = [...[...items.values()].filter(other => other !== item), ...[...groups.values()].filter(other => {
        for (let parent = item.parentId; parent; parent = groups.get(parent)?.parentId) if (parent === other.id) return false
        return true
      })]
      if (neighbours.some(other => distance(moved, other) < Math.min(spacing, distance(item, other)) - ROUTE_EPSILON)) continue
      const incident = diagram.edges.filter(other => other !== edge && (other.source.id === id || other.target.id === id))
      const before = incident.map(offAxis)
      const original = item[axis]
      item[axis] += delta
      const breaks = incident.some((other, index) => {
        const was = before[index], now = offAxis(other)
        return was !== undefined && now !== undefined && was.axis === axis && Math.abs(was.offset) <= ROUTE_EPSILON && Math.abs(now.offset) > ROUTE_EPSILON
      })
      if (breaks) { item[axis] = original; continue }
      snapped = true
      break
    }
  }
  return snapped
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
  drawn: readonly Point[][],
  apart: readonly Point[][] = [],
): PositionedArchitectureEdge {
  const obstacles = architectureRouteObstacles(edge, servicesById, groups, services, junctionsById)
  const groupFrames = ancestorFrameLines(edge, servicesById, groups, junctionsById)
  const cardFrames = [edge.source.id, edge.target.id].flatMap(id => { const card = serviceBounds.get(id); return card ? boxLines(card) : [] })
  // Other relations' ink this route must not run on or beside: drawn on top
  // of each other, two relations cannot be told apart (mermaid-v13#1176).
  const apartLines: FrameLine[] = apart.flatMap(points => points.slice(1).map((point, index) => [points[index]!, point] as const))
  // Only the anchor-to-exit lead may touch its incident card. The middle
  // route must remain outside both endpoints so it cannot reverse through
  // the target and hide an arrowhead under the card's paint.
  for (const endpoint of [edge.source, edge.target]) {
    const group = endpoint.boundary === 'group' ? groups.get(servicesById.get(endpoint.id)!.parentId!) : undefined
    const bounds = group ?? serviceBounds.get(endpoint.id) ?? junctionBounds.get(endpoint.id)!
    obstacles.push({ ...bounds, id: group?.id ?? endpoint.id, kind: group ? 'group' : serviceBounds.has(endpoint.id) ? 'service' : 'junction' })
  }
  const routeFrom = (along: { source?: number; target?: number }) => {
    const source = resolveEndpoint(edge.source, servicesById, serviceBounds, junctionBounds, groups, terminal.start ? terminal.start + radius : 0, along.source)
    const target = resolveEndpoint(edge.target, servicesById, serviceBounds, junctionBounds, groups, terminal.end ? terminal.end + radius : 0, along.target)
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
    // `frames` are outline lines to keep off; `separate` adds the other
    // relations' ink. A route that cannot keep off them all is null.
    const route = (frames: readonly FrameLine[] | undefined, separate: boolean): Point[] | null => {
      // Leads stop a clearance short of a line they would end on head-on.
      const exits = frames ? { start: leadShortOfFrames(source, edge.source.side, frames), end: leadShortOfFrames(target, edge.target.side, frames) } : { start: source.exit, end: target.exit }
      const directMiddle = simplifyOrthogonalPoints([
        exits.start,
        ...routeBetween(exits.start, exits.end, edge.source.side, edge.target.side),
        exits.end,
      ])
      const keepOff = separate ? [...frames ?? [], ...apartLines] : frames
      const direct = routeClearsObstacles(directMiddle, obstacles)
      const startHeading = headingOf(source.anchor, exits.start), endHeading = headingOf(exits.end, target.anchor)
      const lanes = [...frames ? [...groupFrames, ...cardFrames] : [], ...separate ? apartLines : []]
      const middle = keepOff
        ? (direct && !runsAlongFrame(directMiddle, keepOff) ? directMiddle : routeOrthogonalAroundObstacles(exits.start, exits.end, obstacles, startHeading, endHeading, drawn, keepOff, lanes))
        : (direct ? directMiddle : routeOrthogonalAroundObstacles(exits.start, exits.end, obstacles, startHeading, endHeading, drawn) ?? directMiddle)
      return middle && simplifyOrthogonalPoints([source.anchor, ...middle, target.anchor])
    }
    // A route on its own group's frame or header divider reads as part of
    // the container outline: keep off those lines whenever a clear route
    // exists, and off the other relations' ink where it can. Running beside
    // an endpoint's own card side is milder: keep off it too, unless that
    // costs a bend.
    const separate = apartLines.length > 0
    const routes = [[groupFrames, true], [groupFrames, false], [undefined, true], [undefined, false]] as const
    let offGroups: Point[] | null = null, separated = false
    for (const [frames, keepApart] of routes) {
      if (offGroups || (keepApart && !separate)) continue
      offGroups = route(frames, keepApart)
      separated = keepApart
    }
    const offAll = runsAlongFrame(offGroups!, cardFrames) ? route([...groupFrames, ...cardFrames], separated) : null
    let points = offAll && offAll.length <= offGroups!.length ? offAll : offGroups!
    const extended = extendTerminalRuns(points, terminal)
    if (extended && extended !== points && routeClearsObstacles(extended, obstacles)) points = extended
    return { source, target, points }
  }
  let { source, target, points } = routeFrom({})
  // A `{group}` contact may sit anywhere along its group's side. When the
  // default contact puts this route on another relation's line, slide each
  // group contact to the clear place with the fewest crossings, then bends
  // (the declared layout objective's order), then the least displacement.
  if ((edge.source.boundary === 'group' || edge.target.boundary === 'group') && runsAlongFrame(points, apartLines)) {
    const choices = (end: 'source' | 'target'): Array<number | undefined> => {
      if (edge[end].boundary !== 'group') return [undefined]
      const endpoint = edge[end]
      const group = groups.get(servicesById.get(endpoint.id)!.parentId!)!
      const vertical = endpoint.side === 'L' || endpoint.side === 'R'
      const anchor = (end === 'source' ? source : target).anchor
      const preferred = vertical ? anchor.y : anchor.x
      const lo = vertical ? group.y + Math.max(GROUP_EDGE_PAD, (group.headerHeight ?? 0) + ROUTE_CLEARANCE) : group.x + GROUP_EDGE_PAD
      const hi = vertical ? group.y + group.height - GROUP_EDGE_PAD : group.x + group.width - GROUP_EDGE_PAD
      // Places just clear of another relation's parallel run, and the faces
      // of the obstacles a straight run there would pass.
      const near = [
        ...apartLines.filter(([p, q]) => (Math.abs(p.y - q.y) <= ROUTE_EPSILON) === vertical).flatMap(([p]) => {
          const at = vertical ? p.y : p.x
          return [at - 2 * ROUTE_CLEARANCE, at - ROUTE_CLEARANCE, at + ROUTE_CLEARANCE, at + 2 * ROUTE_CLEARANCE]
        }),
        ...obstacles.flatMap(obstacle => vertical ? [obstacle.y, obstacle.y + obstacle.height] : [obstacle.x, obstacle.x + obstacle.width]),
      ].filter(at => at >= lo - ROUTE_EPSILON && at <= hi + ROUTE_EPSILON && Math.abs(at - preferred) > ROUTE_EPSILON)
      const unique = [...new Set(near)].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)
      return [undefined, ...unique.slice(0, 8)]
    }
    const displacement = (end: 'source' | 'target', at: number | undefined): number => {
      if (at === undefined) return 0
      const anchor = (end === 'source' ? source : target).anchor
      return Math.abs(at - (edge[end].side === 'L' || edge[end].side === 'R' ? anchor.y : anchor.x))
    }
    const drawnRoutes = drawn.map(route => ({ points: route }))
    let best: { cost: readonly number[]; result: ReturnType<typeof routeFrom> } | undefined
    for (const sourceAt of choices('source')) {
      for (const targetAt of choices('target')) {
        if (sourceAt === undefined && targetAt === undefined) continue
        const result = routeFrom({ source: sourceAt, target: targetAt })
        if (runsAlongFrame(result.points, apartLines) || !routeClearsObstacles(result.points, obstacles)) continue
        const cost = [countPolylineCrossings([{ points: result.points }, ...drawnRoutes], new Set([0])), result.points.length - 2, displacement('source', sourceAt) + displacement('target', targetAt)]
        const index = best ? cost.findIndex((value, axis) => Math.abs(value - best!.cost[axis]!) > ROUTE_EPSILON) : 0
        if (!best || (index >= 0 && cost[index]! < best.cost[index]!)) best = { cost, result }
      }
    }
    if (best) ({ source, target, points } = best.result)
  }
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
const ROUTE_BEND_COST = 1e4
const ROUTE_MIN_RUN = 8
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
  const excludedGroups = endpointAncestorGroups(edge, servicesById, groups, junctionsById)
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

/**
 * The lead's exit, stopped a clearance short of a frame line it would end on
 * (or just short of) when meeting it head-on, so the route does not turn onto it.
 */
function leadShortOfFrames(endpoint: { anchor: Point; exit: Point }, side: ArchitectureEndpoint['side'], frames: readonly FrameLine[]): Point {
  const horizontal = side === 'L' || side === 'R'
  const forward = side === 'R' || side === 'B'
  let distance = Math.abs(horizontal ? endpoint.exit.x - endpoint.anchor.x : endpoint.exit.y - endpoint.anchor.y)
  for (const [p, q] of frames) {
    if ((Math.abs(p.x - q.x) <= ROUTE_EPSILON) !== horizontal) continue
    const cross = horizontal ? endpoint.anchor.y : endpoint.anchor.x
    if (cross < Math.min(horizontal ? p.y : p.x, horizontal ? q.y : q.x) - ROUTE_EPSILON || cross > Math.max(horizontal ? p.y : p.x, horizontal ? q.y : q.x) + ROUTE_EPSILON) continue
    const face = ((horizontal ? p.x : p.y) - (horizontal ? endpoint.anchor.x : endpoint.anchor.y)) * (forward ? 1 : -1)
    if (face > ROUTE_CLEARANCE + ROUTE_EPSILON && Math.abs(distance - face) < ROUTE_CLEARANCE - ROUTE_EPSILON) distance = face - ROUTE_CLEARANCE
  }
  return movePoint(endpoint.anchor, side, distance)
}

/** Groups that contain either endpoint, innermost first per endpoint. */
function endpointAncestorGroups(
  edge: ArchitectureDiagram['edges'][number],
  servicesById: Map<string, ArchitectureService>,
  groups: Map<string, PositionedArchitectureGroup>,
  junctionsById: Map<string, PositionedArchitectureJunction>,
): Set<string> {
  const ancestors = new Set<string>()
  for (const endpoint of [edge.source, edge.target]) {
    let current = servicesById.get(endpoint.id)?.parentId ?? junctionsById.get(endpoint.id)?.parentId
    while (current && !ancestors.has(current)) {
      ancestors.add(current)
      current = groups.get(current)?.parentId
    }
  }
  return ancestors
}

type FrameLine = readonly [Point, Point]

/**
 * The drawn frame sides and header divider of every group that contains an
 * endpoint. A route may cross these lines but should not run along them.
 * (Unrelated groups and cards are already obstacles inflated by the route
 * clearance; the endpoints' own cards are added by the caller.)
 */
function ancestorFrameLines(
  edge: ArchitectureDiagram['edges'][number],
  servicesById: Map<string, ArchitectureService>,
  groups: Map<string, PositionedArchitectureGroup>,
  junctionsById: Map<string, PositionedArchitectureJunction>,
): FrameLine[] {
  const lines: FrameLine[] = []
  for (const id of endpointAncestorGroups(edge, servicesById, groups, junctionsById)) {
    const group = groups.get(id)
    if (!group) continue
    lines.push(...boxLines(group))
    if (group.headerHeight) lines.push([{ x: group.x, y: group.y + group.headerHeight }, { x: group.x + group.width, y: group.y + group.headerHeight }])
  }
  return lines
}

/** The four sides of a drawn box. */
function boxLines(box: Bounds): FrameLine[] {
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height
  return [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x0, y: y1 }, { x: x1, y: y1 }], [{ x: x0, y: y0 }, { x: x0, y: y1 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }]]
}

/** Whether a segment runs on, or within ROUTE_CLEARANCE beside, a frame line. */
function runsAlongFrame(points: readonly Point[], frames: readonly FrameLine[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const vertical = Math.abs(a.x - b.x) <= ROUTE_EPSILON
    if (!vertical && Math.abs(a.y - b.y) > ROUTE_EPSILON) continue
    for (const [p, q] of frames) {
      if ((Math.abs(p.x - q.x) <= ROUTE_EPSILON) !== vertical) continue
      const offset = vertical ? Math.abs(p.x - a.x) : Math.abs(p.y - a.y)
      const lo = Math.max(Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), Math.min(vertical ? p.y : p.x, vertical ? q.y : q.x))
      const hi = Math.min(Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x), Math.max(vertical ? p.y : p.x, vertical ? q.y : q.x))
      if (offset < ROUTE_CLEARANCE - ROUTE_EPSILON && hi - lo > ROUTE_EPSILON) return true
    }
  }
  return false
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

/**
 * The shared orthogonal router over the obstacle faces and endpoint lanes,
 * never through an obstacle's interior. Turning off an anchor lead counts as
 * a bend; crossing another relation costs half a bend, so a detour avoids it
 * unless that needs another bend; no turn follows the last by less than
 * ROUTE_MIN_RUN, so a detour never makes a visible tiny jog.
 */
function routeOrthogonalAroundObstacles(start: Point, end: Point, obstacles: RouteObstacle[], startHeading: RouterDirection | undefined, endHeading: RouterDirection | undefined, drawn: readonly Point[][], frames?: readonly FrameLine[], lanes: readonly FrameLine[] = frames ?? []): Point[] | null {
  // Lanes a clearance either side of each outline line (`lanes`, every frame
  // and endpoint card side), so a route keeping off `frames` still has
  // somewhere to run.
  const frameX = lanes.filter(([p, q]) => p.x === q.x).flatMap(([p]) => [p.x - ROUTE_CLEARANCE, p.x + ROUTE_CLEARANCE])
  const frameY = lanes.filter(([p, q]) => p.y === q.y).flatMap(([p]) => [p.y - ROUTE_CLEARANCE, p.y + ROUTE_CLEARANCE])
  const route = routeOrthogonal({
    start, end, exit: ANY_DIRECTION, entry: ANY_DIRECTION, startHeading, endHeading, clearance: 0, channelsOnly: true,
    bendCost: ROUTE_BEND_COST, minRun: ROUTE_MIN_RUN,
    crossings: { segments: drawn.flatMap(points => points.slice(1).map((point, index) => [points[index]!, point] as const)), cost: ROUTE_BEND_COST / 2 },
    obstacles: obstacles.map(obstacle => ({ x0: obstacle.x, y0: obstacle.y, x1: obstacle.x + obstacle.width, y1: obstacle.y + obstacle.height })),
    channels: { x: [...obstacles.flatMap(obstacle => [obstacle.x, obstacle.x + obstacle.width]), ...frameX], y: [...obstacles.flatMap(obstacle => [obstacle.y, obstacle.y + obstacle.height]), ...frameY] },
    ...(frames ? { avoid: { segments: frames, separation: ROUTE_CLEARANCE, gap: 0 } } : {}),
  })
  return route ? route.map(point => ({ x: point.x, y: point.y })) : null
}
const ANY_DIRECTION = ['E', 'S', 'W', 'N'] as const
/** Direction of an axis-aligned lead from `from` to `to`, when it has length. */
function headingOf(from: Point, to: Point): RouterDirection | undefined {
  if (from.x === to.x && from.y === to.y) return undefined
  if (from.y === to.y) return to.x > from.x ? 'E' : 'W'
  return from.x === to.x ? (to.y > from.y ? 'S' : 'N') : undefined
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
  along?: number,
): ResolvedEndpoint {
  if (endpoint.boundary === 'group') {
    const service = servicesById.get(endpoint.id)!
    const serviceBoundsEntry = serviceBounds.get(endpoint.id)!
    const group = groups.get(service.parentId!)!
    const anchor = groupAnchor(group, serviceBoundsEntry, endpoint.side)
    if (along !== undefined) anchor[endpoint.side === 'L' || endpoint.side === 'R' ? 'y' : 'x'] = along
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
