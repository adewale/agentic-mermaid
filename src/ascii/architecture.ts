import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
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
import type { AsciiConfig, AsciiTheme, ColorMode, Direction, GridCoord } from './types.ts'
import { Up, Down, Left, Right, gridKey } from './types.ts'
import { mkCanvas } from './canvas.ts'
import { type TerminalOwner } from './terminal-document.ts'
import { wrapText } from './wrap.ts'
import { DEFAULT_ASCII_THEME } from './ansi.ts'
import { getPath, mergePath } from './pathfinder.ts'
import { OccupancyMap } from './occupancy.ts'
import { allocateFacePort, countFaceDemand, faceSize, paintTerminalFrame } from './terminal-geometry.ts'
import { visualWidth } from './width.ts'
import { displayText, normalizeBrTags } from '../multiline-utils.ts'
import { oneRowDisplayText } from './multiline-utils.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { terminalIds } from './identity.ts'
import { TERMINAL_CERTIFICATION_LIMITS } from './terminal-limits.ts'
import { AsciiWidthError } from './width-error.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import type { RenderOptions } from '../types.ts'

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
  clearance?: Partial<Record<ArchitectureEndpoint['side'], number>>
}

interface ArchitectureAsciiOptions extends Pick<RenderOptions, 'graphLayout'> {
  maxWidth?: number
  targetWidth?: number
}

type Cardinal = 'N' | 'S' | 'E' | 'W'

const BASE_X_PIXELS_PER_CELL = 8
const Y_PIXELS_PER_ROW = 24
const OUTER_MARGIN = 2
const BOX_GAP = 2

export function renderArchitectureTerminal(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  options: ArchitectureAsciiOptions = {},
): TerminalArtifact {
  const diagram = parseArchitectureDiagram(lines)
  diagram.title ??= config.title === undefined ? undefined : normalizeBrTags(config.title)
  const generated = terminalIds([...diagram.services.map(service => service.id), ...diagram.groups.map(group => group.id), ...diagram.junctions.map(junction => junction.id)])
  const positioned = layoutArchitectureDiagram(diagram, options)
  const terminalBudget = options.targetWidth ?? options.maxWidth ?? config.targetWidth ?? config.maxWidth
  const endpointId = (endpoint: ArchitectureEndpoint): string => endpoint.boundary === 'group' ? diagram.services.find(service => service.id === endpoint.id)?.parentId ?? endpoint.id : endpoint.id
  const faceDemand = countFaceDemand(diagram.edges.flatMap(edge => [edge.source, edge.target].map(endpoint => ({ id: endpointId(endpoint), side: endpoint.side }))))
  const minimum = (id: string) => faceSize(faceDemand.get(id))
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
  // Positions round to the nearest cell and widths round upward. Reserve
  // both possible rounding cells before projecting the pixel topology.
  const leftMargin = terminalBudget === undefined ? OUTER_MARGIN : 1
  const usableBudget = terminalBudget === undefined ? Infinity : Math.max(8, terminalBudget - OUTER_MARGIN - 2)
  const xScale = Math.max(BASE_X_PIXELS_PER_CELL, (maxPixelX - minPixelX) / usableBudget)
  const titleLines = positioned.title ? wrapText(displayText(positioned.title.text), terminalBudget) : []
  const titleRows = titleLines.length ? titleLines.length + 1 : 0
  const aligned = diagram.alignments.length > 0
  const pixelItems = aligned ? [...positioned.services, ...positioned.junctions] : []
  // Quantize each complete authored fixed-axis component once, including
  // overlapping directives, rather than rounding its members independently.
  const centerCoordinates = (axis: 'row' | 'column'): Map<string, number> => {
    const links = new Map<string, string>()
    const find = (id: string): string => {
      let root = id
      while (links.has(root)) root = links.get(root)!
      while (id !== root) { const next = links.get(id)!; links.set(id, root); id = next }
      return root
    }
    for (const alignment of diagram.alignments) if (alignment.axis === axis) for (const id of alignment.members.slice(1)) {
      const a = find(alignment.members[0]!), b = find(id)
      if (a !== b) links.set(b, a)
    }
    const centers = new Map<string, number>()
    for (const item of pixelItems) {
      const root = find(item.id), value = axis === 'row' ? item.y + item.height / 2 : item.x + item.width / 2
      centers.set(root, Math.min(centers.get(root) ?? Infinity, value))
    }
    return new Map(pixelItems.map(item => [item.id, centers.get(find(item.id))!]))
  }
  const rowCenters = aligned ? centerCoordinates('row') : undefined
  const columnCenters = aligned ? centerCoordinates('column') : undefined
  const projectBoxes = (expansion: number) => {
    let originX = leftMargin, originY = OUTER_MARGIN + titleRows
    const projectX = (x: number): number => originX + Math.round((x - minPixelX) * expansion / xScale)
    const projectY = (y: number): number => originY + Math.round((y - minPixelY) * expansion / Y_PIXELS_PER_ROW)
    const serviceBoxes = new Map<string, CellBox>()
    for (const service of positioned.services) {
      const labelLines = serviceLabelLines(service.label, service.icon, service.iconText).flatMap(line => wrapText(line, terminalBudget ? Math.max(1, terminalBudget - 8) : undefined))
      const contentWidth = Math.max(1, ...labelLines.map(visualWidth))
      serviceBoxes.set(service.id, {
        id: service.id,
        kind: 'service',
        parentId: service.parentId,
        x: projectX(service.x),
        y: projectY(service.y),
        width: Math.max(contentWidth + 2, Math.ceil(service.width / xScale), 5, minimum(service.id).width),
        height: Math.max(labelLines.length + 2, Math.ceil(service.height / Y_PIXELS_PER_ROW) + 1, 3, minimum(service.id).height),
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
        width: Math.max(visualWidth(label) + 2, minimum(junction.id).width),
        height: Math.max(3, minimum(junction.id).height),
        labelLines: [label],
        depth: groupDepth(diagram, junction.parentId) + 1,
      })
    }

    if (aligned) {
      for (const item of [...positioned.services, ...positioned.junctions]) {
        const box = serviceBoxes.get(item.id) ?? junctionBoxes.get(item.id)!
        box.x = projectX(columnCenters!.get(item.id)!) - Math.floor((box.width - 1) / 2)
        box.y = projectY(rowCenters!.get(item.id)!) - Math.floor((box.height - 1) / 2)
      }
      // Keep every child and its later containing frame in the same translation.
      const nodes = [...serviceBoxes.values(), ...junctionBoxes.values()]
      const shiftX = Math.max(0, OUTER_MARGIN - Math.min(Infinity, ...nodes.map(box => box.x)))
      const shiftY = Math.max(0, OUTER_MARGIN + titleRows - Math.min(Infinity, ...nodes.map(box => box.y)))
      originX += shiftX; originY += shiftY
      for (const box of nodes) { box.x += shiftX; box.y += shiftY }
    }

    const groupBoxes = buildGroupBoxes(
      diagram,
      positioned.groups,
      serviceBoxes,
      junctionBoxes,
      projectX,
      projectY,
      xScale / expansion,
      terminalBudget,
      Y_PIXELS_PER_ROW / expansion,
    )
    for (const group of groupBoxes.values()) {
      const topDemand = faceDemand.get(group.id)?.T ?? 0
      group.width = Math.max(group.width, minimum(group.id).width, topDemand ? visualWidth(group.labelLines[0] ?? '') + 3 + topDemand * 3 + 2 : 0)
      group.height = Math.max(group.height, minimum(group.id).height)
    }
    const allBoxes = [...groupBoxes.values(), ...serviceBoxes.values(), ...junctionBoxes.values()]
    for (const edge of diagram.edges) for (const [endpoint, arrow] of [[edge.source, edge.hasArrowStart], [edge.target, edge.hasArrowEnd]] as const) {
      const box = allBoxes.find(box => box.id === endpointId(endpoint))
      if (box) { box.clearance ??= {}; box.clearance[endpoint.side] = Math.max(box.clearance[endpoint.side] ?? 0, arrow ? 2 : 1) }
    }
    settleArchitectureBoxes(allBoxes)
    return { serviceBoxes, junctionBoxes, groupBoxes, allBoxes }
  }
  let expansion = 1
  let projection = projectBoxes(expansion)
  const losesAlignment = (): boolean => {
    const byId = new Map([...projection.serviceBoxes, ...projection.junctionBoxes])
    return diagram.alignments.some(alignment => {
      const centers = alignment.members.map(id => {
        const box = byId.get(id)!
        return alignment.axis === 'row' ? box.y + (box.height - 1) / 2 : box.x + (box.width - 1) / 2
      })
      return Math.max(...centers) - Math.min(...centers) > 0.5
    })
  }
  while (aligned && losesAlignment()) {
    // Text and marker envelopes can exceed their pixel-to-cell footprint.
    // Re-space the same positioned model before painting; never move one
    // aligned member to an unrelated row or reset a final certificate.
    expansion *= 2
    const width = Math.max(1, ...projection.allBoxes.map(box => right(box) + 1))
    if (terminalBudget !== undefined && width > terminalBudget) throw new AsciiWidthError(terminalBudget, width, 'architecture', 'MINIMUM_GEOMETRY')
    if (!Number.isSafeInteger(expansion) || expansion > TERMINAL_CERTIFICATION_LIMITS.maxOperations || projection.allBoxes.some(box => !Number.isSafeInteger(box.x + box.width) || !Number.isSafeInteger(box.y + box.height))) throw new LayoutCertificationError([{ strategy: 'architecture-terminal-alignment', violations: ['aligned cell projection exceeds its allocation bound'] }])
    projection = projectBoxes(expansion)
    const rightmost = Math.max(1, ...projection.allBoxes.map(box => right(box) + 1))
    const bottommost = Math.max(1, ...projection.allBoxes.map(box => bottom(box) + 1))
    if (!Number.isSafeInteger(rightmost * bottommost) || rightmost * bottommost > TERMINAL_CERTIFICATION_LIMITS.maxOperations) throw new LayoutCertificationError([{ strategy: 'architecture-terminal-alignment', violations: ['aligned cell projection exceeds its allocation bound'] }])
  }
  if (expansion > 1 && terminalBudget !== undefined) {
    const width = Math.max(1, ...projection.allBoxes.map(box => right(box) + 1))
    if (width > terminalBudget) throw new AsciiWidthError(terminalBudget, width, 'architecture', 'MINIMUM_GEOMETRY')
  }
  const { serviceBoxes, junctionBoxes, groupBoxes, allBoxes } = projection
  // Crop empty leading geometry before emission so ownership and text coordinates
  // never require reparsing/stripping a serialized result.
  const top = positioned.title ? 0 : Math.min(Infinity, ...allBoxes.map(box => box.y))
  if (Number.isFinite(top) && top > 4) for (const box of allBoxes) box.y -= top - 4
  const dx = Math.max(0, ...allBoxes.map(box => (box.clearance?.L ?? 0) - box.x))
  const dy = Math.max(0, ...allBoxes.map(box => (box.clearance?.T ?? 0) - box.y))
  for (const box of allBoxes) { box.x += dx; box.y += dy }
  const maxRight = Math.max(OUTER_MARGIN + 1, ...titleLines.map(line => visualWidth(line) + OUTER_MARGIN * 2), ...allBoxes.map(right))
  const maxBottom = Math.max(OUTER_MARGIN + titleRows + 1, ...allBoxes.map(bottom))
  const canvas = mkCanvas(maxRight + OUTER_MARGIN + 8, maxBottom + OUTER_MARGIN + 5)
  let activeOwner: TerminalOwner | undefined
  const writeText = (at: GridCoord, value: string, _overwrite = true): void => {
    canvas.textBlock(at.x, at.y, value, { owner: activeOwner, role: 'text', kind: 'text' })
  }

  if (positioned.title) {
    activeOwner = canvas.element({ id: 'title', kind: 'label' })
    canvas.scope(activeOwner, () => titleLines.forEach((line, y) => {
      const x = Math.max(OUTER_MARGIN, Math.floor((maxRight - visualWidth(line)) / 2))
      writeText({ x, y }, line, true)
    }))
  }

  // Containers form the background layer. Deeper groups draw after parents.
  for (const group of [...groupBoxes.values()].sort((a, b) => a.depth - b.depth || compareCodePointStrings(a.id, b.id))) {
    activeOwner = canvas.element({ id: group.id, kind: 'group', parent: group.parentId === undefined ? undefined : { id: group.parentId, kind: 'group' }, members: [...groupBoxes.values(), ...serviceBoxes.values(), ...junctionBoxes.values()].filter(box => box.parentId === group.id).map(box => box.id) })
    canvas.region(activeOwner, { x: group.x, y: group.y, width: group.width, height: group.height })
    drawFramedBox(group, true)
  }

  const connections = new Map<string, Set<Cardinal>>()
  const markerCells: Array<{ point: GridCoord; side: ArchitectureEndpoint['side']; owner: TerminalOwner }> = []
  const edgePaths: Array<{ edge: ArchitectureEdge; points: GridCoord[]; owner: TerminalOwner }> = []
  const connectionOwners = new Map<string, Map<string, { owner: TerminalOwner; dirs: Set<Cardinal> }>>()
  const portCursors = new Map<string, number>()
  const portFor = (box: CellBox, side: ArchitectureEndpoint['side']): GridCoord => {
    const key = `${box.id}:${side}`, index = portCursors.get(key) ?? 0, count = faceDemand.get(box.id)?.[side] ?? 1
    portCursors.set(key, index + 1)
    // Group titles replace top-border ink. Attach beyond their complete
    // display width, where the physical contact is still an owned frame.
    const header = box.kind === 'group' && side === 'T' ? visualWidth(box.labelLines[0] ?? '') + 3 : 0
    return allocateFacePort(header ? { ...box, x: box.x + header, width: box.width - header } : box, side, index, count)
  }
  // Reserve every occurrence before routing: a later endpoint marker must not
  // overwrite an earlier shaft that happened to cross its allocated cell.
  const allocated = diagram.edges.map(edge => {
    const source = endpointBox(edge.source), target = endpointBox(edge.target)
    return source && target ? {
      source, target,
      start: portFor(source, edge.source.side),
      end: portFor(target, edge.target.side),
    } : undefined
  })
  const outward = (port: GridCoord, side: ArchitectureEndpoint['side']) => ({ x: port.x + (side === 'R' ? 1 : side === 'L' ? -1 : 0), y: port.y + (side === 'B' ? 1 : side === 'T' ? -1 : 0) })
  const reservedPorts = allocated.flatMap((ports, index) => {
    const edge = diagram.edges[index]!
    return ports ? [ports.start, ...(edge.hasArrowStart ? [outward(ports.start, edge.source.side)] : []), ports.end, ...(edge.hasArrowEnd ? [outward(ports.end, edge.target.side)] : [])] : []
  })
  const unrouted: Array<{ owner: TerminalOwner; edge: ArchitectureEdge }> = []

  for (const [edgeIndex, edge] of diagram.edges.entries()) {
    const owner = canvas.element({ id: generated(`edge:${edgeIndex}`), kind: 'edge', from: edge.source.id, to: edge.target.id, route: 'connected' })
    activeOwner = owner
    const ports = allocated[edgeIndex]
    if (!ports) {
      unrouted.push({ owner, edge })
      canvas.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `architecture.${owner.id}.endpoint`, message: 'An Architecture endpoint has no allocated service, junction or group boundary; the complete relationship is retained in an owned endpoint summary.' })
      continue
    }
    const { source, target, start, end } = ports
    canvas.port(owner, { nodeId: edge.source.id, ...(edge.source.boundary === 'group' ? { boundary: { id: source.id, kind: 'group' as const } } : {}), x: start.x, y: start.y, side: edge.source.side, end: 'start' })
    canvas.port(owner, { nodeId: edge.target.id, ...(edge.target.boundary === 'group' ? { boundary: { id: target.id, kind: 'group' as const } } : {}), x: end.x, y: end.y, side: edge.target.side, end: 'end' })
    const inward = { T: 'B', B: 'T', L: 'R', R: 'L' } as const
    canvas.expectMarkers(owner, 'start', edge.hasArrowStart ? [{ shape: 'arrow', direction: inward[edge.source.side], ascii: config.useAscii }] : [])
    canvas.expectMarkers(owner, 'end', edge.hasArrowEnd ? [{ shape: 'arrow', direction: inward[edge.target.side], ascii: config.useAscii }] : [])
    const obstacles = obstacleGrid(edge)
    const startExit = outward(start, edge.source.side), endExit = outward(end, edge.target.side)
    const ownContacts = new Set([start, end, ...(edge.hasArrowStart ? [startExit] : []), ...(edge.hasArrowEnd ? [endExit] : [])].map(gridKey))
    for (const port of reservedPorts) if (!ownContacts.has(gridKey(port))) obstacles.set(gridKey(port), true)
    const separated = new OccupancyMap(obstacles)
    for (const key of connections.keys()) separated.set(key, true)
    separated.delete(gridKey(start)); separated.delete(gridKey(end))
    const same = (a: GridCoord, b: GridCoord) => a.x === b.x && a.y === b.y
    const endpointStep = (a: GridCoord, b: GridCoord): boolean => (!same(a, start) || !edge.hasArrowStart || same(b, startExit)) && (!same(b, end) || !edge.hasArrowEnd || same(a, endExit))
    const crossingStep = (a: GridCoord, b: GridCoord): boolean => endpointStep(a, b) && [a, b].every(point => {
      const dirs = connections.get(gridKey(point))
      if (!dirs) return true
      // A foreign run can be crossed perpendicularly; sharing its shaft or
      // turning on its corner would make unrelated relationships join.
      return dirs.size === 2 && (a.x === b.x
        ? dirs.has('E') && dirs.has('W')
        : dirs.has('N') && dirs.has('S'))
    })
    const found = same(start, end) ? null : getPath(separated, start, end, preferredDirection(edge.source.side), endpointStep) ?? getPath(obstacles, start, end, preferredDirection(edge.source.side), crossingStep)
    if (!found) {
      unrouted.push({ owner, edge })
      canvas.projectMarkers(owner, `architecture.${owner.id}.route`)
      canvas.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `architecture.${owner.id}.route`, message: 'No obstacle-free route was found for the authored Architecture ports; the complete relationship is retained in an owned endpoint summary.' })
      continue
    }
    const path = mergePath(found)
    edgePaths.push({ edge, points: path, owner })
    const towardBox: Record<ArchitectureEndpoint['side'], Cardinal> = { T: 'S', R: 'W', B: 'N', L: 'E' }
    addDirection(start, towardBox[edge.source.side]); addDirection(end, towardBox[edge.target.side])
    for (let index = 1; index < path.length; index++) addConnection(path[index - 1]!, path[index]!)
    if (edge.hasArrowStart) markerCells.push({ point: start, side: edge.source.side, owner })
    if (edge.hasArrowEnd) markerCells.push({ point: end, side: edge.target.side, owner })
  }

  for (const key of connections.keys()) {
    const comma = key.indexOf(',')
    const x = Number(key.slice(0, comma))
    const y = Number(key.slice(comma + 1))
    for (const { owner, dirs: ownedDirs } of connectionOwners.get(key)?.values() ?? []) {
      activeOwner = owner
      const bits: Record<Cardinal, number> = { N: 1, E: 2, S: 4, W: 8 }
      const mask = [...ownedDirs].reduce((value, direction) => value | bits[direction], 0)
      canvas.stroke(x, y, mask, { owner, role: ownedDirs.size > 2 ? 'junction' : 'line', ascii: config.useAscii })
    }
  }
  for (const marker of markerCells) {
    const toward: Record<ArchitectureEndpoint['side'], ArchitectureEndpoint['side']> = { T: 'B', B: 'T', L: 'R', R: 'L' }
    canvas.marker(marker.point.x, marker.point.y, { shape: 'arrow', direction: toward[marker.side], ascii: config.useAscii }, { owner: marker.owner, role: 'arrow' })
  }

  const labelBoxes: CellBox[] = []
  const routeCells: CellBox[] = edgePaths.some(({ edge }) => edge.label) ? [...connections.keys()].map(key => {
    const [x, y] = key.split(',').map(Number)
    return { id: '', kind: 'junction', x: x!, y: y!, width: 1, height: 1, labelLines: [], depth: 0 }
  }) : []
  for (const { edge, points, owner } of edgePaths) {
    activeOwner = owner
    if (!edge.label) continue
    const text = `[${oneRowDisplayText(edge.label)}]`
    const placement = placeEdgeLabel(text, points, [...allBoxes, ...labelBoxes, ...routeCells])
    writeText(placement, text, true)
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
  for (const service of serviceBoxes.values()) {
    activeOwner = canvas.element({ id: service.id, kind: 'node', parent: service.parentId === undefined ? undefined : { id: service.parentId, kind: 'group' } })
    canvas.region(activeOwner, { x: service.x, y: service.y, width: service.width, height: service.height })
    drawFramedBox(service, false)
  }
  for (const junction of junctionBoxes.values()) {
    activeOwner = canvas.element({ id: junction.id, kind: 'node', parent: junction.parentId === undefined ? undefined : { id: junction.parentId, kind: 'group' } })
    canvas.region(activeOwner, { x: junction.x, y: junction.y, width: junction.width, height: junction.height })
    drawFramedBox(junction, false)
  }

  for (const { owner, edge } of unrouted) {
    const summary = `${edge.source.id}${edge.source.boundary === 'group' ? '{group}' : ''}:${edge.source.side} ${edge.hasArrowStart ? '<' : ''}--${edge.hasArrowEnd ? '>' : ''} ${edge.target.side}:${edge.target.id}${edge.target.boundary === 'group' ? '{group}' : ''}${edge.label ? ` : ${oneRowDisplayText(edge.label)}` : ''}`
    for (const line of wrapText(summary, terminalBudget)) canvas.text(0, canvas.height, line, { owner, role: 'text', kind: 'text' })
  }
  return terminalArtifact(canvas, { colorMode, theme, trimEnd: true })

  function endpointBox(endpoint: ArchitectureEndpoint): CellBox | undefined {
    if (endpoint.boundary === 'group') {
      const service = serviceBoxes.get(endpoint.id)
      return service?.parentId ? groupBoxes.get(service.parentId) : undefined
    }
    return serviceBoxes.get(endpoint.id) ?? junctionBoxes.get(endpoint.id)
  }

  function obstacleGrid(edge: ArchitectureEdge): OccupancyMap {
    const occupied = new OccupancyMap()
    const sentinel = true
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
    for (const box of groupBoxes.values()) {
      // Endpoint ancestors are permeable frames, but their complete headers
      // remain obstacles just like a service label.
      if (excludedGroups.has(box.id)) mark({ ...box, height: Math.max(1, box.labelLines.length) })
      else mark(box)
    }
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
    const owners = connectionOwners.get(key) ?? new Map<string, { owner: TerminalOwner; dirs: Set<Cardinal> }>()
    if (activeOwner) {
      const route = owners.get(activeOwner.id) ?? { owner: activeOwner, dirs: new Set<Cardinal>() }
      route.dirs.add(direction)
      owners.set(activeOwner.id, route)
    }
    connectionOwners.set(key, owners)
    const dirs = connections.get(key) ?? new Set<Cardinal>()
    dirs.add(direction)
    connections.set(key, dirs)
  }

  function drawFramedBox(box: CellBox, group: boolean): void {
    paintTerminalFrame(canvas, box, activeOwner!, config.useAscii, !group)

    if (group) {
      const start = box.x + 2
      canvas.scope(activeOwner!, () => box.labelLines.forEach((header, index) => writeText({ x: start, y: box.y + index }, header, true)))
      return
    }
    const startY = box.y + Math.max(1, Math.floor((box.height - box.labelLines.length) / 2))
    for (let index = 0; index < box.labelLines.length; index++) {
      const label = box.labelLines[index]!
      const x = box.x + Math.max(1, Math.floor((box.width - visualWidth(label)) / 2))
      writeText({ x, y: startY + index }, label, true)
    }
  }
}

function serviceLabelLines(label: string, icon: string | undefined, iconText?: string): string[] {
  const lines = displayText(label).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const out = lines.length > 0 ? lines : ['']
  if (icon) out[0] = `[${icon}]${out[0] ? ` ${out[0]}` : ''}`
  if (iconText !== undefined) out.unshift(...iconText.split('\n'))
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
  terminalBudget?: number,
  yScale = Y_PIXELS_PER_ROW,
): Map<string, CellBox> {
  const positioned = new Map(flattenGroups(positionedGroups).map(group => [group.id, group]))
  const boxes = new Map<string, CellBox>()
  const ordered = [...diagram.groups].sort((a, b) => groupDepth(diagram, b.id) - groupDepth(diagram, a.id))
  for (const group of ordered) {
    const source = positioned.get(group.id)!
    const labelLines = wrapText(`${group.icon ? `(${group.icon}) ` : ''}${displayText(group.label)}`, terminalBudget ? Math.max(1, terminalBudget - 8) : undefined)
    let x = projectX(source.x)
    let y = projectY(source.y)
    let width = Math.max(8, ...labelLines.map(line => visualWidth(line) + 4), Math.ceil(source.width / xScale))
    let height = Math.max(labelLines.length + BOX_GAP + 2, Math.ceil(source.height / yScale) + 1)
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
      labelLines,
      icon: group.icon,
      depth: groupDepth(diagram, group.id),
    })
  }
  return boxes
}

/** Resolve integer-cell growth in the containment tree before any ink is emitted. */
function settleArchitectureBoxes(boxes: CellBox[]): void {
  const children = (parentId?: string) => boxes.filter(box => box.parentId === parentId)
  const envelope = (box: CellBox): CellBox => ({ ...box, x: box.x - (box.clearance?.L ?? 0), y: box.y - (box.clearance?.T ?? 0), width: box.width + (box.clearance?.L ?? 0) + (box.clearance?.R ?? 0), height: box.height + (box.clearance?.T ?? 0) + (box.clearance?.B ?? 0) })
  const move = (box: CellBox, dy: number): void => {
    box.y += dy
    if (box.kind === 'group') for (const child of children(box.id)) move(child, dy)
  }
  const settle = (parentId?: string): void => {
    const siblings = children(parentId)
    for (const box of siblings) if (box.kind === 'group') settle(box.id)
    const parent = boxes.find(box => box.id === parentId)
    const placed: CellBox[] = []
    const ordered = siblings.sort((a, b) => a.y - b.y || a.x - b.x || compareCodePointStrings(a.id, b.id))
    for (const box of ordered) {
      // Every header line is occupied geometry, including an empty group header.
      if (parent && box.y < parent.y + parent.labelLines.length + BOX_GAP) move(box, parent.y + parent.labelLines.length + BOX_GAP - box.y)
      for (;;) {
        const blockers = placed.filter(other => boxesOverlap(envelope(box), envelope(other)))
        if (!blockers.length) break
        move(box, Math.max(...blockers.map(other => bottom(other) + Math.max(BOX_GAP, (other.clearance?.B ?? 0) + (box.clearance?.T ?? 0)) + 1)) - box.y)
      }
      placed.push(box)
    }
    if (!parent || !siblings.length) return
    const x = Math.max(0, Math.min(parent.x, ...siblings.map(child => child.x - BOX_GAP)))
    const endX = Math.max(right(parent), ...siblings.map(child => right(child) + BOX_GAP), x + Math.max(...parent.labelLines.map(visualWidth)) + 3)
    const endY = Math.max(bottom(parent), ...siblings.map(child => bottom(child) + BOX_GAP))
    parent.x = x
    parent.width = endX - x + 1
    parent.height = endY - parent.y + 1
  }
  settle()
}

function placeEdgeLabel(text: string, path: GridCoord[], boxes: CellBox[]): GridCoord {
  const width = visualWidth(text)
  // A label may sit inside a group; only the group's frame is in its way.
  const obstacles = boxes.flatMap(box => box.kind === 'group' ? groupFrame(box) : [box])
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
  // No candidate may overwrite a foreign card or previously owned label.
  // Outside the occupied bounds there is always room; hard width policy can
  // refuse the complete geometry instead of silently clipping its text.
  let y = Math.max(0, ...boxes.map(box => bottom(box) + 2))
  const x = Math.max(0, middle.x - Math.floor(width / 2))
  while (!clear(x, y)) y++
  return { x, y }
}

function preferredDirection(side: ArchitectureEndpoint['side']): Direction {
  if (side === 'L') return Left
  if (side === 'R') return Right
  if (side === 'T') return Up
  return Down
}

/** The four one-cell sides of a group box. */
function groupFrame(box: CellBox): CellBox[] {
  const side = (x: number, y: number, width: number, height: number): CellBox => ({ ...box, x, y, width, height })
  return [
    side(box.x, box.y, box.width, Math.max(1, box.labelLines.length)),
    side(box.x, bottom(box), box.width, 1),
    side(box.x, box.y, 1, box.height),
    side(right(box), box.y, 1, box.height),
  ]
}

function right(box: CellBox): number { return box.x + box.width - 1 }
function bottom(box: CellBox): number { return box.y + box.height - 1 }

function boxesOverlap(a: CellBox, b: CellBox): boolean {
  return a.x <= right(b) && b.x <= right(a) && a.y <= bottom(b) && b.y <= bottom(a)
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderArchitectureAscii(...args: Parameters<typeof renderArchitectureTerminal>): string {
  return serializeTerminalArtifact(renderArchitectureTerminal(...args))
}
