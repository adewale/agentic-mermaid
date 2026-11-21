import { eventModelingArrow, eventModelingTerminal } from './markers.ts'
import { connectorContourSemantics, projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { connectorMarkerPaintRegions, nodePaintBounds, paintedStrokeExtent } from '../scene/bounds.ts'
import type { Point } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { boxesMeet, finiteBox, orthogonalStrokeInk, writtenGeometry } from '../shared/written-paint.ts'
import { MAX_PREFERENCE_NODES, MAX_PREFERENCE_EDGES } from '../shared/layout-preference-budget.ts'
import { formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { RenderOptions } from '../types.ts'
import { resolveColors, type DiagramColors } from '../theme.ts'
import type { EventFrame, EventModelingBody } from './types.ts'
import { eventLane, eventLanes, eventRelations } from './parser.ts'

export function eventFrameText(body: EventModelingBody, identity: string | EventFrame): string {
  const frame = typeof identity === 'string' ? body.frames.find(value => value.id === identity)! : identity
  const id = frame.id
  const data = frame.data ?? (frame.dataReference ? body.data[frame.dataReference] : undefined)
  const notes = body.notes.filter(value => value.frame === id).map(value => `Note: ${value.data.text}`)
  const specs = body.specifications.filter(value => value.frame === id).flatMap(value => (['given', 'when', 'then'] as const).filter(key => value[key].length).map(key => `${key}: ${value[key].map(item => `${item.type} ${item.entity}`).join(', ')}`))
  return [`${frame.id} · ${frame.type}${frame.reset ? ' · reset' : ''}`, frame.entity, ...(data ? [data.text] : []), ...notes, ...specs].join('\n')
}
export function eventFrameSurface(node: { x: number; y: number; width: number; height: number }, style: ResolvedRenderStyle) {
  return { geometry: { kind: 'rect' as const, x: node.x, y: node.y, width: node.width, height: node.height, rx: style.cornerRadius ?? 5 },
    paint: { fill: style.nodeFillColor ?? 'var(--_node-fill)', stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.nodeLineWidth) } }
}
/** Standalone layout models canonical paint; null retains unknown-producer routes. */
export function layoutEventModeling(body: EventModelingBody, options: Readonly<RenderOptions> = {}, styleFace?: Readonly<InternalStyleFace>, rowHeight = 0, palette?: Readonly<DiagramColors>, paintBackendId: string | null = 'backend:default') {
  const style = resolveRenderStyle(options, undefined, styleFace),
    pad = options.padding ?? 24
  // Admission retains the canonical palette; reuse drawing's cached tone
  // projection here so invisible outlines reserve no painted extent.
  const nodeStroke = paintedStrokeExtent({ stroke: style.nodeBorderColor ?? (palette ? resolveColors(palette).nodeStroke : 'var(--_node-stroke)'), strokeWidth: String(style.nodeLineWidth) }, false) ?? 0
  const prepare = (text: string) => preparePixelText(text, { display: 'literal', fontFamily: options.font, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, maxWidth: 220 })
  const prepareLane = (text: string) => preparePixelText(text, { display: 'literal', fontFamily: style.groupFont ?? options.font, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, transform: style.groupTextTransform, maxWidth: 220 })
  const lanes = eventLanes(body).map(lane => ({ ...lane, block: prepareLane(lane.label), x: pad, y: 0, width: 0, height: 0 }))
  const laneByLabel = new Map(lanes.map(lane => [lane.label, lane]))
  const relations = eventRelations(body)
  const degrees = new Map(body.frames.map(frame => [frame.id, { incoming: 0, outgoing: 0 }]))
  for (const edge of relations) {
    degrees.get(edge.from)!.outgoing++
    degrees.get(edge.to)!.incoming++
  }
  const portSpacing = Math.max(12, 8 + style.lineWidth)
  const titleBand = diagramTitleBand(body.title, style)
  const laneWidth = Math.max(140, ...lanes.map(lane => style.groupLabelPaddingX + lane.block.width + style.groupPaddingX)) + nodeStroke
  const nodes = body.frames.map((frame, index) => {
    const block = prepare(eventFrameText(body, frame))
    const width = Math.max(120, block.width + 2 * (style.nodePaddingX + nodeStroke))
    const ports = degrees.get(frame.id)!
    const count = Math.max(ports.incoming, ports.outgoing)
    const portMargin = Math.max(6 + nodeStroke, style.nodePaddingY + nodeStroke, Math.min(style.cornerRadius ?? 5, width / 2))
    const portHeight = count > 1 ? (count - 1) * portSpacing + 2 * portMargin : 0
    return { id: frame.id, frame, block, lane: laneByLabel.get(eventLane(frame))!.id, x: 0, y: 0, width, height: Math.max(64, block.height + 2 * (style.nodePaddingY + nodeStroke), portHeight), index }
  })
  const columnWidth = Math.max(160, ...nodes.map(node => node.width))
  const gap = Math.max(48, options.nodeSpacing ?? 48, 2 * nodeStroke + 16)
  const width = Math.max(pad * 2 + laneWidth + Math.max(1, nodes.length) * columnWidth + Math.max(0, nodes.length - 1) * gap + Math.max(style.groupPaddingX + nodeStroke, gap / 2 + style.lineWidth), (titleBand?.width ?? 0) + 2 * pad)
  const members = new Map<string, typeof nodes>()
  for (const node of nodes) {
    const list = members.get(node.lane) ?? []
    list.push(node)
    members.set(node.lane, list)
  }
  let y = pad + (titleBand?.height ?? 0) + gap / 2 + Math.max(4, style.lineWidth)
  for (const lane of lanes) {
    const owned = members.get(lane.id) ?? []
    lane.y = y
    lane.height = Math.max(rowHeight, lane.block.height + 2 * style.groupPaddingY, ...owned.map(node => node.height + 2 * (style.groupPaddingY + nodeStroke)))
    lane.width = width - 2 * pad
    for (const node of owned) {
      node.x = pad + laneWidth + node.index * (columnWidth + gap)
      node.y = y + (lane.height - node.height) / 2
    }
    y += lane.height + gap
  }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const laneById = new Map(lanes.map(lane => [lane.id, lane]))
  // Every frame owns a distinct chronological column. Edges leave on its right
  // and travel in inter-lane gutters, so namespace re-entry cannot redirect ink.
  const incoming = new Map<string, number>(), outgoing = new Map<string, number>()
  const edges = relations.map((edge, index) => {
    const from = byId.get(edge.from)!,
      to = byId.get(edge.to)!
    const sourceSlot = outgoing.get(from.id) ?? 0, targetSlot = incoming.get(to.id) ?? 0
    outgoing.set(from.id, sourceSlot + 1)
    incoming.set(to.id, targetSlot + 1)
    const start = { x: from.x + from.width + nodeStroke, y: from.y + from.height / 2 + (sourceSlot - (degrees.get(from.id)!.outgoing - 1) / 2) * portSpacing }
    const end = { x: to.x - nodeStroke, y: to.y + to.height / 2 + (targetSlot - (degrees.get(to.id)!.incoming - 1) / 2) * portSpacing }
    const gutter = from.x + columnWidth + gap / 2
    const targetGutter = to.x - gap / 2
    const routeY = laneById.get(from.lane)!.y - gap / 2
    const points = from.lane === to.lane && to.index === from.index + 1 && start.y === end.y ? [start, end] : to.index === from.index + 1 ? [start, { x: gutter, y: start.y }, { x: gutter, y: end.y }, end] : [start, { x: gutter, y: start.y }, { x: gutter, y: routeY }, { x: targetGutter, y: routeY }, { x: targetGutter, y: end.y }, end]
    const projection = style.edgeBendRadius > 0 ? projectRoundedConnectorPath(points, style.edgeBendRadius, { precision: 3, terminalClearance: { end: eventModelingTerminal(eventModelingArrow.id, style.lineWidth, 'end') } }) : undefined
    return { ...edge, points: projection?.geometry.points ?? points, projection, index }
  })
  // Rough/hybrid paint can extend beyond the canonical shaft and card bounds.
  if (paintBackendId === 'backend:default') shortenChronologicalRoutes(nodes, byId, edges, style)
  return { style, laneWidth, width, height: Math.max(y + pad, 2 * pad + 40), lanes, nodes, edges, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, pad) } : {}) }
}

/** Prefer an existing gutter only when every painted card and relationship
 * remains clear. Chronological columns and allocated contacts never move. */
function shortenChronologicalRoutes(nodes: readonly { id: string; index: number; x: number; y: number; width: number; height: number }[], byId: ReadonlyMap<string, { index: number }>, edges: { from: string; to: string; points: Point[]; projection?: unknown }[], style: ResolvedRenderStyle): void {
  if (nodes.length > MAX_PREFERENCE_NODES || edges.length > MAX_PREFERENCE_EDGES || style.edgeBendRadius !== 0) return
  if (!edges.some(edge => !edge.projection && edge.points.length === 6 && byId.get(edge.to)!.index > byId.get(edge.from)!.index + 1)) return
  const paint = { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: formatSvgNumericAttribute('stroke-width', String(style.lineWidth)) }
  const ink = edges.map(edge => orthogonalStrokeInk(edge.points, paint))
  if (ink.some(value => !value?.length)) return
  const bodies = nodes.map(node => {
    const surface = eventFrameSurface(node, style)
    return nodePaintBounds({ kind: 'shape', id: node.id, role: 'node', ...surface, geometry: writtenGeometry(surface.geometry), paint: { ...surface.paint, strokeWidth: formatSvgNumericAttribute('stroke-width', surface.paint.strokeWidth) } })
  })
  if (!bodies.every(finiteBox)) return
  const markers = edges.map(edge => {
    const geometry = writtenGeometry({ kind: 'polyline', points: edge.points }) as { kind: 'polyline'; points: Point[] }
    return connectorMarkerPaintRegions({ route: { geometry, closed: false, contours: connectorContourSemantics(geometry) }, stroke: { width: paint.strokeWidth }, markers: { end: eventModelingArrow, mid: [] } }, undefined, false)
  })
  if (markers.some(regions => regions.some(marker => !finiteBox(marker.bounds)))) return
  for (const [edgeIndex, edge] of edges.entries()) {
    const from = byId.get(edge.from)!, to = byId.get(edge.to)!, old = edge.points
    if (to.index <= from.index + 1 || old.length !== 6 || edge.projection) continue
    const start = old[0]!, end = old.at(-1)!
    for (const column of [old[1]!.x, old.at(-2)!.x]) {
      if (!(start.x < column && column < end.x)) continue
      const route = start.y === end.y ? [start, end] : [start, { x: column, y: start.y }, { x: column, y: end.y }, end]
      const candidate = orthogonalStrokeInk(route, paint)
      if (candidate?.length !== 2 * route.length - 3) continue
      const clear = candidate.every((shaft, index) => {
        for (const [nodeIndex, node] of nodes.entries()) {
          if (node.id === edge.from && index === 0 || node.id === edge.to && index === candidate.length - 1) continue
          if (boxesMeet(shaft, bodies[nodeIndex]!)) return false
        }
        for (const [peerIndex, peer] of edges.entries()) {
          for (const marker of markers[peerIndex]!) {
            if (peer === edge && index === candidate.length - 1) continue
            if (boxesMeet(shaft, marker.bounds!)) return false
          }
          if (peer !== edge && ink[peerIndex]!.some(support => boxesMeet(shaft, support))) return false
        }
        return true
      })
      if (!clear) continue
      edge.points = route
      ink[edgeIndex] = candidate
      break
    }
  }
}
export type PositionedEventModeling = ReturnType<typeof layoutEventModeling>
