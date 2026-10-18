import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import type { C4Body } from '../c4/types.ts'
import { TerminalDocument, measuredText, type TerminalOwner, type TerminalMarker } from './terminal-document.ts'
import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
import { prepareCellText, type CellTextBlock } from './prepared-text.ts'
import { getCorners } from './shapes/corners.ts'
import { paintTerminalRoute } from './terminal-route.ts'
import { paintTerminalFrame } from './terminal-geometry.ts'
import { allocateBoxRoutes, boxFaceSizes, paintBoxRoute, paintBoxText, type BoxRelation } from './class-like-layout.ts'
import { placeC4Boxes, type C4Box } from '../c4/placement.ts'
import { c4ElementText, c4BoundaryText, c4RelationshipText, c4SourceLine } from '../c4/projection.ts'
import { resolveC4Config, c4Appearance, effectiveC4Shape, type C4ConfigInput } from '../c4/config.ts'
import { planC4Identity } from '../c4/identity.ts'
import { tryParseCssColor, toHex } from '../shared/color-math.ts'
import { projectC4Graph } from '../c4/projection.ts'
import { c4LegendEntries } from '../c4/legend.ts'
import { visualWidth } from './width.ts'
import { assertC4DiagramWork } from '../shared/diagram-limits.ts'

/** Native cell-space C4 cards and compound frames. Neither coordinates nor
 * text lines are reconstructed from a pixel drawing or serialized SVG. */
export function renderC4Terminal(body: C4Body, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, targetWidth?: number, c4Config: C4ConfigInput = {}): TerminalArtifact {
  assertC4DiagramWork(body)
  const options = resolveC4Config(c4Config), identities = planC4Identity(body), doc = new TerminalDocument(), ascii = config.useAscii
  doc.titleHandled = true
  projectC4Graph(body, options) // shared authored paint admission for nodes and relationships
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const widthLimit = targetWidth ? Math.max(8, Math.min(options.compact ? 32 : Infinity, Math.floor(targetWidth / (options.compact ? 2 : 3)))) : options.compact ? 32 : 42
  const prepare = (value: string) => prepareCellText(value, { display: 'literal', maxWidth: c4Config.wrap === false ? undefined : widthLimit })
  const blocks = new Map<string, CellTextBlock>(), sizes = new Map<string, C4Box>()
  const relations: BoxRelation[] = body.relationships.map(item => ({ id: identities.relationships.get(item.id)!, from: item.source, to: item.target, lines: prepare(c4RelationshipText(body, item)).lines }))
  const direction = body.layout.direction ?? body.layout.hints[0]?.direction ?? body.relationships.find(item => item.direction)?.direction ?? 'LR'
  const demand = boxFaceSizes(relations, direction)
  for (const item of body.elements) {
    const block = prepare(c4ElementText(item)), face = demand.get(item.id), shape = effectiveC4Shape(item), glyph = shape === 'person' ? 3 : shape === 'database' ? 2 : 0
    blocks.set(item.id, block)
    sizes.set(item.id, { id: item.id, x: 0, y: 0, width: Math.max(block.width + (shape === 'queue' ? 8 : 4), face?.width ?? 0, 12), height: Math.max(block.height + 2 + glyph, face?.height ?? 0, 5) })
  }
  for (const item of body.boundaries) {
    const block = prepare(c4BoundaryText(item)), face = demand.get(item.id), headerHeight = block.height + 2
    blocks.set(item.id, block)
    sizes.set(item.id, { id: item.id, x: 0, y: 0, width: Math.max(block.width + 4, face?.width ?? 0, 14), height: Math.max(headerHeight + 8, (face?.height ?? 0) + headerHeight * 2), container: true, headerHeight })
  }
  const title = body.title ?? config.title, titleBlock = title === undefined ? undefined : prepare(title)
  const margin = options.compact ? 2 : 5, padding = options.compact ? 3 : 5
  const gapX = Math.max(options.compact ? 6 : 10, ...relations.map(item => Math.max(0, ...(item.lines ?? []).map(visualWidth)) + (options.compact ? 4 : 6)))
  const gapY = Math.max(options.compact ? 4 : 6, ...relations.map(item => (item.lines?.length ?? 0) + (options.compact ? 3 : 6)))
  // Row packing uses measured cell boxes. A pixel viewport never becomes a
  // terminal width; only the caller's terminal budget limits these columns.
  const columns = options.compact && targetWidth && (direction === 'LR' || direction === 'RL')
    ? Math.max(1, Math.floor((targetWidth - margin * 2 + gapX) / (Math.max(1, ...[...sizes.values()].filter(box => !box.container).map(box => box.width)) + gapX))) : options.shapesPerRow
  const placementOptions = { gapX, gapY, padding, marginX: margin, marginY: margin + (titleBlock?.height ?? 0), shapesPerRow: body.layout.shapesPerRow ?? (options.input.c4ShapeInRow === undefined ? Math.min(options.shapesPerRow, columns) : options.shapesPerRow), boundariesPerRow: body.layout.boundariesPerRow ?? options.boundariesPerRow, direction }
  let placement = placeC4Boxes(body, sizes, placementOptions)
  // Recount the actual faces after constrained placement. Distinct parallel
  // contacts are allocated before painting, including self and boundary edges.
  for (let pass = 0; pass < relations.length * 2 + 2; pass++) {
    let changed = false
    for (const [id, face] of boxFaceSizes(relations, direction, [...placement.boxes.values()])) {
      const size = sizes.get(id); if (!size) continue
      const width = Math.max(size.width, face.width), height = Math.max(size.height, face.height + (size.container ? (size.headerHeight ?? 0) * 2 : 0))
      if (width > size.width || height > size.height) { size.width = width; size.height = height; changed = true }
    }
    if (!changed) break
    placement = placeC4Boxes(body, sizes, placementOptions)
  }
  const routes = allocateBoxRoutes([...placement.boxes.values()], relations, direction)
  const owner = (item: typeof body.elements[number] | typeof body.boundaries[number]): TerminalOwner => ({ id: identities.nodes.get(item.id)!, kind: 'external' in item ? 'node' : 'cluster', sourceLine: c4SourceLine(body, item.statementId), ...(item.parentId ? { parent: { id: item.parentId, kind: 'cluster' as const } } : {}), ...(!('external' in item) ? { members: [...body.elements, ...body.boundaries].filter(child => child.parentId === item.id).map(child => child.id) } : {}) })
  const color = (value: string | undefined) => { const parsed = value ? tryParseCssColor(value) : undefined; return parsed ? toHex(parsed[0], parsed[1], parsed[2]) : undefined }
  const styleFrame = (item: typeof body.elements[number] | typeof body.boundaries[number], itemOwner: TerminalOwner) => {
    const appearance = c4Appearance(item, options), stroke = color(appearance.stroke), textColor = color(appearance.text)
    for (const [x, y, cell] of [...doc.entries()]) if (cell.owners.some(value => value.id === itemOwner.id && value.kind === itemOwner.kind)) {
      if (cell.kind === 'text' && textColor) cell.color = textColor
      else if (cell.stroke) { if (stroke) cell.color = stroke; if (appearance.dashed) doc.stroke(x, y, cell.stroke.mask, { owner: itemOwner, role: 'border', ascii, style: item.style.lineStyle === 'dotted' ? 'dotted' : 'dashed', color: stroke }) }
    }
    if (appearance.fill) doc.report({ code: 'TERMINAL_FILL_PROJECTED', feature: `c4.${item.id}.fill`, message: `C4 fill ${appearance.fill} on ${item.id} is represented by an unfilled terminal card; its semantic type remains in the label.` })
    if (appearance.fontSize || appearance.fontWeight || appearance.fontFamily) doc.report({ code: 'TERMINAL_TYPOGRAPHY_PROJECTED', feature: `c4.${item.id}.font`, message: `C4 typography on ${item.id} uses terminal character cells.` })
  }
  const header = (id: string, itemOwner: TerminalOwner, alignment?: 'left' | 'right', top?: number) => {
    const box = placement.boxes.get(id)!, block = blocks.get(id)!
    const x = alignment === 'left' ? box.x + 2 : alignment === 'right' ? box.x + box.width - 2 - block.width : box.x + Math.floor((box.width - block.width) / 2)
    if (alignment) block.lines.forEach((line, index) => doc.textBlock(alignment === 'left' ? box.x + 2 : box.x + box.width - 2 - visualWidth(line), (top ?? box.y + 1) + index, measuredText(line), { owner: itemOwner, role: 'text', textGroup: `${itemOwner.id}:header` }))
    else doc.textBlock(x, top ?? box.y + 1, measuredText(block.lines), { owner: itemOwner, role: 'text' })
  }
  // Frames are transparent compound geometry. Parent and immediate member
  // metadata comes from the model, never from inferred coordinate containment.
  const depth = (id: string): number => { let at = body.boundaries.find(item => item.id === id), count = 0; const seen = new Set<string>(); while (at?.parentId && !seen.has(at.id)) { seen.add(at.id); count++; at = body.boundaries.find(item => item.id === at!.parentId) }; return count }
  for (const item of [...body.boundaries].sort((a, b) => depth(a.id) - depth(b.id))) {
    const box = placement.boxes.get(item.id)!, itemOwner = doc.element(owner(item))
    paintTerminalFrame(doc, box, itemOwner, ascii)
    const y = box.y + box.headerHeight! - 1
    for (let x = box.x + 1; x < box.x + box.width - 1; x++) doc.stroke(x, y, 10, { owner: itemOwner, role: 'border', ascii })
    header(item.id, itemOwner, item.alignment); styleFrame(item, itemOwner)
  }
  for (const route of routes) {
    const item = body.relationships.find(item => item.id === route.relation.id)!, edgeOwner = doc.element({ id: item.id, kind: 'edge', from: item.source, to: item.target, sourceLine: c4SourceLine(body, item.statementId) })
    if (item.style.lineStyle === 'dotted') { if (!paintTerminalRoute(doc, route.path, edgeOwner, ascii, 'dotted')) throw new Error(`Allocated C4 route ${item.id} conflicts with admitted geometry`) }
    else paintBoxRoute(doc, route, edgeOwner, ascii, item.style.lineStyle === 'dashed')
    for (const [end, port, enabled] of [['start', route.source, item.bidirectional], ['end', route.target, true]] as const) {
      const marker: TerminalMarker | undefined = enabled ? { shape: 'arrow', direction: ({ T: 'B', R: 'L', B: 'T', L: 'R' } as const)[port.side], ascii } : undefined
      doc.expectMarkers(edgeOwner, end, marker ? [marker] : [])
      if (marker) doc.marker(port.x, port.y, marker, { owner: edgeOwner, role: 'arrow', color: color(item.style.lineColor) })
    }
    paintBoxText(doc, route.label, edgeOwner)
    for (const [, , cell] of doc.entries()) if (cell.owners.some(value => value.id === item.id && value.kind === 'edge')) { const paint = color(cell.kind === 'text' ? item.style.textColor : item.style.lineColor); if (paint) cell.color = paint }
  }
  for (const item of body.elements) {
    const box = placement.boxes.get(item.id)!, itemOwner = doc.element(owner(item)), shape = effectiveC4Shape(item)
    paintTerminalFrame(doc, box, itemOwner, ascii, true)
    let y = box.y + Math.floor((box.height - blocks.get(item.id)!.height) / 2)
    if (shape === 'person') {
      const x = box.x + Math.floor(box.width / 2)
      for (const [dy, line] of [' O ', '/|\\', '/ \\'].entries()) for (const [dx, glyph] of [...line].entries()) if (glyph !== ' ') doc.put(x - 1 + dx, box.y + 1 + dy, glyph, { owner: itemOwner, role: 'border', kind: 'mark' })
      y = box.y + 4
    } else if (shape === 'database') {
      // Reuse the terminal cylinder vocabulary: rounded/quoted ends and two
      // rims, with every cell still owned by this authored database card.
      const corners = getCorners('cylinder', ascii)
      for (const [x, row, mask, glyph] of [[box.x, box.y, 6, corners.tl], [box.x + box.width - 1, box.y, 12, corners.tr], [box.x, box.y + box.height - 1, 3, corners.bl], [box.x + box.width - 1, box.y + box.height - 1, 9, corners.br]] as const) {
        if (ascii) doc.put(x, row, glyph, { owner: itemOwner, role: 'border', kind: 'mark' })
        else doc.stroke(x, row, mask, { owner: itemOwner, role: 'border', ascii, rounded: true })
      }
      for (const row of [box.y + 1, box.y + box.height - 2]) for (let x = box.x + 1; x < box.x + box.width - 1; x++) doc.stroke(x, row, 10, { owner: itemOwner, role: 'border', ascii })
      y = box.y + 2
    } else if (shape === 'queue') {
      for (const x of [box.x + 2, box.x + box.width - 3]) for (let row = box.y + 1; row < box.y + box.height - 1; row++) doc.stroke(x, row, 5, { owner: itemOwner, role: 'border', ascii })
    }
    header(item.id, itemOwner, undefined, y); styleFrame(item, itemOwner)
  }
  if (titleBlock) doc.textBlock(5, 1, measuredText(titleBlock.lines), { owner: { id: identities.generated('c4:title', ['c4', 'title']), kind: 'label' }, role: 'text' })
  for (const field of ['diagramMarginX', 'diagramMarginY', 'c4ShapeMargin', 'c4ShapePadding', 'width', 'height', 'boxMargin', 'nextLinePaddingX', 'wrapPadding', 'maxWidth']) if (c4Config[field] !== undefined) doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `c4.config.${field}`, message: `C4 ${field} is a pixel dimension; terminal layout independently allocates measured character cells.` })
  const legend = c4LegendEntries(body, options)
  if (legend.length) {
    const top = doc.height + 2
    doc.textBlock(5, top, measuredText('Legend'), { owner: { id: identities.generated('c4:legend:title', ['c4', 'legend', 'title']), kind: 'label' }, role: 'text' })
    let y = top + 2
    for (const entry of legend) { const block = prepare(`${entry.kind === 'relationship' ? '->' : '[]'} ${entry.label}`); doc.textBlock(5, y, measuredText(block.lines), { owner: { id: entry.id, kind: 'label' }, role: 'text' }); y += block.height + 1 }
  }
  for (const item of body.relationships) if (item.style.offsetX !== undefined || item.style.offsetY !== undefined) doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `c4.${item.id}.label-offset`, message: `C4 relationship ${item.id} pixel label offsets are retained in the model; terminal labels use independent collision-free cell allocation.` })
  for (const diagnostic of [...body.diagnostics, ...placement.diagnostics]) doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: diagnostic.code, message: diagnostic.message })
  return terminalArtifact(doc, { colorMode, theme })
}
