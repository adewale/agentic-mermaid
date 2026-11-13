import { parseRequirementDiagram } from '../requirement/parser.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
import { drawMultiBox } from './draw.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { displayText } from '../multiline-utils.ts'
import { allocateBoxRoutes, boxFaceSizes, paintBoxRoute, paintBoxText, reverseBoxes, type TerminalBox, type BoxRelation } from './class-like-layout.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { frontmatterTitle } from '../mermaid-source.ts'

export function renderRequirementTerminal(lines: string[] | string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, frontmatter: MermaidFrontmatterMap = {}, targetWidth?: number): TerminalArtifact {
  const model = parseRequirementDiagram(lines),
    direction = model.direction,
    horizontal = direction === 'LR' || direction === 'RL',
    width = targetWidth ?? config.targetWidth ?? config.maxWidth
  const wrap = (value: string) => wrapText(displayText(value), width ? Math.max(1, width - 8) : undefined)
  const relations: BoxRelation[] = model.relations.map(e => ({ id: e.id, from: e.src, to: e.dst, lines: [`<<${e.type}>>`] })),
    demand = boxFaceSizes(relations, direction)
  const cards = [
    ...model.requirements.map(r => ({
      id: r.name,
      sections: [
        [`<<${r.type}>>`, ...wrap(r.name)],
        ...[
          ['ID', r.requirementId],
          ['Text', r.text],
          ['Risk', r.risk],
          ['Verification', r.verifyMethod],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => wrap(`${k}: ${v}`)),
      ],
    })),
    ...model.elements.map(e => ({
      id: e.name,
      sections: [
        ['<<Element>>', ...wrap(e.name)],
        ...[
          ['Type', e.type],
          ['Doc Ref', e.docRef],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => wrap(`${k}: ${v}`)),
      ],
    })),
  ]
  const sizes = new Map(cards.map(c => [c.id, { width: Math.max(6, ...c.sections.flat().map(s => visualWidth(s) + 4), demand.get(c.id)?.width ?? 0), height: Math.max(c.sections.reduce((n, s) => n + Math.max(1, s.length), 0) + c.sections.length + 1, demand.get(c.id)?.height ?? 0) }]))
  const ranks = new Map<string, number>(),
    incoming = new Set(model.relations.filter(e => e.src !== e.dst).map(e => e.dst)),
    queue = cards.filter(c => !incoming.has(c.id)).map(c => c.id)
  const outgoing = new Map<string, typeof model.relations>()
  for (const edge of model.relations) {
    if (edge.src === edge.dst) continue
    const siblings = outgoing.get(edge.src)
    if (siblings) siblings.push(edge)
    else outgoing.set(edge.src, [edge])
  }
  queue.forEach(id => ranks.set(id, 0))
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!
    for (const e of outgoing.get(id) ?? []) {
      const next = (ranks.get(id) ?? 0) + 1
      if (next >= cards.length || (ranks.get(e.dst) ?? -1) >= next) continue
      ranks.set(e.dst, next)
      queue.push(e.dst)
    }
  }
  let cycle = Math.max(-1, ...ranks.values()) + 1
  for (const c of cards) if (!ranks.has(c.id)) ranks.set(c.id, cycle++)
  const rows = new Map<number, typeof cards>()
  for (const card of cards) {
    const rank = ranks.get(card.id)!, siblings = rows.get(rank)
    if (siblings) siblings.push(card)
    else rows.set(rank, [card])
  }
  const place = (): (TerminalBox & { sections: string[][] })[] => {
    const placed: (TerminalBox & { sections: string[][] })[] = []
    let axis = 4
    for (let rank = 0; rank <= Math.max(-1, ...ranks.values()); rank++) {
      let cross = 4,
        extent = 0
      for (const c of rows.get(rank) ?? []) {
        const size = sizes.get(c.id)!
        placed.push({ ...size, id: c.id, sections: c.sections, x: horizontal ? axis : cross, y: horizontal ? cross : axis })
        cross += (horizontal ? size.height : size.width) + 6
        extent = Math.max(extent, horizontal ? size.width : size.height)
      }
      axis += extent + 10
    }
    reverseBoxes(placed, direction)
    return placed
  }
  let boxes = place()
  // The faces a relation uses follow placement: a relation back to an earlier
  // rank leaves the face opposite the flow direction. Recount the placed
  // faces, as C4 and ER do, so every port is allocated before painting.
  for (let pass = 0; pass < relations.length * 2 + 2; pass++) {
    let changed = false
    for (const [id, face] of boxFaceSizes(relations, direction, boxes)) {
      const size = sizes.get(id)
      if (!size || (size.width >= face.width && size.height >= face.height)) continue
      size.width = Math.max(size.width, face.width)
      size.height = Math.max(size.height, face.height)
      changed = true
    }
    if (!changed) break
    boxes = place()
  }
  const doc = new TerminalDocument(),
    routes = allocateBoxRoutes(boxes, relations, direction)
  const byId = new Map(model.relations.map(edge => [edge.id, edge]))
  for (const route of routes) {
    const edge = byId.get(route.relation.id)!,
      owner = doc.element({ id: edge.id, kind: 'edge', from: edge.src, to: edge.dst })
    paintBoxRoute(doc, route, owner, config.useAscii, edge.type !== 'contains')
    const end = edge.type === 'contains' ? 'start' : 'end',
      port = end === 'start' ? route.source : route.target,
      marker = { shape: edge.type === 'contains' ? ('circle' as const) : ('open-arrow' as const), direction: ({ T: 'B', B: 'T', L: 'R', R: 'L' } as const)[port.side], ascii: config.useAscii }
    doc.expectMarkers(owner, end, [marker])
    doc.expectMarkers(owner, end === 'start' ? 'end' : 'start', [])
    doc.marker(port.x, port.y, marker, { owner, role: 'arrow' })
    paintBoxText(doc, route.label, owner)
  }
  for (const box of boxes) {
    const owner: TerminalOwner = { id: box.id, kind: 'node' }
    doc.region(owner, box)
    const card = drawMultiBox(box.sections, config.useAscii, 1, { width: box.width, height: box.height })
    doc.scope(owner, () => doc.overlay(card, box.x, box.y))
  }
  const title = frontmatterTitle(frontmatter) ?? config.title
  if (title) {
    const rows = wrapText(displayText(title), width),
      out = new TerminalDocument()
    rows.forEach((s, i) => out.text(0, i, s, { owner: { id: 'title', kind: 'label' } }))
    out.overlay(doc, 0, rows.length + 1)
    return terminalArtifact(out, { colorMode, theme })
  }
  return terminalArtifact(doc, { colorMode, theme })
}
