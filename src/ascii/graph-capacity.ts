import type { AsciiGraph, AsciiNode, AsciiSubgraph, AsciiEdge, Direction } from './types.ts'
import { Up, Down, Left, Right } from './types.ts'
import { maxLineWidth, lineCount } from './multiline-utils.ts'

export const GRAPH_EDGE_APPROACH = 2
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export type GraphEndpoint = AsciiNode | AsciiSubgraph
type Endpoint = GraphEndpoint
const isGroup = (endpoint: Endpoint): endpoint is AsciiSubgraph => 'children' in endpoint
export const graphEndpointOf = (edge: AsciiEdge, start: boolean): Endpoint => start
  ? edge.attachFromSubgraph ?? edge.fromSubgraph ?? edge.from
  : edge.attachToSubgraph ?? edge.toSubgraph ?? edge.to
const membersOf = (endpoint: Endpoint): readonly AsciiNode[] => isGroup(endpoint) ? endpoint.nodes : [endpoint]
const logicalBounds = (endpoint: Endpoint): Bounds => {
  const members = membersOf(endpoint)
  return {
    minX: Math.min(...members.map(node => node.gridCoord!.x)), maxX: Math.max(...members.map(node => node.gridCoord!.x + 2)),
    minY: Math.min(...members.map(node => node.gridCoord!.y)), maxY: Math.max(...members.map(node => node.gridCoord!.y + 2)),
  }
}

/** Allocate from semantic endpoint envelopes, including complete container
 * frames. A representative member is only a logical routing anchor; it is
 * never the authority for the container's face, ports or exterior clearance. */
export function reserveGraphEdgeCapacity(graph: AsciiGraph, measure: () => ReadonlyMap<AsciiNode, Bounds>): void {
  const directed = new Map<Endpoint, Map<Endpoint, number>>()
  const contacts = new Map<Endpoint, Map<string, Set<string>>>()
  let needsPhysicalFaces = false
  for (const edge of graph.edges) {
    if (edge.style === 'invisible') continue
    const from = graphEndpointOf(edge, true), to = graphEndpointOf(edge, false)
    const outgoing = directed.get(from) ?? new Map<Endpoint, number>()
    const parallels = (outgoing.get(to) ?? 0) + 1
    outgoing.set(to, parallels); directed.set(from, outgoing)
    const compoundPair = isGroup(from) || isGroup(to)
    if (parallels >= 2 || compoundPair && (from === to || (directed.get(to)?.get(from) ?? 0) > 0)) needsPhysicalFaces = true
    for (const start of [true, false]) {
      const endpoint = start ? from : to, direction = start ? edge.startDir : edge.endDir
      const faces = contacts.get(endpoint) ?? new Map<string, Set<string>>(), face = `${direction.x},${direction.y}`
      const meanings = faces.get(face) ?? new Set<string>()
      const marked = start ? edge.hasArrowStart : edge.hasArrowEnd
      meanings.add(marked ? (start ? edge.startMarker : edge.endMarker) ?? 'arrow' : 'line')
      faces.set(face, meanings); contacts.set(endpoint, faces)
    }
  }
  for (const faces of contacts.values()) for (const meanings of faces.values()) {
    // Compatible shared heads/trunks retain their existing ownership. A line
    // cannot continue through another relationship's endpoint marker, and
    // different markers cannot express both endpoint meanings in one glyph.
    if (meanings.size > 1) needsPhysicalFaces = true
  }
  if (!needsPhysicalFaces && !graph.compoundRepacked) return
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
    if (edge.style === 'invisible') continue
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
  // An individually valid child face is insufficient: its outward marker
  // approach must fit inside the enclosing frame without touching that
  // frame's own ports. Reserve the occupied approach and one clear cell.
  for (const [endpoint, perFace] of faces) {
    const parent = isGroup(endpoint) ? endpoint.parent : parentFor.get(endpoint)
    if (!parent) continue
    for (const face of perFace.keys()) {
      const side = face === Left ? 'left' : face === Right ? 'right' : face === Up ? 'top' : 'bottom'
      parent.insets ??= {}
      parent.insets[side] = Math.max(parent.insets[side] ?? 2, GRAPH_EDGE_APPROACH + 1 + 1)
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
      const index = horizontal ? face === Left ? logical.minX - 1 : logical.maxX + 1 : face === Up ? logical.minY - 1 : logical.maxY + 1
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
    const required = label + 2 * (GRAPH_EDGE_APPROACH + 1 + 1) + (horizontal && lineCount(edge.text) > 1 ? 4 : 0)
    const deficit = Math.max(0, required - (after[min] - before[max]))
    const requests = horizontal ? columns : rows
    requests.set(spacer, Math.max(requests.get(spacer) ?? 0, deficit))
  }
  for (const [index, extra] of columns) graph.columnWidth.set(index, (graph.columnWidth.get(index) ?? 0) + extra)
  for (const [index, extra] of rows) graph.rowHeight.set(index, (graph.rowHeight.get(index) ?? 0) + extra)
}
