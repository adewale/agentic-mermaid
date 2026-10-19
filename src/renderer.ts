import { resolveLabelContent } from './shared/display-text.ts'
import { graphTextBlock } from './graph-text.ts'
import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, RenderContext } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { STROKE_WIDTHS } from './styles.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgGroupEmission, type SvgPrimitiveEmission } from './scene/svg-emission.ts'
import { topRoundedRectPath } from './svg-paths.ts'
import { resolveInlineNodeTextColor, toneOnFill } from './color-resolver.ts'
import type { SceneDoc, SceneNode, SemanticChannels } from './scene/ir.ts'
import * as marks from './scene/marks.ts'
import { pathArtwork } from './scene/artwork.ts'
import { iconFallbackToken } from './shared/icon-fallback.ts'
import { DefaultBackend } from './scene/backend.ts'
import { resolveMindmapIcon } from './mindmap/icons.ts'
import {
  graphSceneShell, graphEdgeFields, createGraphEdgeEmitter, renderGraphSceneNote,
  connectorLabelSceneId, edgeMidpoint, primitive,
  PAINT_ATTRIBUTES, RECT_EMISSION, LABEL_ATTRIBUTES, LABEL_EMISSION,
} from './graph-scene-shared.ts'
export { graphSceneShell, graphEdgeFields, renderGraphEdgeFields, renderGraphSceneNote } from './graph-scene-shared.ts'

export { compactSvg, namespaceSvgIds } from './svg-postprocess.ts'
import { paintsNodeFill, shapeOutline } from './shape-outline.ts'
import { LABEL_PILL_PADDING } from './shared/edge-label-geometry.ts'
import { calculatePathMidpoint } from './layout/geometry.ts'

const HEADER_EMISSION = primitive(['d'])
const SEPARATOR_EMISSION = primitive(['x1', 'y1', 'x2', 'y2'], [{ name: 'class', value: v.meta('region-separator') }], [
  ...PAINT_ATTRIBUTES.slice(1), { name: 'stroke-dasharray', value: v.paint('strokeDasharray') },
])
const HALO_EMISSION = primitive(['x', 'y', 'width', 'height', 'rx', 'ry'], [{ name: 'class', value: v.meta('edge-label-halo') }], PAINT_ATTRIBUTES.slice(0, 2))
const NODE_GROUP_ATTRIBUTES: readonly SvgAttribute[] = [
  { name: 'class', value: v.identity('classNames') }, { name: 'data-id', value: v.identity('id') },
  { name: 'data-label', value: { source: 'groupMetadata', field: 'label' }, display: true },
  { name: 'data-shape', value: { source: 'groupMetadata', field: 'shape' } },
  { name: 'data-semantic-shape', value: { source: 'groupMetadata', field: 'semanticShape' } },
]
const NODE_GROUP_EMISSIONS = Object.freeze([false, true].map(link => snapshotSvgEmissionRecipe({
  kind: 'group', attributes: [
    ...NODE_GROUP_ATTRIBUTES,
    ...(link ? [
      { name: 'data-href' as const, value: { source: 'groupMetadata' as const, field: 'href' as const } },
      { name: 'role' as const, value: v.meta('link') }, { name: 'tabindex' as const, value: v.meta(0) },
    ] : []),
  ],
}) as SvgGroupEmission))
const IMAGE_FRAME_EMISSION = primitive(['x', 'y', 'width', 'height', 'rx'], [], [], '/>')
const IMAGE_SUN_EMISSION = primitive(['cx', 'cy', 'r'], [], [], '/>')
const IMAGE_PATH_EMISSION = primitive(['d'], [], [], '/>') as SvgPrimitiveEmission

// ============================================================================
// SVG renderer — converts a PositionedGraph into an SVG string.
//
// The graph is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id). renderSvg() uses DefaultBackend serialization of that
// scene; styled backends redraw the same
// scene without re-parsing SVG.
//
// Renders back-to-front: groups → edges → arrow heads → edge labels → nodes.
//
// All colors are referenced via CSS custom properties (var(--_xxx)) defined
// in the <style> block. The caller provides bg/fg (+ optional enrichment
// colors) via DiagramColors, which are set as inline CSS variables on the
// <svg> tag. See src/theme.ts for the full variable system.
//
// Style spec:
// - All corners rx=0 ry=0 (sharp)
// - Stroke widths: outer box 1px, inner box 0.75px, connectors 0.75px
// - Arrow heads: filled triangles, 8px wide × 4.8px tall
// - Dashed edges: stroke-dasharray="4 4"
// - Font: Inter with weight per element type
// ============================================================================

/**
 * Render a positioned graph as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 *                 These are set as CSS custom properties on the <svg> tag.
 *                 All element colors reference derived --_xxx variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderSvg(
  ctx: RenderContext<PositionedGraph>,
): string {
  return DefaultBackend.render(lowerGraphScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned graph to the SceneGraph IR in canonical mark order.
 */
export function lowerGraphScene(
  ctx: RenderContext<PositionedGraph>,
): SceneDoc {
  const { positioned: graph, colors, resolved } = ctx
  const options = resolved.renderOptions
  const { opening, font, transparent, style, markerResources } = graphSceneShell(ctx)
  const parts = opening

  // 1. Subgraph backgrounds (group rectangles with header bands)
  for (const group of graph.groups) {
    parts.push(renderGroup(group, font, style))
  }

  // 2. Edges (polylines — rendered behind nodes)
  const edgeOccurrence = new Map<string, number>()
  const edgeSceneIds = new Map<PositionedEdge, string>()
  const emitEdge = createGraphEdgeEmitter()
  for (const edge of graph.edges) {
    if (edge.points.length < 2) continue
    const pairKey = `${edge.source}->${edge.target}`
    const k = edgeOccurrence.get(pairKey) ?? 0
    edgeOccurrence.set(pairKey, k + 1)
    const sceneId = `edge:${pairKey}#${k}`
    edgeSceneIds.set(edge, sceneId)
    parts.push(emitEdge(edge, graphEdgeFields(edge, style, sceneId, markerResources)))
  }

  // 3. Edge labels (positioned at midpoint of edge)
  for (const edge of graph.edges) {
    const connectorSceneId = edgeSceneIds.get(edge)
    if (edge.label && connectorSceneId) parts.push(renderEdgeLabel(edge, font, style, connectorLabelSceneId(connectorSceneId)))
  }

  // 4. Nodes (shape + label wrapped in <g class="node">)
  for (const node of graph.nodes) {
    parts.push(renderNode(node, font, style, colors, options.security !== 'strict'))
  }

  // 5. State-diagram notes (placed by the layout pass on their declared side)
  for (const note of graph.notes ?? []) parts.push(renderGraphSceneNote(note, font, style))
  parts.push(marks.documentClose())
  return { family: 'flowchart', width: graph.width, height: graph.height, colors, transparent, parts }
}


// ============================================================================
// Group rendering (subgraph backgrounds)
// ============================================================================

function renderGroup(group: PositionedGroup, font: string, style: ResolvedRenderStyle, parentId?: string): SceneNode {
  // Concurrency regions (plan §State 2c) draw no box/header of their own —
  // the parent composite draws dashed separators between them instead. Nested
  // composites inside a region still render normally.
  if (group.concurrencyRegion) {
    return marks.group({
      id: `group:${group.id}`,
      role: 'group',
      emission: { kind: 'group', attributes: [
        { name: 'class', value: v.meta('concurrency-region') }, { name: 'data-id', value: v.meta(group.id) },
        ...(parentId ? [{ name: 'data-parent-id' as const, value: v.meta(parentId) }] : []),
      ] },
      children: group.children.map(child => ({ indent: 0, node: renderGroup(child, font, style, group.id) })),
    })
  }

  const headerBlock = group.labelBlock ?? graphTextBlock(resolveLabelContent(group.label, group.labelContent), style, 'group')
  const headerHeight = group.headerHeight ?? style.groupHeaderFontSize + 16 + headerBlock.height - headerBlock.lineHeight
  const children: Array<{ node: SceneNode; indent: number }> = []

  // Opening <g> with semantic attributes for subgraph identification
  // data-id: original Mermaid subgraph ID
  // data-label: display label (may differ from ID)
  const emission: SvgGroupEmission = { kind: 'group', attributes: [
    { name: 'class', value: v.meta('subgraph') }, { name: 'data-id', value: v.meta(group.id) },
    { name: 'data-region', value: v.meta('subgraph') }, { name: 'data-label', value: v.meta(group.label), display: true },
    ...(parentId ? [{ name: 'data-parent-id' as const, value: v.meta(parentId) }] : []),
  ] }

  // Outer rectangle. A State composite's class paint fills its body and
  // outlines it, as Mermaid's classDef rules paint the cluster's body rect.
  const paint = group.inlineStyle
  const rectFill = paint?.fill ?? style.groupFillColor ?? 'var(--_group-fill)'
  const rectStroke = paint?.stroke ?? style.groupBorderColor ?? 'var(--_node-stroke)'
  const rectStrokeWidth = paint?.['stroke-width'] ?? String(style.groupLineWidth)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-rect:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
      paint: { fill: rectFill, stroke: rectStroke, strokeWidth: rectStrokeWidth },
    }, RECT_EMISSION),
  })

  // Header band
  const headerFill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const headerPath = topRoundedRectPath(group.x, group.y, group.width, headerHeight, style.groupCornerRadius)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-header:${group.id}`,
      role: 'group-header',
      geometry: { kind: 'path', d: headerPath },
      paint: { fill: headerFill, stroke: rectStroke, strokeWidth: rectStrokeWidth },
    }, HEADER_EMISSION),
  })

  // Header label (supports multi-line via <br> tags)
  const headerText = headerBlock.text
  const headerTextColor = paint?.color ?? style.groupTextColor ?? 'var(--_text-sec)'
  children.push({
    indent: 2,
    node: marks.text({
      id: `group-label:${group.id}`,
      role: 'group-header',
      text: headerText, block: headerBlock,
      x: group.x + style.groupLabelPaddingX,
      y: group.y + headerHeight / 2,
      fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing,
      anchor: 'start',
      paint: { fill: headerTextColor },
    }, { kind: 'text', layout: 'multiline', attributes: [
      { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') },
      ...(style.groupFont ? [{ name: 'font-family' as const, value: v.meta(style.groupFont) }] : []),
      { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' }, { name: 'fill', value: v.paint('fill') },
    ] }),
  })

  // Dashed separators between concurrency regions (`--`): one line in each
  // gap between adjacent region boxes, spanning the composite's inner extent.
  for (const sep of regionSeparators(group, headerHeight)) {
    children.push({
      indent: 2,
      node: marks.shape({
        id: `region-separator:${group.id}:${sep.index}`,
        role: 'group',
        geometry: { kind: 'line', x1: sep.x1, y1: sep.y1, x2: sep.x2, y2: sep.y2 },
        paint: { stroke: rectStroke, strokeWidth: String(style.groupLineWidth), strokeDasharray: '6 4' },
        attributes: { className: 'region-separator' },
      }, SEPARATOR_EMISSION),
    })
  }

  // Render nested groups recursively (inside this group)
  for (const child of group.children) {
    children.push({ indent: 0, node: renderGroup(child, font, style, group.id) })
  }

  return marks.group({
    id: `group:${group.id}`,
    role: 'group',
    emission,
    children,
  })
}

interface RegionSeparator { index: number; x1: number; y1: number; x2: number; y2: number }

/** Separator lines between adjacent concurrency regions of a composite. The
 *  arrangement axis is derived from the region boxes themselves (side-by-side
 *  regions get vertical separators; stacked regions horizontal ones), so the
 *  invariant "the separator sits between the region boxes" holds whatever the
 *  compound packing chose. */
function regionSeparators(group: PositionedGroup, headerHeight: number): RegionSeparator[] {
  const regions = group.children.filter(c => c.concurrencyRegion)
  if (regions.length < 2) return []
  const spread = (lo: (g: PositionedGroup) => number): number =>
    Math.max(...regions.map(lo)) - Math.min(...regions.map(lo))
  const sideBySide = spread(g => g.x + g.width / 2) >= spread(g => g.y + g.height / 2)
  const sorted = [...regions].sort((a, b) => sideBySide ? a.x - b.x : a.y - b.y)
  const inset = 4
  const out: RegionSeparator[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!, next = sorted[i]!
    if (sideBySide) {
      const x = (prev.x + prev.width + next.x) / 2
      out.push({ index: i - 1, x1: x, y1: group.y + headerHeight + inset, x2: x, y2: group.y + group.height - inset })
    } else {
      const y = (prev.y + prev.height + next.y) / 2
      out.push({ index: i - 1, x1: group.x + inset, y1: y, x2: group.x + group.width - inset, y2: y })
    }
  }
  return out
}

// ============================================================================
// Edge labels
// ============================================================================

function renderEdgeLabel(edge: PositionedEdge, font: string, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  // Use layout-computed label position when available (layout-aware, avoids collisions).
  // Fall back to geometric midpoint of the edge polyline.
  const mid = edge.labelPosition ?? calculatePathMidpoint(edge.points)
  const block = edge.labelBlock ?? graphTextBlock(resolveLabelContent(edge.label!, edge.labelContent), style, 'edge')
  const label = block.text
  const padding = LABEL_PILL_PADDING
  const strokeWidth = edge.style === 'thick' ? style.lineWidth * 2 : style.lineWidth
  const haloPadding = padding + Math.max(4, strokeWidth * 2)

  // Measure text (works for both single and multi-line)
  const metrics = block
  const haloWidth = metrics.width + haloPadding * 2
  const haloHeight = metrics.height + haloPadding * 2
  const haloX = mid.x - haloWidth / 2
  const haloY = mid.y - haloHeight / 2
  const halo = marks.shape({
    id: `${sceneId}:halo`,
    role: 'chrome',
    geometry: { kind: 'rect', x: haloX, y: haloY, width: haloWidth, height: haloHeight, rx: 4, ry: 4 },
    paint: { fill: 'var(--bg)', stroke: 'none' },
    attributes: { className: 'edge-label-halo' },
  }, HALO_EMISSION)

  // Wrap in <g class="edge-label"> with reference to the edge it belongs to
  // The label's pill: the text's own band plus padding.
  const pillWidth = metrics.width + padding * 2
  const pillHeight = metrics.height + padding * 2
  const pill = marks.shape({
    id: `${sceneId}:pill`,
    role: 'chrome',
    geometry: { kind: 'rect', x: mid.x - pillWidth / 2, y: mid.y - pillHeight / 2, width: pillWidth, height: pillHeight, rx: 2, ry: 2 },
    paint: { fill: 'var(--bg)', stroke: 'var(--_inner-stroke)', strokeWidth: '1' },
  }, RECT_EMISSION)
  const labelTextColor = style.edgeTextColor ?? 'var(--_text-sec)'
  const content = marks.text({
    id: `${sceneId}:text`,
    role: 'label',
    text: label, block,
    x: mid.x,
    y: mid.y,
    fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing,
    anchor: 'middle',
    paint: { fill: labelTextColor },
  }, { kind: 'text', layout: 'multiline', attributes: LABEL_ATTRIBUTES,
  })

  // Semantic wrapper: links label to its edge via data-from/data-to
  return marks.group({
    id: sceneId,
    role: 'edge-label',
    emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta('edge-label') }, { name: 'data-from', value: v.meta(edge.source) },
      { name: 'data-to', value: v.meta(edge.target) }, { name: 'data-label', value: v.meta(edge.label!), display: true },
    ] },
    children: [
      { indent: 2, node: halo },
      { indent: 2, node: pill },
      { indent: 2, node: content },
    ],
  })
}

/** Get the midpoint of a polyline (by walking segments) */


// ============================================================================
// Node rendering
// ============================================================================

/**
 * Render a complete node: shape + label wrapped in a semantic <g> element.
 *
 * The group includes data attributes for:
 * - data-id: original Mermaid node ID (for edge matching)
 * - data-label: display label text
 * - data-shape: shape type (rectangle, diamond, circle, etc.)
 */
function renderNode(node: PositionedNode, font: string, style: ResolvedRenderStyle, colors: DiagramColors, includeInteraction: boolean): SceneNode {
  const shape = renderNodeShape(node, style)
  const ink = nodeTextInk(node, style, colors)
  const label = renderNodeLabel(node, font, style, ink)

  // Combine shape and label inside a semantic group
  // This enables reliable node identification without heuristics
  // #81: append user-assigned Mermaid class names so external stylesheets can
  // target semantic node classes (e.g. `.hot { ... }`). Sanitize to valid CSS
  // identifier chars; structural `node` class always comes first.
  const userClasses = (node.classNames ?? [])
    .map(c => c.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
  const channels: SemanticChannels | undefined =
    node.shape === 'state-start' ? { status: 'start' } :
    node.shape === 'state-end' ? { status: 'end' } :
    undefined

  const children: Array<{ node: SceneNode; indent: number }> = [{ indent: 2, node: shape }]
  const media = renderFlowchartMedia(node, ink)
  if (media) children.push({ indent: 2, node: media })
  if (label) {
    children.push({ indent: 2, node: label })
  }
  // data-semantic-shape names the Mermaid v11 `@{ shape }` id when the drawn
  // geometry is a mapping of it, so agents can explain the semantic shape
  // even when the geometry is approximate (repo #44).

  return marks.group({
    id: `node:${node.id}`,
    role: 'node',
    identity: { id: node.id, classNames: ['node', ...userClasses] },
    emission: NODE_GROUP_EMISSIONS[includeInteraction && node.href ? 1 : 0]!,
    emissionMetadata: { label: node.label, shape: node.shape,
      ...(node.semanticShape ? { semanticShape: node.semanticShape } : {}),
      ...(includeInteraction && node.href ? { href: node.href } : {}),
    },
    children,
    channels,
  })
}

function renderFlowchartMedia(node: PositionedNode, ink: string): SceneNode | null {
  const size = Math.min(28, node.height * 0.4)
  const cx = node.x + node.width / 2
  const y = node.y + 6
  if (node.icon) {
    const glyph = resolveMindmapIcon(node.icon)
    if (glyph) {
      const scale = size / 24
      return pathArtwork({ id: `node:${node.id}:icon`, paths: glyph.paths,
        owner: { id: node.id, role: 'node' },
        emission: { kind: 'group', attributes: [
          { name: 'class', value: v.meta('flowchart-icon') }, { name: 'data-icon', value: v.meta(node.icon) },
          { name: 'transform', value: { source: 'transform', form: 'translate-scale-space' } },
          { name: 'fill', value: v.meta(ink) }, { name: 'stroke', value: v.meta(ink) }, { name: 'stroke-width', value: v.meta('0.8') },
        ] },
        transform: { kind: 'matrix', a: scale, b: 0, c: 0, d: scale, e: cx - size / 2, f: y },
        paint: { fill: ink, stroke: ink, strokeWidth: '0.8' },
      })
    }
    const token = iconFallbackToken(node.icon)
    return marks.text({ id: `node:${node.id}:icon`, role: 'icon', owner: { id: node.id, role: 'node' }, text: token,
      block: node.iconFallbackBlock,
      x: cx, y: y + size / 2, fontSize: 10, anchor: 'middle', paint: { fill: ink } }, { kind: 'text', layout: 'direct', attributes: [
        { name: 'class', value: v.meta('flowchart-icon-fallback') }, { name: 'data-icon', value: v.meta(node.icon) },
        { name: 'x', value: v.text('x') }, { name: 'y', value: v.text('y') },
        { name: 'text-anchor', value: v.text('anchor') }, { name: 'font-size', value: v.text('fontSize') }, { name: 'fill', value: v.paint('fill') },
      ] })
  }
  if (node.image) {
    const left = cx - size / 2
    const d = `M${left + 2} ${y + size * 0.66}L${left + size * 0.36} ${y + size * 0.36}L${left + size * 0.52} ${y + size * 0.5}L${left + size * 0.7} ${y + size * 0.32}L${left + size - 2} ${y + size * 0.66}`
    const paint = { fill: 'none', stroke: ink, strokeWidth: '1.2' }
    const owner = { id: node.id, role: 'node' as const }
    return marks.group({ id: `node:${node.id}:image`, role: 'icon', owner,
      emission: { kind: 'group', attributes: [
        { name: 'class', value: v.meta('flowchart-image-placeholder') }, { name: 'data-image-src', value: v.meta(node.image) },
        { name: 'fill', value: v.meta('none') }, { name: 'stroke', value: v.meta(ink) }, { name: 'stroke-width', value: v.meta('1.2') },
      ] }, join: '',
      children: [
        { indent: 0, node: marks.shape({ id: `node:${node.id}:image:frame`, role: 'icon', owner, geometry: { kind: 'rect', x: left, y, width: size, height: size * 0.72, rx: 2 }, paint }, IMAGE_FRAME_EMISSION) },
        { indent: 0, node: marks.shape({ id: `node:${node.id}:image:sun`, role: 'icon', owner, geometry: { kind: 'circle', cx: left + size * 0.72, cy: y + size * 0.2, r: size * 0.08 }, paint }, IMAGE_SUN_EMISSION) },
        { indent: 0, node: marks.shape({ id: `node:${node.id}:image:landscape`, role: 'icon', owner, geometry: { kind: 'path', d }, paint }, IMAGE_PATH_EMISSION) },
      ],
    })
  }
  return null
}

function renderNodeShape(node: PositionedNode, style: ResolvedRenderStyle): SceneNode {
  const { shape, inlineStyle } = node

  // Resolve fill and stroke — inline styles (from mermaid `style` directives)
  // override the CSS variable defaults. When no inline style is present, the
  // CSS variable handles theming automatically via color-mix() derivation.
  const fill = inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)'
  const stroke = inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
  const strokeWidth = inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth)
  const piece = shapeOutline(node, { fill, stroke, strokeWidth }, style.cornerRadius)

  return marks.shape({
    id: `node-shape:${node.id}`,
    role: 'node',
    geometry: piece.geometry,
    paint: piece.paint,
    ...(piece.childPaints ? { childPaints: piece.childPaints } : {}),
  }, piece.emission)
}

// ============================================================================
// Node label rendering
// ============================================================================

/** The ink for a node's label and media: the author's color, black or white
 * on the author's fill, the Style's text color, or else the theme tone inked
 * for the node fill it sits on (a shape that paints no fill leaves its label
 * on the page). */
function nodeTextInk(node: PositionedNode, style: ResolvedRenderStyle, colors: DiagramColors): string {
  const onNode = style.nodeTextColor ?? (node.inlineStyle?.fill || !paintsNodeFill(node)
    ? 'var(--_text)'
    : toneOnFill('var(--_text)', style.nodeFillColor ?? 'var(--_node-fill)', colors))
  return resolveInlineNodeTextColor(node.inlineStyle, onNode)
}

function renderNodeLabel(node: PositionedNode, font: string, style: ResolvedRenderStyle, rawTextColor: string): SceneNode | null {
  // State pseudostates have no label (history keeps its H/H* glyph)
  if (node.shape === 'state-start' || node.shape === 'state-end' ||
      node.shape === 'state-fork' || node.shape === 'state-join' || node.shape === 'state-choice') {
    if (!node.label) return null
  }

  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2

  const block = node.labelBlock ?? graphTextBlock(resolveLabelContent(node.label, node.labelContent), style, 'node')
  const label = block.text

  return marks.text({
    id: `node-label:${node.id}`,
    role: 'label',
    text: label, block,
    x: cx,
    y: cy,
    fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing,
    anchor: 'middle',
    paint: { fill: rawTextColor },
  }, LABEL_EMISSION)
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape a string for use as an XML/HTML attribute value.
 * Escapes quotes and ampersands to prevent attribute injection.
 */
