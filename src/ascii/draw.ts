// ============================================================================
// ASCII renderer — drawing operations
//
// Ported from AlexanderGrooff/mermaid-ascii cmd/draw.go + cmd/arrow.go.
// Contains all visual rendering: boxes, lines, arrows, corners,
// subgraphs, labels, and the top-level draw orchestrator.
// ============================================================================

import type {
  Canvas, DrawingCoord, GridCoord, Direction,
  AsciiGraph, AsciiNode, AsciiEdge, AsciiSubgraph, AsciiEdgeStyle, EdgeBundle, EdgeMarker,
} from './types.ts'
import {
  Up, Down, Left, Right, UpperLeft, UpperRight, LowerLeft, LowerRight, Middle,
  drawingCoordEquals,
} from './types.ts'
import { mkCanvas, copyCanvas, getCanvasSize, drawText } from './canvas.ts'
import type { CharRole } from './types.ts'
import { determineDirection, dirEquals } from './edge-routing.ts'
import { gridToDrawingCoord, lineToDrawing } from './grid.ts'
import { splitLines } from './multiline-utils.ts'
import { visualWidth } from './width.ts'
import { getCorners } from './shapes/corners.ts'
import { getShapeAttachmentPoint } from './shapes/index.ts'
import { safeCssColor } from '../shared/css-color.ts'
import { measuredText, terminalCellConnections, type MeasuredTerminalText, type TerminalCell, type TerminalMarker, type TerminalOwner, type TerminalSide } from './terminal-document.ts'
import type { PathOccupancy } from './occupancy.ts'
import { getPath, mergePath } from './pathfinder.ts'
import { allocateFacePort } from './terminal-geometry.ts'
import { graphEdgeEscape, allocatedGraphPort, graphEndpointOf, type GraphEndpoint } from './graph-capacity.ts'

/** Protect admitted headers and cards before routing in terminal cells. The
 * grid router cannot see text measured inside a container's header band. */
function protectedGraphCells(document: Canvas): PathOccupancy {
  const protectedCell = (cell: TerminalCell | undefined) => !!cell && (cell.kind !== 'stroke' || cell.owners.some(owner => owner.kind === 'node'))
  const textBlocks = new Set<NonNullable<TerminalCell['textBlock']>>()
  let maxX = 0, maxY = 0
  for (const [x, y, cell] of document.entries()) {
    if (protectedCell(cell)) { maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
    if (cell.kind === 'text' && cell.textBlock) textBlocks.add(cell.textBlock)
  }
  const textRows = new Map<number, Array<{ left: number; right: number }>>()
  for (const box of textBlocks) for (let y = box.y; y < box.y + box.height; y++) {
    const spans = textRows.get(y) ?? []; spans.push({ left: box.x, right: box.x + box.width }); textRows.set(y, spans)
  }
  // All routes are planned before any route ink is overlaid, so the admitted
  // document is already the stable occupancy store; do not duplicate its cells.
  const hasCell = (x: number, y: number): boolean =>
    protectedCell(document.cell(x, y)) || !!textRows.get(y)?.some(span => x >= span.left && x < span.right)
  return {
    extent: { maxX, maxY },
    hasCell,
    has(key) {
      const comma = key.indexOf(',')
      return hasCell(Number(key.slice(0, comma)), Number(key.slice(comma + 1)))
    },
  }
}

/** Keep every declared endpoint and its incident direction. Only a segment
 * whose interior crosses protected text needs a terminal-cell detour. */
function feasiblePolyline(poly: DrawingCoord[], protectedCells?: PathOccupancy): DrawingCoord[] {
  if (!protectedCells) return poly
  const result: DrawingCoord[] = [poly[0]!]
  for (let index = 1; index < poly.length; index++) {
    const start = poly[index - 1]!, end = poly[index]!
    const dx = Math.sign(end.x - start.x), dy = Math.sign(end.y - start.y)
    // Legacy diagonal projections retain their existing drawing policy.
    if (dx && dy) { result.push(end); continue }
    const distance = Math.abs(end.x - start.x) + Math.abs(end.y - start.y)
    let obstructed = false
    for (let step = 1; step < distance; step++) if (protectedCells.has(`${start.x + dx * step},${start.y + dy * step}`)) { obstructed = true; break }
    if (!obstructed || distance < 4) { result.push(end); continue }
    const exit = { x: start.x + dx, y: start.y + dy }
    // Keep a straight cell before a terminal marker: a marker cannot also
    // encode a right-angle bend immediately beside its endpoint.
    const entry = { x: end.x - dx * 2, y: end.y - dy * 2 }
    const incidentCells = new Set([`${start.x},${start.y}`, `${end.x},${end.y}`, `${end.x - dx},${end.y - dy}`])
    const obstacles: PathOccupancy = { extent: protectedCells.extent, has: key => incidentCells.has(key) || protectedCells.has(key) }
    const path = !protectedCells.has(`${exit.x},${exit.y}`) && !protectedCells.has(`${entry.x},${entry.y}`)
      ? getPath(obstacles, exit, entry, determineDirection(start, end)) : null
    if (path) result.push(...mergePath(path), end)
    else result.push(end)
  }
  return dedupeCollinear(result)
}

// ============================================================================
// Node drawing — renders a node using shape-aware rendering
// ============================================================================

/**
 * Draw a node using its shape type.
 * Returns a standalone canvas containing the rendered shape.
 *
 * For basic shapes (rectangle, rounded), uses grid-determined dimensions
 * to ensure consistent sizing across nodes in the same column.
 * For special shapes (diamond, circle, state pseudo-states, etc.),
 * uses shape-specific dimension calculation but centers the content
 * within the grid cell dimensions to ensure proper vertical alignment.
 */
export function drawNode(node: AsciiNode, graph: AsciiGraph): Canvas {
  // All shapes use grid-determined dimensions to fill their allocated space.
  // This ensures consistent sizing across nodes and eliminates gaps between
  // nodes and subgraph borders. All shapes are rectangles with distinctive
  // corner characters (defined in corners.ts) to indicate shape type.
  return drawBoxWithGridDimensions(node, graph)
}

/**
 * Draw a box shape using grid-determined dimensions.
 * This ensures consistent sizing when multiple nodes share a column,
 * and eliminates gaps between nodes and subgraph borders by filling
 * the entire allocated grid space.
 *
 * All shapes are rendered as rectangles with distinctive corner characters
 * (defined in corners.ts) to indicate shape type.
 */
function drawBoxWithGridDimensions(node: AsciiNode, graph: AsciiGraph): Canvas {
  const gc = node.gridCoord!
  const useAscii = graph.config.useAscii

  // Width spans 2 columns (border + content) - matching original behavior
  let w = 0
  for (let i = 0; i < 2; i++) {
    w += graph.columnWidth.get(gc.x + i) ?? 0
  }
  // Height spans 2 rows (border + content)
  let h = 0
  for (let i = 0; i < 2; i++) {
    h += graph.rowHeight.get(gc.y + i) ?? 0
  }

  const from: DrawingCoord = { x: 0, y: 0 }
  const to: DrawingCoord = { x: w, y: h }
  const box = mkCanvas(Math.max(from.x, to.x), Math.max(from.y, to.y))

  const parent = graph.subgraphs.filter(group => group.nodes.includes(node)).at(-1)
  return box.scope({ id: node.name, kind: 'node', ...(parent ? { parent: { id: parent.id, kind: graph.containerKind ?? 'subgraph' } } : {}) }, () => {
  box.fill(1, 1, Math.max(0, w - 1), Math.max(0, h - 1))
  // Get corner characters for this shape type
  const corners = getCorners(node.shape, useAscii)

  // State-end uses double border to differentiate from state-start
  const isDoubleBox = node.shape === 'state-end'
  const border = { ascii: useAscii, role: 'border' as const, style: isDoubleBox ? 'double' as const : 'solid' as const }
  for (let x = from.x + 1; x < to.x; x++) {
    box.stroke(x, from.y, 10, border)
    box.stroke(x, to.y, 10, border)
  }
  for (let y = from.y + 1; y < to.y; y++) {
    box.stroke(from.x, y, 5, border)
    box.stroke(to.x, y, 5, border)
  }
  const standard = node.shape === 'rectangle' || node.shape === 'service'
  const rounded = !useAscii && (node.shape === 'rounded' || node.shape === 'cylinder')
  const effectiveCorners = isDoubleBox
    ? useAscii ? { tl: '#', tr: '#', bl: '#', br: '#' } : { tl: '╔', tr: '╗', bl: '╚', br: '╝' }
    : corners
  for (const [x, y, mask, glyph] of [
    [from.x, from.y, 6, effectiveCorners.tl], [to.x, from.y, 12, effectiveCorners.tr],
    [from.x, to.y, 3, effectiveCorners.bl], [to.x, to.y, 9, effectiveCorners.br],
  ] as const) {
    if (standard || rounded || (isDoubleBox && !useAscii)) box.stroke(x, y, mask, { ...border, rounded })
    else box.put(x, y, glyph, { role: 'border', kind: 'marker' })
  }

  // Center the multi-line display label inside the box
  const label = node.displayLabel
  const lines = splitLines(label)
  const textCenterY = from.y + Math.floor(h / 2)
  const startY = textCenterY - Math.floor((lines.length - 1) / 2)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const textX = from.x + Math.floor(w / 2) - Math.ceil(visualWidth(line) / 2) + 1
    drawText(box, { x: textX, y: startY + i }, line, true)
  }

  for (const [, , cell] of box.entries()) {
    const color = safeCssColor(cell.kind === 'text' ? node.styleClass.styles.color : node.styleClass.styles.stroke)
    if (color) cell.color = color
  }

  return box
  })
}

/**
 * Draw a node box with centered label text.
 * Returns a standalone canvas containing just the box.
 * Box size is determined by the grid column/row sizes for the node's position.
 */
export function drawBox(node: AsciiNode, graph: AsciiGraph): Canvas {
  return drawNode(node, graph)
}

// ============================================================================
// Multi-section box drawing — for class and ER diagram nodes
// ============================================================================

/**
 * Draw a multi-section box with horizontal dividers between sections.
 * Used by class diagrams (header | attributes | methods) and ER diagrams (header | attributes).
 * Each section is an array of text lines to render left-aligned with padding.
 *
 * @param sections - Array of sections, each section is an array of text lines
 * @param useAscii - true for ASCII chars, false for Unicode box-drawing
 * @param padding - horizontal padding inside the box (default 1)
 * @returns A standalone Canvas containing the multi-section box
 */
export function drawMultiBox(
  sections: string[][],
  useAscii: boolean,
  padding: number = 1,
  minSize: { width?: number; height?: number } = {},
): Canvas {
  // Compute width: widest line across all sections + 2*padding + 2 border chars
  let maxTextWidth = 0
  for (const section of sections) {
    for (const line of section) {
      maxTextWidth = Math.max(maxTextWidth, visualWidth(line))
    }
  }
  const innerWidth = maxTextWidth + 2 * padding
  const boxWidth = Math.max(innerWidth + 2, minSize.width ?? 0)

  // Compute height: sum of all section line counts + dividers + 2 border rows
  let totalLines = 0
  for (const section of sections) {
    totalLines += Math.max(section.length, 1) // at least 1 row per section
  }
  const numDividers = sections.length - 1
  const boxHeight = Math.max(totalLines + numDividers + 2, minSize.height ?? 0)

  const canvas = mkCanvas(boxWidth - 1, boxHeight - 1)
  const border = { ascii: useAscii, role: 'border' as const }
  canvas.stroke(0, 0, 6, border)
  canvas.stroke(boxWidth - 1, 0, 12, border)
  canvas.stroke(0, boxHeight - 1, 3, border)
  canvas.stroke(boxWidth - 1, boxHeight - 1, 9, border)
  for (let x = 1; x < boxWidth - 1; x++) {
    canvas.stroke(x, 0, 10, border)
    canvas.stroke(x, boxHeight - 1, 10, border)
  }
  for (let y = 1; y < boxHeight - 1; y++) {
    canvas.stroke(0, y, 5, border)
    canvas.stroke(boxWidth - 1, y, 5, border)
  }

  // Render sections with dividers
  let row = 1 // current y position (starts after top border)
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s]!
    const lines = section.length > 0 ? section : ['']

    // Draw section text lines
    for (const line of lines) {
      const startX = 1 + padding
      drawText(canvas, { x: startX, y: row }, line, true)
      row++
    }

    // Draw divider after each section except the last
    if (s < sections.length - 1) {
      canvas.stroke(0, row, 7, border)
      for (let x = 1; x < boxWidth - 1; x++) canvas.stroke(x, row, 10, border)
      canvas.stroke(boxWidth - 1, row, 13, border)
      row++
    }
  }

  return canvas
}

// ============================================================================
// Line drawing — 8-directional lines on the canvas
// ============================================================================

/**
 * Draw a line between two drawing coordinates using orthogonal Manhattan routing.
 * Returns the list of coordinates that were drawn on.
 * offsetFrom/offsetTo control how many cells to skip at the start/end.
 *
 * All lines use 90° bends only - no diagonal lines are produced.
 * For diagonal directions, uses horizontal-first routing (draws horizontal
 * segment, then vertical segment).
 */
export function drawLine(
  canvas: Canvas,
  from: DrawingCoord,
  to: DrawingCoord,
  offsetFrom: number,
  offsetTo: number,
  useAscii: boolean,
  style: AsciiEdgeStyle = 'solid',
): DrawingCoord[] {
  const dir = determineDirection(from, to)
  const drawnCoords: DrawingCoord[] = []

  const paint = { ascii: useAscii, style: style === 'thick' ? 'heavy' as const : style === 'dotted' ? 'dotted' as const : 'solid' as const }

  // Pure vertical directions
  if (dirEquals(dir, Up)) {
    for (let y = from.y - offsetFrom; y >= to.y - offsetTo; y--) {
      drawnCoords.push({ x: from.x, y })
      canvas.stroke(from.x, y, 5, paint)
    }
  } else if (dirEquals(dir, Down)) {
    for (let y = from.y + offsetFrom; y <= to.y + offsetTo; y++) {
      drawnCoords.push({ x: from.x, y })
      canvas.stroke(from.x, y, 5, paint)
    }
  }
  // Pure horizontal directions
  else if (dirEquals(dir, Left)) {
    for (let x = from.x - offsetFrom; x >= to.x - offsetTo; x--) {
      drawnCoords.push({ x, y: from.y })
      canvas.stroke(x, from.y, 10, paint)
    }
  } else if (dirEquals(dir, Right)) {
    for (let x = from.x + offsetFrom; x <= to.x + offsetTo; x++) {
      drawnCoords.push({ x, y: from.y })
      canvas.stroke(x, from.y, 10, paint)
    }
  }
  // Diagonal directions: use Manhattan routing (horizontal-first, then vertical)
  // UpperLeft: go left first, then up
  else if (dirEquals(dir, UpperLeft)) {
    // Horizontal segment: from.x -> to.x (going left)
    for (let x = from.x - offsetFrom; x >= to.x; x--) {
      drawnCoords.push({ x, y: from.y })
      canvas.stroke(x, from.y, 10, paint)
    }
    // Vertical segment: from.y -> to.y (going up)
    for (let y = from.y - 1; y >= to.y - offsetTo; y--) {
      drawnCoords.push({ x: to.x, y })
      canvas.stroke(to.x, y, 5, paint)
    }
  }
  // UpperRight: go right first, then up
  else if (dirEquals(dir, UpperRight)) {
    // Horizontal segment: from.x -> to.x (going right)
    for (let x = from.x + offsetFrom; x <= to.x; x++) {
      drawnCoords.push({ x, y: from.y })
      canvas.stroke(x, from.y, 10, paint)
    }
    // Vertical segment: from.y -> to.y (going up)
    for (let y = from.y - 1; y >= to.y - offsetTo; y--) {
      drawnCoords.push({ x: to.x, y })
      canvas.stroke(to.x, y, 5, paint)
    }
  }
  // LowerLeft: go left first, then down
  else if (dirEquals(dir, LowerLeft)) {
    // Horizontal segment: from.x -> to.x (going left)
    for (let x = from.x - offsetFrom; x >= to.x; x--) {
      drawnCoords.push({ x, y: from.y })
      canvas.stroke(x, from.y, 10, paint)
    }
    // Vertical segment: from.y -> to.y (going down)
    for (let y = from.y + 1; y <= to.y + offsetTo; y++) {
      drawnCoords.push({ x: to.x, y })
      canvas.stroke(to.x, y, 5, paint)
    }
  }
  // LowerRight: go right first, then down
  // Special case: if x difference is small (1), draw straight vertical at from.x
  // This keeps edges visually aligned with the source node
  else if (dirEquals(dir, LowerRight)) {
    const dx = to.x - from.x
    if (dx <= 1) {
      // Draw vertical line at from.x (source's x-coordinate)
      for (let y = from.y + offsetFrom; y <= to.y + offsetTo; y++) {
        drawnCoords.push({ x: from.x, y })
        canvas.stroke(from.x, y, 5, paint)
      }
    } else {
      // Horizontal segment: from.x -> to.x (going right)
      for (let x = from.x + offsetFrom; x <= to.x; x++) {
        drawnCoords.push({ x, y: from.y })
        canvas.stroke(x, from.y, 10, paint)
      }
      // Vertical segment: from.y -> to.y (going down)
      for (let y = from.y + 1; y <= to.y + offsetTo; y++) {
        drawnCoords.push({ x: to.x, y })
        canvas.stroke(to.x, y, 5, paint)
      }
    }
  }

  return drawnCoords
}

// ============================================================================
// Arrow drawing — path, corners, arrowheads, box-start junctions, labels
// ============================================================================

/**
 * Draw a complete arrow (edge) between two nodes.
 * Returns 6 separate canvases for layered compositing:
 * [path, boxStart, arrowHeadEnd, arrowHeadStart, corners, label]
 *
 * Supports bidirectional arrows via edge.hasArrowStart and edge.hasArrowEnd.
 */
function reciprocalLaneOffset(
  graph: AsciiGraph,
  edge: AsciiEdge,
  startPoint: DrawingCoord,
  endPoint: DrawingCoord,
): DrawingCoord {
  const none = { x: 0, y: 0 }
  if ((edge.routeClass !== 'feedback' && edge.routeClass !== 'container') || edge.bundle || edge.path.length !== 2) return none
  const horizontal = startPoint.y === endPoint.y && (dirEquals(edge.startDir, Left) || dirEquals(edge.startDir, Right)) && (dirEquals(edge.endDir, Left) || dirEquals(edge.endDir, Right))
  const vertical = startPoint.x === endPoint.x && (dirEquals(edge.startDir, Up) || dirEquals(edge.startDir, Down)) && (dirEquals(edge.endDir, Up) || dirEquals(edge.endDir, Down))
  if (!horizontal && !vertical) return none
  const opposite = graph.edges.find(other => other !== edge && other.from === edge.to && other.to === edge.from)
  if (!opposite) return none
  if (edge.routeClass === 'container' && graph.edges.indexOf(edge) < graph.edges.indexOf(opposite)) return none
  const inside = (node: AsciiNode, group: AsciiSubgraph | undefined, point: DrawingCoord, offset: number) => {
    if (group) return horizontal
      ? point.y + offset > group.minY + splitLines(group.name).length && point.y + offset < group.maxY
      : point.x + offset > group.minX && point.x + offset < group.maxX
    if (!node.drawing || !node.drawingCoord) return false
    const [width, height] = getCanvasSize(node.drawing)
    return horizontal
      ? point.y + offset > node.drawingCoord.y && point.y + offset < node.drawingCoord.y + height
      : point.x + offset > node.drawingCoord.x && point.x + offset < node.drawingCoord.x + width
  }
  for (const offset of [1, -1]) if (inside(edge.from, edge.fromSubgraph, startPoint, offset) && inside(edge.to, edge.toSubgraph, endPoint, offset)) return horizontal ? { x: 0, y: offset } : { x: offset, y: 0 }
  return none
}

export function drawArrow(
  graph: AsciiGraph,
  edge: AsciiEdge,
  protectedCells?: PathOccupancy,
): [Canvas, Canvas, Canvas, Canvas, Canvas] {
  // Invisible links (~~~) shape the layout but draw no glyphs.
  if (edge.style === 'invisible') {
    const empty = copyCanvas(graph.canvas)
    return [empty, empty, empty, empty, empty]
  }

  if (edge.cellRoute) {
    const poly = edge.cellRoute.points
    if (poly.length < 2) return Array.from({ length: 5 }, () => copyCanvas(graph.canvas)) as [Canvas, Canvas, Canvas, Canvas, Canvas]
    recordGraphPorts(graph, edge, poly[0]!, poly.at(-1)!)
    const [path, lines, directions] = drawDrawingPath(graph, poly, edge.style)
    const start = drawBoxStart(graph, edge.startDir, poly[0]!)
    const endMarker = edge.hasArrowEnd ? drawEndpointMarker(graph, lines.at(-1)!, directions.at(-1)!, edge.endMarker) : copyCanvas(graph.canvas)
    const startMarker = edge.hasArrowStart ? drawEndpointMarker(graph, [poly[0]!], reverseDirection(directions[0]!), edge.startMarker) : copyCanvas(graph.canvas)
    return [path, start, endMarker, startMarker, drawDrawingCorners(graph, poly)]
  }
  if (!edge.path.length) {
    const empty = copyCanvas(graph.canvas)
    return [empty, empty, empty, empty, empty]
  }

  // BUILD-14: edges whose endpoint is a subgraph container attach to the
  // container border, not the inner anchor node we routed through.
  if (edge.attachToSubgraph || edge.attachFromSubgraph || edge.toSubgraph || edge.fromSubgraph) {
    return drawContainerEdge(graph, edge, protectedCells)
  }

  const baseStartPoint = getNodeAttachmentPoint(graph, edge.from, edge.startDir, edge.startPort)
  const baseEndPoint = getNodeAttachmentPoint(graph, edge.to, edge.endDir, edge.endPort)
  // A reciprocal two-cycle needs two disjoint terminal rows. Merge precedence
  // cannot preserve two labels and two markers that occupy the same cells.
  const laneOffset = reciprocalLaneOffset(graph, edge, baseStartPoint, baseEndPoint)
  const startPoint = { x: baseStartPoint.x + laneOffset.x, y: baseStartPoint.y + laneOffset.y }
  // Logical grid coordinates are not physical ports after an RL projection:
  // unequal card widths can otherwise leave the head on a card or beyond it.
  const endPoint = { x: baseEndPoint.x + laneOffset.x, y: baseEndPoint.y + laneOffset.y }
  let projectedPath = edge.path.map((point, index) => index === 0 ? startPoint : index === edge.path.length - 1 ? endPoint : gridToDrawingCoord(graph, point))
  const guideStart = !!edge.startPort || !dirEquals(determineDirection(startPoint, projectedPath[1]!), edge.startDir)
  const guideEnd = !!edge.endPort || !dirEquals(determineDirection(projectedPath.at(-2)!, endPoint), reverseDirection(edge.endDir))
  if (guideStart || guideEnd) {
    const guide = (point: DrawingCoord, direction: Direction) => ({ x: point.x + (direction.x - 1) * 2, y: point.y + (direction.y - 1) * 2 })
    projectedPath = [startPoint, ...(guideStart ? [guide(startPoint, edge.startDir)] : []), ...projectedPath.slice(1, -1), ...(guideEnd ? [guide(endPoint, edge.endDir)] : []), endPoint]
  }
  const feasiblePath = feasiblePolyline(projectedPath, protectedCells)
  const rerouted = guideStart || guideEnd || feasiblePath.length !== projectedPath.length || feasiblePath.some((point, index) => !drawingCoordEquals(point, projectedPath[index]!))
  recordGraphPorts(graph, edge, startPoint, endPoint)
  const [pathCanvas, linesDrawn, lineDirs] = rerouted
    ? drawDrawingPath(graph, feasiblePath, edge.style)
    : drawPath(graph, edge.path, edge.style, startPoint, endPoint)
  const isStatePseudo = edge.from.shape === 'state-start' || edge.from.shape === 'state-end'
  const boxStartCanvas = isStatePseudo
    ? copyCanvas(graph.canvas)
    : drawBoxStart(graph, edge.startDir, startPoint)

  // Draw end marker only if hasArrowEnd is true (default behavior)
  let arrowHeadEndCanvas: Canvas
  if (edge.hasArrowEnd) {
    arrowHeadEndCanvas = drawEndpointMarker(
      graph,
      linesDrawn[linesDrawn.length - 1]!,
      lineDirs[lineDirs.length - 1]!,
      edge.endMarker,
    )
  } else {
    arrowHeadEndCanvas = copyCanvas(graph.canvas)
  }

  // Native ports, not a possibly one-cell first segment, own start attachment.
  const arrowHeadStartCanvas = copyCanvas(graph.canvas)
  if (edge.hasArrowStart) arrowHeadStartCanvas.marker(startPoint.x, startPoint.y, graphMarker(edge.startMarker, terminalSide(reverseDirection(edge.startDir)) ?? 'T', graph.config.useAscii))

  const cornersCanvas = rerouted ? drawDrawingCorners(graph, feasiblePath) : drawCorners(graph, edge.path)

  return [pathCanvas, boxStartCanvas, arrowHeadEndCanvas, arrowHeadStartCanvas, cornersCanvas]
}

/**
 * BUILD-14: Draw an edge that terminates at (or originates from) a subgraph
 * container. The edge was routed to a representative inner anchor node; here we
 * clip the visible polyline to the container's border rectangle and place the
 * arrowhead on the border, so the edge attaches to the container instead of the
 * phantom box or the inner node.
 *
 * Returns the same five geometry layers as drawArrow.
 */
function drawContainerEdge(
  graph: AsciiGraph,
  edge: AsciiEdge,
  protectedCells?: PathOccupancy,
): [Canvas, Canvas, Canvas, Canvas, Canvas] {
  const empty = copyCanvas(graph.canvas)

  // Build the full drawing-coordinate polyline from the grid path.
  const sourceGroup = edge.attachFromSubgraph ?? edge.fromSubgraph
  const targetGroup = edge.attachToSubgraph ?? edge.toSubgraph
  let poly = edge.path.map((c, index) => index === 0 && !sourceGroup ? getNodeAttachmentPoint(graph, edge.from, edge.startDir, edge.startPort)
    : index === edge.path.length - 1 && !targetGroup ? getNodeAttachmentPoint(graph, edge.to, edge.endDir, edge.endPort) : gridToDrawingCoord(graph, c))
  poly = dedupeCollinear(poly)
  if (poly.length < 2) return [empty, empty, empty, empty, empty]

  // Clip the start at the source container border (if any).
  if (sourceGroup) {
    poly = clipPolylineAtBorder(poly, sourceGroup, 'start')
  }
  // Clip the end at the target container border (if any).
  if (targetGroup) {
    poly = clipPolylineAtBorder(poly, targetGroup, 'end')
  }
  if (poly.length < 2) return [empty, empty, empty, empty, empty]

  const lane = reciprocalLaneOffset(graph, edge, poly[0]!, poly.at(-1)!)
  if (lane.x || lane.y) poly = poly.map(point => ({ x: point.x + lane.x, y: point.y + lane.y }))
  poly = feasiblePolyline(poly, protectedCells)

  // Draw the polyline segments.
  const face = (group: AsciiSubgraph | undefined, point: DrawingCoord, fallback: Direction): Direction => !group ? fallback
    : point.x === group.minX ? Left : point.x === group.maxX ? Right : point.y === group.minY ? Up : Down
  const sourceFace = face(sourceGroup, poly[0]!, edge.startDir)
  recordGraphPorts(graph, edge, poly[0]!, poly.at(-1)!, sourceFace, face(targetGroup, poly.at(-1)!, edge.endDir))
  const pathCanvas = copyCanvas(graph.canvas)
  const useAscii = graph.config.useAscii
  // Mirror standard drawPath: every segment skips its first and last cell so
  // bend cells are owned solely by the corner canvas (avoids junction glyph
  // corruption when two segments meet). The source border is a separate
  // junction layer. The very last cell is either
  // the container-border entry (draw it, offset 0) or one cell before a real
  // target node (offset -1, arrowhead drawn separately).
  const lastSegmentEndsAtRealNode = !targetGroup
  for (let i = 1; i < poly.length; i++) {
    const from = poly[i - 1]!
    const to = poly[i]!
    if (drawingCoordEquals(from, to)) continue
    const isLast = i === poly.length - 1
    const offsetFrom = 1
    let offsetTo: number
    if (isLast) {
      offsetTo = lastSegmentEndsAtRealNode ? -1 : 0
    } else {
      offsetTo = -1
    }
    drawLine(pathCanvas, from, to, offsetFrom, offsetTo, useAscii, edge.style)
  }

  // Corner characters at bends.
  const cornersCanvas = copyCanvas(graph.canvas)
  for (let i = 1; i < poly.length - 1; i++) {
    const prev = poly[i - 1]!
    const coord = poly[i]!
    const next = poly[i + 1]!
    const prevDir = determineDirection(prev, coord)
    const nextDir = determineDirection(coord, next)
    cornersCanvas.stroke(coord.x, coord.y, cornerMask(prevDir, nextDir), { ascii: useAscii })
  }

  // Arrowhead at the END of the edge.
  const arrowHeadEndCanvas = copyCanvas(graph.canvas)
  if (edge.hasArrowEnd && poly.length >= 2) {
    const last = poly[poly.length - 1]!
    const beforeLast = poly[poly.length - 2]!
    const arrowDir = determineDirection(beforeLast, last)
    if (targetGroup) {
      // Terminal is the container border — draw the arrowhead on it.
      arrowHeadEndCanvas.marker(last.x, last.y, graphMarker(edge.endMarker, terminalSide(arrowDir) ?? 'B', useAscii))
    } else {
      // Terminal is a real node — draw the arrowhead one cell before its border
      // (matching standard edges, which use offsetTo=-1).
      const tip = stepBack(last, arrowDir)
      arrowHeadEndCanvas.marker(tip.x, tip.y, graphMarker(edge.endMarker, terminalSide(arrowDir) ?? 'B', useAscii))
    }
  }

  // Marker at the START of the edge (container exit, or reversed real source).
  const arrowHeadStartCanvas = copyCanvas(graph.canvas)
  if (edge.hasArrowStart && poly.length >= 2) {
    const first = poly[0]!
    const second = poly[1]!
    const startDir = determineDirection(second, first)
    arrowHeadStartCanvas.marker(first.x, first.y, graphMarker(edge.startMarker, terminalSide(startDir) ?? 'T', useAscii))
  }

  const sourceJunction = edge.from.shape === 'state-start' || edge.from.shape === 'state-end' ? empty : drawBoxStart(graph, sourceFace, poly[0]!)
  return [pathCanvas, sourceJunction, arrowHeadEndCanvas, arrowHeadStartCanvas, cornersCanvas]
}

/** Move one cell backward against a direction (toward the segment origin). */
function stepBack(p: DrawingCoord, dir: Direction): DrawingCoord {
  if (dirEquals(dir, Up)) return { x: p.x, y: p.y + 1 }
  if (dirEquals(dir, Down)) return { x: p.x, y: p.y - 1 }
  if (dirEquals(dir, Left)) return { x: p.x + 1, y: p.y }
  if (dirEquals(dir, Right)) return { x: p.x - 1, y: p.y }
  return { x: p.x, y: p.y }
}

/** Remove redundant collinear midpoints from a drawing polyline. */
function dedupeCollinear(poly: DrawingCoord[]): DrawingCoord[] {
  const out: DrawingCoord[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (last && drawingCoordEquals(last, p)) continue
    out.push({ x: p.x, y: p.y })
  }
  // Collapse three collinear points into two.
  const result: DrawingCoord[] = []
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && i < out.length - 1) {
      const a = out[i - 1]!
      const b = out[i]!
      const c = out[i + 1]!
      const collinearH = a.y === b.y && b.y === c.y
      const collinearV = a.x === b.x && b.x === c.x
      const forward = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0
      if ((collinearH || collinearV) && forward) continue
    }
    result.push(out[i]!)
  }
  return result
}

/**
 * Clip a drawing polyline so the chosen end sits exactly on a subgraph's border.
 *
 * - which = 'end': the polyline ends inside the container; truncate it at the
 *   first point where it crosses the border (walking from the start) and snap
 *   the terminal point onto the border line.
 * - which = 'start': the polyline starts inside the container; drop the inside
 *   portion and start at the border crossing (walking from the end backwards).
 */
function clipPolylineAtBorder(
  poly: DrawingCoord[],
  sg: AsciiSubgraph,
  which: 'start' | 'end',
): DrawingCoord[] {
  const inside = (p: DrawingCoord): boolean =>
    p.x > sg.minX && p.x < sg.maxX && p.y > sg.minY && p.y < sg.maxY

  if (which === 'end') {
    // Walk from start; find first segment entering the container.
    for (let i = 1; i < poly.length; i++) {
      const prev = poly[i - 1]!
      const curr = poly[i]!
      if (!inside(prev) && inside(curr)) {
        const border = borderCrossing(prev, curr, sg)
        return [...poly.slice(0, i), border]
      }
      if (inside(prev)) {
        // Already inside at the previous point — clip there.
        const border = borderCrossing(poly[Math.max(0, i - 2)] ?? prev, prev, sg)
        return [...poly.slice(0, i - 1), border]
      }
    }
    // Never detected a crossing (e.g. anchor outside bbox); snap last point to
    // the nearest border edge from the penultimate point.
    const last = poly[poly.length - 1]!
    const prev = poly[poly.length - 2]!
    return [...poly.slice(0, poly.length - 1), borderCrossing(prev, last, sg)]
  }

  // which === 'start': walk from the end backwards.
  for (let i = poly.length - 2; i >= 0; i--) {
    const next = poly[i + 1]!
    const curr = poly[i]!
    if (!inside(next) && inside(curr)) {
      const border = borderCrossing(next, curr, sg)
      return [border, ...poly.slice(i + 1)]
    }
    if (inside(next)) continue
  }
  const first = poly[0]!
  const next = poly[1]!
  return [borderCrossing(next, first, sg), ...poly.slice(1)]
}

/**
 * Given a segment from an outside point to an inside point, return the point on
 * the container border where the orthogonal segment crosses it. Edge paths are
 * orthogonal, so the segment is either horizontal or vertical.
 */
function borderCrossing(
  outside: DrawingCoord,
  insidePt: DrawingCoord,
  sg: AsciiSubgraph,
): DrawingCoord {
  if (outside.y === insidePt.y) {
    // Horizontal segment crosses a vertical border (left or right).
    const x = outside.x < insidePt.x ? sg.minX : sg.maxX
    return { x, y: insidePt.y }
  }
  if (outside.x === insidePt.x) {
    // Vertical segment crosses a horizontal border (top or bottom).
    const y = outside.y < insidePt.y ? sg.minY : sg.maxY
    return { x: insidePt.x, y }
  }
  // Diagonal fallback (shouldn't happen with orthogonal routing): clamp inside
  // point to the nearest border.
  return {
    x: Math.max(sg.minX, Math.min(sg.maxX, insidePt.x)),
    y: Math.max(sg.minY, Math.min(sg.maxY, insidePt.y)),
  }
}

function terminalSide(dir: Direction): TerminalSide | undefined {
  if (dirEquals(dir, Up)) return 'T'
  if (dirEquals(dir, Right)) return 'R'
  if (dirEquals(dir, Down)) return 'B'
  if (dirEquals(dir, Left)) return 'L'
}

function directionMask(dir: Direction): number {
  const side = terminalSide(dir)
  return side === 'T' ? 1 : side === 'R' ? 2 : side === 'B' ? 4 : side === 'L' ? 8 : 0
}

function cornerMask(previous: Direction, next: Direction): number {
  return (directionMask(reverseDirection(previous)) | directionMask(next)) || 15
}

function directedArrow(canvas: Canvas, point: DrawingCoord, dir: Direction, useAscii: boolean, fallback: Direction = Down): void {
  canvas.marker(point.x, point.y, { shape: 'arrow', direction: terminalSide(dir) ?? terminalSide(fallback) ?? 'B', ascii: useAscii })
}

/**
 * Reverse a direction (for bidirectional arrow start heads).
 */
function reverseDirection(dir: Direction): Direction {
  if (dirEquals(dir, Up)) return Down
  if (dirEquals(dir, Down)) return Up
  if (dirEquals(dir, Left)) return Right
  if (dirEquals(dir, Right)) return Left
  if (dirEquals(dir, UpperLeft)) return LowerRight
  if (dirEquals(dir, UpperRight)) return LowerLeft
  if (dirEquals(dir, LowerLeft)) return UpperRight
  if (dirEquals(dir, LowerRight)) return UpperLeft
  return Middle
}

/**
 * Draw the path lines for an edge.
 * Returns the canvas, the coordinates drawn for each segment, and the direction of each segment.
 */
function drawPath(
  graph: AsciiGraph,
  path: GridCoord[],
  style: AsciiEdgeStyle = 'solid',
  startPointOverride?: DrawingCoord,
  endPointOverride?: DrawingCoord,
): [Canvas, DrawingCoord[][], Direction[]] {
  return drawDrawingPath(graph, path.map((point, index) =>
    index === 0 && startPointOverride ? startPointOverride
      : index === path.length - 1 && endPointOverride ? endPointOverride
        : gridToDrawingCoord(graph, point)), style)
}

/** Paint the same orthogonal route that was checked for text feasibility. */
function drawDrawingPath(graph: AsciiGraph, poly: DrawingCoord[], style: AsciiEdgeStyle): [Canvas, DrawingCoord[][], Direction[]] {
  const canvas = copyCanvas(graph.canvas)
  const lines: DrawingCoord[][] = [], directions: Direction[] = []
  for (let index = 1; index < poly.length; index++) {
    const from = poly[index - 1]!, to = poly[index]!
    if (drawingCoordEquals(from, to)) continue
    const line = drawLine(canvas, from, to, 1, -1, graph.config.useAscii, style)
    if (!line.length) line.push(from)
    lines.push(line); directions.push(determineDirection(from, to))
  }
  return [canvas, lines, directions]
}

function drawDrawingCorners(graph: AsciiGraph, poly: DrawingCoord[]): Canvas {
  const canvas = copyCanvas(graph.canvas)
  for (let index = 1; index < poly.length - 1; index++) {
    const point = poly[index]!
    const before = determineDirection(poly[index - 1]!, point), after = determineDirection(point, poly[index + 1]!)
    if (!dirEquals(before, after)) canvas.stroke(point.x, point.y, cornerMask(before, after), { ascii: graph.config.useAscii })
  }
  return canvas
}

/**
 * Draw the junction character where an edge exits the source node's box.
 * Only applies to Unicode mode (ASCII mode just uses the line characters).
 * Skips drawing for state pseudo-states which have their own visual borders.
 */
function drawBoxStart(
  graph: AsciiGraph,
  startDir: Direction,
  startPoint: DrawingCoord,
): Canvas {
  const canvas = copyCanvas(graph.canvas)
  if (graph.config.useAscii) return canvas

  const outgoing = directionMask(startDir)


  if (outgoing) canvas.stroke(startPoint.x, startPoint.y, outgoing | ((outgoing & 5) ? 10 : 5))

  return canvas
}

function graphMarker(marker: EdgeMarker | undefined, direction: TerminalSide, ascii: boolean): TerminalMarker {
  return { shape: marker === 'circle' ? 'wide-circle' : marker === 'cross' ? 'cross' : 'arrow', direction, ascii }
}

function drawEndpointMarker(
  graph: AsciiGraph,
  lastLine: DrawingCoord[],
  fallbackDir: Direction,
  marker: EdgeMarker | undefined,
): Canvas {
  if (marker === 'circle' || marker === 'cross') {
    const canvas = copyCanvas(graph.canvas)
    if (lastLine.length === 0) return canvas
    const lastPos = lastLine[lastLine.length - 1]!
    canvas.marker(lastPos.x, lastPos.y, graphMarker(marker, terminalSide(fallbackDir) ?? 'B', graph.config.useAscii))
    return canvas
  }

  return drawArrowHead(graph, lastLine, fallbackDir)
}

/**
 * Draw the arrowhead at the end of an edge path.
 * Uses triangular Unicode symbols (▲▼◄►) or ASCII symbols (^v<>).
 */
function drawArrowHead(
  graph: AsciiGraph,
  lastLine: DrawingCoord[],
  fallbackDir: Direction,
): Canvas {
  const canvas = copyCanvas(graph.canvas)
  if (lastLine.length === 0) return canvas

  const from = lastLine[0]!
  const lastPos = lastLine[lastLine.length - 1]!
  let dir = determineDirection(from, lastPos)
  if (lastLine.length === 1 || dirEquals(dir, Middle)) dir = fallbackDir

  directedArrow(canvas, lastPos, dir, graph.config.useAscii, fallbackDir)
  return canvas
}

/**
 * Draw corner characters at path bends (where the direction changes).
 * Uses ┌┐└┘ in Unicode mode, + in ASCII mode.
 */
function drawCorners(graph: AsciiGraph, path: GridCoord[]): Canvas {
  return drawDrawingCorners(graph, path.map(point => gridToDrawingCoord(graph, point)))
}

interface GraphLabel {
  owner: TerminalOwner
  rows: Array<{ x: number; y: number; text: MeasuredTerminalText }>
  color?: string
}

/** Keep measured authored text separate from route ink until placement. */
function planArrowLabel(graph: AsciiGraph, edge: AsciiEdge): GraphLabel | undefined {
  if (!edge.text.length || edge.style === 'invisible') return undefined
  if (edge.cellRoute) {
    const origin = edge.cellRoute.label
    if (!origin) return undefined
    const color = safeCssColor(edge.inlineStyle?.color ?? edge.inlineStyle?.stroke)
    return { owner: terminalEdgeOwner(graph, edge), rows: splitLines(edge.text).map((text, index) => ({ x: origin.x, y: origin.y + index, text: measuredText(text) })), ...(color ? { color } : {}) }
  }
  const start = edge.fromSubgraph
    ? getSubgraphAttachmentPoint(graph, edge.fromSubgraph, edge.from, edge.startDir)
    : getNodeAttachmentPoint(graph, edge.from, edge.startDir)
  const end = edge.toSubgraph
    ? getSubgraphAttachmentPoint(graph, edge.toSubgraph, edge.to, edge.endDir)
    : getNodeAttachmentPoint(graph, edge.to, edge.endDir)
  const laneOffset = edge.attachFromSubgraph || edge.attachToSubgraph ? { x: 0, y: 0 } : reciprocalLaneOffset(graph, edge, start, end)

  const drawingLine = lineToDrawing(graph, edge.labelLine)
    .map(point => ({ x: point.x + laneOffset.x, y: point.y + laneOffset.y }))

  // Offset labels only for true bidirectional pairs. Ordinary downward
  // fan-out branches should keep labels centered on the branch, not shifted
  // upward into the shared trunk.
  const hasOppositeEdge = graph.edges.some(other =>
    other !== edge && other.from === edge.to && other.to === edge.from,
  )
  let isUpwardEdge: boolean | undefined
  if (hasOppositeEdge && edge.path.length >= 2) {
    const startY = edge.path[0]!.y
    const endY = edge.path[edge.path.length - 1]!.y
    if (endY < startY) isUpwardEdge = true
    else if (endY > startY) isUpwardEdge = false
  }

  const isLeftwardEdge = edge.path.length >= 2
    && edge.path[edge.path.length - 1]!.x < edge.path[0]!.x
  const color = safeCssColor(edge.inlineStyle?.color ?? edge.inlineStyle?.stroke)
  return { owner: terminalEdgeOwner(graph, edge), rows: textOnLine(drawingLine, edge.text, isUpwardEdge, isLeftwardEdge), ...(color ? { color } : {}) }
}

/**
 * Measure text centered on a line segment defined by two drawing coordinates.
 * Supports multi-line labels.
 *
 * When isUpwardEdge is provided, offsets the label vertically to prevent
 * overlapping with labels from edges going the opposite direction:
 * - Upward edges: label placed in lower portion of segment
 * - Downward edges (isUpwardEdge=false): label placed in upper portion
 * - No direction (isUpwardEdge=undefined): label centered (default)
 */
function textOnLine(
  line: DrawingCoord[],
  label: string,
  isUpwardEdge?: boolean,
  isLeftwardEdge = false,
): GraphLabel['rows'] {
  if (line.length < 2) return []
  const minX = Math.min(line[0]!.x, line[1]!.x)
  const maxX = Math.max(line[0]!.x, line[1]!.x)
  const minY = Math.min(line[0]!.y, line[1]!.y)
  const maxY = Math.max(line[0]!.y, line[1]!.y)
  const middleX = minX + Math.floor((maxX - minX) / 2)
  let middleY = minY + Math.floor((maxY - minY) / 2)

  // Offset label vertically to prevent overlap on bidirectional edges
  // For vertical segments (same X), shift based on edge direction
  if (isUpwardEdge !== undefined && minX === maxX) {
    const segmentHeight = maxY - minY
    const offset = Math.max(1, Math.floor(segmentHeight / 4))
    if (isUpwardEdge) {
      // Upward edge: place label in lower portion
      middleY = middleY + offset
    } else {
      // Downward edge: place label in upper portion
      middleY = middleY - offset
    }
  }

  // Support multi-line labels
  const lines = splitLines(label)
  const startY = middleY - Math.floor((lines.length - 1) / 2)

  return lines.map((lineText, i) => {
    const text = measuredText(lineText)
    // With an even-width label and an odd midpoint split, reserve the spare
    // cell on the target side for the terminal marker. Leftward routes need
    // the opposite tie-break from the default rightward projection.
    const startX = middleX - Math.floor(text.width / 2) + (isLeftwardEdge ? 1 : 0)
    return { x: startX, y: startY + i, text }
  })
}

// ============================================================================
// Node attachment point helper
// ============================================================================

/**
 * Get the drawing coordinate where an edge attaches to a node's border.
 * Uses grid-allocated dimensions so attachment points align with the actual
 * drawn box (which may be wider/taller than the intrinsic shape dimensions
 * when sharing a column/row with a larger node).
 */
function getNodeAttachmentPoint(
  graph: AsciiGraph,
  node: AsciiNode,
  dir: Direction,
  slot?: { index: number; count: number },
): DrawingCoord {
  const gc = node.gridCoord!

  // Calculate actual drawn dimensions from grid (matching drawBoxWithGridDimensions)
  let w = 0
  for (let i = 0; i < 2; i++) {
    w += graph.columnWidth.get(gc.x + i) ?? 0
  }
  let h = 0
  for (let i = 0; i < 2; i++) {
    h += graph.rowHeight.get(gc.y + i) ?? 0
  }

  // Build dimensions matching the actual drawn box size
  const gridDimensions = {
    width: w + 1,
    height: h + 1,
    labelArea: { x: 0, y: 0, width: 0, height: 0 },
    gridColumns: [0, 0, 0] as [number, number, number],
    gridRows: [0, 0, 0] as [number, number, number],
  }

  const baseCoord = node.drawingCoord!
  if (slot) {
    const side = terminalSide(dir)!
    const point = allocateFacePort({ x: baseCoord.x + 1, y: baseCoord.y + 1, width: w + 1, height: h + 1 }, side, slot.index, slot.count)
    return { x: point.x - 1 - (dir.x - 1), y: point.y - 1 - (dir.y - 1) }
  }
  return getShapeAttachmentPoint(node.shape, dir, gridDimensions, baseCoord)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/** Attach a container edge to the subgraph border nearest its inner anchor. */
function getSubgraphAttachmentPoint(
  graph: AsciiGraph,
  sg: AsciiSubgraph,
  anchor: AsciiNode,
  dir: Direction,
): DrawingCoord {
  const anchorPoint = getNodeAttachmentPoint(graph, anchor, dir)
  if (dirEquals(dir, Up)) {
    return { x: clamp(anchorPoint.x, sg.minX + 1, sg.maxX - 1), y: sg.minY }
  }
  if (dirEquals(dir, Down)) {
    return { x: clamp(anchorPoint.x, sg.minX + 1, sg.maxX - 1), y: sg.maxY }
  }
  if (dirEquals(dir, Left)) {
    return { x: sg.minX, y: clamp(anchorPoint.y, sg.minY + 1, sg.maxY - 1) }
  }
  if (dirEquals(dir, Right)) {
    return { x: sg.maxX, y: clamp(anchorPoint.y, sg.minY + 1, sg.maxY - 1) }
  }
  return anchorPoint
}

// ============================================================================
// Bundled edge drawing — for parallel links (A & B --> C)
// ============================================================================

/**
 * Draw a single edge's segment in a bundle (source → junction for fan-in,
 * junction → target for fan-out).
 *
 * Returns the same tuple format as drawArrow for consistency.
 */
function drawBundledEdgeSegment(
  graph: AsciiGraph,
  edge: AsciiEdge,
  bundle: EdgeBundle,
  protectedCells?: PathOccupancy,
): [Canvas, Canvas, Canvas, Canvas, Canvas] {
  const empty = copyCanvas(graph.canvas)

  if (!edge.pathToJunction || edge.pathToJunction.length === 0) {
    return [empty, empty, empty, empty, empty]
  }

  const useAscii = graph.config.useAscii

  // Convert grid coords to drawing coords
  // For fan-in: first point is at source node border (use attachment point)
  // For fan-out: last point is at target node border (use attachment point)
  const drawingPath = feasiblePolyline(edge.pathToJunction.map((gc, idx) => {
    if (bundle.type === 'fan-in' && idx === 0) {
      // First point: use source node's actual border position
      return getNodeAttachmentPoint(graph, edge.from, edge.startDir)
    }
    if (bundle.type === 'fan-out' && idx === edge.pathToJunction!.length - 1) {
      // Last point: use target node's actual border position
      return getNodeAttachmentPoint(graph, edge.to, edge.endDir)
    }
    return gridToDrawingCoord(graph, gc)
  }), protectedCells)

  const [pathCanvas] = drawDrawingPath(graph, drawingPath, edge.style)
  const cornersCanvas = drawDrawingCorners(graph, drawingPath)

  // Draw box start connector (for fan-in, from source node)
  // The connector is placed at the first point coordinate (box border position)
  // since we use offsets 1,-1 for drawLine, the line starts one step past this point
  const boxStartCanvas = copyCanvas(graph.canvas)
  if (bundle.type === 'fan-in' && edge.pathToJunction.length >= 2) {
    const firstPoint = drawingPath[0]!
    const dir = determineDirection(drawingPath[0]!, drawingPath[1]!)

    if (!useAscii) {
      const outgoing = directionMask(dir)

      if (outgoing) boxStartCanvas.stroke(firstPoint.x, firstPoint.y, outgoing | ((outgoing & 5) ? 10 : 5))
    }
  }

  return [pathCanvas, boxStartCanvas, empty, empty, cornersCanvas]
}

/**
 * Draw the shared path segment of a bundle (junction → target for fan-in,
 * source → junction for fan-out).
 */
function drawBundleSharedPath(graph: AsciiGraph, bundle: EdgeBundle, protectedCells?: PathOccupancy): [Canvas, Canvas] {
  if (bundle.sharedPath.length < 2) return [copyCanvas(graph.canvas), copyCanvas(graph.canvas)]

  const style = bundle.edges[0]?.style ?? 'solid'
  const graphDir = graph.config.graphDirection

  // Convert grid coords to drawing coords
  // For fan-in: last point is at target node border
  // For fan-out: first point is at source node border
  const drawingPath = feasiblePolyline(bundle.sharedPath.map((gc, idx) => {
    if (bundle.type === 'fan-in' && idx === bundle.sharedPath.length - 1) {
      // Last point: use target node's actual border position (entry from above/left)
      const entryDir = graphDir === 'TD' ? Up : Left
      return getNodeAttachmentPoint(graph, bundle.sharedNode, entryDir)
    }
    if (bundle.type === 'fan-out' && idx === 0) {
      // First point: use source node's actual border position (exit going down/right)
      const exitDir = graphDir === 'TD' ? Down : Right
      return getNodeAttachmentPoint(graph, bundle.sharedNode, exitDir)
    }
    return gridToDrawingCoord(graph, gc)
  }), protectedCells)

  const [pathCanvas] = drawDrawingPath(graph, drawingPath, style)
  return [pathCanvas, drawDrawingCorners(graph, drawingPath)]
}

/**
 * Draw the arrowhead for a fan-in bundle (single arrowhead at the shared target).
 */
function drawBundleArrowhead(graph: AsciiGraph, bundle: EdgeBundle): Canvas {
  const canvas = copyCanvas(graph.canvas)

  if (bundle.sharedPath.length < 2) return canvas

  // Get the last segment direction
  const lastIdx = bundle.sharedPath.length - 1
  const secondLast = bundle.sharedPath[lastIdx - 1]!
  const last = bundle.sharedPath[lastIdx]!
  const dir = determineDirection(secondLast, last)

  // Get drawing coord 1 char outside the target node's border (not on the border itself).
  // This matches non-bundled edges where drawPath uses offsetTo=-1 and the arrowhead
  // sits at the last drawn point (1 char before the border).
  const graphDir = graph.config.graphDirection
  const entryDir = graphDir === 'TD' ? Up : Left
  const dc = getNodeAttachmentPoint(graph, bundle.sharedNode, entryDir)
  // Offset 1 char away from the box border so arrowhead sits outside the box
  if (graphDir === 'TD') dc.y -= 1
  else dc.x -= 1

  directedArrow(canvas, dc, dir, graph.config.useAscii)
  return canvas
}

/**
 * Draw the arrowhead for a single edge in a fan-out bundle.
 */
function drawBundledEdgeArrowhead(graph: AsciiGraph, edge: AsciiEdge): Canvas {
  const canvas = copyCanvas(graph.canvas)

  if (!edge.pathToJunction || edge.pathToJunction.length < 2) return canvas

  // Get the last segment direction
  const lastIdx = edge.pathToJunction.length - 1
  const secondLast = edge.pathToJunction[lastIdx - 1]!
  const last = edge.pathToJunction[lastIdx]!
  const dir = determineDirection(secondLast, last)

  // Get drawing coord 1 char outside the target node's border
  const graphDir = graph.config.graphDirection
  const entryDir = graphDir === 'TD' ? Up : Left
  const dc = getNodeAttachmentPoint(graph, edge.to, entryDir)
  // Offset 1 char away from the box border so arrowhead sits outside the box
  if (graphDir === 'TD') dc.y -= 1
  else dc.x -= 1

  directedArrow(canvas, dc, dir, graph.config.useAscii)
  return canvas
}

/**
 * Draw the junction character where bundled edges merge/split.
 *
 * Analyzes actual connecting directions to choose the correct character:
 * - ┼ (cross): lines from all 4 directions
 * - ┬ (T down): lines from left, right, and down
 * - ┴ (T up): lines from left, right, and up
 * - ├ (T right): lines from up, down, and right
 * - ┤ (T left): lines from up, down, and left
 */
function drawJunctionCharacter(graph: AsciiGraph, bundle: EdgeBundle): Canvas {
  const canvas = copyCanvas(graph.canvas)

  if (!bundle.junctionPoint) return canvas

  const dc = gridToDrawingCoord(graph, bundle.junctionPoint)
  const useAscii = graph.config.useAscii

  // Analyze what directions actually connect to the junction
  let hasUp = false
  let hasDown = false
  let hasLeft = false
  let hasRight = false

  // Check shared path direction (where the line continues to/from the shared node)
  if (bundle.sharedPath.length >= 2) {
    // For fan-in: shared path goes FROM junction TO target (index 0 is junction)
    // For fan-out: shared path goes FROM source TO junction (last index is junction)
    const junctionIdx = bundle.type === 'fan-in' ? 0 : bundle.sharedPath.length - 1
    const adjacentIdx = bundle.type === 'fan-in' ? 1 : bundle.sharedPath.length - 2
    const sharedDir = determineDirection(
      bundle.sharedPath[junctionIdx]!,
      bundle.sharedPath[adjacentIdx]!
    )
    // This is the direction the shared path GOES from junction
    if (dirEquals(sharedDir, Down)) hasDown = true
    else if (dirEquals(sharedDir, Up)) hasUp = true
    else if (dirEquals(sharedDir, Right)) hasRight = true
    else if (dirEquals(sharedDir, Left)) hasLeft = true
  }

  // Check each edge's path direction at the junction
  for (const edge of bundle.edges) {
    if (edge.pathToJunction && edge.pathToJunction.length >= 2) {
      // For fan-in: pathToJunction goes FROM source TO junction (last is junction)
      // For fan-out: pathToJunction goes FROM junction TO target (first is junction)
      const junctionIdx = bundle.type === 'fan-in'
        ? edge.pathToJunction.length - 1
        : 0
      const adjacentIdx = bundle.type === 'fan-in'
        ? edge.pathToJunction.length - 2
        : 1

      const arrivalDir = determineDirection(
        edge.pathToJunction[adjacentIdx]!,
        edge.pathToJunction[junctionIdx]!
      )
      // This is the direction the edge ARRIVES at junction from
      // e.g., if arrivalDir is Right, the line comes FROM the left
      if (dirEquals(arrivalDir, Down)) hasUp = true    // arrived going down = came from up
      else if (dirEquals(arrivalDir, Up)) hasDown = true
      else if (dirEquals(arrivalDir, Right)) hasLeft = true
      else if (dirEquals(arrivalDir, Left)) hasRight = true
    }
  }

  const mask = (hasUp ? 1 : 0) | (hasRight ? 2 : 0) | (hasDown ? 4 : 0) | (hasLeft ? 8 : 0)
  canvas.stroke(dc.x, dc.y, mask || 15, { ascii: useAscii })
  return canvas
}

// ============================================================================
// Subgraph drawing
// ============================================================================

/** Draw a subgraph border rectangle. */
export function drawSubgraphBox(sg: AsciiSubgraph, graph: AsciiGraph): Canvas {
  const width = sg.maxX - sg.minX
  const height = sg.maxY - sg.minY
  if (width <= 0 || height <= 0) return mkCanvas(0, 0)

  const from: DrawingCoord = { x: 0, y: 0 }
  const to: DrawingCoord = { x: width, y: height }
  const canvas = mkCanvas(width, height)

  const border = { ascii: graph.config.useAscii }
  for (let x = from.x + 1; x < to.x; x++) {
    canvas.stroke(x, from.y, 10, border); canvas.stroke(x, to.y, 10, border)
  }
  for (let y = from.y + 1; y < to.y; y++) {
    canvas.stroke(from.x, y, 5, border); canvas.stroke(to.x, y, 5, border)
  }
  canvas.stroke(from.x, from.y, 6, border); canvas.stroke(to.x, from.y, 12, border)
  canvas.stroke(from.x, to.y, 3, border); canvas.stroke(to.x, to.y, 9, border)

  return canvas
}

/** Draw a subgraph label centered in its header area. Supports multi-line labels. */
export function drawSubgraphLabel(sg: AsciiSubgraph, graph: AsciiGraph, containerKind: 'subgraph' | 'cluster' = 'subgraph'): [Canvas, DrawingCoord] {
  const width = sg.maxX - sg.minX
  const height = sg.maxY - sg.minY
  if (width <= 0 || height <= 0) return [mkCanvas(0, 0), { x: 0, y: 0 }]

  const canvas = mkCanvas(width, height)

  // Support multi-line subgraph labels
  const lines = splitLines(sg.name)

  // Start at row 1 inside subgraph, expand downward for multiple lines
  canvas.scope({ id: sg.id, kind: containerKind }, () => { for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const labelY = 1 + i
    let labelX = Math.floor(width / 2) - Math.floor(visualWidth(line) / 2)
    if (labelX < 1) labelX = 1
    if (labelY < height) drawText(canvas, { x: labelX, y: labelY }, line, true)
  } })

  return [canvas, { x: sg.minX, y: sg.minY }]
}

// ============================================================================
// Top-level draw orchestrator
// ============================================================================

/** Sort subgraphs by nesting depth (shallowest first) for correct layered rendering. */
function drawConcurrencyRegionSeparators(graph: AsciiGraph, containerKind: 'subgraph' | 'cluster'): Canvas {
  const [maxX, maxY] = getCanvasSize(graph.canvas)
  const canvas = mkCanvas(maxX, maxY)
  for (const parent of graph.subgraphs) {
    const regions = parent.children.filter(child => child.concurrencyRegion && child.nodes.length > 0)
    if (regions.length < 2) continue
    const xSpread = Math.max(...regions.map(region => (region.minX + region.maxX) / 2))
      - Math.min(...regions.map(region => (region.minX + region.maxX) / 2))
    const ySpread = Math.max(...regions.map(region => (region.minY + region.maxY) / 2))
      - Math.min(...regions.map(region => (region.minY + region.maxY) / 2))
    if (xSpread >= ySpread) {
      const ordered = [...regions].sort((a, b) => a.minX - b.minX)
      for (let index = 1; index < ordered.length; index++) {
        const x = Math.round((ordered[index - 1]!.maxX + ordered[index]!.minX) / 2)
        const top = Math.max(parent.minY + 3, Math.min(...regions.map(region => region.minY)))
        const bottom = Math.min(parent.maxY - 1, Math.max(...regions.map(region => region.maxY)))
        for (let y = top; y <= bottom; y++) canvas.stroke(x, y, 5, { ascii: graph.config.useAscii, style: 'dotted', owner: { id: parent.id, kind: containerKind }, role: 'border' })
      }
    } else {
      const ordered = [...regions].sort((a, b) => a.minY - b.minY)
      for (let index = 1; index < ordered.length; index++) {
        const y = Math.round((ordered[index - 1]!.maxY + ordered[index]!.minY) / 2)
        const left = Math.max(parent.minX + 1, Math.min(...regions.map(region => region.minX)))
        const right = Math.min(parent.maxX - 1, Math.max(...regions.map(region => region.maxX)))
        for (let x = left; x <= right; x++) canvas.stroke(x, y, 10, { ascii: graph.config.useAscii, style: 'dotted', owner: { id: parent.id, kind: containerKind }, role: 'border' })
      }
    }
  }
  return canvas
}

function sortSubgraphsByDepth(subgraphs: AsciiSubgraph[]): AsciiSubgraph[] {
  function getDepth(sg: AsciiSubgraph): number {
    return sg.parent === null ? 0 : 1 + getDepth(sg.parent)
  }
  const sorted = [...subgraphs]
  sorted.sort((a, b) => getDepth(a) - getDepth(b))
  return sorted
}

/** Compose positioned sparse layers; identity and roles come from their owners. */
function terminalEdgeOwner(graph: AsciiGraph, edge: AsciiEdge): TerminalOwner {
  return {
    id: edge.id ?? `edge#${edge.sourceIndex ?? graph.edges.indexOf(edge)}:${edge.from.name}->${edge.to.name}`,
    kind: 'edge',
    from: edge.attachFromSubgraph?.id ?? edge.fromSubgraph?.id ?? edge.from.name,
    to: edge.attachToSubgraph?.id ?? edge.toSubgraph?.id ?? edge.to.name,
    ...(edge.bundle ? { bundle: `bundle:${graph.bundles.indexOf(edge.bundle)}` } : edge.sharedTrunk ? { bundle: edge.sharedTrunk } : {}),
  }
}

function recordGraphPorts(graph: AsciiGraph, edge: AsciiEdge, start: DrawingCoord, end: DrawingCoord, startDir = edge.startDir, endDir = edge.endDir): void {
  const owner = terminalEdgeOwner(graph, edge)
  const side = (direction: Direction) => dirEquals(direction, Up) ? 'T' as const : dirEquals(direction, Down) ? 'B' as const : dirEquals(direction, Left) ? 'L' as const : 'R' as const
  graph.canvas.port(owner, { nodeId: owner.from!, ...start, side: side(startDir), end: 'start' })
  graph.canvas.port(owner, { nodeId: owner.to!, ...end, side: side(endDir), end: 'end' })
  graph.canvas.expectMarkers(owner, 'start', edge.hasArrowStart ? [graphMarker(edge.startMarker, side(reverseDirection(startDir)), graph.config.useAscii)] : [])
  // Allocated routes use the ordinary exterior marker cell; clipped container
  // routes paint their marker directly on the frame instead.
  graph.canvas.expectMarkers(owner, 'end', edge.hasArrowEnd ? [graphMarker(edge.endMarker, side(reverseDirection(endDir)), graph.config.useAscii)] : [], !edge.cellRoute && (edge.attachToSubgraph || edge.toSubgraph) ? 0 : 1)
}

/** Resolve preallocated face slots and complete label rectangles against the
 * admitted cards/headers before any edge ink is painted. Other labels and all
 * protected markers are obstacles; unrelated crossings keep separate owners. */
function planAllocatedGraphRoutes(graph: AsciiGraph, protectedCells: PathOccupancy, retained: Canvas): Set<AsciiEdge> {
  const edges = graph.edges.filter(edge => edge.cellAllocation)
  const conflicts = new Set<AsciiEdge>()
  if (!edges.length) return conflicts
  const pairOrder = new Map<GraphEndpoint, Map<GraphEndpoint, number>>()
  const endpointOrder = new Map<GraphEndpoint, number>([...graph.nodes, ...graph.subgraphs].map((endpoint, index) => [endpoint, index]))
  let nextPair = 0
  const order = (edge: AsciiEdge): number => {
    const from = graphEndpointOf(edge, true), to = graphEndpointOf(edge, false)
    const a = endpointOrder.get(from)! < endpointOrder.get(to)! ? from : to, b = a === from ? to : from
    const targets = pairOrder.get(a) ?? new Map<GraphEndpoint, number>()
    const index = targets.get(b) ?? nextPair++
    targets.set(b, index); pairOrder.set(a, targets); return index
  }
  const orderByEdge = new Map(edges.map(edge => [edge, order(edge)]))
  edges.sort((a, b) => orderByEdge.get(a)! - orderByEdge.get(b)!)
  interface Rectangle extends DrawingCoord { width: number; height: number }
  const rectangles = new Map<AsciiEdge, Rectangle>()
  // Per-cell route state is read for every searched step, so it is keyed by
  // one number. Terminal coordinates are far below the row stride.
  const cellKey = (x: number, y: number): number => y * 0x200000 + x
  const routed = new Map<number, number>()
  const retainedEdges = new Map(graph.edges.filter(edge => !edge.cellAllocation).map(edge => [terminalEdgeOwner(graph, edge).id, edge]))
  for (const [x, y, cell] of retained.entries()) if (cell.kind === 'stroke' && cell.owners.some(owner => owner.kind === 'edge')) {
    const mask = cell.stroke?.mask ?? 0
    routed.set(cellKey(x, y), (mask & 5 ? 5 : 0) | (mask & 10 ? 10 : 0))
  }
  const retainedText = new Map<NonNullable<TerminalCell['textBlock']>, Set<AsciiEdge>>()
  for (const [, , cell] of retained.entries()) if (cell.textBlock) for (const owner of cell.owners) {
    const edge = owner.kind === 'edge' ? retainedEdges.get(owner.id) : undefined
    if (edge) { const members = retainedText.get(cell.textBlock) ?? new Set<AsciiEdge>(); members.add(edge); retainedText.set(cell.textBlock, members) }
  }
  const ends = new Map<AsciiEdge, [DrawingCoord, DrawingCoord]>()
  const markerCells = new Map<number, Set<AsciiEdge>>()
  const approaches = new Map<string, { edge: AsciiEdge; start: boolean }>()
  const overlapping = new Map<AsciiEdge, DrawingCoord>()
  const obstructed = new Map<AsciiEdge, DrawingCoord>()
  let regions: ReturnType<Canvas['regions']> | undefined
  const step = (point: DrawingCoord, direction: Direction, count: number) => ({ x: point.x + (direction.x - 1) * count, y: point.y + (direction.y - 1) * count })
  const inside = (box: Rectangle, x: number, y: number) => x >= box.x - (box.height > 1 ? 1 : 0) && x < box.x + box.width && y >= box.y && y < box.y + box.height
  const endpoint = (edge: AsciiEdge, start: boolean): DrawingCoord | undefined => {
    const target = graphEndpointOf(edge, start)
    return allocatedGraphPort(edge, start, 'children' in target ? target : {
      minX: target.drawingCoord!.x, minY: target.drawingCoord!.y,
      maxX: target.drawingCoord!.x + target.drawing!.width - 1, maxY: target.drawingCoord!.y + target.drawing!.height - 1,
    })
  }
  for (const edge of edges) {
    const start = endpoint(edge, true), end = endpoint(edge, false)
    if (!start || !end) {
      edge.cellRoute = { points: [] }
      graph.canvas.report({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: `edge-face:${terminalEdgeOwner(graph, edge).id}`, message: 'The final endpoint envelope has insufficient usable face capacity for its allocated physical port.' })
      continue
    }
    ends.set(edge, [start, end])
    for (const [isStart, point, direction] of [[true, start, edge.startDir], [false, end, edge.endDir]] as const) for (let distance = 0; distance <= graphEdgeEscape(edge, isStart); distance++) {
      const marker = step(point, direction, distance), key = `${marker.x},${marker.y}`
      if (distance > 0 && protectedCells.has(key) && !obstructed.has(edge)) obstructed.set(edge, marker)
      // Fixed approach paint is outside A*: a marker one cell off the face
      // must not replace a retained shaft, marker or complete label rectangle.
      const retainedCell = retained.cell(marker.x, marker.y)
      if (retainedCell) for (const owner of retainedCell.owners) {
        const member = owner.kind === 'edge' ? retainedEdges.get(owner.id) : undefined
        if (member) conflicts.add(member)
      }
      for (const [box, members] of retainedText) if (marker.x >= box.x && marker.x < box.x + box.width && marker.y >= box.y && marker.y < box.y + box.height) {
        for (const member of members) conflicts.add(member)
      }
      const previous = approaches.get(key)
      if (previous && (previous.edge !== edge || previous.start !== isStart)) {
        overlapping.set(previous.edge, marker); overlapping.set(edge, marker)
      } else approaches.set(key, { edge, start: isStart })
      const owners = markerCells.get(cellKey(marker.x, marker.y)) ?? new Set<AsciiEdge>(); owners.add(edge); markerCells.set(cellKey(marker.x, marker.y), owners)
    }
  }
  if (conflicts.size) return conflicts
  for (const [edge, point] of obstructed) {
    const [start, end] = ends.get(edge)!
    edge.cellRoute = { points: [] }
    recordGraphPorts(graph, edge, start, end)
    ends.delete(edge)
    graph.canvas.report({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: `edge-lane:${terminalEdgeOwner(graph, edge).id}`, cell: { column: point.x, row: point.y }, message: 'Allocated physical ports have an approach blocked by protected terminal content before routing.' })
  }
  // Separate valid faces can still have intersecting exterior approaches,
  // especially across concentric frames. Admit the complete set together.
  for (const [edge, point] of overlapping) if (ends.has(edge)) {
    edge.cellRoute = { points: [] }; ends.delete(edge)
    graph.canvas.report({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: `edge-approach:${terminalEdgeOwner(graph, edge).id}`, cell: { column: point.x, row: point.y }, message: 'Allocated physical endpoint approach corridors overlap before routing.' })
  }
  if (overlapping.size || obstructed.size) for (const [key, owners] of markerCells) {
    for (const edge of owners) if (overlapping.has(edge) || obstructed.has(edge)) owners.delete(edge)
    if (!owners.size) markerCells.delete(key)
  }
  for (const edge of edges) {
    if (!ends.has(edge)) continue
    if (!edge.text) continue
    const [start, end] = ends.get(edge)!, text = measuredText(edge.text)
    const preferred = graphEndpointOf(edge, true) === graphEndpointOf(edge, false)
      ? { x: start.x + 4, y: Math.floor((start.y + end.y - text.height + 1) / 2) }
      : { x: Math.floor((start.x + end.x - text.width + 1) / 2), y: Math.floor((start.y + end.y - text.height + 1) / 2) }
    const clear = (point: DrawingCoord): boolean => {
      const margin = text.height > 1 ? 1 : 0
      if (point.x < margin || point.y < 0) return false
      for (let y = point.y; y < point.y + text.height; y++) for (let x = point.x - margin; x < point.x + text.width; x++) {
        if (retained.cell(x, y) || protectedCells.has(`${x},${y}`) || markerCells.has(cellKey(x, y))) return false
        for (const box of rectangles.values()) if (inside(box, x, y)) return false
      }
      return true
    }
    let origin = clear(preferred) ? preferred : undefined
    if (!origin) {
      // Rectangle contact coordinates provide finite measured candidates,
      // including long labels outside deeply nested frames, without a pixel
      // settling loop or an arbitrary radius unrelated to the content.
      const xs = new Set([preferred.x, 0]), ys = new Set([preferred.y, 0])
      for (const region of regions ??= graph.canvas.regions()) {
        // Region summaries prefer authored text bounds. Routing must clear
        // the complete painted card, including its border and empty rows.
        const spans = region.ownedCellSpans
        xs.add(Math.min(...spans.map(span => span.start)) - text.width - 1)
        xs.add(Math.max(...spans.map(span => span.end)) + 1)
        ys.add(Math.min(...spans.map(span => span.row)) - text.height - 1)
        ys.add(Math.max(...spans.map(span => span.row)) + 2)
      }
      for (const box of rectangles.values()) { xs.add(box.x - text.width - 1); xs.add(box.x + box.width + 1); ys.add(box.y - text.height - 1); ys.add(box.y + box.height + 1) }
      const candidates = [...xs].flatMap(x => [...ys].map(y => ({ x, y }))).sort((a, b) => Math.abs(a.x - preferred.x) + Math.abs(a.y - preferred.y) - Math.abs(b.x - preferred.x) - Math.abs(b.y - preferred.y) || a.y - b.y || a.x - b.x)
      origin = candidates.find(clear)
    }
    if (origin) rectangles.set(edge, { ...origin, width: text.width, height: text.height })
  }
  const rectangleList = [...rectangles]
  const extent = { maxX: Math.max(protectedCells.extent.maxX, ...rectangleList.map(([, box]) => box.x + box.width)), maxY: Math.max(protectedCells.extent.maxY, ...rectangleList.map(([, box]) => box.y + box.height)) }
  // Index each admitted label rectangle by the cells it covers (`inside`,
  // including a multiline label's wire column) so an obstacle probe reads
  // only the labels at that cell instead of every label in the diagram.
  const rectangleCells = new Map<number, Array<[AsciiEdge, Rectangle]>>()
  for (const entry of rectangleList) {
    const [, box] = entry
    for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x - (box.height > 1 ? 1 : 0); x < box.x + box.width; x++) {
      const members = rectangleCells.get(cellKey(x, y)); if (members) members.push(entry); else rectangleCells.set(cellKey(x, y), [entry])
    }
  }
  for (const edge of edges) {
    if (!ends.has(edge)) continue
    const [start, end] = ends.get(edge)!, rectangle = rectangles.get(edge)
    const exit = step(start, edge.startDir, graphEdgeEscape(edge, true)), entry = step(end, edge.endDir, graphEdgeEscape(edge, false))
    const ownMarkers = new Set([start, end, step(start, edge.startDir, 1), step(end, edge.endDir, 1)].map(point => cellKey(point.x, point.y)))
    const protectedCell = protectedCells.hasCell ?? ((x: number, y: number) => protectedCells.has(`${x},${y}`))
    const hasCell = (x: number, y: number): boolean => {
      const key = cellKey(x, y)
      if (ownMarkers.has(key) || protectedCell(x, y)) return true
      for (const owner of markerCells.get(key) ?? []) if (owner !== edge) return true
      // Another label blocks its whole `inside` area; this edge's own label
      // blocks only a multiline rectangle, never the adjacent wire column.
      for (const [owner, box] of rectangleCells.get(key) ?? []) if (owner !== edge || box.height > 1 && x >= box.x) return true
      return false
    }
    const obstacles: PathOccupancy = {
      extent,
      hasCell,
      has(key) {
        const comma = key.indexOf(',')
        return hasCell(Number(key.slice(0, comma)), Number(key.slice(comma + 1)))
      },
    }
    // A multiline label has a real adjacent vertical run spanning every row,
    // including authored blank rows. Short rows need not reach a centre wire.
    const labelStart = rectangle ? rectangle.height > 1 ? { x: rectangle.x - 1, y: rectangle.y } : { x: rectangle.x + Math.floor(rectangle.width / 2), y: rectangle.y } : undefined
    const labelEnd = rectangle && labelStart ? { x: labelStart.x, y: labelStart.y + rectangle.height - 1 } : undefined
    const canStep = (from: DrawingCoord, to: DrawingCoord): boolean => {
      const mask = from.x === to.x ? 5 : 10
      return !((routed.get(cellKey(from.x, from.y)) ?? 0) & mask) && !((routed.get(cellKey(to.x, to.y)) ?? 0) & mask)
    }
    const first = !obstacles.has(`${exit.x},${exit.y}`) && !obstacles.has(`${entry.x},${entry.y}`)
      ? getPath(obstacles, exit, labelStart ?? entry, edge.startDir, canStep) : null
    const second = labelEnd && first ? getPath(obstacles, labelEnd, entry, edge.endDir, canStep) : []
    if (first && second && (!edge.text || rectangle)) {
      edge.cellRoute = { points: dedupeCollinear([start, ...mergePath(first), ...(labelEnd ? [labelEnd] : []), ...mergePath(second).slice(1), end]), ...(rectangle ? { label: { x: rectangle.x, y: rectangle.y } } : {}) }
      for (let index = 1; index < edge.cellRoute.points.length; index++) {
        const a = edge.cellRoute.points[index - 1]!, b = edge.cellRoute.points[index]!
        const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y), mask = dx ? 10 : 5
        for (let x = a.x, y = a.y;; x += dx, y += dy) {
          const key = cellKey(x, y); routed.set(key, (routed.get(key) ?? 0) | mask)
          if (x === b.x && y === b.y) break
        }
      }
    } else {
      edge.cellRoute = { points: [] }
      recordGraphPorts(graph, edge, start, end)
      const reason = !rectangle && edge.text ? 'complete label rectangle' : !first ? 'source-to-label route' : 'label-to-target route'
      graph.canvas.report({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: `edge-lane:${terminalEdgeOwner(graph, edge).id}`, ...(rectangle ? { cell: { column: rectangle.x, row: rectangle.y } } : {}), message: `Bounded terminal routing could not allocate the ${reason} between its physical ports.` })
    }
  }
  return conflicts
}

/** Index actual owned route ink once before placing a group of labels. */
function graphLabelRoutes(document: Canvas, labels: readonly GraphLabel[]): Map<string, DrawingCoord[]> {
  const owners = new Set(labels.map(label => label.owner.id)), routes = new Map<string, DrawingCoord[]>()
  if (labels.length) for (const [x, y, cell] of document.entries()) {
    if (cell.kind !== 'stroke' && cell.kind !== 'marker') continue
    for (const owner of cell.owners) if (owner.kind === 'edge' && owners.has(owner.id)) {
      const route = routes.get(owner.id) ?? []; route.push({ x, y }); routes.set(owner.id, route)
    }
  }
  return routes
}

/** Reserve actual emitted endpoint contacts and their first exterior cell. */
function graphPortApproaches(document: Canvas): ReadonlySet<string> {
  const approachCells = new Set<string>()
  for (const region of document.regions()) if (region.kind === 'edge') for (const port of region.ports ?? []) {
    const dx = port.side === 'L' ? -1 : port.side === 'R' ? 1 : 0
    const dy = port.side === 'T' ? -1 : port.side === 'B' ? 1 : 0
    approachCells.add(`${port.x},${port.y}`); approachCells.add(`${port.x + dx},${port.y + dy}`)
  }
  return approachCells
}

/** Allocate an entire label before overlay. Its preferred position may cover
 * its own route; relocation uses empty space so no unrelated ink is erased. */
function feasibleLabel(document: Canvas, label: GraphLabel, route: readonly DrawingCoord[], approachCells: ReadonlySet<string>): { drawing: Canvas; admitted: boolean } {
  let left = Infinity, top = Infinity, right = 0, bottom = 0
  for (const row of label.rows) {
    left = Math.min(left, row.x); top = Math.min(top, row.y)
    right = Math.max(right, row.x + row.text.width - 1); bottom = Math.max(bottom, row.y + row.text.height - 1)
  }
  const owns = (owner: TerminalOwner) => label.owner.id === owner.id && label.owner.kind === owner.kind
  const clear = (dx: number, dy: number, allowOwnRoute: boolean): boolean => {
    if (left + dx < 0 || top + dy < 0) return false
    let touchesRoute = false
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      if (approachCells.has(`${x + dx},${y + dy}`)) return false
      const previous = document.cell(x + dx, y + dy)
      if (previous && !(allowOwnRoute && previous.kind === 'stroke' && previous.owners.length && previous.owners.every(owns))) return false
      for (const [nx, ny] of [[x + dx, y + dy], [x + dx - 1, y + dy], [x + dx + 1, y + dy], [x + dx, y + dy - 1], [x + dx, y + dy + 1]]) {
        if (document.cell(nx!, ny!)?.owners.some(owns)) touchesRoute = true
      }
    }
    return touchesRoute
  }
  const placed = (dx: number, dy: number): Canvas => {
    const canvas = copyCanvas(document)
    canvas.scope(label.owner, () => {
      for (const row of label.rows) canvas.textBlock(row.x + dx, row.y + dy, row.text, { role: 'text', ...(label.color ? { color: label.color } : {}) })
    })
    return canvas
  }
  if (clear(0, 0, true)) return { drawing: placed(0, 0), admitted: true }
  // These candidates depend on measured dimensions, not a search radius: even
  // a long label can sit immediately beside its own run. For each route cell,
  // align the nearest end or the preferred position along the adjacent face.
  const candidates = new Map<string, DrawingCoord>()
  const candidate = (x: number, y: number): void => {
    const point = { x: x - left, y: y - top }
    if (x >= 0 && y >= 0) candidates.set(`${point.x},${point.y}`, point)
  }
  const width = right - left + 1, height = bottom - top + 1
  for (const point of route) {
    for (const y of [clamp(top, point.y - height + 1, point.y), point.y, point.y - height + 1]) {
      candidate(point.x - width, y); candidate(point.x + 1, y)
    }
    for (const x of [clamp(left, point.x - width + 1, point.x), point.x, point.x - width + 1]) {
      candidate(x, point.y - height); candidate(x, point.y + 1)
    }
  }
  const adjacent = [...candidates.values()].sort((a, b) =>
    Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y)
      || Math.abs(a.x) - Math.abs(b.x) || a.y - b.y || b.x - a.x)
  for (const point of adjacent) if (clear(point.x, point.y, false)) return { drawing: placed(point.x, point.y), admitted: true }
  // Bounded integer candidates nearest the authored route anchor. Prefer the
  // adjacent row before moving horizontally away from the relationship.
  for (let radius = 1; radius <= 24; radius++) for (let dx = 0; dx <= radius; dx++) {
    const dy = radius - dx
    for (const [x, y] of [[dx, -dy], [dx, dy], [-dx, -dy], [-dx, dy]]) if (clear(x!, y!, false)) return { drawing: placed(x!, y!), admitted: true }
  }
  // Let strict composition diagnose a genuinely unavailable local rectangle;
  // silently detaching a label elsewhere would misrepresent its relationship.
  return { drawing: placed(0, 0), admitted: false }
}

/** Admit actual route contributions, rather than guessed grid corridors.
 * Different units may cross perpendicularly; collinear ink and opaque markers
 * cannot stand for independent relationships at the same terminal cell. */
function retainedRouteConflicts(graph: AsciiGraph, layers: readonly Canvas[][], projected: Canvas): Set<AsciiEdge> {
  const edges = new Map(graph.edges.map(edge => [terminalEdgeOwner(graph, edge).id, edge]))
  const occupied = new Map<string, Map<object | string, { edges: Set<AsciiEdge>; mask: number; marker: boolean }>>()
  for (const stage of layers) for (const layer of stage) for (const [x, y, cell] of layer.entries()) {
    const point = `${x},${y}`, units = occupied.get(point) ?? new Map()
    for (const owner of cell.owners) {
      const edge = owner.kind === 'edge' ? edges.get(owner.id) : undefined
      if (!edge) continue
      const unit = edge.bundle ?? edge.sharedTrunk ?? edge
      const previous = units.get(unit) ?? { edges: new Set<AsciiEdge>(), mask: 0, marker: false }
      const mask = cell.stroke?.mask ?? 0
      previous.edges.add(edge); previous.mask |= mask
      previous.marker ||= cell.kind === 'marker'
      units.set(unit, previous)
    }
    occupied.set(point, units)
  }
  const conflicts = new Set<AsciiEdge>()
  // Logical adjacency does not prove a visible route: projection can leave
  // half-strokes in its interior or replace the final bend with a marker.
  // Index the actual combined paint once, preserving every shared owner,
  // then admit each retained route through its own cardinal glyph contacts.
  const routes = new Map<AsciiEdge, Map<string, number>>()
  for (const [x, y, cell] of projected.entries()) {
    // Arrowheads terminate at their tail; they are never transit junctions.
    if (cell.marker?.shape === 'arrow') continue
    const ports = terminalCellConnections(cell)
    if (!ports) continue
    for (const owner of cell.owners) {
      const edge = owner.kind === 'edge' ? edges.get(owner.id) : undefined
      if (!edge || edge.cellAllocation) continue
      const cells = routes.get(edge) ?? new Map<string, number>()
      cells.set(`${x},${y}`, ports); routes.set(edge, cells)
    }
  }
  const normals = { T: [0, -1, 1, 4], R: [1, 0, 2, 8], B: [0, 1, 4, 1], L: [-1, 0, 8, 2] } as const
  for (const region of projected.regions()) {
    const edge = region.kind === 'edge' ? edges.get(region.id) : undefined
    if (!edge || edge.cellAllocation || edge.style === 'invisible') continue
    const start = region.ports?.find(port => port.end === 'start'), end = region.ports?.find(port => port.end === 'end')
    if (!start?.side || !end?.side) { conflicts.add(edge); continue }
    const [sx, sy, sourceOut, sourceContact] = normals[start.side], [tx, ty, , targetContact] = normals[end.side]
    const markerX = end.x + tx * (end.markerOffset ?? 1), markerY = end.y + ty * (end.markerOffset ?? 1)
    let exit = `${start.x + sx},${start.y + sy}`, tip = `${markerX},${markerY}`
    let sourceRequired = sourceContact
    const cells = routes.get(edge)
    const opposite = { T: 'B', R: 'L', B: 'T', L: 'R' } as const
    if (edge.hasArrowStart && (!edge.startMarker || edge.startMarker === 'arrow')) {
      const marker = projected.cell(start.x + sx * (start.markerOffset ?? 0), start.y + sy * (start.markerOffset ?? 0))
      if (marker?.marker?.shape !== 'arrow' || marker.marker.direction !== opposite[start.side]) { conflicts.add(edge); continue }
    }
    if (edge.hasArrowEnd && (!edge.endMarker || edge.endMarker === 'arrow')) {
      const marker = projected.cell(markerX, markerY)
      if (marker?.marker?.shape !== 'arrow' || marker.marker.direction !== opposite[end.side]) { conflicts.add(edge); continue }
      tip = `${markerX + tx},${markerY + ty}`
      // A one-cell arrow can meet its source face directly. Only an actual
      // owned junction on that face can supply its tail, never an invented port.
      if (exit === `${markerX},${markerY}` && tip === `${start.x},${start.y}` && ((cells?.get(tip) ?? 0) & sourceOut)) { exit = tip; sourceRequired = sourceOut }
    }
    if (!((cells?.get(exit) ?? 0) & sourceRequired) || !((cells?.get(tip) ?? 0) & targetContact)) { conflicts.add(edge); continue }
    const queue = [exit], seen = new Set(queue)
    for (let index = 0; index < queue.length && !seen.has(tip); index++) {
      const key = queue[index]!, comma = key.indexOf(','), x = Number(key.slice(0, comma)), y = Number(key.slice(comma + 1)), ports = cells!.get(key)!
      for (const [dx, dy, out, into] of Object.values(normals)) {
        const next = `${x + dx},${y + dy}`
        if ((ports & out) && ((cells!.get(next) ?? 0) & into) && !seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
    if (!seen.has(tip)) conflicts.add(edge)
  }
  for (const units of occupied.values()) {
    const contributions = [...units.values()]
    if (contributions.length < 2) continue
    const marker = contributions.some(unit => unit.marker)
    const horizontal = contributions.filter(unit => unit.mask & 10).length > 1
    const vertical = contributions.filter(unit => unit.mask & 5).length > 1
    for (const unit of contributions) if (marker || horizontal && (unit.mask & 10) || vertical && (unit.mask & 5)) {
      for (const edge of unit.edges) conflicts.add(edge)
    }
  }
  return conflicts
}

export function drawGraph(graph: AsciiGraph): Canvas {
  for (;;) {
    const result = drawGraphCandidate(graph)
    if (result instanceof Set) {
      if (!graph.reserveRouteUnits?.(result)) throw new Error('Terminal routing closure did not grow')
      continue
    }
    return result
  }
}

/** Each attempt is private. A closure expansion discards all geometry and
 * owner registrations before projecting the finite larger unit set. */
function drawGraphCandidate(graph: AsciiGraph): Canvas | Set<AsciiEdge> {
  const containerKind = graph.containerKind ?? 'subgraph'
  const document = graph.canvas
  const parentFor = new Map(graph.subgraphs.flatMap(group => group.nodes.map(node => [node.name, group.id] as const)))
  for (const group of sortSubgraphsByDepth(graph.subgraphs)) {
    const owner = {
      id: group.id, kind: containerKind,
      ...(group.parent ? { parent: { id: group.parent.id, kind: containerKind } } : {}),
      members: [...group.nodes.filter(node => !node.containerAnchor && parentFor.get(node.name) === group.id).map(node => node.name), ...group.children.map(child => child.id)],
    }
    document.region(owner, { x: group.minX, y: group.minY, width: group.maxX - group.minX + 1, height: group.maxY - group.minY + 1 })
    if (!group.concurrencyRegion) document.overlay(drawSubgraphBox(group, graph).attribute(owner, { role: 'border' }), group.minX, group.minY)
  }
  document.overlay(drawConcurrencyRegionSeparators(graph, containerKind))
  for (const node of graph.nodes) {
    if (!node.drawn && node.drawingCoord && node.drawing) {
      const owner = { id: node.name, kind: 'node' as const, ...(parentFor.has(node.name) ? { parent: { id: parentFor.get(node.name)!, kind: containerKind } } : {}) }
      document.overlay(node.drawing.attribute(owner, { role: 'border' }), node.drawingCoord.x, node.drawingCoord.y)
      node.drawn = true
    }
  }
  for (const group of graph.subgraphs) {
    if (group.nodes.length === 0 || group.concurrencyRegion) continue
    const [label, offset] = drawSubgraphLabel(group, graph, containerKind)
    document.overlay(label.attribute({ id: group.id, kind: containerKind }, { role: 'text' }), offset.x, offset.y)
  }
  const protectedCells = protectedGraphCells(document)

  // Global paint order remains explicit, while each layer stores touched cells only.
  const layers: Canvas[][] = Array.from({ length: 7 }, () => [])
  const edgeOwner = (edge: AsciiEdge) => terminalEdgeOwner(graph, edge)
  const edgeStyles = new Map(graph.edges.map(edge => [edgeOwner(edge).id, edge.inlineStyle]))
  const add = (stage: number, drawing: Canvas, owners: ReturnType<typeof edgeOwner> | ReturnType<typeof edgeOwner>[], role: CharRole): void => {
    const first = Array.isArray(owners) ? owners[0]! : owners
    const style = edgeStyles.get(first.id)
    const color = safeCssColor(role === 'text' ? style?.color ?? style?.stroke : style?.stroke)
    layers[stage]!.push(drawing.attribute(owners, { role, ...(color ? { color } : {}), ...(role === 'arrow' ? { kind: 'marker' as const } : {}) }))
  }
  const labels: GraphLabel[] = []
  const processed = new Set<EdgeBundle>()
  const collect = (edges: readonly AsciiEdge[]): void => {
    for (const edge of edges) {
      const owner = edgeOwner(edge)
      const label = planArrowLabel(graph, edge)
      if (label) labels.push(label)
      if (edge.bundle && edge.pathToJunction) {
        const bundle = edge.bundle
        recordGraphPorts(graph, edge, getNodeAttachmentPoint(graph, edge.from, edge.startDir), getNodeAttachmentPoint(graph, edge.to, edge.endDir))
        const [path, start, , , corners] = drawBundledEdgeSegment(graph, edge, bundle, protectedCells)
        add(0, path, owner, 'line'); add(1, corners, owner, 'corner')
        add(4, start, owner, 'junction')
        if (!processed.has(bundle)) {
          processed.add(bundle)
          const owners = bundle.edges.map(edgeOwner)
          const [shared, sharedCorners] = drawBundleSharedPath(graph, bundle, protectedCells)
          add(0, shared, owners, 'line'); add(1, sharedCorners, owners, 'corner')
          if (bundle.type === 'fan-in') add(3, drawBundleArrowhead(graph, bundle), owners, 'arrow')
          add(2, drawJunctionCharacter(graph, bundle), owners, 'junction')
        }
        if (bundle.type === 'fan-out' && edge.hasArrowEnd) add(3, drawBundledEdgeArrowhead(graph, edge), owner, 'arrow')
      } else {
        const [path, start, endHead, startHead, corners] = drawArrow(graph, edge, protectedCells)
        add(0, path, owner, 'line'); add(1, corners, owner, 'corner')
        add(3, endHead, owner, 'arrow'); add(4, start, owner, 'junction')
        add(5, startHead, owner, 'arrow')
      }
    }
  }
  collect(graph.edges.filter(edge => !edge.cellAllocation))
  const trunks = new Map<string, AsciiEdge[]>()
  for (const edge of graph.edges) if (edge.sharedTrunk) {
    const members = trunks.get(edge.sharedTrunk) ?? []; members.push(edge); trunks.set(edge.sharedTrunk, members)
  }
  for (const junction of graph.trunkJunctions) {
    const owners = (trunks.get(junction.trunk) ?? []).map(edgeOwner)
    if (!owners.length) continue
    const point = gridToDrawingCoord(graph, junction), drawing = document.blank()
    drawing.stroke(point.x, point.y, graph.config.graphDirection === 'LR' ? graph.config.reverseDirection ? 13 : 7 : 14, { ascii: graph.config.useAscii })
    add(6, drawing, owners, 'junction')
  }
  const allocated = graph.edges.filter(edge => edge.cellAllocation)
  const retained = allocated.length ? document.blank() : document
  if (retained !== document) retained.overlay(document)
  for (const stage of layers) for (const layer of stage) retained.overlay(layer)
  const conflicts = retainedRouteConflicts(graph, layers, retained)
  if (conflicts.size) return conflicts
  const retainedLabels: Canvas[] = []
  const retainedApproaches = graphPortApproaches(retained), retainedRoutes = graphLabelRoutes(retained, labels)
  for (const label of labels) {
    const planned = feasibleLabel(retained, label, retainedRoutes.get(label.owner.id) ?? [], retainedApproaches)
    if (!planned.admitted) return new Set(graph.edges.filter(edge => edgeOwner(edge).id === label.owner.id))
    retainedLabels.push(planned.drawing); retained.overlay(planned.drawing)
  }
  if (!allocated.length) return document
  labels.length = 0
  const affected = planAllocatedGraphRoutes(graph, protectedGraphCells(retained), retained)
  if (affected.size) return affected
  collect(allocated)
  for (let stage = 0; stage < layers.length; stage++) {
    for (const drawing of layers[stage]!) document.overlay(drawing)
  }
  for (const label of retainedLabels) document.overlay(label)
  // Index actual painted route ink once, including declared shared ownership.
  // Label placement must not consult stale grid paths after header detours.
  const labelRoutes = graphLabelRoutes(document, labels)
  const approaches = graphPortApproaches(document)
  for (const label of labels) document.overlay(feasibleLabel(document, label, labelRoutes.get(label.owner.id) ?? [], approaches).drawing)
  // Exhausting the bounded route search is an explicit projection, not a
  // missing marker that crashes serialization. Retain every authored
  // relationship in owned text; the collision diagnostic still fails strict
  // terminal certification.
  for (const edge of graph.edges) {
    if (!edge.cellRoute || edge.cellRoute.points.length || edge.style === 'invisible') continue
    const owner = edgeOwner(edge), feature = `graph.${owner.id}.route`
    const head = (start: boolean) => {
      if (!(start ? edge.hasArrowStart : edge.hasArrowEnd)) return ''
      const marker = start ? edge.startMarker : edge.endMarker
      return marker === 'circle' ? 'o' : marker === 'cross' ? 'x' : start ? '<' : '>'
    }
    const shaft = edge.style === 'dotted' ? '-.-' : edge.style === 'thick' ? '==' : '--'
    const summary = `${owner.from} ${head(true)}${shaft}${head(false)} ${owner.to}${edge.text ? ` : ${edge.text}` : ''}`
    document.textBlock(0, document.height, measuredText(summary), { owner, role: 'text' })
    document.projectMarkers(owner, feature)
    document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature, message: 'No complete terminal route was allocated; the authored relationship is retained in an owned endpoint summary.' })
  }
  return document
}
