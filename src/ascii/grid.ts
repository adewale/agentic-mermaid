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
import { mkCanvas, setCanvasSizeToGrid, setRoleCanvasSizeToGrid } from './canvas.ts'
import { determinePath, determineLabelLine } from './edge-routing.ts'
import { getPath, mergePath } from './pathfinder.ts'
import { analyzeEdgeBundles, processBundles } from './edge-bundling.ts'
import { drawBox } from './draw.ts'
import { maxLineWidth, lineCount } from './multiline-utils.ts'
import { getShapeDimensions } from './shapes/index.ts'

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

function calculateSubgraphBoundingBox(graph: AsciiGraph, sg: AsciiSubgraph): void {
  if (sg.nodes.length === 0) return

  let minX = 1_000_000
  let minY = 1_000_000
  let maxX = -1_000_000
  let maxY = -1_000_000

  // Include children's bounding boxes
  for (const child of sg.children) {
    calculateSubgraphBoundingBox(graph, child)
    if (child.nodes.length > 0) {
      minX = Math.min(minX, child.minX)
      minY = Math.min(minY, child.minY)
      maxX = Math.max(maxX, child.maxX)
      maxY = Math.max(maxY, child.maxY)
    }
  }

  // Include node positions
  for (const node of sg.nodes) {
    if (!node.drawingCoord || !node.drawing) continue
    const nodeMinX = node.drawingCoord.x
    const nodeMinY = node.drawingCoord.y
    const nodeMaxX = nodeMinX + node.drawing.length - 1
    const nodeMaxY = nodeMinY + node.drawing[0]!.length - 1
    minX = Math.min(minX, nodeMinX)
    minY = Math.min(minY, nodeMinY)
    maxX = Math.max(maxX, nodeMaxX)
    maxY = Math.max(maxY, nodeMaxY)
  }

  const subgraphPadding = 2
  const subgraphLabelSpace = 2
  sg.minX = minX - subgraphPadding
  sg.minY = minY - subgraphPadding - subgraphLabelSpace
  sg.maxX = maxX + subgraphPadding
  sg.maxY = maxY + subgraphPadding
}

export function calculateSubgraphBoundingBoxes(graph: AsciiGraph): void {
  for (const sg of graph.subgraphs) {
    calculateSubgraphBoundingBox(graph, sg)
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
      // Safety: break if even a forced pass made no progress (disconnected
      // nodes). A first stall means children are waiting on a cycle — run
      // one greedy pass to break the deadlock, then resume waiting.
      if (force) break
      force = true
    } else {
      force = false
    }
  }

  separateRootSubgraphLanes(graph, dir)

  // Compute column widths and row heights
  for (const node of graph.nodes) {
    setColumnWidth(graph, node)
  }

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

  if (graph.config.reverseDirection) {
    mirrorHorizontalGrid(graph)
  }

  // Convert grid coords → drawing coords and generate box drawings
  for (const node of graph.nodes) {
    node.drawingCoord = gridToDrawingCoord(graph, node.gridCoord!)
    node.drawing = drawBox(node, graph)
  }

  // Set canvas size and compute subgraph bounding boxes
  setCanvasSizeToGrid(graph.canvas, graph.columnWidth, graph.rowHeight)
  setRoleCanvasSizeToGrid(graph.roleCanvas, graph.columnWidth, graph.rowHeight)
  calculateSubgraphBoundingBoxes(graph)
  offsetDrawingForSubgraphs(graph)
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
  graph.trunkJunctions = graph.trunkJunctions.map(point)

  const mirroredGrid = new Map<string, AsciiNode>()
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
    const key = `${edge.from.name}:${edge.startDir.x},${edge.startDir.y}`
    const list = groups.get(key) ?? []
    list.push(edge)
    groups.set(key, list)
  }

  const junctionKeys = new Set(graph.trunkJunctions.map(gridKey))

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
      const key = gridKey(branchPoint)
      if (!junctionKeys.has(key)) {
        graph.trunkJunctions.push(branchPoint)
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
