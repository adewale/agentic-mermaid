import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { RenderOptions } from '../types.ts'
import type { EventFrame, EventModelingBody } from './types.ts'
import { eventLane, eventRelations } from './parser.ts'

export function eventFrameText(body: EventModelingBody, identity: string | EventFrame): string {
  const frame = typeof identity === 'string' ? body.frames.find(value => value.id === identity)! : identity
  const id = frame.id
  const data = frame.data ?? (frame.dataReference ? body.data[frame.dataReference] : undefined)
  const notes = body.notes.filter(value => value.frame === id).map(value => `Note: ${value.data.text}`)
  const specs = body.specifications.filter(value => value.frame === id).flatMap(value => (['given', 'when', 'then'] as const).filter(key => value[key].length).map(key => `${key}: ${value[key].map(item => `${item.type} ${item.entity}`).join(', ')}`))
  return [`${frame.id} · ${frame.type}${frame.reset ? ' · reset' : ''}`, frame.entity, ...(data ? [data.text] : []), ...notes, ...specs].join('\n')
}
export function layoutEventModeling(body: EventModelingBody, options: Readonly<RenderOptions> = {}, styleFace?: Readonly<InternalStyleFace>) {
  const style = resolveRenderStyle(options, undefined, styleFace),
    pad = options.padding ?? 24
  const prepare = (text: string) => preparePixelText(text, { display: 'literal', fontFamily: options.font, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, maxWidth: 220 })
  const lanes = [...new Set(body.frames.map(eventLane))].map((label, index) => ({ id: `lane:${index}`, label, block: prepare(label), x: pad, y: 0, width: 0, height: 0 }))
  const laneByLabel = new Map(lanes.map(lane => [lane.label, lane]))
  const titleBand = diagramTitleBand(body.title, style)
  const laneWidth = Math.max(140, ...lanes.map(lane => lane.block.width + 24))
  const nodes = body.frames.map((frame, index) => {
    const block = prepare(eventFrameText(body, frame))
    return { id: frame.id, frame, block, lane: laneByLabel.get(eventLane(frame))!.id, x: 0, y: 0, width: Math.max(120, block.width + 2 * style.nodePaddingX), height: Math.max(64, block.height + 2 * style.nodePaddingY), index }
  })
  const columnWidth = Math.max(160, ...nodes.map(node => node.width))
  const gap = Math.max(48, options.nodeSpacing ?? 48)
  const width = pad * 2 + laneWidth + Math.max(1, nodes.length) * (columnWidth + gap)
  const members = new Map<string, typeof nodes>()
  for (const node of nodes) {
    const list = members.get(node.lane) ?? []
    list.push(node)
    members.set(node.lane, list)
  }
  let y = pad + (titleBand?.height ?? 0)
  for (const lane of lanes) {
    const owned = members.get(lane.id) ?? []
    lane.y = y
    lane.height = Math.max(lane.block.height + 32, ...owned.map(node => node.height + 48))
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
  const edges = eventRelations(body).map((edge, index) => {
    const from = byId.get(edge.from)!,
      to = byId.get(edge.to)!
    const start = { x: from.x + from.width, y: from.y + from.height / 2 }
    const end = { x: to.x, y: to.y + to.height / 2 }
    const gutter = from.x + columnWidth + gap / 2
    const targetGutter = to.x - gap / 2
    const routeY = laneById.get(from.lane)!.y - gap / 2
    const points = from.lane === to.lane && to.index === from.index + 1 ? [start, end] : to.index === from.index + 1 ? [start, { x: gutter, y: start.y }, { x: gutter, y: end.y }, end] : [start, { x: gutter, y: start.y }, { x: gutter, y: routeY }, { x: targetGutter, y: routeY }, { x: targetGutter, y: end.y }, end]
    return { ...edge, points, index }
  })
  return { width, height: Math.max(y + pad, 2 * pad + 40), lanes, nodes, edges, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, pad) } : {}) }
}
export type PositionedEventModeling = ReturnType<typeof layoutEventModeling>
