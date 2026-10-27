import { OccupancyMap } from './occupancy.ts'
// ============================================================================
// ASCII renderer — grid-based layout
//
// Ported from AlexanderGrooff/mermaid-ascii cmd/graph.go + cmd/mapping_node.go.
// Places nodes on a logical grid, computes column/row sizes,
// converts grid coordinates to character-level drawing coordinates,
// and handles subgraph bounding boxes.
// ============================================================================

import type {
  GridCoord, DrawingCoord, Direction, AsciiGraph, AsciiNode, AsciiSubgraph, AsciiEdge,
} from './types.ts'
import { gridKey, gridCoordDirection } from './types.ts'
import { mkCanvas, setCanvasSizeToGrid } from './canvas.ts'
import { determinePath, determineLabelLine } from './edge-routing.ts'
import { getPath, mergePath } from './pathfinder.ts'
import { analyzeEdgeBundles, processBundles } from './edge-bundling.ts'
import { drawBox } from './draw.ts'
import { maxLineWidth, lineCount } from './multiline-utils.ts'
import { getShapeDimensions } from './shapes/index.ts'
import { placeCompoundItems } from './compound-placement.ts'
import { reserveGraphEdgeCapacity, graphRoutingUnits, unsafeGraphContacts, graphEdgeEscape, allocatedGraphPort, graphEndpointOf } from './graph-capacity.ts'

// ============================================================================
// Grid coordinate → drawing coordinate conversion
// ============================================================================

/**
 * Convert a grid coordinate to a drawing (character) coordinate.
 * Sums column widths up to the target column, and row heights up to the target row,
 * then centers within the cell.
 */
export function gridToDrawingCoord(
  graph: AsciiGraph,
  c: GridCoord,
  dir?: Direction,
): DrawingCoord {
  const target: GridCoord = dir
    ? { x: c.x + dir.x, y: c.y + dir.y }
    : c

  let x = 0
  for (let col = 0; col < target.x; col++) {
    x += graph.columnWidth.get(col) ?? 0
  }

  let y = 0
  for (let row = 0; row < target.y; row++) {
    y += graph.rowHeight.get(row) ?? 0
  }

  const colW = graph.columnWidth.get(target.x) ?? 0
  const rowH = graph.rowHeight.get(target.y) ?? 0
  return {
    x: x + Math.floor(colW / 2) + graph.offsetX,
    y: y + Math.floor(rowH / 2) + graph.offsetY,
  }
}

/** Convert a path of grid coords to drawing coords. */
export function lineToDrawing(graph: AsciiGraph, line: GridCoord[]): DrawingCoord[] {
  return line.map(c => gridToDrawingCoord(graph, c))
}

// ============================================================================
// Node placement on the grid
// ============================================================================

/**
 * Reserve a 3x3 block in the grid for a node.
 * If the requested position is occupied, recursively shift by 4 grid units
 * (in the perpendicular direction based on effective direction) until a free spot is found.
 *
 * @param effectiveDir - Optional direction override. If not provided, uses the node's
 *                       effective direction (subgraph direction if in a subgraph with override,
 *                       otherwise graph direction).
 */
export function reserveSpotInGrid(
  graph: AsciiGraph,
  node: AsciiNode,
  requested: GridCoord,
  effectiveDir?: 'LR' | 'TD',
): GridCoord {
  // Determine direction for collision handling
  const dir = effectiveDir ?? getEffectiveDirection(graph, node)

  if (graph.grid.has(gridKey(requested))) {
    // Collision — shift perpendicular to main flow direction
    if (dir === 'LR') {
      return reserveSpotInGrid(graph, node, { x: requested.x, y: requested.y + 4 }, dir)
    } else {
      return reserveSpotInGrid(graph, node, { x: requested.x + 4, y: requested.y }, dir)
    }
  }

  // Reserve the 3x3 block
  for (let dx = 0; dx < 3; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      const reserved: GridCoord = { x: requested.x + dx, y: requested.y + dy }
      graph.grid.set(gridKey(reserved), node)
    }
  }

  node.gridCoord = requested
  return requested
}

// ============================================================================
// Column width / row height computation
// ============================================================================

/**
 * Set column widths and row heights for a node's 3x3 grid block.
 * Each node occupies 3 columns (border, content, border) and 3 rows.
 * Uses shape-aware dimensions to properly size non-rectangular shapes.
 */
export function setColumnWidth(graph: AsciiGraph, node: AsciiNode): void {
  const gc = node.gridCoord!
  const padding = graph.config.boxBorderPadding

  // Get shape-aware dimensions
  const shapeDims = getShapeDimensions(node.shape, node.displayLabel, {
    useAscii: graph.config.useAscii,
    padding,
  })

  // Use shape-provided grid dimensions
  const colWidths = shapeDims.gridColumns
  const rowHeights = shapeDims.gridRows

  for (let idx = 0; idx < colWidths.length; idx++) {
    const xCoord = gc.x + idx
    const current = graph.columnWidth.get(xCoord) ?? 0
    graph.columnWidth.set(xCoord, Math.max(current, colWidths[idx]!))
  }

  for (let idx = 0; idx < rowHeights.length; idx++) {
    const yCoord = gc.y + idx
    const current = graph.rowHeight.get(yCoord) ?? 0
    graph.rowHeight.set(yCoord, Math.max(current, rowHeights[idx]!))
  }

  // Padding column/row before the node (spacing between nodes)
  if (gc.x > 0) {
    const current = graph.columnWidth.get(gc.x - 1) ?? 0
    graph.columnWidth.set(gc.x - 1, Math.max(current, graph.config.paddingX))
  }

  if (gc.y > 0) {
    let basePadding = graph.config.paddingY
    // Extra vertical padding for nodes with incoming edges from outside their subgraph
    if (hasIncomingEdgeFromOutsideSubgraph(graph, node)) {
      const subgraphOverhead = 4
      basePadding += subgraphOverhead
    }
    const current = graph.rowHeight.get(gc.y - 1) ?? 0
    graph.rowHeight.set(gc.y - 1, Math.max(current, basePadding))
  }
}

/** A glyph cannot carry two different endpoint meanings. Reserve capacity
 * before converting logical cells to physical cards; compatible shared heads
 * retain their existing allocation and ownership. */
function reserveMarkerPorts(graph: AsciiGraph): void {
  const faces = new Map<AsciiNode, Map<string, Array<{ edge: AsciiEdge; end: 'start' | 'end'; marker: string }>>>()
  for (const edge of graph.edges) for (const end of ['start', 'end'] as const) {
    if (edge.style === 'invisible' || !(end === 'start' ? edge.hasArrowStart : edge.hasArrowEnd)
      || (end === 'start' ? edge.fromSubgraph || edge.attachFromSubgraph : edge.toSubgraph || edge.attachToSubgraph)) continue
    const node = end === 'start' ? edge.from : edge.to, dir = end === 'start' ? edge.startDir : edge.endDir
    const groups = faces.get(node) ?? new Map(), key = `${dir.x},${dir.y}`, group = groups.get(key) ?? []
    group.push({ edge, end, marker: (end === 'start' ? edge.startMarker : edge.endMarker) ?? 'arrow' })
    groups.set(key, group); faces.set(node, groups)
  }
  for (const [node, groups] of faces) for (const [face, group] of groups) {
    const kinds = [...new Set(group.map(item => item.marker))]
    if (kinds.length < 2) continue
    for (const { edge, end, marker } of group) edge[end === 'start' ? 'startPort' : 'endPort'] = { index: kinds.indexOf(marker), count: kinds.length }
    const verticalFace = face === '1,0' || face === '1,2'
    const dimensions = verticalFace ? graph.columnWidth : graph.rowHeight
    const origin = verticalFace ? node.gridCoord!.x : node.gridCoord!.y
    const extent = (dimensions.get(origin) ?? 0) + (dimensions.get(origin + 1) ?? 0) + 1
    const extra = Math.max(0, kinds.length * 3 + 2 - extent)
    dimensions.set(origin + 1, (dimensions.get(origin + 1) ?? 0) + extra)
  }
}

/** Ensure grid has width/height entries for all cells along an edge path. */
export function increaseGridSizeForPath(graph: AsciiGraph, path: GridCoord[]): void {
  for (const c of path) {
    if (!graph.columnWidth.has(c.x)) {
      graph.columnWidth.set(c.x, Math.floor(graph.config.paddingX / 2))
    }
    if (!graph.rowHeight.has(c.y)) {
      graph.rowHeight.set(c.y, Math.floor(graph.config.paddingY / 2))
    }
  }
}

// ============================================================================
// Subgraph helpers
// ============================================================================

function isNodeInAnySubgraph(graph: AsciiGraph, node: AsciiNode): boolean {
  return graph.subgraphs.some(sg => sg.nodes.includes(node))
}

/**
 * Get the innermost subgraph that directly contains this node.
 * Returns null if node is not in any subgraph.
 */
export function getNodeSubgraph(graph: AsciiGraph, node: AsciiNode): AsciiSubgraph | null {
  // Find the innermost (most deeply nested) subgraph containing the node
  let innermost: AsciiSubgraph | null = null
  for (const sg of graph.subgraphs) {
    if (sg.nodes.includes(node)) {
      // Check if this subgraph is deeper (more nested) than current innermost
      if (!innermost || isAncestorOrSelf(innermost, sg)) {
        innermost = sg
      }
    }
  }
  return innermost
}

/** Check if `candidate` is the same as or an ancestor of `target`. */
function isAncestorOrSelf(candidate: AsciiSubgraph, target: AsciiSubgraph): boolean {
  let current: AsciiSubgraph | null = target
  while (current !== null) {
    if (current === candidate) return true
    current = current.parent
  }
  return false
}

/**
 * Get the effective direction for a node's layout.
 * Returns the subgraph's direction override if the node is in a subgraph with one,
 * otherwise returns the graph-level direction.
 */
export function getEffectiveDirection(graph: AsciiGraph, node: AsciiNode): 'LR' | 'TD' {
  const sg = getNodeSubgraph(graph, node)
  if (sg?.direction) {
    return sg.direction
  }
  return graph.config.graphDirection
}

/**
 * Check if a node has an incoming edge from outside its subgraph
 * AND is the topmost such node in its subgraph.
 * Used to add extra vertical padding for subgraph borders.
 */
function hasIncomingEdgeFromOutsideSubgraph(graph: AsciiGraph, node: AsciiNode): boolean {
  const nodeSg = getNodeSubgraph(graph, node)
  if (!nodeSg) return false

  let hasExternalEdge = false
  for (const edge of graph.edges) {
    if (edge.to === node) {
      const sourceSg = getNodeSubgraph(graph, edge.from)
      if (sourceSg !== nodeSg) {
        hasExternalEdge = true
        break
      }
    }
  }

  if (!hasExternalEdge) return false

  // Only return true for the topmost node with an external incoming edge
  for (const otherNode of nodeSg.nodes) {
    if (otherNode === node || !otherNode.gridCoord) continue
    let otherHasExternal = false
    for (const edge of graph.edges) {
      if (edge.to === otherNode) {
        const sourceSg = getNodeSubgraph(graph, edge.from)
        if (sourceSg !== nodeSg) {
          otherHasExternal = true
          break
        }
      }
    }
    if (otherHasExternal && otherNode.gridCoord.y < node.gridCoord!.y) {
      return false
    }
  }

  return true
}

// ============================================================================
// Subgraph bounding boxes
// ============================================================================

function calculateSubgraphBoundingBox(graph: AsciiGraph, sg: AsciiSubgraph, projected?: ReadonlyMap<AsciiNode, GridBounds>): void {
  if (sg.nodes.length === 0) return

  let minX = 1_000_000
  let minY = 1_000_000
  let maxX = -1_000_000
  let maxY = -1_000_000

  // Include children's bounding boxes
  for (const child of sg.children) {
    calculateSubgraphBoundingBox(graph, child, projected)
    if (child.nodes.length > 0) {
      minX = Math.min(minX, child.minX)
      minY = Math.min(minY, child.minY)
      maxX = Math.max(maxX, child.maxX)
      maxY = Math.max(maxY, child.maxY)
    }
  }

  // Include node positions
  for (const node of sg.nodes) {
    const bounds = projected?.get(node) ?? (node.drawingCoord && node.drawing ? {
      minX: node.drawingCoord.x, minY: node.drawingCoord.y,
      maxX: node.drawingCoord.x + node.drawing.width - 1, maxY: node.drawingCoord.y + node.drawing.height - 1,
    } : undefined)
    if (!bounds) continue
    minX = Math.min(minX, bounds.minX)
    minY = Math.min(minY, bounds.minY)
    maxX = Math.max(maxX, bounds.maxX)
    maxY = Math.max(maxY, bounds.maxY)
  }

  // Keep two cells after the last header line for an incoming bend and its
  // terminal marker; a marker cannot also represent a change of direction.
  const subgraphLabelSpace = Math.max(2, lineCount(sg.name) + 1)
  sg.minX = minX - (sg.insets?.left ?? 2)
  sg.minY = minY - (sg.insets?.top ?? 2) - subgraphLabelSpace
  sg.maxX = maxX + (sg.insets?.right ?? 2)
  sg.maxY = maxY + (sg.insets?.bottom ?? 2)
}

export function calculateSubgraphBoundingBoxes(graph: AsciiGraph, projected?: ReadonlyMap<AsciiNode, GridBounds>): void {
  for (const sg of graph.subgraphs) {
    if (!sg.parent) calculateSubgraphBoundingBox(graph, sg, projected)
  }
}

/** Reserve complete headers in the shared grid before routing or painting. */
function reserveSubgraphHeaders(graph: AsciiGraph): void {
  for (const group of graph.subgraphs) {
    const nodes = group.nodes.filter(node => node.gridCoord !== null)
    if (!nodes.length) continue
    const first = nodes.reduce((a, b) => a.gridCoord!.x < b.gridCoord!.x ? a : b)
    const left = Math.min(...nodes.map(node => gridToDrawingCoord(graph, node.gridCoord!).x))
    const right = Math.max(...nodes.map(node => {
      const gc = node.gridCoord!
      return gridToDrawingCoord(graph, gc).x + (graph.columnWidth.get(gc.x) ?? 0) + (graph.columnWidth.get(gc.x + 1) ?? 0)
    }))
    const extraWidth = Math.max(0, maxLineWidth(group.name) + 2 - (right - left + 4))
    if (extraWidth) {
      const column = first.gridCoord!.x + 1
      graph.columnWidth.set(column, (graph.columnWidth.get(column) ?? 0) + extraWidth)
    }
    const top = Math.min(...nodes.map(node => node.gridCoord!.y))
    if (top > 0) graph.rowHeight.set(top - 1, Math.max(graph.rowHeight.get(top - 1) ?? 0, graph.config.paddingY + Math.max(0, lineCount(group.name) - 2)))
  }
}

interface GridBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boundsOfNodes(nodes: readonly AsciiNode[]): GridBounds | null {
  const placed = nodes.filter((node): node is AsciiNode & { gridCoord: GridCoord } => node.gridCoord !== null)
  if (placed.length === 0) return null
  return {
    minX: Math.min(...placed.map(node => node.gridCoord.x)),
    minY: Math.min(...placed.map(node => node.gridCoord.y)),
    maxX: Math.max(...placed.map(node => node.gridCoord.x + 2)),
    maxY: Math.max(...placed.map(node => node.gridCoord.y + 2)),
  }
}

function boundsOverlap(a: GridBounds, b: GridBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function subgraphFramesMayOverlap(a: GridBounds, b: GridBounds, halo: number, dir: 'LR' | 'TD'): boolean {
  const xOverlap = dir === 'TD'
    ? a.minX - halo <= b.maxX + halo && a.maxX + halo >= b.minX - halo
    : a.minX - halo < b.maxX + halo && a.maxX + halo > b.minX - halo
  const yOverlap = dir === 'LR'
    ? a.minY - halo <= b.maxY + halo && a.maxY + halo >= b.minY - halo
    : a.minY - halo < b.maxY + halo && a.maxY + halo > b.minY - halo
  // Equality on the axis where root containers are assigned lanes still means
  // their rendered borders occupy the same row/column. Keep the perpendicular
  // comparison strict so already-disjoint side-by-side frames do not move.
  return xOverlap && yOverlap
}

function expandedBounds(bounds: GridBounds, amount: number): GridBounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  }
}

function shiftedBounds(bounds: GridBounds, dir: 'LR' | 'TD', amount: number): GridBounds {
  return dir === 'LR'
    ? { ...bounds, minY: bounds.minY + amount, maxY: bounds.maxY + amount }
    : { ...bounds, minX: bounds.minX + amount, maxX: bounds.maxX + amount }
}

function nodeBounds(node: AsciiNode): GridBounds | null {
  if (!node.gridCoord) return null
  const { x, y } = node.gridCoord
  return { minX: x, minY: y, maxX: x + 2, maxY: y + 2 }
}

/** Reserve complete painted envelopes across the containment tree. Logical
 * blocks choose safe separating cuts; shared track widths can still make
 * centred physical cards exceed those blocks. */
function reserveProtectedEnvelopes(graph: AsciiGraph): void {
  let projected = projectNodeEnvelopes(graph)
  // Ordinary cards contained by their disjoint logical blocks need no pair
  // scan. Compound frames, or cards enlarged beyond a block, need measured
  // separation rather than the logical-placement assumption.
  if (!graph.subgraphs.length && !graph.edges.some(edge => edge.cellAllocation) && graph.nodes.every(node => {
    const end = gridToDrawingCoord(graph, { x: node.gridCoord!.x + 2, y: node.gridCoord!.y + 2 })
    const bounds = projected.get(node)!
    return bounds.maxX <= end.x && bounds.maxY <= end.y
  })) return
  interface Envelope { bounds: GridBounds; logical: GridBounds; node?: AsciiNode; group?: AsciiSubgraph; approach?: { edge: AsciiEdge; start: boolean } }
  const envelopes: Envelope[] = []
  const endpointEnvelopes = new Map<AsciiNode | AsciiSubgraph, Envelope>()
  for (const [node, bounds] of projected) {
    const envelope = { node, bounds, logical: nodeBounds(node)! }
    envelopes.push(envelope); endpointEnvelopes.set(node, envelope)
  }
  for (const group of graph.subgraphs) {
    const logical = boundsOfNodes(group.nodes)
    if (!logical) continue
    const envelope = { group, logical, bounds: { minX: group.minX, minY: group.minY, maxX: group.maxX, maxY: group.maxY } }
    endpointEnvelopes.set(group, envelope)
    if (!group.concurrencyRegion) envelopes.push(envelope)
  }
  const approachBounds = (envelope: Envelope, bounds: GridBounds): GridBounds | undefined => {
    const { edge, start } = envelope.approach!, point = allocatedGraphPort(edge, start, bounds)
    if (!point) return undefined
    const direction = start ? edge.startDir : edge.endDir, dx = direction.x - 1, dy = direction.y - 1, approach = graphEdgeEscape(edge, start)
    // Graph markers occupy one cell: the end marker at distance 1 lies in
    // this exterior run; a start marker at distance 0 lies on its own envelope.
    return {
      minX: Math.min(point.x + dx, point.x + dx * approach), maxX: Math.max(point.x + dx, point.x + dx * approach),
      minY: Math.min(point.y + dy, point.y + dy * approach), maxY: Math.max(point.y + dy, point.y + dy * approach),
    }
  }
  for (const edge of graph.edges) if (edge.cellAllocation) for (const start of [true, false]) {
    const base = endpointEnvelopes.get(graphEndpointOf(edge, start))!
    const envelope: Envelope = { ...base, approach: { edge, start } }, bounds = approachBounds(envelope, base.bounds)
    if (bounds) { envelope.bounds = bounds; envelopes.push(envelope) }
  }
  const related = (a: Envelope, b: Envelope): boolean => {
    if (a.node && a.node === b.node) return true
    if (a.group && b.node) return a.group.nodes.includes(b.node)
    if (b.group && a.node) return b.group.nodes.includes(a.node)
    if (a.group && b.group) return isAncestorOrSelf(a.group, b.group) || isAncestorOrSelf(b.group, a.group)
    return false
  }
  const bendCapacity = (envelope: Envelope) => envelope.approach
    ? graphEdgeEscape(envelope.approach.edge, envelope.approach.start) / 2 + 1 : 2
  interface Constraint { axis: 'x' | 'y'; index: number; left: Envelope; right: Envelope; clearance: number }
  const active = new Map<string, Constraint>(), declined = new Set<string>()
  const measure = (): void => {
    projected = projectNodeEnvelopes(graph)
    for (const envelope of envelopes) {
      const bounds = envelope.node ? projected.get(envelope.node)! : {
        minX: envelope.group!.minX, minY: envelope.group!.minY,
        maxX: envelope.group!.maxX, maxY: envelope.group!.maxY,
      }
      envelope.bounds = envelope.approach ? approachBounds(envelope, bounds)! : bounds
    }
  }
  for (;;) {
    // At cut k the left members end by k, so their drawing anchors and widths
    // read only tracks below k. Later cuts cannot enlarge that left envelope;
    // right anchors only stay or increase. Selected approaches add only fixed
    // face/slot offsets, preserving that monotonicity. Re-solve ordered cuts when
    // a newly witnessed pair activates a lower cut. Each round adds a finite
    // envelope pair; this is constraint closure, not a settling-radius limit.
    for (const axis of ['x', 'y'] as const) {
      const cuts = new Map<number, Constraint[]>()
      for (const constraint of active.values()) if (constraint.axis === axis) {
        const constraints = cuts.get(constraint.index) ?? []
        constraints.push(constraint); cuts.set(constraint.index, constraints)
      }
      for (const [index, constraints] of [...cuts].sort(([a], [b]) => a - b)) {
        measure()
        const min = axis === 'x' ? 'minX' : 'minY', max = axis === 'x' ? 'maxX' : 'maxY'
        const extra = Math.max(0, ...constraints.map(({ left, right, clearance }) => left.bounds[max] + clearance - right.bounds[min]))
        const sizes = axis === 'x' ? graph.columnWidth : graph.rowHeight
        if (extra) sizes.set(index, (sizes.get(index) ?? 0) + extra)
      }
    }
    measure()
    let activated = false
    for (let index = 0; index < envelopes.length; index++) for (let next = index + 1; next < envelopes.length; next++) {
      const a = envelopes[index]!, b = envelopes[next]!, key = `${index}:${next}`
      if (related(a, b) || active.has(key) || declined.has(key)) continue
      const first = a.bounds, second = b.bounds
      // Independent contacts need separate bend lanes beyond their fixed
      // normal leads. One blank cell alone leaves the first routed lane
      // fencing every remaining lead against the neighboring body.
      const clearance = Math.max(bendCapacity(a), bendCapacity(b))
      if (first.maxX + clearance <= second.minX || second.maxX + clearance <= first.minX
        || first.maxY + clearance <= second.minY || second.maxY + clearance <= first.minY) continue
      const candidates: Array<Constraint & { extra: number }> = []
      for (const axis of ['x', 'y'] as const) {
        const min = axis === 'x' ? 'minX' : 'minY', max = axis === 'x' ? 'maxX' : 'maxY'
        if (a.logical[max] < b.logical[min]) candidates.push({ axis, index: b.logical[min] - 1, left: a, right: b, clearance, extra: first[max] + clearance - second[min] })
        if (b.logical[max] < a.logical[min]) candidates.push({ axis, index: a.logical[min] - 1, left: b, right: a, clearance, extra: second[max] + clearance - first[min] })
      }
      candidates.sort((a, b) => a.extra - b.extra || (a.axis === (graph.config.graphDirection === 'TD' ? 'y' : 'x') ? -1 : 1))
      const candidate = candidates[0]
      if (candidate) { active.set(key, candidate); activated = true; continue }
      declined.add(key)
      const nameOf = (envelope: Envelope) => envelope.approach ? `${envelope.approach.edge.id}:${envelope.approach.start ? 'start' : 'end'}` : envelope.group?.id ?? envelope.node!.name
      const firstId = nameOf(a), secondId = nameOf(b)
      graph.canvas.report({
        code: 'TERMINAL_GEOMETRY_COLLISION', feature: `container-envelope:${firstId}:${secondId}`,
        message: `Unrelated envelopes ${firstId} and ${secondId} interleave in both logical axes; spacer capacity cannot separate them.`,
      })
    }
    if (!activated) return
  }
}

/** Measure cards and complete nested frames from the same grid projection. */
function projectNodeEnvelopes(graph: AsciiGraph): Map<AsciiNode, GridBounds> {
  const projected = new Map<AsciiNode, GridBounds>()
  for (const node of graph.nodes) {
    if (!node.gridCoord) continue
    const point = gridToDrawingCoord(graph, node.gridCoord)
    projected.set(node, {
      minX: point.x, minY: point.y,
      maxX: point.x + (graph.columnWidth.get(node.gridCoord.x) ?? 0) + (graph.columnWidth.get(node.gridCoord.x + 1) ?? 0),
      maxY: point.y + (graph.rowHeight.get(node.gridCoord.y) ?? 0) + (graph.rowHeight.get(node.gridCoord.y + 1) ?? 0),
    })
  }
  calculateSubgraphBoundingBoxes(graph, projected)
  return projected
}

/**
 * Keep root containers in disjoint logical lanes before edge routing.
 *
 * Node placement reserves individual 3x3 blocks, but it historically allowed
 * members of different root subgraphs to interleave. Moving only the computed
 * frame afterwards detached it from those members and let two frames merge,
 * overwriting titles and node text. Translate the later root container as one
 * unit instead, rebuild occupancy, then let routing and frame calculation use
 * those final coordinates.
 */
function separateRootSubgraphLanes(graph: AsciiGraph, dir: 'LR' | 'TD'): void {
  const roots = graph.subgraphs.filter(sg => sg.parent === null && sg.nodes.length > 0)
  const rootMembers = new Set(roots.flatMap(sg => sg.nodes))
  const externalBounds = graph.nodes
    .filter(node => !rootMembers.has(node))
    .map(nodeBounds)
    .filter((bounds): bounds is GridBounds => bounds !== null)
  const settled: GridBounds[] = []
  const frameHalo = 1

  for (const sg of roots) {
    const members = [...new Set(sg.nodes)]
    const original = boundsOfNodes(members)
    if (!original) continue

    let shift = 0
    while (true) {
      const candidate = shiftedBounds(original, dir, shift)
      const candidateFrame = expandedBounds(candidate, frameHalo)
      const settledBlockers = settled
        .filter(bounds => subgraphFramesMayOverlap(bounds, candidate, frameHalo, dir))
        .map(bounds => expandedBounds(bounds, frameHalo))
      const externalBlockers = externalBounds
        .filter(bounds => boundsOverlap(bounds, candidateFrame))
      const blockers = [...settledBlockers, ...externalBlockers]
      if (blockers.length === 0) break

      // Move the whole member envelope just beyond every conflicting frame or
      // outside node. The extra halo keeps the rendered border itself out of
      // the blocker instead of merely preventing member-node collisions.
      const blockerEnd = Math.max(...blockers.map(bounds => (dir === 'LR' ? bounds.maxY : bounds.maxX)))
      const nextMemberStart = blockerEnd + frameHalo + 1
      shift = nextMemberStart - (dir === 'LR' ? original.minY : original.minX)
    }

    if (shift > 0) {
      for (const node of members) {
        if (!node.gridCoord) continue
        if (dir === 'LR') node.gridCoord.y += shift
        else node.gridCoord.x += shift
      }
    }
    const finalBounds = shiftedBounds(original, dir, shift)
    settled.push(finalBounds)

    // Frames extend two cells on every side, plus two header rows above.
    // Preserve a visible gap even when targetWidth reduces normal padding.
    if (shift > 0) {
      if (dir === 'LR') {
        const spacerRow = finalBounds.minY - 1
        graph.rowHeight.set(spacerRow, Math.max(graph.rowHeight.get(spacerRow) ?? 0, 7))
      } else {
        const spacerColumn = finalBounds.minX - 1
        graph.columnWidth.set(spacerColumn, Math.max(graph.columnWidth.get(spacerColumn) ?? 0, 5))
      }
    }
  }

  graph.grid.clear()
  for (const node of graph.nodes) {
    if (!node.gridCoord) continue
    for (let dx = 0; dx < 3; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        graph.grid.set(gridKey({ x: node.gridCoord.x + dx, y: node.gridCoord.y + dy }), node)
      }
    }
  }
}

/**
 * Offset all drawing coordinates so subgraph borders don't go negative.
 * If any subgraph has negative min coordinates, shift everything positive.
 */
export function offsetDrawingForSubgraphs(graph: AsciiGraph): void {
  if (graph.subgraphs.length === 0) return

  let minX = 0
  let minY = 0
  for (const sg of graph.subgraphs) {
    minX = Math.min(minX, sg.minX)
    minY = Math.min(minY, sg.minY)
  }

  for (const edge of graph.edges) if (edge.cellAllocation) for (const start of [true, false]) {
    const group = start ? edge.attachFromSubgraph ?? edge.fromSubgraph : edge.attachToSubgraph ?? edge.toSubgraph
    const node = start ? edge.from : edge.to, direction = start ? edge.startDir : edge.endDir
    if (direction.x === 0) minX = Math.min(minX, (group?.minX ?? node.drawingCoord!.x) - graphEdgeEscape(edge, start))
    if (direction.y === 0) minY = Math.min(minY, (group?.minY ?? node.drawingCoord!.y) - graphEdgeEscape(edge, start))
  }

  const offsetX = -minX
  const offsetY = -minY
  if (offsetX === 0 && offsetY === 0) return

  graph.offsetX = offsetX
  graph.offsetY = offsetY

  for (const sg of graph.subgraphs) {
    sg.minX += offsetX
    sg.minY += offsetY
    sg.maxX += offsetX
    sg.maxY += offsetY
  }

  for (const node of graph.nodes) {
    if (node.drawingCoord) {
      node.drawingCoord.x += offsetX
      node.drawingCoord.y += offsetY
    }
  }
}

// ============================================================================
// Main layout orchestrator
// ============================================================================

/**
 * createMapping performs the full grid layout:
 * 1. Place root nodes on the grid
 * 2. Place child nodes level by level
 * 3. Compute column widths and row heights
 * 4. Run A* pathfinding for all edges
 * 5. Determine label placement
 * 6. Convert grid coords → drawing coords
 * 7. Generate node box drawings
 * 8. Calculate subgraph bounding boxes
 */
export function createMapping(graph: AsciiGraph): void {
  const dir = graph.config.graphDirection
  // Sparse level tracker — levels grow by 4 per generation, so a fixed-size
  // array would run out on deep chains (a ~25-node chain already reaches
  // level 100) and the resulting `undefined` positions turned into NaN grid
  // coordinates that sent A* pathfinding into an unbounded search (hang).
  const highestPositionPerLevel = new Map<number, number>()
  const levelPos = (level: number): number => highestPositionPerLevel.get(level) ?? 0

  // Identify root nodes — nodes that aren't the target of any edge
  const nodesFound = new Set<string>()
  const initialRoots: AsciiNode[] = []

  for (const node of graph.nodes) {
    if (!nodesFound.has(node.name)) {
      initialRoots.push(node)
    }
    nodesFound.add(node.name)
    for (const child of getChildren(graph, node)) {
      nodesFound.add(child.name)
    }
  }

  // Filter out subgraph nodes that have incoming edges from external sources.
  // This handles the case where subgraph is declared before external nodes
  // (e.g., `subgraph s; A-->B; end; X-->A` - A shouldn't be a root, X should).
  const rootNodes = initialRoots.filter(node => {
    const nodeSg = getNodeSubgraph(graph, node)
    if (!nodeSg) return true  // external nodes: keep as roots

    // Check if this subgraph node has incoming edges from outside its subgraph
    for (const edge of graph.edges) {
      if (edge.to === node) {
        const sourceSg = getNodeSubgraph(graph, edge.from)
        if (sourceSg !== nodeSg) {
          return false  // has external incoming edge → not a root
        }
      }
    }
    return true
  })

  // In LR mode with both external and subgraph roots, separate them
  // so subgraph roots are placed one level deeper
  let hasExternalRoots = false
  let hasSubgraphRootsWithEdges = false
  for (const node of rootNodes) {
    if (isNodeInAnySubgraph(graph, node)) {
      if (getChildren(graph, node).length > 0) hasSubgraphRootsWithEdges = true
    } else {
      hasExternalRoots = true
    }
  }
  const shouldSeparate = dir === 'LR' && hasExternalRoots && hasSubgraphRootsWithEdges

  let externalRootNodes: AsciiNode[]
  let subgraphRootNodes: AsciiNode[] = []

  if (shouldSeparate) {
    externalRootNodes = rootNodes.filter(n => !isNodeInAnySubgraph(graph, n))
    subgraphRootNodes = rootNodes.filter(n => isNodeInAnySubgraph(graph, n))
  } else {
    externalRootNodes = rootNodes
  }

  // Group roots that feed the same first target so they sit contiguously
  // (upstream lukilabs#69): interleaved declarations otherwise scatter each
  // fan-in group across the level and their edge trunks cross. The sort is
  // stable, so declaration order survives within each group and graphs
  // without shared targets are unaffected.
  const rootGroupKey = (n: AsciiNode): string => {
    const kids = getChildren(graph, n)
    return kids.length > 0 ? kids[0]!.name : `__ungrouped__${n.name}`
  }
  const rootGroupOrder = new Map<string, number>()
  for (const n of externalRootNodes) {
    const k = rootGroupKey(n)
    if (!rootGroupOrder.has(k)) rootGroupOrder.set(k, rootGroupOrder.size)
  }
  externalRootNodes = [...externalRootNodes]
    .sort((a, b) => rootGroupOrder.get(rootGroupKey(a))! - rootGroupOrder.get(rootGroupKey(b))!)

  // Forward in-degree per node, for fan-in target alignment below
  // (fan-in trunk grouping, issues #68/#69). SVG and ASCII now share the
  // classifier from route-contracts.ts; only primary-forward edges contribute
  // to deepest-parent placement.
  const inDegree = new Map<string, number>()
  // Forward parents per child (same exclusions as inDegree): used for
  // longest-path layering, so a fan-in target waits for its DEEPEST parent
  // instead of being parked at the level of whichever parent places first
  // (which made later parents' edges run backward — issue #25 criterion 1).
  const forwardParents = new Map<string, Array<typeof graph.nodes[number]>>()
  for (const edge of graph.edges) {
    // Skip self-loops: a node is not its own fan-in source (issues #68/#69).
    if (edge.from.name === edge.to.name) continue
    if (edge.routeClass !== 'primary-forward') continue
    inDegree.set(edge.to.name, (inDegree.get(edge.to.name) ?? 0) + 1)
    if (!forwardParents.has(edge.to.name)) forwardParents.set(edge.to.name, [])
    forwardParents.get(edge.to.name)!.push(edge.from)
  }

  // Place external root nodes
  for (const node of externalRootNodes) {
    const requested: GridCoord = dir === 'LR'
      ? { x: 0, y: levelPos(0) }
      : { x: levelPos(0), y: 0 }
    reserveSpotInGrid(graph, graph.nodes[node.index]!, requested)
    highestPositionPerLevel.set(0, levelPos(0) + 4)
  }

  // Place subgraph root nodes at level 4 (one level in from the edge)
  if (shouldSeparate && subgraphRootNodes.length > 0) {
    const subgraphLevel = 4
    for (const node of subgraphRootNodes) {
      const requested: GridCoord = dir === 'LR'
        ? { x: subgraphLevel, y: levelPos(subgraphLevel) }
        : { x: levelPos(subgraphLevel), y: subgraphLevel }
      reserveSpotInGrid(graph, graph.nodes[node.index]!, requested)
      highestPositionPerLevel.set(subgraphLevel, levelPos(subgraphLevel) + 4)
    }
  }

  // Place child nodes level by level
  // Use subgraph direction only when both parent and child are in the same subgraph
  // Multi-pass: iterate until all nodes are placed (handles non-topological node order)
  // Note: when shouldSeparate, externalRootNodes + subgraphRootNodes = rootNodes
  //       otherwise, externalRootNodes = rootNodes and subgraphRootNodes is empty
  let placedCount = externalRootNodes.length + subgraphRootNodes.length
  // Longest-path layering needs cycle tolerance: when a whole pass places
  // nothing because children are waiting on parents stuck in a cycle, one
  // forced pass falls back to greedy placement, then waiting resumes.
  let force = false
  while (placedCount < graph.nodes.length) {
    const prevCount = placedCount
    for (const node of graph.nodes) {
      if (node.gridCoord === null) continue  // skip unplaced nodes
      const gc = node.gridCoord

      for (const edge of getEdgesFromNode(graph, node)) {
        const child = edge.to
        if (child.gridCoord !== null) continue // already placed
        // Longest-path layering: wait until every forward parent is placed,
        // so the child lands after its deepest parent.
        if (!force && (forwardParents.get(child.name) ?? []).some(p => p.gridCoord === null)) continue

        // Determine direction for this edge (parent -> child)
        // Use subgraph direction only if both are in the same subgraph with override
        const parentSg = getNodeSubgraph(graph, node)
        const childSg = getNodeSubgraph(graph, child)
        const edgeDir = (parentSg && parentSg === childSg && parentSg.direction)
          ? parentSg.direction
          : graph.config.graphDirection

        // Longest path: the child's level comes from its deepest placed
        // forward parent, not from whichever parent iterates first.
        let parentLevel = edgeDir === 'LR' ? gc.x : gc.y
        if (edgeDir === graph.config.graphDirection) {
          for (const parent of forwardParents.get(child.name) ?? []) {
            if (parent.gridCoord === null) continue
            parentLevel = Math.max(parentLevel, edgeDir === 'LR' ? parent.gridCoord.x : parent.gridCoord.y)
          }
        }
        const childLevel = parentLevel + 4

        // Determine position based on direction context
        let highestPosition: number
        if (edgeDir !== graph.config.graphDirection) {
          // Cross-direction: use parent's perpendicular coordinate
          // This keeps children aligned with parent when direction changes
          highestPosition = edgeDir === 'LR' ? gc.y : gc.x
        } else if (edge.fromSubgraph) {
          // Container-to-node edges should emerge from the subgraph's anchor
          // side, not from the next free root slot, otherwise a TD edge from a
          // subgraph to a following node can jump sideways and render backward.
          highestPosition = Math.max(
            levelPos(childLevel),
            edgeDir === 'LR' ? gc.y : gc.x,
          )
        } else if ((inDegree.get(child.name) ?? 0) > 1) {
          // Fan-in target: align with the parent group's perpendicular
          // position (upstream lukilabs#69) instead of the next sequential
          // slot, so each target sits under its own root group and trunk
          // rows of different fan-in groups don't collide.
          highestPosition = Math.max(
            levelPos(childLevel),
            edgeDir === 'LR' ? gc.y : gc.x,
          )
        } else {
          // Same direction: use level tracker
          highestPosition = levelPos(childLevel)
        }

        const requested: GridCoord = edgeDir === 'LR'
          ? { x: childLevel, y: highestPosition }
          : { x: highestPosition, y: childLevel }
        reserveSpotInGrid(graph, graph.nodes[child.index]!, requested, edgeDir)

        // Only update level tracker for same-direction placements
        if (edgeDir === graph.config.graphDirection) {
          highestPositionPerLevel.set(childLevel, highestPosition + 4)
        }
        placedCount++
      }
    }
    if (placedCount === prevCount) {
      // A component may have no surviving root after container entry filtering.
      // Seed one unplaced member, preferring an external node, then let the
      // ordinary child allocator place the rest of that component.
      if (force) {
        const unplaced = graph.nodes.filter(node => node.gridCoord === null)
        const seed = unplaced.find(node => !isNodeInAnySubgraph(graph, node)) ?? unplaced[0]
        if (!seed) break
        reserveSpotInGrid(graph, seed, dir === 'LR' ? { x: 0, y: levelPos(0) } : { x: levelPos(0), y: 0 })
        highestPositionPerLevel.set(0, levelPos(0) + 4)
        placedCount++
        force = false
        continue
      }
      force = true
    } else {
      force = false
    }
  }

  separateRootSubgraphLanes(graph, dir)
  placeCompoundItems(graph)
  if (graph.compoundRepacked) { graph.columnWidth.clear(); graph.rowHeight.clear() }

  // Compute column widths and row heights
  for (const node of graph.nodes) {
    setColumnWidth(graph, node)
  }
  reserveSubgraphHeaders(graph)

  // Analyze edges for bundling (parallel links like A & B --> C)
  // This groups edges that share sources or targets for cleaner visualization
  graph.bundles = analyzeEdgeBundles(graph)

  // Route bundled edges through junction points
  processBundles(graph)

  // Route non-bundled edges via A* and determine label positions
  for (const edge of graph.edges) {
    // Skip edges already routed as part of a bundle. processBundles draws the
    // shared trunk once and writes each member's path; re-running A* here would
    // overwrite that path and break the merged junction. The path.length guard
    // ensures we only skip edges that actually received a routed path.
    if (edge.bundle && edge.path.length > 0) {
      increaseGridSizeForPath(graph, edge.path)
      determineLabelLine(graph, edge)
      continue
    }

    determinePath(graph, edge)
    increaseGridSizeForPath(graph, edge.path)
    determineLabelLine(graph, edge)
  }

  shareSiblingEdgeTrunks(graph)
  reserveMarkerPorts(graph)

  if (graph.config.reverseDirection) {
    mirrorHorizontalGrid(graph)
    // Reflection exchanges the shared block columns. Measure readable cards
    // and headers in that final projection before allocating physical faces.
    for (const node of graph.nodes) setColumnWidth(graph, node)
    reserveSubgraphHeaders(graph)
  }

  const units = graphRoutingUnits(graph), selected = new Set<AsciiEdge>()
  const original = {
    columns: new Map(graph.columnWidth), rows: new Map(graph.rowHeight),
    bundles: graph.bundles, junctions: graph.trunkJunctions,
    edges: new Map(graph.edges.map(edge => [edge, { startDir: edge.startDir, endDir: edge.endDir, bundle: edge.bundle, sharedTrunk: edge.sharedTrunk, pathToJunction: edge.pathToJunction }])),
    insets: new Map(graph.subgraphs.map(group => [group, group.insets ? { ...group.insets } : undefined])),
    canvas: graph.canvas, drawn: new Map(graph.nodes.map(node => [node, node.drawn])),
  }
  const project = (): void => {
    graph.columnWidth = new Map(original.columns); graph.rowHeight = new Map(original.rows)
    graph.offsetX = 0; graph.offsetY = 0; graph.canvas = original.canvas.blank()
    graph.canvas.overlay(original.canvas)
    for (const [group, insets] of original.insets) group.insets = insets ? { ...insets } : undefined
    for (const [edge, route] of original.edges) {
      Object.assign(edge, route); delete edge.cellAllocation; delete edge.cellRoute
      if (selected.has(edge)) { delete edge.bundle; delete edge.sharedTrunk; delete edge.pathToJunction }
    }
    graph.bundles = original.bundles.filter(bundle => !bundle.edges.some(edge => selected.has(edge)))
    const retainedTrunks = new Set(graph.edges.filter(edge => !selected.has(edge)).map(edge => edge.sharedTrunk))
    graph.trunkJunctions = original.junctions.filter(junction => retainedTrunks.has(junction.trunk))
    reserveGraphEdgeCapacity(graph, () => projectNodeEnvelopes(graph), selected)
    reserveProtectedEnvelopes(graph)
    for (const node of graph.nodes) {
      node.drawn = original.drawn.get(node)!
      node.drawingCoord = gridToDrawingCoord(graph, node.gridCoord!)
      node.drawing = drawBox(node, graph)
    }
    setCanvasSizeToGrid(graph.canvas, graph.columnWidth, graph.rowHeight)
    calculateSubgraphBoundingBoxes(graph)
    offsetDrawingForSubgraphs(graph)
  }
  graph.reserveRouteUnits = edges => {
    const before = selected.size
    for (const edge of edges) for (const member of units.get(edge) ?? [edge]) selected.add(member)
    if (selected.size === before) return false
    project(); return true
  }
  if (!graph.reserveRouteUnits(unsafeGraphContacts(graph))) project()

}

// ============================================================================
// Reverse-direction projection
// ============================================================================

function mirrorHorizontalDirection(direction: Direction): Direction {
  return { x: 2 - direction.x, y: direction.y }
}

/**
 * Mirror the completed LR logical grid before drawing. Text is drawn only
 * after this projection, so labels retain reading order while node placement,
 * routes, markers, bundles, and junctions become a genuine RL layout.
 */
function mirrorHorizontalGrid(graph: AsciiGraph): void {
  const maxX = Math.max(0, ...graph.columnWidth.keys())
  const point = (value: GridCoord): GridCoord => ({ x: maxX - value.x, y: value.y })

  for (const node of graph.nodes) {
    const coord = node.gridCoord!
    node.gridCoord = { x: maxX - (coord.x + 2), y: coord.y }
  }
  for (const edge of graph.edges) {
    edge.path = edge.path.map(point)
    edge.labelLine = edge.labelLine.map(point)
    edge.startDir = mirrorHorizontalDirection(edge.startDir)
    edge.endDir = mirrorHorizontalDirection(edge.endDir)
  }
  // TD is the only bundling mode, so an LR-derived RL projection has no
  // EdgeBundle/pathToJunction state to mirror.
  graph.trunkJunctions = graph.trunkJunctions.map(junction => ({ ...point(junction), trunk: junction.trunk }))

  const mirroredGrid = new OccupancyMap<AsciiNode>()
  for (const [key, node] of graph.grid) {
    const [x, y] = key.split(',').map(Number)
    mirroredGrid.set(gridKey({ x: maxX - x!, y: y! }), node)
  }
  graph.grid = mirroredGrid
  graph.columnWidth = new Map([...graph.columnWidth].map(([x, width]) => [maxX - x, width]))
}

// ============================================================================
// Sibling trunk sharing
// ============================================================================

/**
 * Re-route sibling edges from the same source/start side through the first
 * edge's initial trunk. This fixes labeled fan-outs that cannot use bundle
 * routing: A* otherwise solves each sibling independently and can send later
 * branches on avoidable L-shaped detours (trunk sharing, issues #111/#113).
 */
function shareSiblingEdgeTrunks(graph: AsciiGraph): void {
  const groups = new Map<string, AsciiEdge[]>()
  for (const edge of graph.edges) {
    // Bundled edges already share a routed trunk via processBundles; sharing
    // again here would fight that routing (issues #111/#113).
    if (edge.bundle) continue
    const key = `${edge.from.name}:${edge.startDir.x},${edge.startDir.y}:${edge.style}:${edge.inlineStyle?.stroke ?? ''}`
    const list = groups.get(key) ?? []
    list.push(edge)
    groups.set(key, list)
  }

  const junctionKeys = new Set(graph.trunkJunctions.map(junction => `${junction.trunk}:${gridKey(junction)}`))

  for (const edges of groups.values()) {
    if (edges.length < 2) continue
    // Self-loops have no meaningful trunk to share and would inject a spurious
    // junction; exclude any group containing one (issues #111/#113).
    if (edges.some(e => e.from === e.to)) continue

    const first = edges[0]!
    const firstPath = first.path
    let branchIdx = -1
    if (firstPath.length >= 3) {
      const dx = firstPath[1]!.x - firstPath[0]!.x
      const dy = firstPath[1]!.y - firstPath[0]!.y
      for (let i = 2; i < firstPath.length; i++) {
        const ndx = firstPath[i]!.x - firstPath[i - 1]!.x
        const ndy = firstPath[i]!.y - firstPath[i - 1]!.y
        if (ndx !== dx || ndy !== dy) {
          branchIdx = i - 1
          break
        }
      }
    }
    if (branchIdx === -1) continue

    const trunk = firstPath.slice(0, branchIdx + 1)
    const branchPoint = firstPath[branchIdx]!

    for (let i = 1; i < edges.length; i++) {
      const edge = edges[i]!
      const target = gridCoordDirection(edge.to.gridCoord!, edge.endDir)
      const route = getPath(graph.grid, branchPoint, target, edge.startDir)
      if (!route) continue

      edge.path = [...trunk, ...mergePath(route).slice(1)]
      first.sharedTrunk ??= `trunk:${first.id ?? first.sourceIndex}`
      edge.sharedTrunk = first.sharedTrunk
      const key = `${first.sharedTrunk}:${gridKey(branchPoint)}`
      if (!junctionKeys.has(key)) {
        graph.trunkJunctions.push({ ...branchPoint, trunk: first.sharedTrunk })
        junctionKeys.add(key)
      }
      increaseGridSizeForPath(graph, edge.path)
      determineLabelLine(graph, edge)
    }
  }
}

// ============================================================================
// Graph traversal helpers
// ============================================================================

/** Get all edges originating from a node. */
function getEdgesFromNode(graph: AsciiGraph, node: AsciiNode): AsciiGraph['edges'] {
  return graph.edges.filter(e => e.from.name === node.name)
}

/** Get all direct children of a node (targets of outgoing edges). */
function getChildren(graph: AsciiGraph, node: AsciiNode): AsciiNode[] {
  return getEdgesFromNode(graph, node).map(e => e.to)
}
