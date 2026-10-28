import { prepareClassConstruction, compactClassRoutesDecision, classLinkFooterText, type ClassConstruction } from './class-constructive-layout.ts'
// Class layout keeps integer cards, endpoint demand and label rectangles
// authoritative before emitting owned terminal primitives.
import { classRelationshipLineStyle, parseClassDiagram } from '../class/parser.ts'
import { memberToString } from '../class/text.ts'
import type { ClassNamespace, ClassNode, RelationshipType } from '../class/types.ts'
import { displayText, normalizeBrTags } from '../multiline-utils.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { type DisplayTextInput, resolveLabelContent } from '../shared/display-text.ts'
import { checkAllClassLikeAuthoredStyles } from '../shared/style-props.ts'
import { allocateBoxRoutes, allocateConstructiveClassRoutes, TerminalBoxRouteUnavailable, type BoxRoute, BOX_ROUTE_APPROACH_DISTANCE, type BoxRelation, type BoxSide, boxFaceDemands, boxFaceSizes, classLikePaint, paintBoxRoute, paintBoxText, reverseBoxes, type TerminalBox } from './class-like-layout.ts'
import { drawMultiBox } from './draw.ts'
import { terminalIds } from './identity.ts'
import { serializeTerminalArtifact, type TerminalArtifact, terminalArtifact } from './terminal-artifact.ts'
import { TerminalDocument, type TerminalMarker, type TerminalOwner } from './terminal-document.ts'
import { faceSize, paintTerminalFrame } from './terminal-geometry.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'

interface PlacedClass extends TerminalBox {
  cls: ClassNode
  sections: string[][]
}
interface PlacedNamespace extends TerminalBox {
  labelLines: string[]
  parentId?: string
  members: string[]
  depth: number
}

function classSections(cls: ClassNode, width?: number): string[][] {
  const header = [...(cls.annotation === undefined ? [] : wrapText(`<<${cls.annotation}>>`, width)), ...wrapText(displayText(resolveLabelContent(cls.label, cls.labelContent)), width)]
  const attrs = cls.attributes.flatMap(member => wrapText(memberToString(member), width))
  const methods = cls.methods.flatMap(member => wrapText(memberToString(member), width))
  return methods.length ? [header, attrs, methods] : attrs.length ? [header, attrs] : [header]
}

function classMarker(type: RelationshipType, side: BoxSide, ascii: boolean): TerminalMarker | undefined {
  if (type === 'link-solid' || type === 'link-dashed') return undefined
  const shape = type === 'inheritance' || type === 'realization' ? 'open-arrow' : type === 'composition' ? 'filled-diamond' : type === 'aggregation' ? 'hollow-diamond' : type === 'lollipop' ? 'lollipop' : 'triangle'
  return { shape, direction: ({ T: 'B', B: 'T', L: 'R', R: 'L' } as const)[side], ascii }
}

export function renderClassTerminal(text: string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, targetWidth?: number, authoredText?: string): TerminalArtifact {
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const lines = (value: string) =>
    value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('%%'))
  const diagram = parseClassDiagram(lines(text), authoredText === undefined ? undefined : lines(authoredText))
  diagram.title ??= config.title
  checkAllClassLikeAuthoredStyles(diagram.classDefs, diagram.classes)
  if (!diagram.classes.length && !diagram.namespaces.length && !diagram.notes.length) {
    const lines = diagram.title ? wrapText(displayText(normalizeBrTags(diagram.title)), targetWidth) : []
    const empty = new TerminalDocument(Math.max(0, ...lines.map(visualWidth)), lines.length)
    empty.scope({ id: 'title', kind: 'label' }, () => lines.forEach((line, row) => empty.text(0, row, line)))
    return terminalArtifact(empty, { colorMode, theme })
  }
  const namespaceIds = (items: ClassNamespace[], parent = ''): string[] =>
    items.flatMap(item => {
      const id = parent ? `${parent}.${item.name}` : item.name
      return [id, ...namespaceIds(item.children, id)]
    })
  const generated = terminalIds([...diagram.classes.map(cls => cls.id), ...namespaceIds(diagram.namespaces)])
  const direction = diagram.direction ?? 'TB',
    horizontal = direction === 'LR' || direction === 'RL'
  const prepared = (value: DisplayTextInput) => wrapText(displayText(value), targetWidth ? Math.max(1, Math.floor(targetWidth / 3)) : undefined)
  const relations: BoxRelation[] = diagram.relationships.map((rel, index) => ({
    id: generated(`relationship:${index}`),
    from: rel.from,
    to: rel.to,
    ...(rel.label ? { lines: prepared(resolveLabelContent(rel.label, rel.labelContent)) } : {}),
    ...(rel.fromCardinality ? { fromLines: prepared(resolveLabelContent(rel.fromCardinality, rel.fromCardinalityContent)) } : {}),
    ...(rel.toCardinality ? { toLines: prepared(resolveLabelContent(rel.toCardinality, rel.toCardinalityContent)) } : {}),
  }))
  const relationshipById = new Map<string, (typeof diagram.relationships)[number]>()
  relations.forEach((relation, index) => {
    if (!relationshipById.has(relation.id)) relationshipById.set(relation.id, diagram.relationships[index]!)
  })
  const notePlans = diagram.notes.map((note, index) => ({ id: generated(`note:${index}`), targetId: note.for, lines: wrapText(displayText(resolveLabelContent(note.text, note.textContent)), targetWidth ? Math.max(1, targetWidth - 8) : undefined) }))
  const noteRelations: BoxRelation[] = notePlans.flatMap(note => (note.targetId ? [{ id: generated(`${note.id}:connector`), from: note.targetId, to: note.id }] : []))
  const faceSizes = boxFaceSizes([...relations, ...noteRelations], direction)
  const sections = new Map(diagram.classes.map(cls => [cls.id, classSections(cls, targetWidth ? Math.max(1, targetWidth - 8) : undefined)]))
  const sizes = new Map(
    diagram.classes.map(cls => {
      const content = sections.get(cls.id)!,
        demand = faceSizes.get(cls.id)
      return [
        cls.id,
        {
          width: Math.max(4 + Math.max(0, ...content.flat().map(visualWidth)), demand?.width ?? 0),
          height: Math.max(content.reduce((count, section) => count + Math.max(1, section.length), 0) + content.length + 1, demand?.height ?? 0),
        },
      ]
    }),
  )
  const children = new Map<string, Set<string>>(),
    parents = new Map<string, Set<string>>()
  for (const rel of diagram.relationships) {
    if (rel.from === rel.to) continue
    const inherited = rel.type === 'inheritance' || rel.type === 'realization'
    const parent = inherited && rel.markerAt === 'to' ? rel.to : rel.from
    const child = inherited && rel.markerAt === 'to' ? rel.from : rel.to
    const outgoing = children.get(parent) ?? new Set<string>()
    outgoing.add(child)
    children.set(parent, outgoing)
    const incoming = parents.get(child) ?? new Set<string>()
    incoming.add(parent)
    parents.set(child, incoming)
  }
  const level = new Map<string, number>(),
    queue = diagram.classes.filter(cls => !parents.has(cls.id)).map(cls => cls.id)
  queue.forEach(id => level.set(id, 0))
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!
    for (const child of children.get(id) ?? []) {
      const next = level.get(id)! + 1
      if (next >= diagram.classes.length || (level.get(child) ?? -1) >= next) continue
      level.set(child, next)
      queue.push(child)
    }
  }
  let cycleLevel = Math.max(-1, ...level.values()) + 1
  for (const cls of diagram.classes) if (!level.has(cls.id)) level.set(cls.id, cycleLevel++)
  const placed = new Map<string, PlacedClass>()
  // Each exterior approach occupies distance+1 blank cells. Opposing faces
  // need one additional free row/column between those protected approaches.
  const minimumRoutingGap = 2 * (BOX_ROUTE_APPROACH_DISTANCE + 1) + 1
  let routingGapPromoted = false
  const allocateCards = () => {
    placed.clear()
    let axis = 4
    const mainGap = Math.max(8, routingGapPromoted ? minimumRoutingGap : 0, ...relations.flatMap(rel => [rel.lines?.length ?? 0, rel.fromLines?.length ?? 0, rel.toLines?.length ?? 0]).map(count => count + 6))
    for (let index = 0; index <= Math.max(0, ...level.values()); index++) {
      let cross = 4,
        extent = 0
      for (const cls of diagram.classes.filter(item => (level.get(item.id) ?? 0) === index)) {
        const size = sizes.get(cls.id)!
        placed.set(cls.id, { id: cls.id, cls, sections: sections.get(cls.id)!, x: horizontal ? axis : cross, y: horizontal ? cross : axis, ...size })
        cross += (horizontal ? size.height : size.width) + (routingGapPromoted ? minimumRoutingGap : 6)
        extent = Math.max(extent, horizontal ? size.width : size.height)
      }
      axis += extent + mainGap
    }
    reverseBoxes(placed.values(), direction)
  }
  allocateCards()
  // Inheritance and feedback links may run against source direction. Recount
  // the physical faces after allocation, then grow/reflow only where needed.
  for (let pass = 0; pass < (relations.length + noteRelations.length) * 2 + 2; pass++) {
    let noteY = Math.max(0, ...[...placed.values()].map(box => box.y + box.height)) + 8
    const notes = notePlans.map(note => {
      const target = note.targetId ? placed.get(note.targetId) : undefined
      const box = { id: note.id, x: target?.x ?? 4, y: noteY, width: Math.max(6, ...note.lines.map(line => visualWidth(line) + 4)), height: note.lines.length + 2 }
      noteY += box.height + 4
      return box
    })
    const demand = boxFaceSizes([...relations, ...noteRelations], direction, [...placed.values(), ...notes])
    let changed = false
    for (const [id, size] of demand) {
      const previous = faceSizes.get(id) ?? { width: 0, height: 0 }
      faceSizes.set(id, { width: Math.max(previous.width, size.width), height: Math.max(previous.height, size.height) })
      const card = sizes.get(id)
      if (card && (card.width < size.width || card.height < size.height)) {
        card.width = Math.max(card.width, size.width)
        card.height = Math.max(card.height, size.height)
        changed = true
      }
    }
    if (!changed) break
    allocateCards()
  }
  const namespaceByClass = new Map<string, string>(),
    namespaces: PlacedNamespace[] = []
  const allocateNamespaces = (): void => {
    namespaceByClass.clear()
    namespaces.length = 0
    if (diagram.namespaces.length) {
      const header = (ns: ClassNamespace) => prepared(ns.labelContent?.value === (ns.label ?? ns.name) ? ns.labelContent.prepared : normalizeBrTags(ns.label ?? ns.name))
      // Keep normal port approaches and a free routing row inside each frame.
      const frameClearance = 4
      const depthOf = (items: ClassNamespace[], depth = 1): number => Math.max(depth, ...items.map(ns => depthOf(ns.children, depth + 1)))
      const headerHeight = (items: ClassNamespace[]): number => Math.max(1, ...items.flatMap(ns => [header(ns).length, headerHeight(ns.children)]))
      const inset = depthOf(diagram.namespaces) * (headerHeight(diagram.namespaces) + frameClearance)
      for (const box of placed.values()) {
        box.x += inset
        box.y += inset
      }
      let emptyY = Math.max(4, ...[...placed.values()].map(box => box.y + box.height + 4))
      const visit = (ns: ClassNamespace, parentId?: string, depth = 1): PlacedNamespace | undefined => {
        const id = parentId ? `${parentId}.${ns.name}` : ns.name
        ns.classIds.forEach(member => namespaceByClass.set(member, id))
        const children = ns.children.map(child => visit(child, id, depth + 1)).filter((child): child is PlacedNamespace => child !== undefined)
        const members = ns.classIds.map(member => placed.get(member)).filter((member): member is PlacedClass => member !== undefined)
        const bounds = [...children, ...members]
        const labelLines = header(ns)
        if (!bounds.length) {
          const empty: PlacedNamespace = { id, parentId, depth, members: [], labelLines, x: 4, y: emptyY, width: Math.max(6, ...labelLines.map(line => visualWidth(line) + 4)), height: labelLines.length + 3 }
          emptyY += empty.height + 4
          namespaces.push(empty)
          return empty
        }
        const x = Math.min(...bounds.map(box => box.x)) - frameClearance,
          y = Math.min(...bounds.map(box => box.y)) - labelLines.length - frameClearance
        const right = Math.max(...bounds.map(box => box.x + box.width + frameClearance - 1), x + Math.max(...labelLines.map(visualWidth)) + 4)
        const bottom = Math.max(...bounds.map(box => box.y + box.height + frameClearance - 1))
        const frame: PlacedNamespace = { id, parentId, depth, members: [...ns.classIds, ...children.map(child => child.id)], labelLines, x, y, width: right - x + 1, height: bottom - y + 1 }
        namespaces.push(frame)
        return frame
      }
      diagram.namespaces.forEach(ns => visit(ns))
      // Header growth can make independently placed sibling namespaces overlap.
      // Settle their complete envelopes, moving each contained subtree together.
      const move = (box: PlacedClass | PlacedNamespace, dy: number): void => {
        box.y += dy
        if ('members' in box) {
          namespaces.filter(child => child.parentId === box.id).forEach(child => move(child, dy))
          for (const child of placed.values()) if (namespaceByClass.get(child.id) === box.id) move(child, dy)
        }
      }
      const settle = (parentId?: string): void => {
        const children = [...namespaces.filter(box => box.parentId === parentId), ...[...placed.values()].filter(box => namespaceByClass.get(box.id) === parentId)]
        for (const child of children) if ('members' in child) settle(child.id)
        const allocated: Array<PlacedClass | PlacedNamespace> = []
        for (const child of children.sort((a, b) => a.y - b.y || a.x - b.x || compareCodePointStrings(a.id, b.id))) {
          const separation = (other: PlacedClass | PlacedNamespace) => (routingGapPromoted && !('members' in child) && !('members' in other) ? Math.max(frameClearance, minimumRoutingGap) : frameClearance)
          for (;;) {
            const blockers = allocated.filter(other => child.x < other.x + other.width + separation(other) && other.x < child.x + child.width + separation(other) && child.y < other.y + other.height + separation(other) && other.y < child.y + child.height + separation(other))
            if (!blockers.length) break
            move(child, Math.max(...blockers.map(other => other.y + other.height + separation(other))) - child.y)
          }
          allocated.push(child)
        }
        const parent = namespaces.find(box => box.id === parentId)
        if (parent && children.length) {
          parent.x = Math.min(...children.map(box => box.x)) - frameClearance
          parent.y = Math.min(...children.map(box => box.y)) - parent.labelLines.length - frameClearance
          parent.width = Math.max(...children.map(box => box.x + box.width + frameClearance), parent.x + Math.max(...parent.labelLines.map(visualWidth)) + 4) - parent.x
          parent.height = Math.max(...children.map(box => box.y + box.height + frameClearance)) - parent.y
        }
      }
      settle()
      // Empty nested frames can extend above or left of the first allocated
      // child. Translate the complete layout before terminal coordinates/routing.
      const boxes = [...placed.values(), ...namespaces]
      const dx = Math.max(0, -Math.min(0, ...boxes.map(box => box.x)))
      const dy = Math.max(0, -Math.min(0, ...boxes.map(box => box.y)))
      if (dx || dy)
        for (const box of boxes) {
          box.x += dx
          box.y += dy
        }
    }
  }
  const allocateNotes = () => {
    let noteY = Math.max(0, ...[...placed.values()].map(box => box.y + box.height), ...namespaces.map(box => box.y + box.height)) + Math.max(8, routingGapPromoted ? minimumRoutingGap : 0)
    return notePlans.map(note => {
      const size = faceSizes.get(note.id),
        target = note.targetId ? placed.get(note.targetId) : undefined
      const box = { ...note, x: target?.x ?? 2, y: noteY, width: Math.max(6, ...note.lines.map(line => visualWidth(line) + 4), size?.width ?? 0), height: Math.max(note.lines.length + 2, size?.height ?? 0) }
      noteY += box.height + (routingGapPromoted ? minimumRoutingGap : 4)
      return box
    })
  }
  let noteBoxes: ReturnType<typeof allocateNotes> = []
  // Namespace packing can change a relation's physical faces after the first
  // rank allocation. Recount those settled faces, including actual note sizes.
  // Every growth reaches a new 3*k+2 threshold, k <= endpoint incident degree.
  // Two dimensions and two endpoints per relation permit at most 4R growths,
  // followed by at most one promotion of the render's routing separation.
  const maximumGrowths = (relations.length + noteRelations.length) * 4 + 1
  for (let pass = 0; pass <= maximumGrowths; pass++) {
    allocateNamespaces()
    noteBoxes = allocateNotes()
    const boxes = [...placed.values(), ...noteBoxes]
    const byId = new Map(boxes.map(box => [box.id, box]))
    const demand = boxFaceDemands([...relations, ...noteRelations], direction, byId)
    let changed = false
    for (const [id, count] of demand) {
      const size = faceSize(count)
      const previous = faceSizes.get(id) ?? { width: 0, height: 0 }
      faceSizes.set(id, { width: Math.max(previous.width, size.width), height: Math.max(previous.height, size.height) })
      const box = byId.get(id)
      if (!box || (box.width >= size.width && box.height >= size.height)) continue
      const card = sizes.get(id)
      if (card) {
        card.width = Math.max(card.width, size.width)
        card.height = Math.max(card.height, size.height)
      }
      changed = true
    }
    if (!changed && !routingGapPromoted) {
      const deficient = (a: TerminalBox, b: TerminalBox): boolean => {
        const first = demand.get(a.id),
          second = demand.get(b.id)
        if (!first || !second) return false
        const verticalGap = b.y - a.y - a.height,
          horizontalGap = b.x - a.x - a.width
        return (first.B > 0 && second.T > 0 && verticalGap >= 0 && verticalGap < minimumRoutingGap && a.x < b.x + b.width && b.x < a.x + a.width) || (first.R > 0 && second.L > 0 && horizontalGap >= 0 && horizontalGap < minimumRoutingGap && a.y < b.y + b.height && b.y < a.y + a.height)
      }
      for (let first = 0; first < boxes.length && !routingGapPromoted; first++)
        for (let second = first + 1; second < boxes.length; second++) {
          if (!deficient(boxes[first]!, boxes[second]!) && !deficient(boxes[second]!, boxes[first]!)) continue
          routingGapPromoted = true
          changed = true
          break
        }
    }
    if (!changed) break
    if (pass === maximumGrowths) throw new Error('Terminal face capacity did not stabilize within its incident demand')
    // Rebuild from rank coordinates; retaining translated namespace members
    // would accumulate offsets and leave frame/header/note geometry stale.
    allocateCards()
  }
  // Select one complete layout before painting. An invalid compact route is
  // not published and never consumes/restarts a certification budget.
  let routes: BoxRoute[] = [],
    construction: ClassConstruction | undefined
  const allRelations = [...relations, ...noteRelations],
    boxes = [...placed.values(), ...noteBoxes]
  let compactIssue: string | undefined
  try {
    routes = allocateBoxRoutes(
      boxes,
      allRelations,
      direction,
      namespaces.map(box => ({ ...box, container: true, headerHeight: box.labelLines.length })),
    )
    const decision = compactClassRoutesDecision(routes, boxes, namespaces, namespaceByClass)
    // UNKNOWN preserves the original compact drawing for the one final certifier.
    if (decision.status === 'invalid') compactIssue = decision.reason
  } catch (error) {
    if (!(error instanceof TerminalBoxRouteUnavailable)) throw error
    compactIssue = error.message
  }
  if (compactIssue) {
    const titleLines = diagram.title ? wrapText(displayText(normalizeBrTags(diagram.title)), targetWidth) : []
    construction = prepareClassConstruction(placed, namespaces, noteBoxes, namespaceByClass, allRelations, direction, titleLines, targetWidth, relations.length)
    routes = allocateConstructiveClassRoutes(construction)
  }
  const doc = new TerminalDocument()
  if (construction) doc.reserveTerminalPathWitnessWork(construction.report.planningWork)
  const ascii = config.useAscii
  const frame = (box: TerminalBox, owner: TerminalOwner, opaque = false) => paintTerminalFrame(doc, box, owner, ascii, opaque)
  for (const box of namespaces.sort((a, b) => a.depth - b.depth || compareCodePointStrings(a.id, b.id))) {
    const owner = doc.element({ id: box.id, kind: 'cluster', parent: box.parentId === undefined ? undefined : { id: box.parentId, kind: 'cluster' }, members: box.members })
    frame(box, owner)
    doc.scope(owner, () => box.labelLines.forEach((line, row) => doc.text(box.x + Math.max(1, Math.floor((box.width - visualWidth(line) - 2) / 2)), box.y + row, ` ${line} `)))
  }
  for (const route of routes) {
    const rel = relationshipById.get(route.relation.id)
    if (!rel) {
      const owner = { id: route.relation.id, kind: 'edge' as const, route: 'connected' as const, from: route.relation.from, to: route.relation.to }
      paintBoxRoute(doc, route, owner, ascii)
      doc.expectMarkers(owner, 'start', [])
      doc.expectMarkers(owner, 'end', [])
      continue
    }
    const owner = doc.element({ id: route.relation.id, kind: 'edge', route: 'connected', from: rel.from, to: rel.to })
    paintBoxRoute(doc, route, owner, ascii, classRelationshipLineStyle(rel) === 'dashed')
    for (const [end, port, type, enabled] of [
      ['start', route.source, rel.fromType ?? rel.type, rel.markerAt === 'from' || rel.markerAt === 'both'],
      ['end', route.target, rel.toType ?? rel.type, rel.markerAt === 'to' || rel.markerAt === 'both'],
    ] as const) {
      const marker = enabled ? classMarker(type, port.side, ascii) : undefined
      doc.expectMarkers(owner, end, marker ? [marker] : [])
      if (marker) doc.marker(port.x, port.y, marker, { owner, role: 'arrow' })
    }
    paintBoxText(doc, route.label, owner)
    paintBoxText(doc, route.fromLabel, { id: generated(`${owner.id}:from-cardinality`), kind: 'label', parent: { id: owner.id, kind: 'edge' } })
    paintBoxText(doc, route.toLabel, { id: generated(`${owner.id}:to-cardinality`), kind: 'label', parent: { id: owner.id, kind: 'edge' } })
  }
  for (const box of placed.values()) {
    const owner = doc.element({ id: box.id, kind: 'node', parent: namespaceByClass.has(box.id) ? { id: namespaceByClass.get(box.id)!, kind: 'cluster' } : undefined })
    if (box.cls.isInterface) {
      doc.resize(box.x + box.width, box.y + box.height) // Preserve the caption's allocated canvas, independently of its physical surface.
      // An unboxed interface's visible surface is its lollipop, not the
      // invisible rectangle used to pack its caption. Keep that caption and
      // every authored endpoint unchanged, and attribute only admitted ink.
      const route = routes.find(route => route.relation.from === box.id || route.relation.to === box.id)
      const relation = route && relationshipById.get(route.relation.id)
      const start = route?.relation.from === box.id
      const port = route && (start ? route.source : route.target)
      const enabled = relation && (relation.markerAt === 'both' || relation.markerAt === (start ? 'from' : 'to'))
      const expected = relation && port && enabled ? classMarker((start ? relation.fromType : relation.toType) ?? relation.type, port.side, ascii) : undefined
      const cell = port && doc.cell(port.x, port.y)
      if (
        route &&
        port &&
        expected?.shape === 'lollipop' &&
        cell?.kind === 'marker' &&
        cell.head === port.x &&
        cell.marker?.shape === expected.shape &&
        cell.marker.direction === expected.direction &&
        cell.owners.some(candidate => candidate.kind === 'edge' && candidate.id === route.relation.id) &&
        cell.owners.every(candidate => candidate.kind !== 'edge' || candidate.id === route.relation.id)
      ) {
        const surface = { x: port.x, y: port.y, width: cell.width, height: 1 }
        doc.region(owner, surface)
        doc.attributeWithin(owner, surface)
      } else doc.region(owner, { x: box.x, y: box.y, width: box.width, height: box.height }) // Missing ink still fails the unchanged final checks.
      const lines = box.sections[0] ?? []
      const top = box.y + Math.floor((box.height - lines.length) / 2)
      lines.forEach((line, index) => doc.text(box.x + Math.floor((box.width - visualWidth(line)) / 2), top + index, line, { owner }))
      continue
    }
    doc.region(owner, { x: box.x, y: box.y, width: box.width, height: box.height })
    doc.fill(box.x, box.y, box.width, box.height, { owner, kind: 'surface' })
    const card = drawMultiBox(box.sections, ascii, 1, { width: box.width, height: box.height })
    const style = Object.assign({}, diagram.classDefs.get('default'), ...(box.cls.className ?? '').split(/\s+/).map(name => diagram.classDefs.get(name)), box.cls.inlineStyle)
    const paint = classLikePaint(doc, 'class', box.id, style)
    for (const [, , cell] of card.entries()) {
      const color = cell.kind === 'text' ? paint.text : paint.stroke
      if (color) cell.color = color
    }
    let y = 1
    box.sections.forEach((section, index) => {
      const bounds = { x: 1, y, width: box.width - 2, height: Math.max(1, section.length) },
        compartment: TerminalOwner = { id: generated(`${box.id}:compartment:${index}`), kind: 'compartment', parent: { id: box.id, kind: 'node' } }
      card.attributeWithin(compartment, bounds)
      card.region(compartment, bounds)
      y += bounds.height + 1
    })
    doc.scope(owner, () => doc.overlay(card, box.x, box.y))
  }
  for (const box of noteBoxes) {
    const owner = doc.element({ id: box.id, kind: 'node', annotationTarget: box.targetId === undefined ? undefined : { id: box.targetId, kind: 'node' } })
    frame(box, owner, true)
    doc.textBlock(box.x + 2, box.y + 1, box.lines, { owner })
  }
  for (const cls of diagram.classes) if (cls.href) doc.text(0, doc.height + 1, classLinkFooterText(cls.id, cls.href), { owner: { id: cls.id, kind: 'node' }, role: 'text' })
  if (diagram.title) {
    const lines = wrapText(displayText(normalizeBrTags(diagram.title)), targetWidth),
      titled = new TerminalDocument(Math.max(doc.width, ...lines.map(visualWidth)), doc.height + lines.length + 1)
    titled.scope({ id: 'title', kind: 'label' }, () => lines.forEach((line, row) => titled.text(Math.floor((titled.width - visualWidth(line)) / 2), row, line)))
    titled.overlay(doc, 0, lines.length + 1)
    return terminalArtifact(titled, { colorMode, theme, ...(construction ? { trimEnd: true } : {}) })
  }
  return terminalArtifact(doc, { colorMode, theme, ...(construction ? { trimEnd: true } : {}) })
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderClassAscii(...args: Parameters<typeof renderClassTerminal>): string {
  return serializeTerminalArtifact(renderClassTerminal(...args))
}
