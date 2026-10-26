import type { PositionedGraph, PositionedNode, PositionedGroup, PositionedEdge, RenderOptions, TextTransform } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { C4Body, C4Diagnostic } from './types.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { resolveRenderStyle, positionDiagramTitle, DIAGRAM_TITLE_FONT_SIZE, DIAGRAM_TITLE_FONT_WEIGHT, DIAGRAM_TITLE_GAP } from '../styles.ts'
import { resolveC4Config, c4Appearance, effectiveC4Shape, type C4Config, type C4ConfigInput } from './config.ts'
import { projectC4Graph, c4ElementText, c4BoundaryText, c4RelationshipText } from './projection.ts'
import { placeC4Boxes, type C4Box } from './placement.ts'
import { translateGeometryToNonNegativeOrigin } from '../layout/route-geometry.ts'
import { routeC4Pixels } from './routing.ts'
import { c4LegendEntries, type C4LegendEntry } from './legend.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { planC4Identity } from './identity.ts'
import { c4LabelRect, c4MarkerRects, placeC4PixelLabels, c4PixelVisibilityDiagnostics } from './pixel-labels.ts'
import { assertC4DiagramWork } from '../shared/diagram-limits.ts'

export interface PositionedC4Diagram extends PositionedGraph {
  body: C4Body; config: C4Config; diagnostics: C4Diagnostic[]
  textContext: { node?: TextTransform; edge?: TextTransform; group?: TextTransform; legendHeading?: TextTransform; title?: string }
  identities: ReturnType<typeof planC4Identity>
  legend?: { x: number; y: number; width: number; height: number; heading: PixelTextBlock; entries: Array<C4LegendEntry & { block: PixelTextBlock }> }
}
export function layoutC4Diagram(body: C4Body, options: RenderOptions & { diagramTitle?: string } = {}, styleFace?: InternalStyleFace, c4Config: C4ConfigInput = {}, themeVariables: C4ConfigInput = {}): PositionedC4Diagram {
  assertC4DiagramWork(body)
  const config = resolveC4Config({ ...(options.padding === undefined ? {} : { diagramMarginX: options.padding, diagramMarginY: options.padding }), ...(options.nodeSpacing === undefined ? {} : { c4ShapeMargin: options.nodeSpacing }), ...(options.layerSpacing === undefined ? {} : { nextLinePaddingX: options.layerSpacing }), ...c4Config }, themeVariables), style = resolveRenderStyle(options, undefined, styleFace)
  const graph = projectC4Graph(body, config), sizes = new Map<string, C4Box>()
  const parents = new Map([...body.elements, ...body.boundaries].map(item => [item.id, item.parentId]))
  const ancestors = (id: string): string[] => { const result: string[] = []; for (let parent = parents.get(id); parent && !result.includes(parent); parent = parents.get(parent)) result.push(parent); return result }
  const pixelPadding = (axis: 'X' | 'Y') => config.input.c4ShapePadding !== undefined ? config.padding : config.compact && styleFace?.node?.[axis === 'X' ? 'paddingX' : 'paddingY'] === undefined ? Math.min(config.padding, style[axis === 'X' ? 'nodePaddingX' : 'nodePaddingY']) : style[axis === 'X' ? 'nodePaddingX' : 'nodePaddingY']
  const wrapWidth = (id?: string) => {
    if (config.wrapWidth === undefined) return undefined
    if (config.maxWidth === undefined) return config.wrapWidth
    const depth = id === undefined ? 0 : ancestors(id).length
    return Math.max(24, config.minimumWidth - pixelPadding('X') * 2 - 20, Math.min(config.wrapWidth, config.maxWidth - (config.marginX + 40) * 2 - depth * config.boundaryPadding * 2 - pixelPadding('X') * 2 - 20))
  }
  const text = (item: typeof body.elements[number] | typeof body.boundaries[number], label: string, group = false) => {
    const appearance = c4Appearance(item, config)
    return preparePixelText(label, { display: 'literal', fontSize: appearance.fontSize ?? (group ? style.groupHeaderFontSize : style.nodeLabelFontSize), fontWeight: appearance.fontWeight ?? (group ? style.groupHeaderFontWeight : style.nodeLabelFontWeight), transform: group ? style.groupTextTransform : style.nodeTextTransform, maxWidth: wrapWidth(item.id), letterSpacing: group ? style.groupLetterSpacing : style.nodeLetterSpacing, fontFamily: appearance.fontFamily ?? (group ? style.groupFont : undefined) })
  }
  const nodes: PositionedNode[] = body.elements.map(item => {
    const label = c4ElementText(item), labelBlock = text(item, label), shape = effectiveC4Shape(item), glyphHeight = shape === 'person' ? 38 : shape === 'database' ? 16 : 0
    const width = Math.max(config.minimumWidth, labelBlock.width + pixelPadding('X') * 2 + (shape === 'queue' ? 20 : 0)), height = Math.max(config.minimumHeight, labelBlock.height + pixelPadding('Y') * 2 + glyphHeight)
    sizes.set(item.id, { id: item.id, x: 0, y: 0, width, height, ...(shape === 'database' ? { cylinder: true } : {}) })
    return { ...graph.nodes.get(item.id)!, x: 0, y: 0, width, height, labelBlock, inlineStyle: graph.nodeStyles.get(item.id) }
  })
  const groups = new Map<string, PositionedGroup>()
  for (const item of body.boundaries) {
    const label = c4BoundaryText(item), labelBlock = text(item, label, true), headerHeight = labelBlock.height + config.padding * 2
    const group: PositionedGroup = { id: item.id, label, labelBlock, x: 0, y: 0, width: Math.max(config.minimumWidth, labelBlock.width + config.padding * 2), height: headerHeight + config.boundaryPadding * 2, headerHeight, children: [] }
    groups.set(item.id, group); sizes.set(item.id, { ...group, container: true })
  }
  const edges: PositionedEdge[] = graph.edges.map((edge, index) => ({ ...edge, points: [], labelBlock: preparePixelText(c4RelationshipText(body, body.relationships[index]!), { display: 'literal', fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, transform: style.edgeTextTransform, ...(config.maxWidth === undefined ? {} : { maxWidth: wrapWidth() }) }), inlineStyle: graph.linkStyles.get(index), edgeIndex: index }))
  // A relationship to an ancestor needs a real interior lane between the
  // descendant's bottom face and the ancestor's frame. Ordinary box padding
  // can be shorter than the opaque label plus arrowhead and hide the entire
  // relationship while its semantic route still looks valid.
  for (const boundary of body.boundaries) {
    const contained = edges.filter(edge => edge.source === boundary.id && ancestors(edge.target).includes(boundary.id) || edge.target === boundary.id && ancestors(edge.source).includes(boundary.id))
    if (contained.length) sizes.get(boundary.id)!.bottomPadding = Math.max(config.boundaryPadding, ...contained.map(edge => (edge.labelBlock?.height ?? 0) + 48)) * contained.length
  }
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL'
  for (const [id, box] of sizes) {
    const incident = edges.filter(edge => edge.source === id || edge.target === id)
    const height = Math.max(0, ...incident.map(edge => (edge.labelBlock?.height ?? 0) + 28))
    const width = Math.max(0, ...incident.map(edge => (edge.labelBlock?.width ?? 0) + 24))
    // Repeated/reciprocal interactions need independent label corridors.
    // Ordinary fan-out needs distinct physical ports, not one full label band
    // per interaction on every face of an otherwise small card.
    const pairDemand = new Map<string, number>()
    for (const edge of incident) {
      const peer = edge.source === id ? edge.target : edge.source
      pairDemand.set(peer, (pairDemand.get(peer) ?? 0) + 1)
    }
    const parallel = Math.max(0, ...pairDemand.values())
    if (horizontal) box.height = Math.max(box.height, (parallel + 1) * height + (box.headerHeight ?? 0), (incident.length + 1) * 16 + (box.headerHeight ?? 0))
    else box.width = Math.max(box.width, (parallel + 1) * width, (incident.length + 1) * 16)
  }
  const titleText = options.diagramTitle ?? body.title
  const titleBlock = titleText === undefined ? undefined : preparePixelText(titleText, { display: 'literal', fontSize: DIAGRAM_TITLE_FONT_SIZE, fontWeight: DIAGRAM_TITLE_FONT_WEIGHT, transform: style.groupTextTransform, letterSpacing: style.groupLetterSpacing, fontFamily: style.groupFont, ...(config.maxWidth === undefined ? {} : { maxWidth: Math.max(24, config.maxWidth - config.marginX * 2) }) })
  // A centerline shared with another interaction needs room for a full opaque
  // halo on either side. A single label band leaves no clear candidate even
  // when its route, cards and physical ports are individually feasible.
  const title = titleBlock ? { text: titleBlock.text, width: titleBlock.width, height: titleBlock.height + DIAGRAM_TITLE_GAP, block: titleBlock } : undefined, gapX = Math.max(config.gap, ...edges.map(edge => (edge.labelBlock?.width ?? 0) * 2 + 48)), gapY = Math.max(config.rowGap, ...edges.map(edge => (edge.labelBlock?.height ?? 0) * 2 + 48))
  const pairCounts = new Map<string, number>()
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target].sort())
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  const parallelCorridors = Math.max(1, ...pairCounts.values())
  const corridorDemand = parallelCorridors > 1 ? parallelCorridors + 1 : 1
  const placement = placeC4Boxes(body, sizes, { gapX: gapX * corridorDemand, gapY: gapY * corridorDemand, padding: config.boundaryPadding, marginX: config.marginX + 40, marginY: config.marginY + 40 + (title?.height ?? 0), shapesPerRow: body.layout.shapesPerRow ?? config.shapesPerRow, boundariesPerRow: body.layout.boundariesPerRow ?? config.boundariesPerRow, direction: graph.direction === 'TD' ? 'TB' : graph.direction, maxWidth: config.maxWidth })
  for (const node of nodes) Object.assign(node, placement.boxes.get(node.id))
  const roots: PositionedGroup[] = []
  for (const item of body.boundaries) { const group = groups.get(item.id)!; Object.assign(group, placement.boxes.get(item.id)); const parent = item.parentId && groups.get(item.parentId); if (parent) parent.children.push(group); else roots.push(group) }
  routeC4Pixels(placement.boxes, { nodes, groups: roots, edges }, graph, style, planC4Identity(body))
  placeC4PixelLabels({ nodes, groups: roots, edges }, style.lineWidth, body)
  const labelBoxes: PositionedNode[] = edges.flatMap(edge => { const box = c4LabelRect(edge); return box ? [{ ...box, id: edge.id!, label: '', shape: 'rectangle' }] : [] })
  const markerBoxes: PositionedNode[] = edges.flatMap(edge => c4MarkerRects(edge, style.lineWidth).map(box => ({ ...box, id: edge.id!, label: '', shape: 'rectangle' as const })))
  translateGeometryToNonNegativeOrigin([...nodes, ...labelBoxes, ...markerBoxes], edges, roots, Math.max(config.marginX, config.marginY) + (title?.height ?? 0))
  const allBoxes = [...nodes, ...groups.values(), ...labelBoxes, ...markerBoxes]
  let width = Math.max(placement.width, ...allBoxes.map(box => box.x + box.width + config.marginX), ...edges.flatMap(edge => [...edge.points.map(p => p.x + config.marginX), (edge.labelPosition?.x ?? 0) + (edge.labelBlock?.width ?? 0) / 2 + config.marginX]), title ? title.width + config.marginX * 2 : 0)
  let height = Math.max(placement.height, ...allBoxes.map(box => box.y + box.height + config.marginY), ...edges.flatMap(edge => [...edge.points.map(p => p.y + config.marginY), (edge.labelPosition?.y ?? 0) + (edge.labelBlock?.height ?? 0) / 2 + config.marginY]))
  const entries = c4LegendEntries(body, config).map(entry => ({ ...entry, block: preparePixelText(entry.label, { display: 'literal', fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, transform: style.edgeTextTransform, ...(config.maxWidth === undefined ? {} : { maxWidth: Math.max(24, config.maxWidth - config.marginX * 2 - 64) }) }) }))
  const legendHeading = preparePixelText('Legend', { display: 'literal', fontSize: styleFace?.text?.fontSize ?? 13, fontWeight: styleFace?.text?.fontWeight ?? 600, letterSpacing: styleFace?.text?.letterSpacing ?? 0, transform: styleFace?.text?.textTransform, ...(config.maxWidth === undefined ? {} : { maxWidth: Math.max(24, config.maxWidth - config.marginX * 2 - 24) }) })
  const legend = entries.length ? { x: config.marginX, y: height + 12, width: Math.max(legendHeading.width + 24, ...entries.map(entry => entry.block.width + 64)), height: legendHeading.height + 20 + entries.reduce((sum, entry) => sum + entry.block.height + 10, 0), heading: legendHeading, entries } : undefined
  if (legend) { width = Math.max(width, legend.x + legend.width + config.marginX); height = legend.y + legend.height + config.marginY }
  const diagnostics = [...placement.diagnostics, ...c4PixelVisibilityDiagnostics(body, { nodes, groups: roots, edges }, style.lineWidth, { width, height })]
  if (config.maxWidth !== undefined && width > config.maxWidth + .01) diagnostics.push({ code: 'C4_WIDTH_EXCEEDED', severity: 'warning', message: `The requested C4 width ${config.maxWidth}px cannot contain the ${Math.ceil(width)}px artifact without shrinking or clipping content; minimum card widths, nesting, explicit direction constraints and authored offsets retain precedence.` })
  return { width, height, ...(legend ? { legend } : {}), nodes, groups: roots, edges, ...(title ? { title: positionDiagramTitle(title, width, config.marginY) } : {}), body, config, diagnostics, identities: planC4Identity(body),
    textContext: { node: style.nodeTextTransform, edge: style.edgeTextTransform, group: style.groupTextTransform, legendHeading: styleFace?.text?.textTransform, title: titleText } }
}
