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

/** Ensure non-overlapping root subgraphs have minimum spacing. */
function ensureSubgraphSpacing(graph: AsciiGraph): void {
  const minSpacing = 1
  const rootSubgraphs = graph.subgraphs.filter(sg => sg.parent === null && sg.nodes.length > 0)

  for (let i = 0; i < rootSubgraphs.length; i++) {
    for (let j = i + 1; j < rootSubgraphs.length; j++) {
      const sg1 = rootSubgraphs[i]!
      const sg2 = rootSubgraphs[j]!

      // Horizontal overlap → adjust vertical
      if (sg1.minX < sg2.maxX && sg1.maxX > sg2.minX) {
        if (sg1.maxY >= sg2.minY - minSpacing && sg1.minY < sg2.minY) {
          sg2.minY = sg1.maxY + minSpacing + 1
        } else if (sg2.maxY >= sg1.minY - minSpacing && sg2.minY < sg1.minY) {
          sg1.minY = sg2.maxY + minSpacing + 1
        }
      }
      // Vertical overlap → adjust horizontal
      if (sg1.minY < sg2.maxY && sg1.maxY > sg2.minY) {
        if (sg1.maxX >= sg2.minX - minSpacing && sg1.minX < sg2.minX) {
          sg2.minX = sg1.maxX + minSpacing + 1
        } else if (sg2.maxX >= sg1.minX - minSpacing && sg2.minX < sg1.minX) {
          sg1.minX = sg2.maxX + minSpacing + 1
        }
      }
    }
  }
}

export function calculateSubgraphBoundingBoxes(graph: AsciiGraph): void {
  for (const sg of graph.subgraphs) {
    calculateSubgraphBoundingBox(graph, sg)
  }
  ensureSubgraphSpacing(graph)
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
  const highestPositionPerLevel: number[] = new Array(100).fill(0)

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
  // (fan-in trunk grouping, issues #68/#69).
  // Self-loops and 2-cycle back-edges (A ⇄ B toggles, common in state
  // machines) are excluded: they are round-trips, not fan-in joins, and
  // aligning on them drags placements sideways. A degree that counts a
  // back-edge would mis-classify an ordinary node as a fan-in target.
  const outNeighbors = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    let s = outNeighbors.get(edge.from.name)
    if (!s) { s = new Set(); outNeighbors.set(edge.from.name, s) }
    s.add(edge.to.name)
  }
  const inDegree = new Map<string, number>()
  // Forward parents per child (same exclusions as inDegree): used for
  // longest-path layering, so a fan-in target waits for its DEEPEST parent
  // instead of being parked at the level of whichever parent places first
  // (which made later parents' edges run backward — issue #25 criterion 1).
  const forwardParents = new Map<string, Array<typeof graph.nodes[number]>>()
  for (const edge of graph.edges) {
    // Skip self-loops: a node is not its own fan-in source (issues #68/#69).
    if (edge.from.name === edge.to.name) continue
    // Skip 2-cycle back-edges: A→B paired with B→A is a round-trip, not a
    // join, so it must not inflate the target's fan-in degree (issues #68/#69).
    if (outNeighbors.get(edge.to.name)?.has(edge.from.name)) continue
    inDegree.set(edge.to.name, (inDegree.get(edge.to.name) ?? 0) + 1)
    if (!forwardParents.has(edge.to.name)) forwardParents.set(edge.to.name, [])
    forwardParents.get(edge.to.name)!.push(edge.from)
  }

  // Place external root nodes
  for (const node of externalRootNodes) {
    const requested: GridCoord = dir === 'LR'
      ? { x: 0, y: highestPositionPerLevel[0]! }
      : { x: highestPositionPerLevel[0]!, y: 0 }
    reserveSpotInGrid(graph, graph.nodes[node.index]!, requested)
    highestPositionPerLevel[0] = highestPositionPerLevel[0]! + 4
  }

  // Place subgraph root nodes at level 4 (one level in from the edge)
  if (shouldSeparate && subgraphRootNodes.length > 0) {
    const subgraphLevel = 4
    for (const node of subgraphRootNodes) {
      const requested: GridCoord = dir === 'LR'
        ? { x: subgraphLevel, y: highestPositionPerLevel[subgraphLevel]! }
        : { x: highestPositionPerLevel[subgraphLevel]!, y: subgraphLevel }
      reserveSpotInGrid(graph, graph.nodes[node.index]!, requested)
      highestPositionPerLevel[subgraphLevel] = highestPositionPerLevel[subgraphLevel]! + 4
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
            highestPositionPerLevel[childLevel]!,
            edgeDir === 'LR' ? gc.y : gc.x,
          )
        } else if ((inDegree.get(child.name) ?? 0) > 1) {
          // Fan-in target: align with the parent group's perpendicular
          // position (upstream lukilabs#69) instead of the next sequential
          // slot, so each target sits under its own root group and trunk
          // rows of different fan-in groups don't collide.
          highestPosition = Math.max(
            highestPositionPerLevel[childLevel]!,
            edgeDir === 'LR' ? gc.y : gc.x,
          )
        } else {
          // Same direction: use level tracker
          highestPosition = highestPositionPerLevel[childLevel]!
        }

        const requested: GridCoord = edgeDir === 'LR'
          ? { x: childLevel, y: highestPosition }
          : { x: highestPosition, y: childLevel }
        reserveSpotInGrid(graph, graph.nodes[child.index]!, requested, edgeDir)

        // Only update level tracker for same-direction placements
        if (edgeDir === graph.config.graphDirection) {
          highestPositionPerLevel[childLevel] = highestPosition + 4
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
