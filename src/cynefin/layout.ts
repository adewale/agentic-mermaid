import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { CYNEFIN_DOMAINS, type CynefinBody, type PositionedCynefin, type CynefinPlacedLabel } from './types.ts'

/** Every item is measured before region sizes are chosen. No item count,
 * text length or confusion-domain content is truncated to fit a fixed box. */
export function layoutCynefin(body: CynefinBody, options: Readonly<RenderOptions> = {}, styleFace?: InternalStyleFace): PositionedCynefin {
  const style = resolveRenderStyle(options, undefined, styleFace), pad = options.padding ?? 24, gap = 24, inset = 18
  const band = diagramTitleBand(body.title, style), top = pad + (band?.height ?? 0)
  const measure = (text: string, heading = false) => preparePixelText(text, { display: 'literal', fontSize: style.nodeLabelFontSize, fontWeight: heading ? Math.max(600, style.nodeLabelFontWeight) : style.nodeLabelFontWeight, maxWidth: 220, fontFamily: options.font })
  const declared = new Map(body.domains.map(domain => [domain.name, domain]))
  const measured = new Map(CYNEFIN_DOMAINS.map(name => {
    const heading = measure(name.charAt(0).toUpperCase() + name.slice(1), true), items = (declared.get(name)?.items ?? []).map(item => measure(item.label))
    return [name, { heading, items, width: Math.max(250, heading.width + inset * 2, ...items.map(item => item.width + inset * 2)), height: Math.max(180, heading.height + inset * 3 + items.reduce((sum, item) => sum + item.height + 12, 0)) }] as const
  }))
  const leftWidth = Math.max(measured.get('complex')!.width, measured.get('chaotic')!.width), middleWidth = measured.get('confusion')!.width, rightWidth = Math.max(measured.get('complicated')!.width, measured.get('clear')!.width)
  let topHeight = Math.max(measured.get('complex')!.height, measured.get('complicated')!.height), bottomHeight = Math.max(measured.get('chaotic')!.height, measured.get('clear')!.height)
  const deficit = Math.max(0, measured.get('confusion')!.height - topHeight - bottomHeight - gap)
  topHeight += deficit / 2; bottomHeight += deficit / 2
  const width = Math.max(pad * 2 + leftWidth + middleWidth + rightWidth + 2 * gap, (band?.width ?? 0) + pad * 2), height = top + topHeight + bottomHeight + gap + pad
  const columns = { left: pad, middle: pad + leftWidth + gap, right: pad + leftWidth + middleWidth + 2 * gap }
  const domains = CYNEFIN_DOMAINS.map(name => {
    const m = measured.get(name)!, bottom = name === 'chaotic' || name === 'clear', center = name === 'confusion', right = name === 'complicated' || name === 'clear'
    const x = center ? columns.middle : right ? columns.right : columns.left, y = top + (bottom ? topHeight + gap : 0), w = center ? middleWidth : right ? rightWidth : leftWidth, h = center ? topHeight + bottomHeight + gap : bottom ? bottomHeight : topHeight
    let cursor = y + inset + m.heading.height + inset
    const heading: CynefinPlacedLabel = { id: `heading:${name}`, text: m.heading.text, block: m.heading, x: x + w / 2, y: y + inset + m.heading.height / 2 }
    const items = m.items.map((block, index) => { const item = { id: `${name}:${index}`, text: declared.get(name)!.items[index]!.label, block, x: x + w / 2, y: cursor + block.height / 2 }; cursor += block.height + 12; return item })
    return { name, x, y, width: w, height: h, heading, items }
  })
  const byName = new Map(domains.map(domain => [domain.name, domain]))
  const transitions = body.transitions.map((transition, index) => {
    const from = byName.get(transition.from)!, to = byName.get(transition.to)!
    const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }, b = { x: to.x + to.width / 2, y: to.y + to.height / 2 }, dx = b.x - a.x, dy = b.y - a.y
    const trim = (w: number, h: number) => Math.min(dx ? w / (2 * Math.abs(dx)) : Infinity, dy ? h / (2 * Math.abs(dy)) : Infinity)
    const source = trim(from.width, from.height), target = trim(to.width, to.height)
    const points = [{ x: a.x + dx * source, y: a.y + dy * source }, { x: b.x - dx * target, y: b.y - dy * target }]
    const block = transition.label === undefined ? undefined : measure(transition.label)
    return { id: `transition:${index}`, from: transition.from, to: transition.to, points, ...(block ? { label: { id: `transition:${index}`, text: transition.label!, block, x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 } } : {}) }
  })
  return { width, height, body, domains, transitions, options, ...(band ? { title: positionDiagramTitle(band, width, pad) } : {}) }
}
