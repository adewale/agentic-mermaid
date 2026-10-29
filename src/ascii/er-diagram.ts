import { resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'
import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
// ER cards and relationship ports are allocated in integer terminal cells.
// Source semantics, complete labels and family cardinalities stay distinct.
import { parseErDiagram } from '../er/parser.ts'
import type { ErEntity, ErAttribute, Cardinality } from '../er/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, type TerminalMarker, type TerminalOwner } from './terminal-document.ts'
import { drawMultiBox } from './draw.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { displayText, normalizeBrTags } from '../multiline-utils.ts'
import { checkAllClassLikeAuthoredStyles } from '../shared/style-props.ts'
import { terminalIds } from './identity.ts'
import { paintTerminalFrame } from './terminal-geometry.ts'
import { allocateBoxRoutes, boxFaceSizes, classLikePaint, paintBoxRoute, paintBoxText, reverseBoxes, type BoxPort, type BoxRelation, type TerminalBox } from './class-like-layout.ts'

interface PlacedEntity extends TerminalBox { entity: ErEntity; sections: string[][] }
const attributeText = (attr: ErAttribute) => `${attr.keys.length ? attr.keys.join(',') : '   '} ${attr.type} ${attr.name}${attr.comment ? ` # ${attr.comment}` : ''}`

/** Family-owned crow's-foot projection, measured along the port's normal. */
function cardinalityMarkers(card: Cardinality, port: BoxPort, ascii: boolean): TerminalMarker[] {
  if (card === 'parent') return [{ shape: 'hollow-diamond', direction: port.side, ascii }]
  const marker: TerminalMarker = { shape: card === 'one' || card === 'zero-one' ? 'cardinality-one' : 'cardinality-many', direction: port.side, ascii }
  return card === 'zero-one' || card === 'zero-many' ? [marker, { shape: 'circle', ascii }] : [marker]
}

export function renderErTerminal(text: string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, targetWidth?: number): TerminalArtifact {
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const diagram = parseErDiagram(text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%')))
  diagram.title ??= config.title === undefined ? undefined : normalizeBrTags(config.title)
  const finish = (doc: TerminalDocument): TerminalArtifact => {
    if (!diagram.title) return terminalArtifact(doc, { colorMode, theme })
    const lines = wrapText(displayText(diagram.title), targetWidth)
    const titled = new TerminalDocument(Math.max(doc.width, ...lines.map(visualWidth)), doc.height ? doc.height + lines.length + 1 : lines.length)
    titled.scope({ id: 'title', kind: 'label' }, () => lines.forEach((line, row) => titled.text(Math.floor((titled.width - visualWidth(line)) / 2), row, line)))
    if (doc.height) titled.overlay(doc, 0, lines.length + 1)
    return terminalArtifact(titled, { colorMode, theme })
  }
  checkAllClassLikeAuthoredStyles(diagram.classDefs, diagram.entities)
  if (!diagram.entities.length && !diagram.groups.length) return finish(new TerminalDocument())
  const generated = terminalIds([...diagram.entities.map(entity => entity.id), ...diagram.groups.map(group => group.id)])
  const direction = diagram.direction ?? 'LR', horizontal = direction === 'LR' || direction === 'RL'
  const prepared = (value: DisplayTextInput) => wrapText(displayText(value), targetWidth ? Math.max(1, Math.floor(targetWidth / 3)) : undefined)
  const relations: BoxRelation[] = diagram.relationships.map((rel, index) => ({ id: generated(`relationship:${index}`), from: rel.entity1, to: rel.entity2, ...(rel.label ? { lines: prepared(resolveLabelContent(rel.label, rel.labelContent)) } : {}) }))
  const relationshipById = new Map<string, (typeof diagram.relationships)[number]>()
  relations.forEach((relation, index) => {
    if (!relationshipById.has(relation.id)) relationshipById.set(relation.id, diagram.relationships[index]!)
  })
  const faceSizes = boxFaceSizes(relations, direction)
  const sections = new Map(diagram.entities.map(entity => {
    const header = wrapText(displayText(resolveLabelContent(entity.label, entity.labelContent)), targetWidth ? Math.max(1, targetWidth - 8) : undefined)
    const attributes = entity.attributes.flatMap(attr => wrapText(attributeText(attr), targetWidth ? Math.max(1, targetWidth - 8) : undefined))
    return [entity.id, attributes.length ? [header, attributes] : [header]]
  }))
  const sizes = new Map(diagram.entities.map(entity => {
    const content = sections.get(entity.id)!, demand = faceSizes.get(entity.id)
    return [entity.id, { width: Math.max(4 + Math.max(0, ...content.flat().map(visualWidth)), demand?.width ?? 0), height: Math.max(content.reduce((count, section) => count + Math.max(1, section.length), 0) + content.length + 1, demand?.height ?? 0) }]
  }))
  // Preserve source order and disconnected components. The logical row/column
  // allocation changes with direction; card text and compartments never rotate.
  const adjacency = new Map(diagram.entities.map(entity => [entity.id, new Set<string>()]))
  for (const rel of relations) { adjacency.get(rel.from)?.add(rel.to); adjacency.get(rel.to)?.add(rel.from) }
  const seen = new Set<string>(), components: string[][] = []
  for (const entity of diagram.entities) {
    if (seen.has(entity.id)) continue
    const queue = [entity.id]; seen.add(entity.id)
    for (let index = 0; index < queue.length; index++) for (const next of adjacency.get(queue[index]!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next) }
    const members = new Set(queue); components.push(diagram.entities.filter(item => members.has(item.id)).map(item => item.id))
  }
  const placed = new Map<string, PlacedEntity>(), byId = new Map(diagram.entities.map(entity => [entity.id, entity]))
  const labelWidth = Math.max(0, ...relations.flatMap(rel => rel.lines ?? []).map(visualWidth)), labelHeight = Math.max(0, ...relations.map(rel => rel.lines?.length ?? 0))
  const horizontalGap = Math.max(8, labelWidth + 4), verticalGap = Math.max(8, labelHeight + 6)
  interface GroupFrame extends TerminalBox { children: Array<PlacedEntity | GroupFrame>; labelLines: string[]; parentId?: string; members: string[] }
  let groupFrames: GroupFrame[] = []
  const allocateEntities = () => {
  placed.clear()
  let componentCross = 4
  for (const component of components) {
    const perRow = Math.max(2, Math.ceil(Math.sqrt(component.length)))
    let axis = 4, cross = componentCross, rowCount = 0, rowExtent = 0, componentEnd = componentCross
    for (const id of component) {
      const entity = byId.get(id)!, size = sizes.get(id)!
      if (rowCount >= perRow) { cross += rowExtent + (horizontal ? verticalGap : horizontalGap); axis = 4; rowCount = 0; rowExtent = 0 }
      placed.set(id, { id, entity, sections: sections.get(id)!, ...size, x: horizontal ? axis : cross, y: horizontal ? cross : axis })
      axis += (horizontal ? size.width : size.height) + (horizontal ? horizontalGap : verticalGap)
      rowExtent = Math.max(rowExtent, horizontal ? size.height : size.width)
      componentEnd = Math.max(componentEnd, cross + rowExtent); rowCount++
    }
    componentCross = componentEnd + (horizontal ? verticalGap : horizontalGap)
  }
  reverseBoxes(placed.values(), direction)
  groupFrames = []
  if (diagram.groups.length) {
    const move = (box: PlacedEntity | GroupFrame, dx: number, dy: number): void => {
      box.x += dx; box.y += dy
      if ('children' in box) box.children.forEach(child => move(child, dx, dy))
    }
    const build = (id: string): GroupFrame => {
      const group = diagram.groups.find(item => item.id === id)!, labelLines = prepared(resolveLabelContent(group.label, group.labelContent))
      const frameClearance = 4, headerHeight = labelLines.length + 1
      const children: Array<PlacedEntity | GroupFrame> = [
        ...diagram.entities.filter(entity => entity.groupId === id).map(entity => placed.get(entity.id)!),
        ...diagram.groups.filter(item => item.parentId === id).map(item => build(item.id)),
      ]
      const localDirection = group.direction ?? direction, alongX = localDirection === 'LR' || localDirection === 'RL'
      const ordered = localDirection === 'RL' || localDirection === 'BT' ? [...children].reverse() : children
      let axis = alongX ? frameClearance : headerHeight + frameClearance
      for (const child of ordered) {
        const x = alongX ? axis : frameClearance, y = alongX ? headerHeight + frameClearance : axis
        move(child, x - child.x, y - child.y)
        axis += (alongX ? child.width : child.height) + 8
      }
      const size = faceSizes.get(id)
      const frame: GroupFrame = {
        id, parentId: group.parentId, children, labelLines, members: [...group.entityIds, ...children.filter(child => 'children' in child).map(child => child.id)],
        container: true, headerHeight,
        x: 0, y: 0, width: Math.max(8, ...labelLines.map(line => visualWidth(line) + 4), ...children.map(child => child.x + child.width + frameClearance), size?.width ?? 0),
        height: Math.max(labelLines.length + 4, ...children.map(child => child.y + child.height + frameClearance), size?.height ?? 0),
      }
      groupFrames.push(frame); return frame
    }
    const roots: Array<PlacedEntity | GroupFrame> = [
      ...diagram.groups.filter(group => !group.parentId).map(group => build(group.id)),
      ...diagram.entities.filter(entity => !entity.groupId).map(entity => placed.get(entity.id)!),
    ]
    const ordered = direction === 'RL' || direction === 'BT' ? [...roots].reverse() : roots
    let axis = 4
    for (const item of ordered) {
      const x = horizontal ? axis : 4, y = horizontal ? 4 : axis
      move(item, x - item.x, y - item.y); axis += (horizontal ? item.width : item.height) + 8
    }
  }
  }
  allocateEntities()
  for (let pass = 0; pass < relations.length * 2 + 2; pass++) {
    const demand = boxFaceSizes(relations, direction, [...placed.values(), ...groupFrames])
    let changed = false
    for (const [id, size] of demand) {
      const previous = faceSizes.get(id) ?? { width: 0, height: 0 }
      if (previous.width < size.width || previous.height < size.height) { faceSizes.set(id, { width: Math.max(previous.width, size.width), height: Math.max(previous.height, size.height) }); changed = true }
      const card = sizes.get(id)
      if (card && (card.width < size.width || card.height < size.height)) { card.width = Math.max(card.width, size.width); card.height = Math.max(card.height, size.height); changed = true }
    }
    if (!changed) break
    allocateEntities()
  }
  const routes = allocateBoxRoutes([...placed.values(), ...groupFrames], relations, direction), doc = new TerminalDocument()
  for (const group of [...groupFrames].reverse()) {
    const owner = doc.element({ id: group.id, kind: 'cluster', parent: group.parentId === undefined ? undefined : { id: group.parentId, kind: 'cluster' }, members: group.members })
    paintTerminalFrame(doc, group, owner, config.useAscii)
    doc.scope(owner, () => group.labelLines.forEach((line, row) => doc.text(group.x + 2, group.y + row, line)))
  }
  for (const route of routes) {
    const rel = relationshipById.get(route.relation.id)!
    const owner = doc.element({ id: route.relation.id, kind: 'edge', from: rel.entity1, to: rel.entity2 })
    paintBoxRoute(doc, route, owner, config.useAscii, !rel.identifying)
    for (const [end, port, card] of [['start', route.source, rel.cardinality1], ['end', route.target, rel.cardinality2]] as const) {
      const dx = port.side === 'L' ? -1 : port.side === 'R' ? 1 : 0, dy = port.side === 'T' ? -1 : port.side === 'B' ? 1 : 0
      const markers = cardinalityMarkers(card, port, config.useAscii)
      doc.expectMarkers(owner, end, markers)
      markers.forEach((marker, index) => doc.marker(port.x + dx * index, port.y + dy * index, marker, { owner, role: 'arrow' }))
    }
    paintBoxText(doc, route.label, owner)
  }
  for (const box of placed.values()) {
    const owner = doc.element({ id: box.id, kind: 'node', parent: box.entity.groupId === undefined ? undefined : { id: box.entity.groupId, kind: 'cluster' } })
    doc.region(owner, { x: box.x, y: box.y, width: box.width, height: box.height }); doc.fill(box.x, box.y, box.width, box.height, { owner, kind: 'surface' })
    const card = drawMultiBox(box.sections, config.useAscii, 1, { width: box.width, height: box.height })
    const style = Object.assign({}, diagram.classDefs.get('default'), ...(box.entity.className ?? '').split(/\s+/).map(name => diagram.classDefs.get(name)), box.entity.inlineStyle)
    const paint = classLikePaint(doc, 'er', box.id, style)
    for (const [, , cell] of card.entries()) { const color = cell.kind === 'text' ? paint.text : paint.stroke; if (color) cell.color = color }
    let y = 1
    box.sections.forEach((section, index) => {
      const bounds = { x: 1, y, width: box.width - 2, height: Math.max(1, section.length) }, compartment: TerminalOwner = { id: generated(`${box.id}:compartment:${index}`), kind: 'compartment', parent: { id: box.id, kind: 'node' } }
      card.attributeWithin(compartment, bounds); card.region(compartment, bounds); y += bounds.height + 1
    })
    doc.scope(owner, () => doc.overlay(card, box.x, box.y))
  }
  return finish(doc)
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderErAscii(...args: Parameters<typeof renderErTerminal>): string {
  return serializeTerminalArtifact(renderErTerminal(...args))
}
