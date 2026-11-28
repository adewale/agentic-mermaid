import { eventModelingArrow, eventModelingTerminal } from './markers.ts'
import { routeOrthogonal } from '../layout/orthogonal-router.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { paintedStrokeExtent } from '../scene/bounds.ts'
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
export function layoutEventModeling(body: EventModelingBody, options: Readonly<RenderOptions> = {}, styleFace?: Readonly<InternalStyleFace>, rowHeight = 0, palette?: Readonly<DiagramColors>) {
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
  // A frame that names itself as a source loops beside its own card, inside
  // its own lane: out of its lowest right port, under the card, and back into
  // its lowest left port, short of the gutters other relations travel in.
  const looped = new Set(relations.filter(edge => edge.from === edge.to).map(edge => edge.from))
  const titleBand = diagramTitleBand(body.title, style)
  const laneWidth = Math.max(140, ...lanes.map(lane => style.groupLabelPaddingX + lane.block.width + style.groupPaddingX)) + nodeStroke
  const nodes = body.frames.map((frame, index) => {
    const block = prepare(eventFrameText(body, frame))
    const width = Math.max(120, block.width + 2 * (style.nodePaddingX + nodeStroke))
    const ports = degrees.get(frame.id)!
    const count = Math.max(ports.incoming, ports.outgoing)
    const portMargin = Math.max(6 + nodeStroke, style.nodePaddingY + nodeStroke, Math.min(style.cornerRadius ?? 5, width / 2))
    const portHeight = count > 1 ? (count - 1) * portSpacing + 2 * portMargin : 0
    return { id: frame.id, frame, block, lane: laneByLabel.get(eventLane(frame))!.id, x: 0, y: 0, width, height: Math.max(64, block.height + 2 * (style.nodePaddingY + nodeStroke), portHeight), index, portMargin }
  })
  const columnWidth = Math.max(160, ...nodes.map(node => node.width))
  const gap = Math.max(48, options.nodeSpacing ?? 48, 2 * nodeStroke + 16)
  const loopLead = Math.max(portSpacing, gap / 4)
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
    lane.height = Math.max(rowHeight, lane.block.height + 2 * style.groupPaddingY, ...owned.map(node => node.height + 2 * (Math.max(style.groupPaddingY, looped.has(node.id) ? 2 * loopLead : 0) + nodeStroke)))
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
  // Routes stay in the corridors: the gutter after every column and the gap
  // above every lane (and below the last). The shared router picks the fewest
  // bends, then the shortest path, through them around every card.
  const obstacles = nodes.map(node => ({ x0: node.x - nodeStroke, y0: node.y - nodeStroke, x1: node.x + node.width + nodeStroke, y1: node.y + node.height + nodeStroke }))
  const columns = Array.from({ length: Math.max(1, nodes.length) }, (_, index) => pad + laneWidth + index * (columnWidth + gap))
  const channels = {
    x: columns.map(x => x + columnWidth + gap / 2),
    y: [...lanes.map(lane => lane.y - gap / 2), ...(lanes.length ? [lanes.at(-1)!.y + lanes.at(-1)!.height + gap / 2] : [])],
  }
  // A card's port slots follow the other ends top to bottom (then left to
  // right), so routes leaving or entering one side do not cross each other.
  // A self-relation takes the lowest slot on both sides, so its loop passes
  // no other port.
  const centre = (edge: (typeof relations)[number], end: 'from' | 'to') => { if (edge.from === edge.to) return Infinity; const node = byId.get(edge[end])!; return node.y + node.height / 2 }
  const slotOrder = (side: 'from' | 'to') => {
    const other = side === 'from' ? 'to' : 'from'
    const ranked = relations.map((edge, index) => ({ edge, index }))
      .sort((a, b) => centre(a.edge, other) - centre(b.edge, other) || byId.get(a.edge[other])!.index - byId.get(b.edge[other])!.index || a.index - b.index)
    const slots = new Map<number, number>(), used = new Map<string, number>()
    for (const { edge, index } of ranked) {
      const slot = used.get(edge[side]) ?? 0
      slots.set(index, slot)
      used.set(edge[side], slot + 1)
    }
    return slots
  }
  const routeAll = (sourceSlots: ReadonlyMap<number, number>, targetSlots: ReadonlyMap<number, number>) => {
    // Routes already drawn, so a later one neither shares a line with an
    // unrelated relationship nor runs beside it (relations from or to the same
    // card may still share a trunk, as before).
    const drawn: Array<{ from: string; to: string; points: readonly { x: number; y: number }[] }> = []
    return relations.map((edge, index) => {
      const from = byId.get(edge.from)!,
        to = byId.get(edge.to)!
      const sourceSlot = sourceSlots.get(index)!, targetSlot = targetSlots.get(index)!
      const start = { x: from.x + from.width + nodeStroke, y: from.y + from.height / 2 + (sourceSlot - (degrees.get(from.id)!.outgoing - 1) / 2) * portSpacing }
      const end = { x: to.x - nodeStroke, y: to.y + to.height / 2 + (targetSlot - (degrees.get(to.id)!.incoming - 1) / 2) * portSpacing }
      // A side with one connection may meet the other end level, when that
      // height lies on the side, so a straight run needs no jog.
      const within = (node: typeof from, y: number) => y >= node.y + node.portMargin && y <= node.y + node.height - node.portMargin
      if (degrees.get(to.id)!.incoming === 1 && within(to, start.y)) end.y = start.y
      else if (degrees.get(from.id)!.outgoing === 1 && within(from, end.y)) start.y = end.y
      const gutter = from.x + columnWidth + gap / 2
      const targetGutter = to.x - gap / 2
      const routeY = laneById.get(from.lane)!.y - gap / 2
      const template = from.lane === to.lane && to.index === from.index + 1 && start.y === end.y ? [start, end] : to.index === from.index + 1 ? [start, { x: gutter, y: start.y }, { x: gutter, y: end.y }, end] : [start, { x: gutter, y: start.y }, { x: gutter, y: routeY }, { x: targetGutter, y: routeY }, { x: targetGutter, y: end.y }, end]
      if (edge.from === edge.to) {
        const below = from.y + from.height + nodeStroke + loopLead
        const points = [start, { x: start.x + loopLead, y: start.y }, { x: start.x + loopLead, y: below }, { x: end.x - loopLead, y: below }, { x: end.x - loopLead, y: end.y }, end]
        drawn.push({ from: edge.from, to: edge.to, points })
        return { edge, index, points }
      }
      const segments = drawn.filter(other => other.from !== edge.from && other.to !== edge.to && other.from !== edge.to && other.to !== edge.from)
        .flatMap(other => other.points.slice(1).map((point, at) => [other.points[at]!, point] as const))
      const routed = routeOrthogonal({ start, end, exit: 'E', entry: 'E', obstacles, clearance: 0, channels: { x: [...channels.x, targetGutter], y: channels.y }, channelsOnly: true, minRun: portSpacing,
        avoid: { segments, separation: portSpacing / 2, gap: 2 * portSpacing } })
      // The template is the fallback when no corridor route exists.
      const points = routed && routed.length <= template.length ? routed.map(point => ({ x: point.x, y: point.y })) : template
      drawn.push({ from: edge.from, to: edge.to, points })
      return { edge, index, points }
    })
  }
  const sourceSlots = slotOrder('from'), targetSlots = slotOrder('to')
  let routes = routeAll(sourceSlots, targetSlots)
  // The other ends do not say where a route turns: a relation to a farther
  // card may run on past the gutter where a nearer one turns down, across
  // it. Read each side's order again from the routes, top to bottom: routes
  // whose vertical run nearest the side goes up (the leftmost run highest),
  // then straight ones, then those going down (the leftmost run lowest), so
  // no run crosses another's way to the side. Where that order
  // differs, route again with it, and keep the new routes only if they cross
  // less, or as little with fewer bends.
  const routedOrder = (side: 'from' | 'to', slots: ReadonlyMap<number, number>) => {
    const turn = ({ edge, points }: (typeof routes)[number]) => {
      if (edge.from === edge.to) return Infinity
      const runs = points.slice(1).map((point, at) => [points[at]!, point] as const)
      const run = (side === 'from' ? runs : runs.reverse()).find(([a, b]) => a.x === b.x && a.y !== b.y)
      return run ? Math.sign(run[1].y - run[0].y) * (1e9 - run[0].x) : 0
    }
    const ranked = routes.map(route => ({ route, turn: turn(route) })).sort((a, b) => a.turn - b.turn || slots.get(a.route.index)! - slots.get(b.route.index)!)
    const order = new Map<number, number>(), used = new Map<string, number>()
    for (const { route } of ranked) {
      const slot = used.get(route.edge[side]) ?? 0
      order.set(route.index, slot)
      used.set(route.edge[side], slot + 1)
    }
    return order
  }
  const reorderedSources = routedOrder('from', sourceSlots), reorderedTargets = routedOrder('to', targetSlots)
  if (routes.some(({ index }) => reorderedSources.get(index) !== sourceSlots.get(index) || reorderedTargets.get(index) !== targetSlots.get(index))) {
    const retried = routeAll(reorderedSources, reorderedTargets)
    const bends = (all: typeof routes) => all.reduce((sum, route) => sum + route.points.length - 2, 0)
    const before = countPolylineCrossings(routes), after = countPolylineCrossings(retried)
    if (after < before || (after === before && bends(retried) < bends(routes))) routes = retried
  }
  const edges = routes.map(({ edge, index, points }) => {
    const projection = style.edgeBendRadius > 0 ? projectRoundedConnectorPath(points, style.edgeBendRadius, { precision: 3, terminalClearance: { end: eventModelingTerminal(eventModelingArrow.id, style.lineWidth, 'end') } }) : undefined
    return { ...edge, points: projection?.geometry.points ?? points, projection, index }
  })
  return { style, laneWidth, width, height: Math.max(y + pad, 2 * pad + 40), lanes, nodes, edges, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, pad) } : {}) }
}
export type PositionedEventModeling = ReturnType<typeof layoutEventModeling>
