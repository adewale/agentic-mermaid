import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { applyTextTransform, resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import { measureSystemFontSafeTextWidth } from '../text-metrics.ts'
import type { RenderOptions } from '../types.ts'
import type { SankeyVisualConfig } from './config.ts'
import { DEFAULT_SANKEY_VISUAL_CONFIG } from './config.ts'
import type { PositionedSankeyChart, PositionedSankeyLink, PositionedSankeyNode, SankeyDiagram } from './types.ts'

// ============================================================================
// Sankey layout engine
//
// A deterministic layered flow layout in the d3-sankey tradition, clean-room:
//
//   1. Layering: longest-path depth from the sources; the resolved
//      `sankey.nodeAlignment` places sinks/orphans (justify flushes pure
//      sinks to the last layer, matching upstream's default alignment).
//   2. Vertical scale: ky = min over layers of
//      (extent - (n-1) * nodePadding) / sum(node values), so every layer fits.
//   3. Ordering: a fixed number of barycenter relaxation sweeps (alternating
//      left→right and right→left with a decaying step) followed by collision
//      resolution. No randomness, no clock — identical input, identical
//      geometry.
//   4. Link stacking: at each node, outgoing links sort by target center
//      (incoming by source center), then stack top-to-bottom; each link is a
//      centerline cubic Bézier whose stroke width is value * ky.
//
// All coordinates are direct pixel positions — the renderer never recomputes
// geometry. Labels follow the upstream convention: nodes in the left half
// carry their label to the right of the rectangle, nodes in the right half to
// the left, with the formatted value on a second line when `showValues`.
// ============================================================================

const SANKEY = {
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleGap: 20,
  labelFontSize: 13,
  labelFontWeight: 500,
  valueFontWeight: 400,
  /** Gap between a node rectangle and its label. */
  labelGap: 6,
  /** Line advance inside a two-line label (matches renderMultilineText). */
  labelLineHeight: 13 * 1.3,
  /** Barycenter relaxation sweep steps (deterministic, fixed count). */
  relaxationSteps: [1, 0.75, 0.5, 0.3, 0.2, 0.1],
  /** Visibility floor so a zero/tiny-value node cannot vanish entirely. */
  minNodeHeight: 1,
  nodeStrokeWidth: 1,
} as const

/** Shared by layout and rendering so role typography reserves the exact canvas
 * that the renderer consumes. */
export const SANKEY_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: SANKEY.labelFontSize,
  edgeLabelFontSize: SANKEY.labelFontSize,
  groupHeaderFontSize: SANKEY.titleFontSize,
  nodeLabelFontWeight: SANKEY.labelFontWeight,
  edgeLabelFontWeight: SANKEY.labelFontWeight,
  groupHeaderFontWeight: SANKEY.titleFontWeight,
  nodePaddingX: 0,
  nodePaddingY: 0,
  nodeLineWidth: SANKEY.nodeStrokeWidth,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: 0,
  groupPaddingY: 0,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

/** Format a flow value faithfully — full authored precision, no rounding. */
export function formatSankeyValue(value: number, visual: SankeyVisualConfig): string {
  return `${visual.prefix}${String(value)}${visual.suffix}`
}

/** Stable link id: endpoints plus an occurrence suffix for duplicate rows. */
export function sankeyLinkId(source: string, target: string, occurrence: number): string {
  const base = `link:${source}->${target}`
  return occurrence === 0 ? base : `${base}#${occurrence}`
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

interface LayoutNode {
  label: string
  index: number
  value: number
  layer: number
  height: number
  y0: number
  outgoing: LayoutLink[]
  incoming: LayoutLink[]
}

interface LayoutLink {
  source: LayoutNode
  target: LayoutNode
  value: number
  index: number
  width: number
  sy: number
  ty: number
}

/**
 * Lay out a parsed sankey diagram. Node order (palette identity) is
 * first-appearance order; the vertical order inside each layer is decided by
 * the deterministic relaxation passes.
 */
export function layoutSankeyDiagram(diagram: SankeyDiagram, options: RenderOptions = {}, visual: SankeyVisualConfig = DEFAULT_SANKEY_VISUAL_CONFIG, styleFace?: Readonly<InternalStyleFace>): PositionedSankeyChart {
  const style = resolveRenderStyle(options, SANKEY_STYLE_DEFAULTS, styleFace)

  // -- graph model -----------------------------------------------------------
  const nodes: LayoutNode[] = diagram.nodes.map((label, index) => ({
    label,
    index,
    value: 0,
    layer: 0,
    height: 0,
    y0: 0,
    outgoing: [],
    incoming: [],
  }))
  const byLabel = new Map(nodes.map(node => [node.label, node]))
  const links: LayoutLink[] = diagram.links.map((link, index) => {
    const source = byLabel.get(link.source)!
    const target = byLabel.get(link.target)!
    const model: LayoutLink = { source, target, value: link.value, index, width: 0, sy: 0, ty: 0 }
    source.outgoing.push(model)
    target.incoming.push(model)
    return model
  })
  for (const node of nodes) {
    node.value = Math.max(
      node.outgoing.reduce((sum, link) => sum + link.value, 0),
      node.incoming.reduce((sum, link) => sum + link.value, 0),
    )
  }

  // -- layering (parser guarantees acyclicity) -------------------------------
  const depth = longestPathFromSources(nodes)
  const heightFromSinks = longestPathToSinks(nodes)
  const maxDepth = Math.max(...depth)
  for (const node of nodes) {
    switch (visual.nodeAlignment) {
      case 'left':
        node.layer = depth[node.index]!
        break
      case 'right':
        node.layer = maxDepth - heightFromSinks[node.index]!
        break
      case 'center':
        // d3's sankeyCenter: keep depth when the node has incoming links;
        // otherwise sit one layer left of its nearest target (orphans at 0).
        node.layer = node.incoming.length > 0 ? depth[node.index]! : node.outgoing.length > 0 ? Math.min(...node.outgoing.map(link => depth[link.target.index]!)) - 1 : 0
        break
      default:
        // justify: pure sinks flush to the last layer.
        node.layer = node.outgoing.length > 0 ? depth[node.index]! : maxDepth
        break
    }
  }
  const layerCount = maxDepth + 1
  const layers: LayoutNode[][] = Array.from({ length: layerCount }, () => [])
  for (const node of nodes) layers[node.layer]!.push(node)

  // -- vertical scale --------------------------------------------------------
  // The flow area grows beyond the configured height when a layer physically
  // cannot fit its nodes at the visibility floor.
  let flowHeight = Math.max(visual.height, ...layers.map(layer => layer.length * SANKEY.minNodeHeight + (layer.length - 1) * visual.nodePadding))
  let ky = Number.POSITIVE_INFINITY
  for (const layer of layers) {
    const total = layer.reduce((sum, node) => sum + node.value, 0)
    if (total > 0) {
      ky = Math.min(ky, (flowHeight - (layer.length - 1) * visual.nodePadding) / total)
    }
  }
  if (!Number.isFinite(ky) || ky < 0) ky = 0
  for (const link of links) {
    link.width = Math.max(link.value > 0 ? 1 : 0, link.value * ky)
  }
  // A node face must hold its CLAMPED ribbon stack: the 1px visibility floor
  // can out-stack `value * ky` (a tiny flow beside a large one), so height
  // follows the stacks, and the flow area grows again so clamped stacks still
  // fit their layer — same growth discipline as the node-height floor above.
  const stacked = (side: readonly LayoutLink[]) => side.reduce((sum, link) => sum + link.width, 0)
  for (const node of nodes) {
    node.height = Math.max(SANKEY.minNodeHeight, node.value * ky, stacked(node.outgoing), stacked(node.incoming))
  }
  flowHeight = Math.max(flowHeight, ...layers.map(layer => layer.reduce((sum, node) => sum + node.height, 0) + (layer.length - 1) * visual.nodePadding))

  // -- vertical placement ----------------------------------------------------
  // Initialize stacked in first-appearance order, then relax.
  for (const layer of layers) {
    let y = 0
    for (const node of layer) {
      node.y0 = y
      y += node.height + visual.nodePadding
    }
  }
  for (const alpha of SANKEY.relaxationSteps) {
    relaxTowardNeighbors(layers, alpha, 'incoming')
    resolveCollisions(layers, flowHeight, visual.nodePadding)
    relaxTowardNeighbors(layers, alpha, 'outgoing')
    resolveCollisions(layers, flowHeight, visual.nodePadding)
  }

  // -- horizontal placement --------------------------------------------------
  const flowWidth = Math.max(visual.width, layerCount * visual.nodeWidth)
  const xStep = layerCount > 1 ? (flowWidth - visual.nodeWidth) / (layerCount - 1) : 0
  const flowLeft = SANKEY.padding
  const renderedTitle = diagram.title ? applyTextTransform(diagram.title, style.groupTextTransform) : undefined
  const titleFontSize = style.groupHeaderFontSize
  const titleHeight = renderedTitle ? titleFontSize + SANKEY.titleGap : 0
  const flowTop = SANKEY.padding + titleHeight
  const nodeX = (node: LayoutNode) => (layerCount > 1 ? flowLeft + node.layer * xStep : flowLeft + (flowWidth - visual.nodeWidth) / 2)

  // -- link stacking ---------------------------------------------------------
  for (const node of nodes) {
    const center = (peer: LayoutNode) => peer.y0 + peer.height / 2
    node.outgoing.sort((a, b) => center(a.target) - center(b.target) || a.index - b.index)
    node.incoming.sort((a, b) => center(a.source) - center(b.source) || a.index - b.index)
    let sy = node.y0
    for (const link of node.outgoing) {
      link.sy = sy + link.width / 2
      sy += link.width
    }
    let ty = node.y0
    for (const link of node.incoming) {
      link.ty = ty + link.width / 2
      ty += link.width
    }
  }

  // -- labels + canvas bounds ------------------------------------------------
  const labelFontSize = style.nodeLabelFontSize
  const flowCenterX = flowLeft + flowWidth / 2
  interface LabelPlan {
    lines: string[]
    anchor: 'start' | 'end'
    width: number
  }
  const labelPlans = new Map<LayoutNode, LabelPlan>()
  for (const node of nodes) {
    const name = applyTextTransform(node.label, style.nodeTextTransform)
    const lines = visual.showValues ? [name, formatSankeyValue(node.value, visual)] : [name]
    const anchor: 'start' | 'end' = nodeX(node) + visual.nodeWidth / 2 < flowCenterX ? 'start' : 'end'
    const width = Math.max(...lines.map(line => measureSystemFontSafeTextWidth(line, labelFontSize, style.nodeLabelFontWeight)))
    labelPlans.set(node, { lines, anchor, width })
  }
  let minX: number = flowLeft
  let maxX = flowLeft + flowWidth
  for (const node of nodes) {
    const plan = labelPlans.get(node)!
    const x0 = nodeX(node)
    if (plan.anchor === 'start') {
      maxX = Math.max(maxX, x0 + visual.nodeWidth + SANKEY.labelGap + plan.width)
    } else {
      minX = Math.min(minX, x0 - SANKEY.labelGap - plan.width)
    }
  }
  const shiftX = SANKEY.padding - minX
  const width = Math.max(maxX + shiftX + SANKEY.padding, (renderedTitle ? measureSystemFontSafeTextWidth(renderedTitle, titleFontSize, style.groupHeaderFontWeight) : 0) + 2 * SANKEY.padding)
  const height = flowTop + flowHeight + SANKEY.padding

  // -- positioned projection -------------------------------------------------
  const positionedNodes: PositionedSankeyNode[] = nodes.map(node => {
    const plan = labelPlans.get(node)!
    const x0 = nodeX(node) + shiftX
    const x1 = x0 + visual.nodeWidth
    const y0 = flowTop + node.y0
    const y1 = y0 + node.height
    return {
      label: node.label,
      value: node.value,
      layer: node.layer,
      x0: round(x0),
      y0: round(y0),
      x1: round(x1),
      y1: round(y1),
      labelLines: plan.lines,
      labelX: round(plan.anchor === 'start' ? x1 + SANKEY.labelGap : x0 - SANKEY.labelGap),
      labelY: round((y0 + y1) / 2),
      labelAnchor: plan.anchor,
    }
  })

  const occurrences = new Map<string, number>()
  const positionedLinks: PositionedSankeyLink[] = links.map(link => {
    const key = `${link.source.label}->${link.target.label}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const sx = round(nodeX(link.source) + shiftX + visual.nodeWidth)
    const tx = round(nodeX(link.target) + shiftX)
    const sy = round(flowTop + link.sy)
    const ty = round(flowTop + link.ty)
    const geometry = linkCenterline(sx, sy, tx, ty)
    return {
      id: sankeyLinkId(link.source.label, link.target.label, occurrence),
      source: link.source.label,
      target: link.target.label,
      value: link.value,
      path: geometry.path,
      points: geometry.points,
      width: round(link.width),
      sx,
      sy,
      tx,
      ty,
    }
  })

  return {
    width: round(width),
    height: round(height),
    ...(renderedTitle ? { title: { text: renderedTitle, x: round(width / 2), y: SANKEY.padding + titleFontSize / 2 } } : {}),
    nodes: positionedNodes,
    links: positionedLinks,
    total: diagram.links.reduce((sum, link) => sum + link.value, 0),
    visual,
  }
}

/** Centerline cubic Bézier plus its deterministic routed polyline projection
 * (sampled at fixed t so typed connector geometry has honest interior points). */
function linkCenterline(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): {
  path: string
  points: Array<{ x: number; y: number }>
} {
  const mx = round((sx + tx) / 2)
  const path = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`
  const points: Array<{ x: number; y: number }> = []
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const u = 1 - t
    // Cubic with control points (mx, sy) and (mx, ty).
    const x = u * u * u * sx + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * tx
    const y = u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t * t * t * ty
    points.push({ x: round(x), y: round(y) })
  }
  return { path, points }
}

/** Longest-path depth from the sources over the (acyclic) link graph. */
function longestPathFromSources(nodes: readonly LayoutNode[]): number[] {
  const depth = nodes.map(() => 0)
  for (const node of topologicalOrder(nodes)) {
    for (const link of node.outgoing) {
      depth[link.target.index] = Math.max(depth[link.target.index]!, depth[node.index]! + 1)
    }
  }
  return depth
}

/** Longest-path distance to the sinks (the mirror of `longestPathFromSources`). */
function longestPathToSinks(nodes: readonly LayoutNode[]): number[] {
  const height = nodes.map(() => 0)
  for (const node of [...topologicalOrder(nodes)].reverse()) {
    for (const link of node.outgoing) {
      height[node.index] = Math.max(height[node.index]!, height[link.target.index]! + 1)
    }
  }
  return height
}

/** Kahn topological order; ties resolve to first-appearance order. */
function topologicalOrder(nodes: readonly LayoutNode[]): LayoutNode[] {
  const remaining = nodes.map(node => node.incoming.length)
  const queue: LayoutNode[] = nodes.filter(node => node.incoming.length === 0)
  const order: LayoutNode[] = []
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!
    order.push(node)
    for (const link of node.outgoing) {
      remaining[link.target.index]! -= 1
      if (remaining[link.target.index] === 0) queue.push(link.target)
    }
  }
  return order
}

/** One barycenter sweep: move each node toward the value-weighted mean center
 * of its neighbors on the given side, scaled by `alpha`. */
function relaxTowardNeighbors(layers: readonly LayoutNode[][], alpha: number, side: 'incoming' | 'outgoing'): void {
  const ordered = side === 'incoming' ? layers : [...layers].reverse()
  for (const layer of ordered) {
    for (const node of layer) {
      const neighbors = side === 'incoming' ? node.incoming : node.outgoing
      if (neighbors.length === 0) continue
      let weight = 0
      let sum = 0
      for (const link of neighbors) {
        const peer = side === 'incoming' ? link.source : link.target
        const w = Math.max(link.value, 1e-6)
        weight += w
        sum += (peer.y0 + peer.height / 2) * w
      }
      const desired = sum / weight - node.height / 2
      node.y0 += (desired - node.y0) * alpha
    }
  }
}

/** Re-sort each layer by current position and push overlapping nodes apart,
 * clamping into the flow extent. Stable: position ties keep layer order. */
function resolveCollisions(layers: readonly LayoutNode[][], flowHeight: number, nodePadding: number): void {
  for (const layer of layers) {
    const order = [...layer].sort((a, b) => a.y0 - b.y0 || a.index - b.index)
    // Forward sweep: enforce top bound and pairwise padding.
    let y = 0
    for (const node of order) {
      node.y0 = Math.max(node.y0, y)
      y = node.y0 + node.height + nodePadding
    }
    // Backward sweep: enforce bottom bound, pushing back up as needed.
    let bottom = flowHeight
    for (let i = order.length - 1; i >= 0; i--) {
      const node = order[i]!
      node.y0 = Math.min(node.y0, bottom - node.height)
      bottom = node.y0 - nodePadding
    }
    // Reorder the layer array itself so later stacking sees vertical order.
    layer.sort((a, b) => a.y0 - b.y0 || a.index - b.index)
  }
}
