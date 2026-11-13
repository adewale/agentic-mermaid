import type { AsciiGraph, AsciiNode, AsciiSubgraph, AsciiEdge, Direction, DrawingCoord } from './types.ts'
import { Up, Down, Left, Right } from './types.ts'
import { maxLineWidth, lineCount } from './multiline-utils.ts'

export const GRAPH_EDGE_APPROACH = 2
/** Keep each allocated face's normal leads clear before their independent
 * bend lanes. Marker glyphs still occupy only their original face cells. */
export const graphEdgeEscape = (edge: AsciiEdge, start: boolean): number =>
  (start ? edge.cellAllocation?.startEscape : edge.cellAllocation?.endEscape) ?? GRAPH_EDGE_APPROACH
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export type GraphEndpoint = AsciiNode | AsciiSubgraph
type Endpoint = GraphEndpoint
const isGroup = (endpoint: Endpoint): endpoint is AsciiSubgraph => 'children' in endpoint
export const graphEndpointOf = (edge: AsciiEdge, start: boolean): Endpoint => start
  ? edge.attachFromSubgraph ?? edge.fromSubgraph ?? edge.from
  : edge.attachToSubgraph ?? edge.toSubgraph ?? edge.to
const membersOf = (endpoint: Endpoint): readonly AsciiNode[] => isGroup(endpoint) ? endpoint.nodes : [endpoint]

/** A relative face allocation projects from the current complete envelope.
 * Capacity reservation and painting must use the same physical contact. */
export function allocatedGraphPort(edge: AsciiEdge, start: boolean, bounds: Bounds): DrawingCoord | undefined {
  const endpoint = graphEndpointOf(edge, start), direction = start ? edge.startDir : edge.endDir
  const offset = start ? edge.cellAllocation!.startOffset : edge.cellAllocation!.endOffset
  const horizontal = direction.x !== 1, available = horizontal ? bounds.maxY - bounds.minY : bounds.maxX - bounds.minX
  const minimum = isGroup(endpoint) && horizontal ? lineCount(endpoint.name) + 1 : 1
  if (!Number.isSafeInteger(offset) || offset < minimum || offset >= available) return undefined
  return horizontal ? { x: direction.x === 0 ? bounds.minX : bounds.maxX, y: bounds.minY + offset }
    : { x: bounds.minX + offset, y: direction.y === 0 ? bounds.minY : bounds.maxY }
}

const logicalBounds = (endpoint: Endpoint): Bounds => {
  const members = membersOf(endpoint)
  return {
    minX: Math.min(...members.map(node => node.gridCoord!.x)), maxX: Math.max(...members.map(node => node.gridCoord!.x + 2)),
    minY: Math.min(...members.map(node => node.gridCoord!.y)), maxY: Math.max(...members.map(node => node.gridCoord!.y + 2)),
  }
}

/** Keep complete shared routing units when selecting unsafe contacts. */
export function graphRoutingUnits(graph: AsciiGraph): Map<AsciiEdge, readonly AsciiEdge[]> {
  const groups = new Map<AsciiEdge | object | string, AsciiEdge[]>()
  for (const edge of graph.edges) {
    const key = edge.bundle ?? edge.sharedTrunk ?? edge
    const members = groups.get(key) ?? []; members.push(edge); groups.set(key, members)
  }
  return new Map([...groups.values()].flatMap(members => members.map(edge => [edge, members] as const)))
}

/** Select witnessed contact conflicts, retaining their relationship identities.
 * Projection alone is not evidence that every route needs replacing. */
export function unsafeGraphContacts(graph: AsciiGraph): Set<AsciiEdge> {
  const directed = new Map<Endpoint, Map<Endpoint, AsciiEdge[]>>()
  const contacts = new Map<Endpoint, Map<string, Map<string, AsciiEdge[]>>>()
  const selected = new Set<AsciiEdge>()
  for (const edge of graph.edges) {
    if (edge.style === 'invisible') continue
    const from = graphEndpointOf(edge, true), to = graphEndpointOf(edge, false)
    // A frame has no node-centre contact, and a self relationship needs two
    // distinct physical contacts on the same envelope.
    if (isGroup(from) || isGroup(to) || from === to) selected.add(edge)
    const outgoing = directed.get(from) ?? new Map<Endpoint, AsciiEdge[]>()
    const parallels = outgoing.get(to) ?? []
    parallels.push(edge); outgoing.set(to, parallels); directed.set(from, outgoing)
    const reverse = directed.get(to)?.get(from) ?? []
    if (parallels.length >= 2 || (isGroup(from) || isGroup(to)) && (from === to || reverse.length)) {
      for (const member of [...parallels, ...reverse]) selected.add(member)
    }
    for (const start of [true, false]) {
      const endpoint = start ? from : to, direction = start ? edge.startDir : edge.endDir
      const faces = contacts.get(endpoint) ?? new Map<string, Map<string, AsciiEdge[]>>(), face = `${direction.x},${direction.y}`
      const meanings = faces.get(face) ?? new Map<string, AsciiEdge[]>()
      const marked = start ? edge.hasArrowStart : edge.hasArrowEnd
      const meaning = marked ? (start ? edge.startMarker : edge.endMarker) ?? 'arrow' : 'line'
      const members = meanings.get(meaning) ?? []; members.push(edge); meanings.set(meaning, members)
      faces.set(face, meanings); contacts.set(endpoint, faces)
    }
  }
  for (const faces of contacts.values()) for (const meanings of faces.values()) if (meanings.size > 1) {
    for (const members of meanings.values()) for (const member of members) selected.add(member)
  }
  return selected
}

/** Allocate only selected units from semantic endpoint envelopes. Retained
 * route/contact footprints participate in admission before publication. */
export function reserveGraphEdgeCapacity(graph: AsciiGraph, measure: () => ReadonlyMap<AsciiNode, Bounds>, selected: ReadonlySet<AsciiEdge>): void {
  if (!selected.size) return
  const logicalEnvelopes = new Map<Endpoint, Bounds>()
  const logicalOf = (endpoint: Endpoint): Bounds => {
    let bounds = logicalEnvelopes.get(endpoint)
    if (!bounds) { bounds = logicalBounds(endpoint); logicalEnvelopes.set(endpoint, bounds) }
    return bounds
  }
  let projected = measure()
  const boundsOf = (endpoint: Endpoint): Bounds => isGroup(endpoint) ? endpoint : projected.get(endpoint)!
  const faces = new Map<Endpoint, Map<Direction, { extent: number; count: number }>>()
  const parentFor = new Map(graph.subgraphs.flatMap(group => group.nodes.map(node => [node, group] as const)))
  const slot = (endpoint: Endpoint, face: Direction, demand: number): number => {
    const perFace = faces.get(endpoint) ?? new Map<Direction, { extent: number; count: number }>()
    const before = perFace.get(face) ?? { extent: 1 + (isGroup(endpoint) && (face === Left || face === Right) ? lineCount(endpoint.name) : 0), count: 0 }
    perFace.set(face, { extent: before.extent + demand + 2, count: before.count + 1 }); faces.set(endpoint, perFace)
    return before.extent + Math.floor(demand / 2)
  }
  for (const edge of graph.edges) {
    if (edge.style === 'invisible' || !selected.has(edge)) continue
    const from = graphEndpointOf(edge, true), to = graphEndpointOf(edge, false), a = boundsOf(from), b = boundsOf(to)
    const separatedX = a.maxX < b.minX || b.maxX < a.minX, separatedY = a.maxY < b.minY || b.maxY < a.minY
    const dx = Math.abs(a.minX + a.maxX - b.minX - b.maxX), dy = Math.abs(a.minY + a.maxY - b.minY - b.maxY)
    const horizontal = separatedX && !separatedY || separatedX === separatedY && (dx > dy || dx === dy && graph.config.graphDirection === 'LR')
    const forward = horizontal ? a.minX < b.minX : a.minY < b.minY
    edge.startDir = horizontal ? forward ? Right : Left : forward ? Down : Up
    edge.endDir = horizontal ? forward ? Left : Right : forward ? Up : Down
    if (from === to) { edge.startDir = Right; edge.endDir = Right }
    else if (!separatedX && !separatedY) {
      // Ancestor/descendant endpoints share an interior. Attach to opposite
      // physical faces; facing one another across a frame's two-cell padding
      // would make the marker corridors coincide.
      edge.startDir = Right; edge.endDir = Left
    }
    const demand = edge.startDir === Left || edge.startDir === Right ? lineCount(edge.text) : Math.max(1, maxLineWidth(edge.text))
    edge.cellAllocation = { startOffset: slot(from, edge.startDir, demand), endOffset: slot(to, edge.endDir, demand) }
  }
  for (const edge of graph.edges) if (edge.cellAllocation) {
    for (const start of [true, false]) {
      const endpoint = graphEndpointOf(edge, start), face = start ? edge.startDir : edge.endDir
      const count = faces.get(endpoint)!.get(face)!.count
      const approach = GRAPH_EDGE_APPROACH + 2 * (count - 1)
      if (start) edge.cellAllocation.startEscape = approach
      else edge.cellAllocation.endEscape = approach
    }
  }
  // An individually valid child face is insufficient: its outward marker
  // approach must fit inside the enclosing frame without touching that
  // frame's own ports. Reserve the occupied approach and one clear cell.
  for (const [endpoint, perFace] of faces) {
    const parent = isGroup(endpoint) ? endpoint.parent : parentFor.get(endpoint)
    if (!parent) continue
    for (const [face, demand] of perFace) {
      const side = face === Left ? 'left' : face === Right ? 'right' : face === Up ? 'top' : 'bottom'
      parent.insets ??= {}
      parent.insets[side] = Math.max(parent.insets[side] ?? 2, GRAPH_EDGE_APPROACH + 2 * (demand.count - 1) + 1 + 1)
    }
  }
  // Card demand fills its own grid dimensions. Container demand first measures
  // its actual usable face, then grows a member grid interval only by deficit.
  for (const [endpoint, perFace] of faces) if (!isGroup(endpoint)) for (const [face, demand] of perFace) {
    const horizontal = face === Left || face === Right
    const index = horizontal ? endpoint.gridCoord!.y + 1 : endpoint.gridCoord!.x + 1
    const sizes = horizontal ? graph.rowHeight : graph.columnWidth
    sizes.set(index, Math.max(sizes.get(index) ?? 0, demand.extent))
  }
  if ([...faces.keys()].some(isGroup)) projected = measure()
  const columns = new Map<number, number>(), rows = new Map<number, number>()
  for (const [endpoint, perFace] of faces) {
    const logical = logicalOf(endpoint), bounds = boundsOf(endpoint)
    for (const [face, demand] of perFace) {
      const horizontal = face === Left || face === Right
      if (isGroup(endpoint)) {
        const available = horizontal ? bounds.maxY - bounds.minY : bounds.maxX - bounds.minX
        const deficit = Math.max(0, demand.extent - available)
        const index = (horizontal ? logical.minY : logical.minX) + 1
        const requests = horizontal ? rows : columns
        requests.set(index, Math.max(requests.get(index) ?? 0, deficit))
      }
      const sizes = horizontal ? graph.columnWidth : graph.rowHeight
      // A node's first two tracks paint its body; logical.max is the
      // trailing escape track. Growing max + 1 can enlarge the next body
      // while leaving the immediate outward corridor unchanged.
      const index = horizontal ? face === Left ? logical.minX - 1 : logical.maxX : face === Up ? logical.minY - 1 : logical.maxY
      if (index >= 0) sizes.set(index, Math.max(sizes.get(index) ?? 0, GRAPH_EDGE_APPROACH + 1 + demand.count * 2))
    }
  }
  for (const [index, extra] of columns) graph.columnWidth.set(index, (graph.columnWidth.get(index) ?? 0) + extra)
  for (const [index, extra] of rows) graph.rowHeight.set(index, (graph.rowHeight.get(index) ?? 0) + extra)
  projected = measure()
  columns.clear(); rows.clear()
  for (const edge of graph.edges) {
    if (!edge.cellAllocation) continue
    const from = graphEndpointOf(edge, true), to = graphEndpointOf(edge, false)
    if (from === to) continue
    const horizontal = edge.startDir === Left || edge.startDir === Right
    const a = boundsOf(from), b = boundsOf(to), first = logicalOf(from), second = logicalOf(to)
    const min = horizontal ? 'minX' : 'minY', max = horizontal ? 'maxX' : 'maxY'
    if (first[max] >= second[min] && second[max] >= first[min]) continue
    const before = first[max] < second[min] ? a : b, after = before === a ? b : a
    const spacer = Math.max(first[min], second[min]) - 1
    const label = horizontal ? maxLineWidth(edge.text) : lineCount(edge.text)
    // Each endpoint keeps its straight marker approach, one bend and one
    // label-clearance cell. Multiline labels add their separate adjacent run.
    const required = label + graphEdgeEscape(edge, true) + graphEdgeEscape(edge, false) + 4 + (horizontal && lineCount(edge.text) > 1 ? 4 : 0)
    const deficit = Math.max(0, required - (after[min] - before[max]))
    const requests = horizontal ? columns : rows
    requests.set(spacer, Math.max(requests.get(spacer) ?? 0, deficit))
  }
  for (const [index, extra] of columns) graph.columnWidth.set(index, (graph.columnWidth.get(index) ?? 0) + extra)
  for (const [index, extra] of rows) graph.rowHeight.set(index, (graph.rowHeight.get(index) ?? 0) + extra)
}
