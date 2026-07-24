import {
  sankey as createSankeyLayout,
  sankeyCenter,
  sankeyJustify,
  sankeyLeft,
  sankeyRight,
  type SankeyExtraProperties,
  type SankeyGraph,
  type SankeyLink,
  type SankeyNode,
} from 'd3-sankey'
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
// The geometric authority is d3-sankey 0.12.3, the same layout engine pinned
// by Mermaid 11.16. AM owns only the projection around it: deterministic IDs,
// measured label/canvas bounds, typed routes, and the 1px visibility floor
// Mermaid applies when it draws a zero/tiny link.
//
// All coordinates are direct pixel positions — the renderer never recomputes
// geometry. Legacy labels follow the upstream half-canvas convention;
// outlined labels follow Mermaid's central-layer convention so upstream nodes
// stay outside the main flow corridor. Values use Mermaid's two-decimal
// display rounding while exact numeric values remain on the typed scene marks.
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

/** Format a flow value with Mermaid's display-only two-decimal rounding. */
export function formatSankeyValue(value: number, visual: SankeyVisualConfig): string {
  return `${visual.prefix}${String(Math.round(value * 100) / 100)}${visual.suffix}`
}

/** Stable link id: endpoints plus an occurrence suffix for duplicate rows. */
export function sankeyLinkId(source: string, target: string, occurrence: number): string {
  const base = `link:${source}->${target}`
  return occurrence === 0 ? base : `${base}#${occurrence}`
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

interface D3NodeData extends SankeyExtraProperties {
  id: string
  authoredIndex: number
  /** d3-sankey sets this at runtime, but its published types omit it. */
  layer?: number
}

interface D3LinkData extends SankeyExtraProperties {
  authoredIndex: number
}

type D3Node = SankeyNode<D3NodeData, D3LinkData>
type D3Link = SankeyLink<D3NodeData, D3LinkData>

const ALIGNMENTS = {
  left: sankeyLeft,
  right: sankeyRight,
  center: sankeyCenter,
  justify: sankeyJustify,
} as const

function requiredCoordinate(value: number | undefined, name: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`d3-sankey did not assign ${name}`)
  }
  return value
}

/**
 * Lay out a parsed sankey diagram. Node order (palette identity) is
 * first-appearance order; d3-sankey decides deterministic layer placement,
 * vertical relaxation, collision resolution, and ribbon stacking.
 */
export function layoutSankeyDiagram(diagram: SankeyDiagram, options: RenderOptions = {}, visual: SankeyVisualConfig = DEFAULT_SANKEY_VISUAL_CONFIG, styleFace?: Readonly<InternalStyleFace>): PositionedSankeyChart {
  const style = resolveRenderStyle(options, SANKEY_STYLE_DEFAULTS, styleFace)

  // Mermaid feeds these exact parameters into d3-sankey. The extra 15px is
  // its allowance for the second value-label line.
  const layoutNodePadding = visual.nodePadding + (visual.showValues ? 15 : 0)
  const graph: SankeyGraph<D3NodeData, D3LinkData> = {
    nodes: diagram.nodes.map((id, authoredIndex) => ({ id, authoredIndex })),
    links: diagram.links.map((link, authoredIndex) => ({
      source: link.source,
      target: link.target,
      value: link.value,
      authoredIndex,
    })),
  }
  createSankeyLayout<D3NodeData, D3LinkData>()
    .nodeId(node => node.id)
    .nodeWidth(visual.nodeWidth)
    .nodePadding(layoutNodePadding)
    .nodeAlign(ALIGNMENTS[visual.nodeAlignment] as (node: D3Node, n: number) => number)
    .extent([[0, 0], [visual.width, visual.height]])(graph)

  const nodes = graph.nodes as D3Node[]
  const links = graph.links as D3Link[]
  // Mermaid renders every positive ribbon at least 1px wide. d3-sankey does
  // not account for that display floor, so a tiny ribbon can otherwise
  // over-stack its node face. Preserve d3's layers and ordering, then grow
  // only the affected node/layer projection enough to hold rendered widths.
  const linkWidths = new Map<D3Link, number>(
    links.map(link => [link, round(Math.max(link.value > 0 ? 1 : 0, link.width ?? 0))]),
  )
  const nodeHeights = new Map<D3Node, number>()
  for (const node of nodes) {
    const outgoing = (node.sourceLinks ?? []).reduce((sum, link) => sum + linkWidths.get(link as D3Link)!, 0)
    const incoming = (node.targetLinks ?? []).reduce((sum, link) => sum + linkWidths.get(link as D3Link)!, 0)
    const d3Height = requiredCoordinate(node.y1, `y1 for node ${node.id}`) - requiredCoordinate(node.y0, `y0 for node ${node.id}`)
    nodeHeights.set(node, Math.max(SANKEY.minNodeHeight, d3Height, outgoing, incoming))
  }

  const nodesByLayer = new Map<number, D3Node[]>()
  for (const node of nodes) {
    const layer = node.layer ?? node.depth ?? 0
    nodesByLayer.set(layer, [...(nodesByLayer.get(layer) ?? []), node])
  }
  const nodeY = new Map<D3Node, number>()
  let flowHeight = visual.height
  for (const layer of nodesByLayer.values()) {
    layer.sort((a, b) => requiredCoordinate(a.y0, `y0 for node ${a.id}`) - requiredCoordinate(b.y0, `y0 for node ${b.id}`) || a.authoredIndex - b.authoredIndex)
    let nextY = 0
    for (const node of layer) {
      const y = Math.max(requiredCoordinate(node.y0, `y0 for node ${node.id}`), nextY)
      nodeY.set(node, y)
      nextY = y + nodeHeights.get(node)! + layoutNodePadding
    }
    flowHeight = Math.max(flowHeight, nextY - layoutNodePadding)
  }

  const sourceY = new Map<D3Link, number>()
  const targetY = new Map<D3Link, number>()
  for (const node of nodes) {
    const nodeTop = nodeY.get(node)!
    const nodeHeight = nodeHeights.get(node)!
    const stack = (side: 'source' | 'target', output: Map<D3Link, number>): void => {
      const nodeLinks = ((side === 'source' ? node.sourceLinks : node.targetLinks) ?? []) as D3Link[]
      const coordinate = (link: D3Link) => requiredCoordinate(side === 'source' ? link.y0 : link.y1, `${side} y for link ${link.authoredIndex}`)
      nodeLinks.sort((a, b) => coordinate(a) - coordinate(b) || a.authoredIndex - b.authoredIndex)
      const total = nodeLinks.reduce((sum, link) => sum + linkWidths.get(link)!, 0)
      let cursor = nodeTop + (nodeHeight - total) / 2
      for (const link of nodeLinks) {
        const width = linkWidths.get(link)!
        output.set(link, cursor + width / 2)
        cursor += width
      }
    }
    stack('source', sourceY)
    stack('target', targetY)
  }

  const flowWidth = visual.width
  const flowLeft = SANKEY.padding
  const renderedTitle = diagram.title ? applyTextTransform(diagram.title, style.groupTextTransform) : undefined
  const titleFontSize = style.groupHeaderFontSize
  const titleHeight = renderedTitle ? titleFontSize + SANKEY.titleGap : 0
  const flowTop = SANKEY.padding + titleHeight

  // -- labels + canvas bounds ------------------------------------------------
  const labelFontSize = style.nodeLabelFontSize
  const flowCenterX = flowLeft + flowWidth / 2
  interface LabelPlan {
    lines: string[]
    anchor: 'start' | 'end'
    width: number
  }
  const centralNodeLayer = nodes.reduce(
    (central, node) => (node.value ?? 0) > (central.value ?? 0) ? node : central,
    nodes[0]!,
  ).layer ?? 0
  const labelPlans = new Map<D3Node, LabelPlan>()
  for (const node of nodes) {
    const name = applyTextTransform(node.id, style.nodeTextTransform)
    const value = node.value ?? 0
    const layer = node.layer ?? node.depth ?? 0
    const x0 = requiredCoordinate(node.x0, `x0 for node ${node.id}`)
    const lines = visual.showValues ? [name, formatSankeyValue(value, visual)] : [name]
    const anchor: 'start' | 'end' = visual.labelStyle === 'outlined'
      ? layer < centralNodeLayer ? 'end' : 'start'
      : flowLeft + x0 < flowCenterX ? 'start' : 'end'
    const width = Math.max(...lines.map(line => measureSystemFontSafeTextWidth(line, labelFontSize, style.nodeLabelFontWeight)))
    labelPlans.set(node, { lines, anchor, width })
  }
  let minX: number = flowLeft
  let maxX = flowLeft + flowWidth
  for (const node of nodes) {
    const plan = labelPlans.get(node)!
    const x0 = flowLeft + requiredCoordinate(node.x0, `x0 for node ${node.id}`)
    const x1 = flowLeft + requiredCoordinate(node.x1, `x1 for node ${node.id}`)
    if (plan.anchor === 'start') {
      maxX = Math.max(maxX, x1 + SANKEY.labelGap + plan.width)
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
    const x0 = flowLeft + requiredCoordinate(node.x0, `x0 for node ${node.id}`) + shiftX
    const x1 = flowLeft + requiredCoordinate(node.x1, `x1 for node ${node.id}`) + shiftX
    const y0 = flowTop + nodeY.get(node)!
    const y1 = y0 + nodeHeights.get(node)!
    return {
      label: node.id,
      value: node.value ?? 0,
      layer: node.layer ?? node.depth ?? 0,
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
    const source = link.source as D3Node
    const target = link.target as D3Node
    const key = `${source.id}->${target.id}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const sx = round(flowLeft + requiredCoordinate(source.x1, `x1 for node ${source.id}`) + shiftX)
    const tx = round(flowLeft + requiredCoordinate(target.x0, `x0 for node ${target.id}`) + shiftX)
    const sy = round(flowTop + sourceY.get(link)!)
    const ty = round(flowTop + targetY.get(link)!)
    const geometry = linkCenterline(sx, sy, tx, ty)
    return {
      id: sankeyLinkId(source.id, target.id, occurrence),
      source: source.id,
      target: target.id,
      value: link.value,
      path: geometry.path,
      points: geometry.points,
      width: linkWidths.get(link)!,
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
