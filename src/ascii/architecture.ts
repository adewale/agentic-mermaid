// ============================================================================
// Spatial ASCII/Unicode renderer — architecture diagrams
//
// Projects the deterministic Architecture layout into terminal cells, then
// routes authored side/boundary endpoints through an obstacle grid. Groups,
// cards, junctions, labels, and connectors share one canvas; there is no
// detached endpoint edge list.
// ============================================================================

import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import type {
  ArchitectureDiagram,
  ArchitectureEdge,
  ArchitectureEndpoint,
  PositionedArchitectureGroup,
} from '../architecture/types.ts'
import type { AsciiNode, AsciiConfig, AsciiTheme, CharRole, ColorMode, Direction, GridCoord } from './types.ts'
import { Up, Down, Left, Right, gridKey } from './types.ts'
import {
  canvasToString,
  drawText,
  increaseRoleCanvasSize,
  increaseSize,
  mkCanvas,
  mkRoleCanvas,
  setRole,
} from './canvas.ts'
import { DEFAULT_ASCII_THEME } from './ansi.ts'
import { getPath, mergePath } from './pathfinder.ts'
import { visualWidth } from './width.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

interface CellBox {
  id: string
  kind: 'service' | 'junction' | 'group'
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  labelLines: string[]
  icon?: string
  depth: number
}

interface ArchitectureAsciiOptions {
  maxWidth?: number
  targetWidth?: number
}

type Cardinal = 'N' | 'S' | 'E' | 'W'

const BASE_X_PIXELS_PER_CELL = 8
const Y_PIXELS_PER_ROW = 24
const OUTER_MARGIN = 2
const BOX_GAP = 2

export function renderArchitectureAscii(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  options: ArchitectureAsciiOptions = {},
): string {
  const diagram = parseArchitectureDiagram(lines)
  const positioned = layoutArchitectureDiagram(diagram)
  const terminalBudget = options.targetWidth ?? options.maxWidth
  const allPixelBounds = [
    ...positioned.services.map(item => ({ x: item.x, right: item.x + item.width })),
    ...positioned.junctions.map(item => ({ x: item.x, right: item.x + item.width })),
    ...flattenGroups(positioned.groups).map(item => ({ x: item.x, right: item.x + item.width })),
  ]
  const minPixelX = allPixelBounds.length > 0 ? Math.min(...allPixelBounds.map(item => item.x)) : 0
  const maxPixelX = allPixelBounds.length > 0 ? Math.max(...allPixelBounds.map(item => item.right)) : 1
  const minPixelY = Math.min(
    0,
    ...positioned.services.map(item => item.y),
    ...positioned.junctions.map(item => item.y),
    ...flattenGroups(positioned.groups).map(item => item.y),
  )
  // projectX already accounts for the left margin; reserve one rounding cell
  // on the right rather than charging the margin twice.
  const leftMargin = terminalBudget === undefined ? OUTER_MARGIN : 1
  const usableBudget = terminalBudget === undefined ? Infinity : Math.max(8, terminalBudget - OUTER_MARGIN - 1)
  const xScale = Math.max(BASE_X_PIXELS_PER_CELL, (maxPixelX - minPixelX) / usableBudget)
  const titleRows = positioned.title ? 2 : 0
  const projectX = (x: number): number => leftMargin + Math.round((x - minPixelX) / xScale)
  const projectY = (y: number): number => OUTER_MARGIN + titleRows + Math.round((y - minPixelY) / Y_PIXELS_PER_ROW)

  const serviceBoxes = new Map<string, CellBox>()
  for (const service of positioned.services) {
    const labelLines = serviceLabelLines(service.label, service.icon)
    const contentWidth = Math.max(1, ...labelLines.map(visualWidth))
    serviceBoxes.set(service.id, {
      id: service.id,
      kind: 'service',
      parentId: service.parentId,
      x: projectX(service.x),
      y: projectY(service.y),
      width: Math.max(contentWidth + 2, Math.ceil(service.width / xScale), 5),
      height: Math.max(labelLines.length + 2, Math.ceil(service.height / Y_PIXELS_PER_ROW) + 1, 3),
      labelLines,
      icon: service.icon,
      depth: groupDepth(diagram, service.parentId) + 1,
    })
  }

  const junctionBoxes = new Map<string, CellBox>()
  for (const junction of positioned.junctions) {
    const mark = config.useAscii ? '(*)' : '◉'
    const label = `${mark} ${junction.id}`
    junctionBoxes.set(junction.id, {
      id: junction.id,
      kind: 'junction',
      parentId: junction.parentId,
      x: projectX(junction.x),
      y: projectY(junction.y),
      width: visualWidth(label),
      height: 1,
      labelLines: [label],
      depth: groupDepth(diagram, junction.parentId) + 1,
    })
  }

  // Rounding and display-width minima can enlarge cards beyond their projected
  // pixel slots. Resolve the rare collision monotonically without changing
  // source order or identity.
  separateItemBoxes([...serviceBoxes.values(), ...junctionBoxes.values()])

  const groupBoxes = buildGroupBoxes(
    diagram,
    positioned.groups,
    serviceBoxes,
    junctionBoxes,
    projectX,
    projectY,
    xScale,
    config.useAscii,
  )

  const allBoxes = [...groupBoxes.values(), ...serviceBoxes.values(), ...junctionBoxes.values()]
  const maxRight = Math.max(OUTER_MARGIN + 1, ...allBoxes.map(right))
  const maxBottom = Math.max(OUTER_MARGIN + titleRows + 1, ...allBoxes.map(bottom))
  const canvas = mkCanvas(maxRight + OUTER_MARGIN + 8, maxBottom + OUTER_MARGIN + 5)
  const roleCanvas = mkRoleCanvas(maxRight + OUTER_MARGIN + 8, maxBottom + OUTER_MARGIN + 5)

  const setCell = (x: number, y: number, char: string, role: CharRole, overwrite = true): void => {
    if (x < 0 || y < 0) return
    increaseSize(canvas, x, y)
    increaseRoleCanvasSize(roleCanvas, x, y)
    if (overwrite || canvas[x]![y] === ' ') {
      canvas[x]![y] = char
      setRole(roleCanvas, x, y, role)
    }
  }

  if (positioned.title) {
    const x = Math.max(OUTER_MARGIN, Math.floor((maxRight - visualWidth(positioned.title.text)) / 2))
    drawText(canvas, { x, y: 0 }, positioned.title.text, true)
    for (let col = x; col < x + visualWidth(positioned.title.text); col++) setRole(roleCanvas, col, 0, 'text')
  }

  // Containers form the background layer. Deeper groups draw after parents.
  for (const group of [...groupBoxes.values()].sort((a, b) => a.depth - b.depth || compareCodePointStrings(a.id, b.id))) {
    drawFramedBox(group, true)
  }

  const connections = new Map<string, Set<Cardinal>>()
  const markerCells: Array<{ point: GridCoord; char: string }> = []
  const edgePaths: Array<{ edge: ArchitectureEdge; points: GridCoord[] }> = []

  for (const edge of diagram.edges) {
    const source = endpointBox(edge.source)
    const target = endpointBox(edge.target)
    if (!source || !target) continue
    const start = outsideAnchor(source, edge.source.side)
    const end = outsideAnchor(target, edge.target.side)
    const obstacles = obstacleGrid(edge)
    const path = mergePath(getPath(obstacles, start, end, preferredDirection(edge.source.side)) ?? fallbackPath(start, end))
    edgePaths.push({ edge, points: path })
    for (let index = 1; index < path.length; index++) addConnection(path[index - 1]!, path[index]!)
    if (edge.hasArrowStart) markerCells.push({ point: start, char: markerTowardBox(edge.source.side) })
    if (edge.hasArrowEnd) markerCells.push({ point: end, char: markerTowardBox(edge.target.side) })
  }

  for (const [key, dirs] of connections) {
    const comma = key.indexOf(',')
    const x = Number(key.slice(0, comma))
    const y = Number(key.slice(comma + 1))
    setCell(x, y, connectionGlyph(dirs), dirs.size > 2 ? 'junction' : 'line')
  }
  for (const marker of markerCells) setCell(marker.point.x, marker.point.y, marker.char, 'arrow')

  const labelBoxes: CellBox[] = []
  for (const { edge, points } of edgePaths) {
    if (!edge.label) continue
    const text = `[${edge.label.replace(/\n/g, ' ')}]`
    const placement = placeEdgeLabel(text, points, [...allBoxes, ...labelBoxes])
    drawText(canvas, placement, text, true)
    for (let x = placement.x; x < placement.x + visualWidth(text); x++) setRole(roleCanvas, x, placement.y, 'text')
    labelBoxes.push({
      id: `edge-label-${labelBoxes.length}`,
      kind: 'junction',
      x: placement.x,
      y: placement.y,
      width: visualWidth(text),
      height: 1,
      labelLines: [text],
      depth: 0,
    })
  }

  // Cards and junction labels are the foreground layer.
  for (const service of serviceBoxes.values()) drawFramedBox(service, false)
  for (const junction of junctionBoxes.values()) {
    drawText(canvas, { x: junction.x, y: junction.y }, junction.labelLines[0]!, true)
    const markWidth = config.useAscii ? 3 : 1
    for (let x = junction.x; x < junction.x + junction.width; x++) {
      setRole(roleCanvas, x, junction.y, x < junction.x + markWidth ? 'arrow' : 'text')
    }
  }

  const raw = canvasToString(canvas, { roleCanvas, colorMode, theme })
  const rows = raw.split('\n')
  while (rows.length > 0 && stripTerminalMarkup(rows[0]!).trim().length === 0) rows.shift()
  while (rows.length > 0 && stripTerminalMarkup(rows[rows.length - 1]!).trim().length === 0) rows.pop()
  return rows.map(row => row.trimEnd()).join('\n')

  function endpointBox(endpoint: ArchitectureEndpoint): CellBox | undefined {
    if (endpoint.boundary === 'group') {
      const service = serviceBoxes.get(endpoint.id)
      return service?.parentId ? groupBoxes.get(service.parentId) : undefined
    }
    return serviceBoxes.get(endpoint.id) ?? junctionBoxes.get(endpoint.id)
  }

  function obstacleGrid(edge: ArchitectureEdge): Map<string, AsciiNode> {
    const occupied = new Map<string, AsciiNode>()
    const sentinel = {} as AsciiNode
    const excludedGroups = new Set<string>()
    const addAncestors = (parentId: string | undefined): void => {
      let current = parentId
      while (current) {
        if (excludedGroups.has(current)) break
        excludedGroups.add(current)
        current = diagram.groups.find(group => group.id === current)?.parentId
      }
    }
    const sourceService = diagram.services.find(service => service.id === edge.source.id)
    const targetService = diagram.services.find(service => service.id === edge.target.id)
    const sourceJunction = diagram.junctions.find(junction => junction.id === edge.source.id)
    const targetJunction = diagram.junctions.find(junction => junction.id === edge.target.id)
    addAncestors(sourceService?.parentId ?? sourceJunction?.parentId)
    addAncestors(targetService?.parentId ?? targetJunction?.parentId)

    const mark = (box: CellBox): void => {
      for (let x = box.x; x <= right(box); x++) {
        for (let y = box.y; y <= bottom(box); y++) occupied.set(gridKey({ x, y }), sentinel)
      }
    }
    for (const box of serviceBoxes.values()) mark(box)
    for (const box of junctionBoxes.values()) mark(box)
    for (const box of groupBoxes.values()) if (!excludedGroups.has(box.id)) mark(box)
    return occupied
  }

  function addConnection(a: GridCoord, b: GridCoord): void {
    const dx = Math.sign(b.x - a.x)
    const dy = Math.sign(b.y - a.y)
    let current = { ...a }
    while (current.x !== b.x || current.y !== b.y) {
      const next = { x: current.x + dx, y: current.y + dy }
      const forward: Cardinal = dx > 0 ? 'E' : dx < 0 ? 'W' : dy > 0 ? 'S' : 'N'
      const backward: Cardinal = dx > 0 ? 'W' : dx < 0 ? 'E' : dy > 0 ? 'N' : 'S'
      addDirection(current, forward)
      addDirection(next, backward)
      current = next
    }
  }

  function addDirection(point: GridCoord, direction: Cardinal): void {
    const key = gridKey(point)
    const dirs = connections.get(key) ?? new Set<Cardinal>()
    dirs.add(direction)
    connections.set(key, dirs)
  }

  function markerTowardBox(side: ArchitectureEndpoint['side']): string {
    if (config.useAscii) {
      if (side === 'L') return '>'
      if (side === 'R') return '<'
      if (side === 'T') return 'v'
      return '^'
    }
    if (side === 'L') return '►'
    if (side === 'R') return '◄'
    if (side === 'T') return '▼'
    return '▲'
  }

  function connectionGlyph(dirs: Set<Cardinal>): string {
    const key = [...dirs].sort().join('')
    if (config.useAscii) {
      if (key === 'EW') return '-'
      if (key === 'NS') return '|'
      return '+'
    }
    const glyphs: Record<string, string> = {
      EW: '─', NS: '│', ES: '┌', SW: '┐', EN: '└', NW: '┘',
      ENS: '├', NSW: '┤', ESW: '┬', ENW: '┴', ENSW: '┼',
    }
    return glyphs[key] ?? (dirs.has('E') || dirs.has('W') ? '─' : '│')
  }

  function drawFramedBox(box: CellBox, group: boolean): void {
    const chars = config.useAscii
      ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' }
      : { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' }
    for (let x = box.x + 1; x < right(box); x++) {
      setCell(x, box.y, chars.h, 'border')
      setCell(x, bottom(box), chars.h, 'border')
    }
    for (let y = box.y + 1; y < bottom(box); y++) {
      setCell(box.x, y, chars.v, 'border')
      setCell(right(box), y, chars.v, 'border')
    }
    setCell(box.x, box.y, chars.tl, 'border')
    setCell(right(box), box.y, chars.tr, 'border')
    setCell(box.x, bottom(box), chars.bl, 'border')
    setCell(right(box), bottom(box), chars.br, 'border')

    if (group) {
      const header = box.labelLines[0]!
      const start = box.x + 2
      drawText(canvas, { x: start, y: box.y }, header, true)
      for (let x = start; x < start + visualWidth(header); x++) setRole(roleCanvas, x, box.y, 'text')
      return
    }
    const startY = box.y + Math.max(1, Math.floor((box.height - box.labelLines.length) / 2))
    for (let index = 0; index < box.labelLines.length; index++) {
      const label = box.labelLines[index]!
      const x = box.x + Math.max(1, Math.floor((box.width - visualWidth(label)) / 2))
      drawText(canvas, { x, y: startY + index }, label, true)
      for (let col = x; col < x + visualWidth(label); col++) setRole(roleCanvas, col, startY + index, 'text')
    }
  }
}

function serviceLabelLines(label: string, icon: string | undefined): string[] {
  const lines = label.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const out = lines.length > 0 ? lines : ['']
  if (icon) out[0] = `[${icon}]${out[0] ? ` ${out[0]}` : ''}`
  return out
}

function flattenGroups(groups: PositionedArchitectureGroup[]): PositionedArchitectureGroup[] {
  const out: PositionedArchitectureGroup[] = []
  const visit = (group: PositionedArchitectureGroup): void => {
    out.push(group)
    for (const child of group.children) visit(child)
  }
  for (const group of groups) visit(group)
  return out
}

function groupDepth(diagram: ArchitectureDiagram, id: string | undefined): number {
  let depth = 0
  let current = id
  while (current) {
    depth++
    current = diagram.groups.find(group => group.id === current)?.parentId
  }
  return depth
}

function buildGroupBoxes(
  diagram: ArchitectureDiagram,
  positionedGroups: PositionedArchitectureGroup[],
  services: Map<string, CellBox>,
  junctions: Map<string, CellBox>,
  projectX: (x: number) => number,
  projectY: (y: number) => number,
  xScale: number,
  useAscii: boolean,
): Map<string, CellBox> {
  const positioned = new Map(flattenGroups(positionedGroups).map(group => [group.id, group]))
  const boxes = new Map<string, CellBox>()
  const ordered = [...diagram.groups].sort((a, b) => groupDepth(diagram, b.id) - groupDepth(diagram, a.id))
  for (const group of ordered) {
    const source = positioned.get(group.id)!
    const header = `${group.icon ? `(${group.icon}) ` : ''}${group.label.replace(/\n/g, ' ')}`
    let x = projectX(source.x)
    let y = projectY(source.y)
    let width = Math.max(8, visualWidth(header) + 4, Math.ceil(source.width / xScale))
    let height = Math.max(4, Math.ceil(source.height / Y_PIXELS_PER_ROW) + 1)
    const children = [
      ...[...services.values()].filter(child => child.parentId === group.id),
      ...[...junctions.values()].filter(child => child.parentId === group.id),
      ...[...boxes.values()].filter(child => child.parentId === group.id),
    ]
    if (children.length > 0) {
      const childLeft = Math.min(...children.map(child => child.x))
      const childTop = Math.min(...children.map(child => child.y))
      const childRight = Math.max(...children.map(right))
      const childBottom = Math.max(...children.map(bottom))
      const newX = Math.min(x, childLeft - BOX_GAP)
      const newY = Math.min(y, childTop - BOX_GAP)
      const newRight = Math.max(x + width - 1, childRight + BOX_GAP)
      const newBottom = Math.max(y + height - 1, childBottom + BOX_GAP)
      x = Math.max(0, newX)
      y = Math.max(0, newY)
      width = newRight - x + 1
      height = newBottom - y + 1
    }
    boxes.set(group.id, {
      id: group.id,
      kind: 'group',
      parentId: group.parentId,
      x,
      y,
      width,
      height,
      labelLines: [header],
      icon: group.icon,
      depth: groupDepth(diagram, group.id),
    })
  }
  return boxes
}

function separateItemBoxes(boxes: CellBox[]): void {
  const placed: CellBox[] = []
  const ordered = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x || compareCodePointStrings(a.id, b.id))
  for (const box of ordered) {
    for (let guard = 0; guard <= placed.length; guard++) {
      const blockers = placed.filter(other => boxesOverlap(box, other))
      if (blockers.length === 0) break
      box.y = Math.max(...blockers.map(other => bottom(other) + BOX_GAP + 1))
    }
    placed.push(box)
  }
}

function placeEdgeLabel(text: string, path: GridCoord[], obstacles: CellBox[]): GridCoord {
  const width = visualWidth(text)
  const segments = path.slice(1).map((point, index) => ({ a: path[index]!, b: point }))
    .sort((a, b) => (Math.abs(b.b.x - b.a.x) - Math.abs(a.b.x - a.a.x)))
  const clear = (x: number, y: number): boolean => {
    const candidate: CellBox = { id: '', kind: 'junction', x, y, width, height: 1, labelLines: [], depth: 0 }
    return x >= 0 && y >= 0 && obstacles.every(obstacle => !boxesOverlap(candidate, obstacle))
  }
  for (const segment of segments) {
    if (segment.a.y !== segment.b.y) continue
    const left = Math.min(segment.a.x, segment.b.x)
    const right = Math.max(segment.a.x, segment.b.x)
    if (right - left + 1 < width) continue
    const x = Math.floor((left + right - width + 1) / 2)
    if (clear(x, segment.a.y)) return { x, y: segment.a.y }
  }
  const middle = path[Math.floor(path.length / 2)] ?? { x: 0, y: 0 }
  for (const dy of [-1, 1, -2, 2, 0]) {
    const x = Math.max(0, middle.x - Math.floor(width / 2))
    if (clear(x, middle.y + dy)) return { x, y: middle.y + dy }
  }
  return { x: Math.max(0, middle.x - Math.floor(width / 2)), y: Math.max(0, middle.y) }
}

function outsideAnchor(box: CellBox, side: ArchitectureEndpoint['side']): GridCoord {
  if (side === 'L') return { x: box.x - 1, y: box.y + Math.floor(box.height / 2) }
  if (side === 'R') return { x: right(box) + 1, y: box.y + Math.floor(box.height / 2) }
  if (side === 'T') return { x: box.x + Math.floor(box.width / 2), y: box.y - 1 }
  return { x: box.x + Math.floor(box.width / 2), y: bottom(box) + 1 }
}

function preferredDirection(side: ArchitectureEndpoint['side']): Direction {
  if (side === 'L') return Left
  if (side === 'R') return Right
  if (side === 'T') return Up
  return Down
}

function fallbackPath(start: GridCoord, end: GridCoord): GridCoord[] {
  if (start.x === end.x || start.y === end.y) return [start, end]
  return [start, { x: end.x, y: start.y }, end]
}

function right(box: CellBox): number { return box.x + box.width - 1 }
function bottom(box: CellBox): number { return box.y + box.height - 1 }

function boxesOverlap(a: CellBox, b: CellBox): boolean {
  return a.x <= right(b) && b.x <= right(a) && a.y <= bottom(b) && b.y <= bottom(a)
}

function stripTerminalMarkup(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '').replace(/<\/?span(?:\s[^>]*)?>/g, '')
}
