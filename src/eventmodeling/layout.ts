import { eventModelingLane, eventModelingRelations, eventModelingSpecificationLines } from './parser.ts'
import type { EventModelingBody, EventModelingFrame } from './types.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle } from '../styles.ts'
import type { PositionedDiagramTitle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { RenderOptions } from '../types.ts'

export interface PositionedEventModeling {
  width: number; height: number; body: EventModelingBody
  title?: PositionedDiagramTitle
  lanes: { id: string; label: string; block: PixelTextBlock; y: number; height: number }[]
  frames: { frame: EventModelingFrame; label: string; block: PixelTextBlock; x: number; y: number; width: number; height: number; lane: string }[]
  relations: { id: string; from: string; to: string; inferred: boolean; points: { x: number; y: number }[] }[]
}
export function layoutEventModeling(body: EventModelingBody, options: RenderOptions = {}, face?: InternalStyleFace): PositionedEventModeling {
  const style = resolveRenderStyle(options, FLOWCHART_STYLE_DEFAULTS, face), pad = options.padding ?? 24
  const measure = (text: string, group = false) => preparePixelText(text, { fontSize: group ? style.groupHeaderFontSize : style.nodeLabelFontSize, fontWeight: group ? style.groupHeaderFontWeight : style.nodeLabelFontWeight, letterSpacing: group ? style.groupLetterSpacing : style.nodeLetterSpacing, transform: group ? style.groupTextTransform : style.nodeTextTransform, fontFamily: group ? style.groupFont : undefined, maxWidth: 260 })
  const titleBand = diagramTitleBand(body.title, style), top = pad + (titleBand?.height ?? 0)
  const lanes: PositionedEventModeling['lanes'] = []
  const frames = body.frames.map(frame => {
    const lane = eventModelingLane(frame)
    if (!lanes.some(item => item.id === lane)) lanes.push({ id: lane, label: lane, block: measure(lane, true), y: 0, height: 0 })
    const data = frame.data ?? body.data.find(item => item.id === frame.dataReference)?.value
    const notes = body.notes.filter(note => note.frame === frame.id).map(note => note.text)
    const specifications = body.specifications.filter(spec => spec.frame === frame.id).map(spec => eventModelingSpecificationLines(spec, true).join('\n'))
    const label = [`${frame.id} · ${frame.entityType}`, frame.entity.split('.').at(-1)!, ...(data ? [data.text] : []), ...notes, ...specifications].join('\n'), block = measure(label)
    return { frame, label, block, lane, width: Math.max(140, block.width + style.nodePaddingX * 2), height: Math.max(64, block.height + style.nodePaddingY * 2), x: 0, y: 0 }
  })
  const gutter = Math.max(120, ...lanes.map(lane => lane.block.width + 28))
  let y = top
  // The public positioned projection uses integer pixels. Keep each lane's
  // height integral at the producer, so rounding a shared boundary cannot turn
  // adjacent lanes into overlapping groups under a fractional-font style.
  for (const lane of lanes) { lane.y = y; lane.height = Math.ceil(Math.max(90, ...frames.filter(frame => frame.lane === lane.id).map(frame => frame.height + 36), lane.block.height + 32)); y += lane.height }
  let x = pad + gutter
  for (const frame of frames) { const lane = lanes.find(lane => lane.id === frame.lane)!; frame.x = x; frame.y = lane.y + (lane.height - frame.height) / 2; x += frame.width + 44 }
  let footerChannels = 0
  const relations = eventModelingRelations(body).map(relation => {
    const from = frames.find(frame => frame.frame.id === relation.from)!, to = frames.find(frame => frame.frame.id === relation.to)!
    const source = { x: from.x + from.width, y: from.y + from.height / 2 }, target = { x: to.x, y: to.y + to.height / 2 }
    const fromIndex = frames.indexOf(from), toIndex = frames.indexOf(to)
    if (toIndex === fromIndex + 1) {
      const bend = (source.x + target.x) / 2
      return { ...relation, points: [source, { x: bend, y: source.y }, { x: bend, y: target.y }, target] }
    }
    // A reference can skip timeline columns or point back in source order.
    // Route through free inter-column gutters and a separate footer channel,
    // so its vertical segment cannot cut through an intervening frame.
    const footer = y + 12 + footerChannels++ * 12
    return { ...relation, points: [source, { x: source.x + 22, y: source.y }, { x: source.x + 22, y: footer }, { x: target.x - 22, y: footer }, { x: target.x - 22, y: target.y }, target] }
  })
  const width = Math.max(160, x + pad, (titleBand?.width ?? 0) + 2 * pad), height = Math.max(100, y + pad + footerChannels * 12)
  return { width, height, body, lanes, frames, relations, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, pad) } : {}) }
}
