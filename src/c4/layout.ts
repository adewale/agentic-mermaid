import type { PositionedGraph, PositionedNode, PositionedGroup, PositionedEdge, RenderOptions } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { C4Body, C4Diagnostic } from './types.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { resolveRenderStyle, positionDiagramTitle, DIAGRAM_TITLE_FONT_SIZE, DIAGRAM_TITLE_FONT_WEIGHT, DIAGRAM_TITLE_GAP } from '../styles.ts'
import { resolveC4Config, c4Appearance, effectiveC4Shape, type C4Config, type C4ConfigInput } from './config.ts'
import { projectC4Graph, c4ElementText, c4BoundaryText, c4RelationshipText } from './projection.ts'
import { placeC4Boxes, type C4Box } from './placement.ts'
import { translateGeometryToNonNegativeOrigin } from '../layout/passes/translation.ts'
import { routeC4Pixels } from './routing.ts'
import { c4LegendEntries, type C4LegendEntry } from './legend.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { planC4Identity } from './identity.ts'

export interface PositionedC4Diagram extends PositionedGraph {
  body: C4Body; config: C4Config; diagnostics: C4Diagnostic[]
  identities: ReturnType<typeof planC4Identity>
  legend?: { x: number; y: number; width: number; height: number; entries: Array<C4LegendEntry & { block: PixelTextBlock }> }
}
export function layoutC4Diagram(body: C4Body, options: RenderOptions & { diagramTitle?: string } = {}, styleFace?: InternalStyleFace, c4Config: C4ConfigInput = {}, themeVariables: C4ConfigInput = {}): PositionedC4Diagram {
  const config = resolveC4Config({ ...(options.padding === undefined ? {} : { diagramMarginX: options.padding, diagramMarginY: options.padding }), ...(options.nodeSpacing === undefined ? {} : { c4ShapeMargin: options.nodeSpacing }), ...(options.layerSpacing === undefined ? {} : { nextLinePaddingX: options.layerSpacing }), ...c4Config }, themeVariables), style = resolveRenderStyle(options, undefined, styleFace)
  const graph = projectC4Graph(body, config), sizes = new Map<string, C4Box>()
  const text = (item: typeof body.elements[number] | typeof body.boundaries[number], label: string, group = false) => {
    const appearance = c4Appearance(item, config)
    return preparePixelText(label, { display: 'literal', fontSize: appearance.fontSize ?? (group ? style.groupHeaderFontSize : style.nodeLabelFontSize), fontWeight: appearance.fontWeight ?? (group ? style.groupHeaderFontWeight : style.nodeLabelFontWeight), transform: group ? style.groupTextTransform : style.nodeTextTransform, maxWidth: config.wrapWidth, letterSpacing: group ? style.groupLetterSpacing : style.nodeLetterSpacing })
  }
  const nodes: PositionedNode[] = body.elements.map(item => {
    const label = c4ElementText(item), labelBlock = text(item, label), shape = effectiveC4Shape(item), glyphHeight = shape === 'person' ? 38 : shape === 'database' ? 16 : 0
    let width = Math.max(config.minimumWidth, labelBlock.width + (config.input.c4ShapePadding === undefined ? style.nodePaddingX : config.padding) * 2 + (shape === 'queue' ? 20 : 0)), height = Math.max(config.minimumHeight, labelBlock.height + (config.input.c4ShapePadding === undefined ? style.nodePaddingY : config.padding) * 2 + glyphHeight)
    sizes.set(item.id, { id: item.id, x: 0, y: 0, width, height, ...(shape === 'database' ? { cylinder: true } : {}) })
    return { ...graph.nodes.get(item.id)!, x: 0, y: 0, width, height, labelBlock, inlineStyle: graph.nodeStyles.get(item.id) }
  })
  const groups = new Map<string, PositionedGroup>()
  for (const item of body.boundaries) {
    const label = c4BoundaryText(item), labelBlock = text(item, label, true), headerHeight = labelBlock.height + config.padding * 2
    const group: PositionedGroup = { id: item.id, label, labelBlock, x: 0, y: 0, width: Math.max(config.minimumWidth, labelBlock.width + config.padding * 2), height: headerHeight + config.boundaryPadding * 2, headerHeight, children: [] }
    groups.set(item.id, group); sizes.set(item.id, { ...group, container: true })
  }
  const edges: PositionedEdge[] = graph.edges.map((edge, index) => ({ ...edge, points: [], labelBlock: preparePixelText(c4RelationshipText(body, body.relationships[index]!), { display: 'literal', fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, transform: style.edgeTextTransform }), inlineStyle: graph.linkStyles.get(index), edgeIndex: index }))
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
  const titleBlock = titleText === undefined ? undefined : preparePixelText(titleText, { display: 'literal', fontSize: DIAGRAM_TITLE_FONT_SIZE, fontWeight: DIAGRAM_TITLE_FONT_WEIGHT, transform: style.groupTextTransform, letterSpacing: style.groupLetterSpacing })
  const title = titleBlock ? { text: titleBlock.text, width: titleBlock.width, height: titleBlock.height + DIAGRAM_TITLE_GAP, block: titleBlock } : undefined, gapX = Math.max(config.gap, ...edges.map(edge => (edge.labelBlock?.width ?? 0) + 32)), gapY = Math.max(config.rowGap, ...edges.map(edge => (edge.labelBlock?.height ?? 0) + 36))
  const pairCounts = new Map<string, number>()
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target].sort())
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  const parallelCorridors = Math.max(1, ...pairCounts.values())
  const corridorDemand = parallelCorridors > 1 ? parallelCorridors + 1 : 1
  const placement = placeC4Boxes(body, sizes, { gapX: gapX * corridorDemand, gapY: gapY * corridorDemand, padding: config.boundaryPadding, marginX: config.marginX + 40, marginY: config.marginY + 40 + (title?.height ?? 0), shapesPerRow: body.layout.shapesPerRow ?? config.shapesPerRow, boundariesPerRow: body.layout.boundariesPerRow ?? config.boundariesPerRow, direction: graph.direction === 'TD' ? 'TB' : graph.direction })
  for (const node of nodes) Object.assign(node, placement.boxes.get(node.id))
  const roots: PositionedGroup[] = []
  for (const item of body.boundaries) { const group = groups.get(item.id)!; Object.assign(group, placement.boxes.get(item.id)); const parent = item.parentId && groups.get(item.parentId); if (parent) parent.children.push(group); else roots.push(group) }
  routeC4Pixels(placement.boxes, { nodes, groups: roots, edges }, graph, style, planC4Identity(body))
  for (const [index, edge] of edges.entries()) if (edge.labelPosition) { const authored = body.relationships[index]!.style; const dx = Number(authored.offsetX ?? 0), dy = Number(authored.offsetY ?? 0); if (Number.isFinite(dx)) edge.labelPosition.x += dx; if (Number.isFinite(dy)) edge.labelPosition.y += dy }
  const labelBoxes: PositionedNode[] = edges.flatMap(edge => edge.labelPosition && edge.labelBlock ? [{ id: edge.id!, label: '', shape: 'rectangle', x: edge.labelPosition.x - edge.labelBlock.width / 2 - 10, y: edge.labelPosition.y - edge.labelBlock.height / 2 - 8, width: edge.labelBlock.width + 20, height: edge.labelBlock.height + 16 }] : [])
  translateGeometryToNonNegativeOrigin([...nodes, ...labelBoxes], edges, roots, Math.max(config.marginX, config.marginY) + (title?.height ?? 0))
  const allBoxes = [...nodes, ...groups.values()]
  let width = Math.max(placement.width, ...allBoxes.map(box => box.x + box.width + config.marginX), ...edges.flatMap(edge => [...edge.points.map(p => p.x + config.marginX), (edge.labelPosition?.x ?? 0) + (edge.labelBlock?.width ?? 0) / 2 + config.marginX]), title ? title.width + config.marginX * 2 : 0)
  let height = Math.max(placement.height, ...allBoxes.map(box => box.y + box.height + config.marginY), ...edges.flatMap(edge => [...edge.points.map(p => p.y + config.marginY), (edge.labelPosition?.y ?? 0) + (edge.labelBlock?.height ?? 0) / 2 + config.marginY]))
  const entries = c4LegendEntries(body).map(entry => ({ ...entry, block: preparePixelText(entry.label, { display: 'literal', fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight }) }))
  const legend = entries.length ? { x: config.marginX, y: height + 12, width: Math.max(...entries.map(entry => entry.block.width)) + 64, height: 36 + entries.reduce((sum, entry) => sum + entry.block.height + 10, 0), entries } : undefined
  if (legend) { width = Math.max(width, legend.x + legend.width + config.marginX); height = legend.y + legend.height + config.marginY }
  return { width, height, ...(legend ? { legend } : {}), nodes, groups: roots, edges, ...(title ? { title: positionDiagramTitle(title, width, config.marginY) } : {}), body, config, diagnostics: placement.diagnostics, identities: planC4Identity(body) }
}
