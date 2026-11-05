import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { CYNEFIN_DOMAINS, type CynefinBody, type PositionedCynefin, type CynefinPlacedLabel } from './types.ts'

/** Domains keep their familiar positions. Transitions have separate exterior
 * tracks: their carriers and captions never pass through a third domain. */
export function layoutCynefin(body: CynefinBody, options: Readonly<RenderOptions> = {}, styleFace?: InternalStyleFace): PositionedCynefin {
  const style = resolveRenderStyle(options, undefined, styleFace), pad = options.padding ?? 24, gap = Math.max(24, style.groupPaddingX), inset = Math.max(18, style.groupPaddingY)
  const band = diagramTitleBand(body.title, style)
  const measure = (text: string, role: 'node' | 'group' | 'edge' = 'node') => preparePixelText(text, {
    display: 'literal', maxWidth: 220, fontFamily: role === 'group' ? style.groupFont ?? options.font : options.font,
    fontSize: role === 'group' ? style.groupHeaderFontSize : role === 'edge' ? style.edgeLabelFontSize : style.nodeLabelFontSize,
    fontWeight: role === 'group' ? style.groupHeaderFontWeight : role === 'edge' ? style.edgeLabelFontWeight : style.nodeLabelFontWeight,
    letterSpacing: role === 'group' ? style.groupLetterSpacing : role === 'edge' ? style.edgeLetterSpacing : style.nodeLetterSpacing,
    transform: role === 'group' ? style.groupTextTransform : role === 'edge' ? style.edgeTextTransform : style.nodeTextTransform,
  })
  const transitionBlocks = body.transitions.map(transition => transition.label === undefined ? undefined : measure(transition.label, 'edge'))
  const trackGap = Math.max(12, style.lineWidth * 4), captionSpan = Math.max(24, ...transitionBlocks.map(block => (block?.width ?? 0) + 24)), gutter = body.transitions.length ? captionSpan + 24 + body.transitions.length * trackGap * 2 : 0
  let trackY = pad + (band?.height ?? 0)
  const tracks = transitionBlocks.map(block => { const y = trackY + Math.max(20, block?.height ?? 0) / 2; trackY += Math.max(20, block?.height ?? 0) + 16; return y })
  const top = trackY + (body.transitions.length ? 24 : 0)
  const declared = new Map(body.domains.map(domain => [domain.name, domain]))
  const measured = new Map(CYNEFIN_DOMAINS.map(name => {
    const heading = measure(name.charAt(0).toUpperCase() + name.slice(1), 'group'), items = (declared.get(name)?.items ?? []).map(item => measure(item.label))
    return [name, { heading, items, width: Math.max(250, heading.width + inset * 2, ...items.map(item => item.width + inset * 2)), height: Math.max(180, heading.height + inset * 3 + items.reduce((sum, item) => sum + item.height + 12, 0)) }] as const
  }))
  const leftWidth = Math.max(measured.get('complex')!.width, measured.get('chaotic')!.width), middleWidth = measured.get('confusion')!.width, rightWidth = Math.max(measured.get('complicated')!.width, measured.get('clear')!.width)
  let topHeight = Math.max(measured.get('complex')!.height, measured.get('complicated')!.height), bottomHeight = Math.max(measured.get('chaotic')!.height, measured.get('clear')!.height)
  const deficit = Math.max(0, measured.get('confusion')!.height - topHeight - bottomHeight - gap)
  topHeight += deficit / 2; bottomHeight += deficit / 2
  const width = Math.max(pad * 2 + gutter * 2 + leftWidth + middleWidth + rightWidth + 2 * gap, (band?.width ?? 0) + pad * 2), height = top + topHeight + bottomHeight + gap + pad
  const columns = { left: pad + gutter, middle: pad + gutter + leftWidth + gap, right: pad + gutter + leftWidth + middleWidth + 2 * gap }
  const domains = CYNEFIN_DOMAINS.map(name => {
    const m = measured.get(name)!, bottom = name === 'chaotic' || name === 'clear', center = name === 'confusion', right = name === 'complicated' || name === 'clear'
    const x = center ? columns.middle : right ? columns.right : columns.left, y = top + (bottom ? topHeight + gap : 0), w = center ? middleWidth : right ? rightWidth : leftWidth, h = center ? topHeight + bottomHeight + gap : bottom ? bottomHeight : topHeight
    let cursor = y + inset + m.heading.height + inset
    const heading: CynefinPlacedLabel = { id: `heading:${name}`, text: m.heading.text, block: m.heading, x: x + w / 2, y: y + inset + m.heading.height / 2 }
    const items = m.items.map((block, index) => { const item = { id: `${name}:${index}`, text: declared.get(name)!.items[index]!.label, block, x: x + w / 2, y: cursor + block.height / 2 }; cursor += block.height + 12; return item })
    return { name, x, y, width: w, height: h, heading, items }
  })
  const byName = new Map(domains.map(domain => [domain.name, domain]))
  const contacts = new Map<string, number>(), totals = new Map<string, number>()
  for (const transition of body.transitions) for (const name of [transition.from, transition.to]) totals.set(name, (totals.get(name) ?? 0) + 1)
  const port = (name: string, index: number, target: boolean) => {
    const domain = byName.get(name as typeof CYNEFIN_DOMAINS[number])!, position = (contacts.get(name) ?? 0) + 1
    contacts.set(name, position)
    const fraction = position / ((totals.get(name) ?? 0) + 1)
    if (name === 'confusion') {
      const x = domain.x + domain.width * fraction
      return { point: { x, y: domain.y }, outside: { x, y: tracks[index]! } }
    }
    const right = name === 'complicated' || name === 'clear', x = right ? domain.x + domain.width : domain.x, y = domain.y + domain.height * fraction
    const outsideX = right ? width - pad - index * trackGap - (target ? captionSpan : 0) : pad + index * trackGap + (target ? captionSpan : 0)
    return { point: { x, y }, outside: { x: outsideX, y } }
  }
  const transitions = body.transitions.map((transition, index) => {
    const from = port(transition.from, index, false), to = port(transition.to, index, true), y = tracks[index]!, block = transitionBlocks[index]
    const points = [from.point, from.outside, { x: from.outside.x, y }, { x: to.outside.x, y }, to.outside, to.point]
      .filter((point, i, all) => !i || point.x !== all[i - 1]!.x || point.y !== all[i - 1]!.y)
    return { id: `transition:${index}`, from: transition.from, to: transition.to, points, ...(block ? { label: { id: `transition:${index}`, text: transition.label!, block, x: (from.outside.x + to.outside.x) / 2, y } } : {}) }
  })
  return { width, height, body, domains, transitions, options, ...(band ? { title: positionDiagramTitle(band, width, pad) } : {}) }
}
