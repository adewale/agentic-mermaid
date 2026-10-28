import { allocateFacePort, countFaceDemand, faceSize } from './terminal-geometry.ts'
import { measuredText } from './terminal-document.ts'
import { TERMINAL_CERTIFICATION_LIMITS as LIMITS } from './terminal-limits.ts'
import { visualWidth } from './width.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'
import { AsciiWidthError } from './width-error.ts'
import type { TerminalBox, BoxRelation, BoxRoute, BoxText } from './class-like-layout.ts'
interface Card extends TerminalBox {
  sections?: string[][]
  lines?: readonly string[]
  cls?: { isInterface?: boolean; href?: string }
  targetId?: string
}
interface Frame extends TerminalBox {
  labelLines: string[]
  parentId?: string
  members: string[]
}
interface Item {
  original: Card | Frame
  id: string
  x: number
  y: number
  width: number
  height: number
  order: number
  frame?: boolean
  children?: Item[]
}
interface Text {
  lines: readonly string[]
  width: number
  height: number
  cells: number
  extra: number
}
interface Scalar {
  relation: BoxRelation
  source: { x: number; y: number; index: number; count: number }
  target: { x: number; y: number; index: number; count: number }
  inner: number
  outer: number
  sourceLane: number
  targetLane: number
  aux: number
  count: number
  central: Text
  fromText: Text
  toText: Text
}
export interface ClassConstruction {
  horizontal: boolean
  side: 'R' | 'B'
  nodes: Item[]
  frames: Item[]
  routes: Scalar[]
  endBand: number
  relations: readonly BoxRelation[]
  report: { width: number; height: number; outputUpper: number; pathPoints: number; certificationUpper: number; planningWork: number; [key: string]: number }
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError('Terminal constructive layout: ' + message)
}
const describe = (value: readonly string[] | undefined): Text => {
  const lines = value?.some(line => line.length) ? sanitizeTerminalText(value.join('\n'), true).split('\n') : []
  const width = Math.max(0, ...lines.map(visualWidth))
  return { lines, width, height: lines.length, cells: width * lines.length, extra: lines.reduce((sum, line) => sum + Math.max(0, line.length - visualWidth(line)), 0) }
}
export const classLinkFooterText = (id: string, href: string): string => `link ${id}: ${href}`
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
/** Validate actual compact geometry before any paint. Only strict perpendicular
 * interior crossings are legal between unrelated authored paths. */
const compactProofLimit = Symbol('compact contact proof limit')
function inspectCompactClassRoutes(routes: readonly BoxRoute[], boxes: readonly TerminalBox[], frames: readonly Frame[], parents: ReadonlyMap<string, string>): string | undefined {
  const frameById = new Map(frames.map(frame => [frame.id, frame])),
    ink = new Map<string, { edge: string; mask: number; terminal: boolean }>()
  let work = 0
  const visit = () => {
    if (work >= LIMITS.maxOperations) throw compactProofLimit
    work++
  }
  const ancestors = (id: string) => {
    const result = new Set<string>()
    let at = parents.get(id)
    while (at) {
      visit()
      if (result.has(at)) throw new Error('Cyclic namespace parent')
      result.add(at)
      at = frameById.get(at)?.parentId
    }
    return result
  }
  for (const route of routes) {
    const permitted = new Set([...ancestors(route.relation.from), ...ancestors(route.relation.to)]),
      seen = new Set<string>()
    for (let index = 0; index < route.points.length; index++) {
      visit()
      const p = route.points[index]!,
        a = route.points[index - 1],
        b = route.points[index + 1],
        key = p.x + ',' + p.y
      if (seen.has(key)) return 'self-retracing route ' + route.relation.id
      seen.add(key)
      let mask = 0
      for (const q of [a, b]) if (q) mask |= q.x > p.x ? 2 : q.x < p.x ? 8 : q.y > p.y ? 4 : 1
      const terminal = index === 0 || index === route.points.length - 1,
        previous = ink.get(key)
      if (previous && previous.edge !== route.relation.id && !(!terminal && !previous.terminal && ((mask === 10 && previous.mask === 5) || (mask === 5 && previous.mask === 10)))) return 'illegal route contact ' + previous.edge + ' / ' + route.relation.id
      ink.set(key, { edge: route.relation.id, mask: previous ? 15 : mask, terminal })
      for (const box of boxes) {
        visit()
        if (p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height) return 'card body contact ' + route.relation.id
      }
      for (const frame of frames) {
        visit()
        if (p.x < frame.x || p.x >= frame.x + frame.width || p.y < frame.y || p.y >= frame.y + frame.height) continue
        if (p.y < frame.y + frame.labelLines.length) return 'namespace header contact ' + route.relation.id
        const vertical = p.x === frame.x || p.x === frame.x + frame.width - 1,
          horizontal = p.y === frame.y + frame.height - 1
        if (vertical || horizontal) {
          if (!permitted.has(frame.id) || !a || !b || (vertical && horizontal) || (vertical && (a.y !== p.y || b.y !== p.y)) || (horizontal && (a.x !== p.x || b.x !== p.x))) return 'namespace boundary contact ' + route.relation.id
        }
      }
    }
  }
  const labels = routes.flatMap(route => [route.label, route.fromLabel, route.toLabel].filter((text): text is BoxText => !!text))
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    for (const box of [...boxes, ...frames.map(frame => ({ x: frame.x, y: frame.y, width: frame.width, height: frame.labelLines.length }))]) {
      visit()
      if (overlap(label, box)) return 'label geometry contact'
    }
    for (let j = 0; j < i; j++) {
      visit()
      if (overlap(label, labels[j]!)) return 'label overlap'
    }
    for (let y = label.y; y < label.y + label.height; y++)
      for (let x = label.x; x < label.x + label.width; x++) {
        visit()
        if (ink.has(x + ',' + y)) return 'label shaft contact'
      }
  }
  return undefined
}
export function compactClassRoutesDecision(routes: readonly BoxRoute[], boxes: readonly TerminalBox[], frames: readonly Frame[], parents: ReadonlyMap<string, string>): { status: 'clear' | 'unknown' } | { status: 'invalid'; reason: string } {
  try {
    const issue = inspectCompactClassRoutes(routes, boxes, frames, parents)
    return issue ? { status: 'invalid', reason: issue } : { status: 'clear' }
  } catch (error) {
    if (error === compactProofLimit) return { status: 'unknown' }
    throw error
  }
}
/** Complete subtree packing and measured private U tracks. Text remains upright
 * in every direction; arrows keep their authored from/to and marker roles. */
export function prepareClassConstruction(
  placed: ReadonlyMap<string, Card>,
  frames: readonly Frame[],
  notes: readonly Card[],
  parents: ReadonlyMap<string, string>,
  relations: readonly BoxRelation[],
  direction: string,
  titleLines: readonly string[],
  maxWidth: number | undefined,
  relationshipCount: number,
): ClassConstruction {
  const horizontal = direction === 'LR' || direction === 'RL',
    reverse = direction === 'BT' || direction === 'RL',
    side = horizontal ? 'B' : 'R'
  const u = (item: Item) => (horizontal ? item.width : item.height)
  const endpointTexts = relations.flatMap(relation => [describe(relation.fromLines), describe(relation.toLines)]),
    pitch = Math.max(2, ...endpointTexts.map(text => (horizontal ? text.width : text.height) + 1))
  const demand = countFaceDemand(
    relations.flatMap(relation => [
      { id: relation.from, side },
      { id: relation.to, side },
    ]),
  )
  let order = 0
  const cardItem = (original: Card): Item & { original: Card } => {
    const sections = original.sections,
      lines = sections?.flat() ?? original.lines ?? [],
      contentWidth = Math.max(6, 4 + Math.max(0, ...lines.map(visualWidth))),
      contentHeight = sections ? sections.reduce((sum, section) => sum + Math.max(1, section.length), 0) + sections.length + 1 : Math.max(3, lines.length + 2)
    const count = demand.get(original.id)?.[side] ?? 0,
      capacity = Math.max(horizontal ? faceSize(demand.get(original.id)).width : faceSize(demand.get(original.id)).height, count ? pitch * (count + 1) + 1 : 0)
    return { original, id: original.id, x: 0, y: 0, width: Math.max(contentWidth, horizontal ? capacity : 0), height: Math.max(contentHeight, horizontal ? 0 : capacity), order: order++ }
  }
  const classes = [...placed.values()].map(cardItem),
    noteItems = notes.map(cardItem),
    frameItems = frames.map(original => ({ original, id: original.id, x: 0, y: 0, width: 0, height: 0, order: order++, frame: true }) as Item),
    frameById = new Map(frameItems.map(item => [item.id, item])),
    seen = new Set<string>(),
    active = new Set<string>()
  const size = (item: Item): void => {
    requireValue(!active.has(item.id), 'namespace cycle')
    if (seen.has(item.id)) return
    active.add(item.id)
    item.children = [...frameItems.filter(child => (child.original as Frame).parentId === item.id), ...classes.filter(child => parents.get(child.id) === item.id)]
    for (const child of item.children) if (child.frame) size(child)
    item.children.sort((a, b) => a.order - b.order)
    if (item.children.length) item.order = Math.min(...item.children.map(child => child.order))
    if (reverse) item.children.reverse()
    const h = (item.original as Frame).labelLines.length,
      w = describe((item.original as Frame).labelLines).width
    if (horizontal) {
      item.width = Math.max(w + 4, 6, 8 + item.children.reduce((sum, child) => sum + child.width, 0) + 4 * Math.max(0, item.children.length - 1))
      item.height = Math.max(h + 3, h + 8 + Math.max(0, ...item.children.map(child => child.height)))
    } else {
      item.width = Math.max(w + 4, 6, ...item.children.map(child => child.width + 8))
      item.height = item.children.length ? h + 8 + item.children.reduce((sum, child) => sum + child.height, 0) + 4 * (item.children.length - 1) : h + 3
    }
    active.delete(item.id)
    seen.add(item.id)
  }
  requireValue(frameById.size === frameItems.length, 'duplicate namespace identity')
  for (const frame of frameItems) size(frame)
  const locate = (item: Item, x: number, y: number): void => {
    item.x = x
    item.y = y
    if (item.frame) {
      let next = horizontal ? x + 4 : y + (item.original as Frame).labelLines.length + 4
      for (const child of item.children!) {
        locate(child, horizontal ? next : x + 4, horizontal ? y + (item.original as Frame).labelLines.length + 4 : next)
        next += u(child) + 4
      }
    }
  }
  const roots = [...frameItems.filter(item => (item.original as Frame).parentId === undefined), ...classes.filter(item => !parents.has(item.id)), ...noteItems].sort((a, b) => a.order - b.order)
  if (reverse) roots.reverse()
  let next = 4
  for (const item of roots) {
    locate(item, horizontal ? next : 4, horizontal ? 4 : next)
    next += u(item) + 4
  }
  const nodes = [...classes, ...noteItems],
    all = [...nodes, ...frameItems],
    byId = new Map(nodes.map(item => [item.id, item]))
  requireValue(byId.size === nodes.length && all.every(item => item.x >= 4 && item.y >= 4), 'node/note identity or parent allocation')
  const right = Math.max(0, ...all.map(item => item.x + item.width)),
    bottom = Math.max(0, ...all.map(item => item.y + item.height)),
    endBand = (horizontal ? bottom : right) + 4,
    endExtent = Math.max(0, ...endpointTexts.map(text => (horizontal ? text.height : text.width)))
  let lane = endBand + endExtent + 4,
    aux = (horizontal ? right : bottom) + 4
  const cursors = new Map<string, number>(),
    ports = new Set<number>()
  const port = (id: string) => {
    const node = byId.get(id)
    requireValue(node, 'missing authored endpoint ' + id)
    const count = demand.get(id)?.[side] ?? 0,
      index = cursors.get(id) ?? 0
    cursors.set(id, index + 1)
    const along = Math.floor(((index + 1) * ((horizontal ? node.width : node.height) - 1)) / (count + 1)),
      x = horizontal ? node.x + along : node.x + node.width,
      y = horizontal ? node.y + node.height : node.y + along,
      key = horizontal ? x : y
    requireValue(!ports.has(key), 'duplicate physical port coordinate')
    ports.add(key)
    return { x, y, index, count }
  }
  const routes = relations.map(relation => {
    const source = port(relation.from),
      target = port(relation.to),
      central = describe(relation.lines),
      fromText = describe(relation.fromLines),
      toText = describe(relation.toLines),
      inner = lane,
      outer = inner + Math.max(3, (horizontal ? central.height : central.width) + 3),
      end = aux + Math.max(1, horizontal ? central.width : central.height),
      sourceU = horizontal ? source.x : source.y,
      targetU = horizontal ? target.x : target.y,
      sourceLane = sourceU > targetU ? inner : outer,
      targetLane = targetU > sourceU ? inner : outer,
      count = sourceLane - (horizontal ? source.y : source.x) + end - sourceU + outer - inner + end - targetU + targetLane - (horizontal ? target.y : target.x) + 1
    lane = outer + 1
    aux = end + 2
    return { relation, source, target, inner, outer, sourceLane, targetLane, aux: end, count, central, fromText, toText }
  })
  // The canonical painter appends one blank row and the measured text rows
  // per link, before applying the title offset. Reserve that same inert footer.
  const footers = classes.flatMap(item => (item.original.cls?.href ? [describe([classLinkFooterText(item.id, item.original.cls.href)])] : []))
  const footerRows = footers.reduce((sum, text) => sum + 1 + text.height, 0)
  const title = describe(titleLines),
    offset = title.height ? title.height + 1 : 0,
    width = Math.max(right, title.width, ...footers.map(text => text.width), ...routes.map(route => (horizontal ? route.aux + 1 : route.outer + 1))),
    bodyHeight = Math.max(bottom, ...routes.map(route => (horizontal ? route.outer + 1 : route.aux + 1))),
    height = bodyHeight + footerRows + offset,
    pathPoints = routes.reduce((sum, route) => sum + route.count, 0)
  requireValue(
    [width, height, pathPoints].every(value => Number.isSafeInteger(value) && value >= 0),
    'unsafe construction arithmetic',
  )
  requireValue(height <= LIMITS.maxOperations && pathPoints <= LIMITS.maxOperations, 'route/row allocation ceiling')
  if (maxWidth !== undefined && width > maxWidth) throw new AsciiWidthError(maxWidth, width, 'class', 'MINIMUM_GEOMETRY')
  // The fallback emits ordinary trimEnd lines. Row extents below are upper bounds
  // of every card/frame/shaft/text glyph; no visible cell is excluded from proof.
  const widths = new Array<number>(height).fill(0)
  let layoutWork = 0
  const visit = () => requireValue(++layoutWork <= LIMITS.maxOperations, 'construction planning work ceiling')
  const span = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row++) {
      visit()
      widths[row + offset] = Math.max(widths[row + offset] ?? 0, x + w)
    }
  }
  for (const item of all) span(item.x, item.y, item.width, item.height)
  const textBounds = (route: Scalar) =>
    horizontal
      ? [
          { text: route.central, x: route.aux - route.central.width, y: route.inner + 2 },
          { text: route.fromText, x: route.source.x - route.fromText.width, y: endBand },
          { text: route.toText, x: route.target.x - route.toText.width, y: endBand },
        ]
      : [
          { text: route.central, x: route.inner + 2, y: route.aux - route.central.height },
          { text: route.fromText, x: endBand, y: route.source.y - route.fromText.height },
          { text: route.toText, x: endBand, y: route.target.y - route.toText.height },
        ]
  for (const route of routes) {
    const vertices = constructionVertices(route, horizontal)
    for (let i = 1; i < vertices.length; i++) {
      const a = vertices[i - 1]!,
        b = vertices[i]!
      span(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x) + 1, Math.abs(b.y - a.y) + 1)
    }
    for (const label of textBounds(route)) if (label.text.height) span(label.x, label.y, label.text.width, label.text.height)
  }
  let footerY = bodyHeight
  for (const text of footers) {
    footerY++
    span(0, footerY, text.width, text.height)
    footerY += text.height
  }
  for (let row = 0; row < title.height; row++) widths[row] = Math.ceil((width + title.width) / 2)
  const outputUpper =
    widths.reduce((sum, width) => sum + width, Math.max(0, height - 1)) +
    [
      ...classes.flatMap(item => item.original.sections?.flat() ?? []),
      ...notes.flatMap(note => note.lines ?? []),
      ...frames.flatMap(frame => frame.labelLines),
      ...titleLines,
      ...footers.flatMap(text => text.lines),
      ...routes.flatMap(route => [...route.central.lines, ...route.fromText.lines, ...route.toText.lines]),
    ].reduce((sum, line) => sum + Math.max(0, line.length - visualWidth(line)), 0)
  requireValue(outputUpper <= LIMITS.maxOutputCodeUnits, 'encoded output ceiling')
  let frameContacts = 0,
    planningWork = 3
  for (const relation of relations)
    for (const id of [relation.from, relation.to]) {
      let at = parents.get(id)
      visit()
      planningWork++
      while (at) {
        visit()
        planningWork++
        frameContacts++
        at = (frameById.get(at)?.original as Frame | undefined)?.parentId
      }
    }
  let crossings = 0
  for (const a of routes)
    for (const b of routes)
      if (a !== b)
        for (const [p, q, lane] of [
          [horizontal ? a.source.y : a.source.x, horizontal ? a.source.x : a.source.y, a.sourceLane],
          [horizontal ? a.target.y : a.target.x, horizontal ? a.target.x : a.target.y, a.targetLane],
        ])
          for (const [v, u] of [
            [b.sourceLane, horizontal ? b.source.x : b.source.y],
            [b.targetLane, horizontal ? b.target.x : b.target.y],
          ]) {
            visit()
            if (p! < v! && v! < lane! && u! < q! && q! < b.aux) crossings++
          }
  const nodeArea = nodes.reduce((sum, item) => sum + item.width * item.height, 0),
    perimeters = frameItems.reduce((sum, item) => sum + 2 * item.width + 2 * item.height - 4, 0),
    external = routes.reduce((sum, route) => sum + route.central.cells + route.fromText.cells + route.toText.cells, 0)
  const compartments = classes.reduce((sum, item) => sum + (item.original.sections?.length ?? 0), 0),
    compartmentArea = classes.reduce((sum, item) => sum + (item.width - 2) * (item.original.sections ?? []).reduce((rows, section) => rows + Math.max(1, section.length), 0), 0)
  const identities = nodes.length + frames.length + relations.length + compartments + 2 * relationshipCount + (title.height ? 1 : 0),
    declarations = nodes.length + frames.length + compartments,
    members = frames.reduce((sum, frame) => sum + frame.members.length, 0),
    portCount = 2 * relations.length
  const headerCells = frames.reduce((sum, frame) => sum + describe(frame.labelLines.map(line => ' ' + line + ' ')).cells, 0),
    headerRows = frames.reduce((sum, frame) => sum + frame.labelLines.length, 0)
  const nodeText = classes.reduce((sum, item) => sum + (item.original.sections ?? []).reduce((rows, section) => rows + section.reduce((cells, line) => cells + describe([line]).cells, 0), 0), 0) + notes.reduce((sum, note) => sum + describe(note.lines).cells, 0)
  const footerCells = footers.reduce((sum, text) => sum + text.cells, 0)
  const textVisual = nodeText + external + headerCells + title.cells + footerCells,
    physical = nodeArea + pathPoints + external + perimeters + headerCells + title.cells + footerCells
  const allocationUpper = nodeArea + 3 * relations.length + headerRows + title.height + footers.length,
    emptyUpper = nodeArea + footerRows + routes.reduce((sum, route) => sum + route.central.height + route.fromText.height + route.toText.height, 0) + headerRows + title.height
  const identityUpper = 4 * identities + identities * identities + members * (identities + 1) + 2 * relations.length
  const baselineUpper = widths.reduce((sum, width) => sum + width, 0) + height + identityUpper + 2 * declarations + allocationUpper + emptyUpper + 18 * textVisual + 5 * physical + 2 * compartmentArea + 6 * portCount
  const producerUpper = (title.height ? 6 + 16 * relations.length : 3 + 9 * relations.length) + planningWork
  const certificationUpper = baselineUpper + 2 * pathPoints + 2 * crossings + frameContacts + producerUpper + 11 + 22 * relations.length
  // A conservative estimate is not a pass. The unchanged final live-cell
  // certifier enforces its actual 1M counter; no budget is restarted or enlarged.
  const report = { width, height, outputUpper, pathPoints, certificationUpper, baselineUpper, planningWork, layoutWork, frameContacts, nodeArea, perimeters, external, crossings, identities, declarations, compartments, ports: portCount, footerCells }
  for (const item of all) Object.assign(item.original, { x: item.x, y: item.y, width: item.width, height: item.height })
  return { horizontal, side, nodes, frames: frameItems, routes, endBand, relations, report }
}
function constructionVertices(route: Scalar, horizontal: boolean) {
  const a = route.source,
    b = route.target
  return horizontal
    ? [a, { x: a.x, y: route.sourceLane }, { x: route.aux, y: route.sourceLane }, { x: route.aux, y: route.targetLane }, { x: b.x, y: route.targetLane }, b]
    : [a, { x: route.sourceLane, y: a.y }, { x: route.sourceLane, y: route.aux }, { x: route.targetLane, y: route.aux }, { x: route.targetLane, y: b.y }, b]
}
export function materializeClassConstruction<T>(plan: ClassConstruction, seal: (value: any) => T): T[] {
  const byId = new Map(plan.nodes.map(item => [item.id, item.original])),
    label = (text: Text, x: number, y: number): BoxText | undefined => (text.height ? Object.freeze({ x, y, width: text.width, height: text.height, lines: Object.freeze([...text.lines]), text: measuredText(text.lines) }) : undefined)
  return plan.routes.map(route => {
    const source = allocateFacePort(byId.get(route.relation.from)!, plan.side, route.source.index, route.source.count),
      target = allocateFacePort(byId.get(route.relation.to)!, plan.side, route.target.index, route.target.count)
    requireValue(source.x === route.source.x && source.y === route.source.y && target.x === route.target.x && target.y === route.target.y, 'canonical face allocation binding')
    const vertices = constructionVertices(route, plan.horizontal),
      points: Array<{ x: number; y: number }> = []
    points.push(source)
    for (let i = 1; i < vertices.length; i++) {
      const a = vertices[i - 1]!,
        b = vertices[i]!,
        dx = Math.sign(b.x - a.x),
        dy = Math.sign(b.y - a.y)
      requireValue((dx !== 0 || dy !== 0) && (!dx || !dy), 'positive orthogonal segment')
      for (let x = a.x + dx, y = a.y + dy; ; x += dx, y += dy) {
        points.push({ x, y })
        if (x === b.x && y === b.y) break
      }
    }
    requireValue(points.length === route.count, 'path point admission')
    const central = plan.horizontal ? label(route.central, route.aux - route.central.width, route.inner + 2) : label(route.central, route.inner + 2, route.aux - route.central.height),
      from = plan.horizontal ? label(route.fromText, route.source.x - route.fromText.width, plan.endBand) : label(route.fromText, plan.endBand, route.source.y - route.fromText.height),
      to = plan.horizontal ? label(route.toText, route.target.x - route.toText.width, plan.endBand) : label(route.toText, plan.endBand, route.target.y - route.toText.height)
    return seal({ relation: route.relation, source, target, points, ...(central ? { label: central } : {}), ...(from ? { fromLabel: from } : {}), ...(to ? { toLabel: to } : {}) })
  })
}
