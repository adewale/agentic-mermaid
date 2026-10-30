import { blockDisplayText } from '../block/text.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { layout as layoutGrid, type Cell } from '../block/grid.ts'
import type { Block } from '../block/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, type TerminalOwner, type TerminalMarker } from './terminal-document.ts'
import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { displayText } from '../multiline-utils.ts'
import { paintTerminalFrame } from './terminal-geometry.ts'
import { allocateBoxRoutes, BOX_ROUTE_APPROACH_DISTANCE, boxFaceSizes, paintBoxRoute, paintBoxText, selfLoopClearance, type BoxRelation } from './class-like-layout.ts'
import { frontmatterTitle, type MermaidFrontmatterMap } from '../mermaid-source.ts'

interface BlockCell extends Cell {
  block: Block
  lines: string[]
  parentId?: string
}
export function renderBlockTerminal(lines: string[] | string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, frontmatter: MermaidFrontmatterMap = {}, targetWidth?: number): TerminalArtifact {
  const model = parseBlockDiagram(lines),
    width = targetWidth ?? config.targetWidth ?? config.maxWidth,
    cols = model.root.columns && model.root.columns > 0 ? model.root.columns : Math.max(1, model.root.children?.length ?? 1)
  const make = (block: Block, parentId?: string): BlockCell => {
    const text = block.label ?? (block.type === 'composite' ? '' : block.id),
      rows = wrapText(blockDisplayText(text), width ? Math.max(1, Math.floor((width - 8) / cols) - 6) : undefined),
      head = block.type === 'composite' && text ? rows.length + 2 : 0
    return { block, lines: rows, parentId, children: [], columns: block.columns ?? -1, span: block.widthInColumns ?? 1, space: block.type === 'space', head, nw: Math.max(6, ...rows.map(s => visualWidth(s) + 4)), nh: Math.max(5, rows.length + 2), col: 0, row: 0, cols: 0, heights: [], x: 0, y: 0, w: 0, h: 0 }
  }
  const root = make(model.root),
    all = [root]
  root.nw = 0
  root.nh = 0
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!
    for (const child of p.block.children ?? []) {
      const c = make(child, p === root ? undefined : p.block.id)
      p.children.push(c)
      all.push(c)
    }
  }
  const placedBoxes = () => all
    .slice(1)
    .filter(c => c.block.type !== 'space')
    .map(c => ({ ...c, id: c.block.id, x: Math.round(c.x - c.w / 2) + 4, y: Math.round(c.y - c.h / 2) + 4, width: Math.round(c.w), height: Math.round(c.h), container: c.block.type === 'composite', headerHeight: c.head }))
  const relations: BoxRelation[] = model.edges.map(e => ({ id: e.id, from: e.start!, to: e.end!, ...(e.label ? { lines: wrapText(blockDisplayText(e.label), width ? Math.max(1, width - 8) : undefined) } : {}) }))
  // Opposing protected approaches must leave a transverse channel between
  // cells. Without it, disjoint ports can close a pocket around another exit.
  // Self-loops take nested slots beyond a card's right and bottom faces; a
  // neighbour's endpoint approach and a blank cell must still fit beyond them.
  const gap = relations.length ? Math.max(6, 2 * (BOX_ROUTE_APPROACH_DISTANCE + 1) + 1, selfLoopClearance(relations) + BOX_ROUTE_APPROACH_DISTANCE + 2) : 6
  layoutGrid(root, gap)
  let boxes = placedBoxes()
  const cells = new Map(all.map(cell => [cell.block.id, cell]))
  // Geometry determines the contacted faces. Grow before routing, then recount
  // after placement. Minimum sizes only increase and face demand is bounded by
  // the finite incident endpoints, so no retry limit can publish a small card.
  for (;;) {
    let changed = false
    const byId = new Map(boxes.map(box => [box.id, box]))
    for (const [id, demand] of boxFaceSizes(relations, 'TB', boxes)) {
      const cell = cells.get(id), box = byId.get(id)
      if (!cell || !box) continue // The route allocator diagnoses missing endpoints.
      if (box.width < demand.width) { cell.nw = Math.max(cell.nw, demand.width); changed = true }
      if (box.height < demand.height) {
        if (cell.children.length) cell.insetY = (cell.insetY ?? gap) + Math.ceil((demand.height - box.height) / 2)
        else cell.nh = Math.max(cell.nh, demand.height)
        changed = true
      }
    }
    if (!changed) break
    layoutGrid(root, gap)
    boxes = placedBoxes()
  }
  const routes = allocateBoxRoutes(boxes, relations, 'TB'),
    doc = new TerminalDocument()
  const members = new Map<string, string[]>(), edges = new Map(model.edges.map(edge => [edge.id, edge]))
  for (const box of boxes) if (box.parentId) {
    const siblings = members.get(box.parentId)
    if (siblings) siblings.push(box.id)
    else members.set(box.parentId, [box.id])
  }
  for (const box of boxes.filter(b => b.container)) {
    // Registered once: the frame paints every perimeter cell with this owner.
    const owner = doc.element({ id: box.id, kind: 'cluster', parent: box.parentId ? { id: box.parentId, kind: 'cluster' } : undefined, members: members.get(box.id) ?? [] })
    paintTerminalFrame(doc, box, owner, config.useAscii)
    if (box.block.label) doc.textBlock(box.x + 2, box.y + 1, box.lines, { owner })
  }
  for (const route of routes) {
    const edge = edges.get(route.relation.id)!,
      owner = doc.element({ id: edge.id, kind: 'edge', from: edge.start!, to: edge.end! })
    paintBoxRoute(doc, route, owner, config.useAscii, edge.pattern === 'dotted')
    for (const [end, port, type] of [
      ['start', route.source, edge.arrowTypeStart],
      ['end', route.target, edge.arrowTypeEnd],
    ] as const) {
      const shape: TerminalMarker['shape'] | undefined = type === 'arrow_point' ? 'arrow' : type === 'arrow_circle' ? 'circle' : type === 'arrow_cross' ? 'cross' : undefined,
        marker = shape ? { shape, direction: ({ T: 'B', B: 'T', L: 'R', R: 'L' } as const)[port.side], ascii: config.useAscii } : undefined
      doc.expectMarkers(owner, end, marker ? [marker] : [])
      if (marker) doc.marker(port.x, port.y, marker, { owner, role: 'arrow' })
    }
    paintBoxText(doc, route.label, owner)
  }
  for (const box of boxes.filter(b => !b.container)) {
    const owner: TerminalOwner = { id: box.id, kind: 'node', parent: box.parentId ? { id: box.parentId, kind: 'cluster' } : undefined }
    paintTerminalFrame(doc, box, owner, config.useAscii, true)
    doc.textBlock(box.x + 2, box.y + 1, box.lines, { owner })
    if (!['na', 'square'].includes(box.block.type ?? 'na')) doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `block.${box.id}.shape`, message: `Block shape ${box.block.type} is represented by a terminal frame.` })
    if (box.block.type === 'block_arrow') {
      doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `block.${box.id}.directions`, message: `Block arrow directions ${(box.block.directions ?? []).join(', ')} are written beside its terminal frame.` })
      doc.text(box.x + 1, box.y + box.height - 2, (box.block.directions ?? []).join(','), { owner, role: 'text' })
    }
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
export function renderBlockAscii(...args: Parameters<typeof renderBlockTerminal>): string {
  return serializeTerminalArtifact(renderBlockTerminal(...args))
}
