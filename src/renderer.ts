import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, PositionedStateNote, Point, EdgeMarker, RenderContext } from './types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from './theme.ts'
import { STROKE_WIDTHS, ARROW_HEAD, FLOWCHART_DOTTED_DASH, applyTextTransform, resolveRenderStyle } from './styles.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import { measureMultilineText } from './text-metrics.ts'
import { renderMultilineText, renderMultilineTextWithBackground, escapeAttr, escapeXml } from './multiline-utils.ts'
import { topRoundedRectPath } from './svg-paths.ts'
import { resolveInlineNodeTextColor } from './color-resolver.ts'
import type { Geometry, MarkerRef, SceneDoc, SceneNode, SemanticChannels } from './scene/ir.ts'
import * as marks from './scene/marks.ts'
import { DefaultBackend } from './scene/backend.ts'
import type { StateRenderOptions } from './state/config.ts'
import { resolveMindmapIcon } from './mindmap/icons.ts'

// ============================================================================
// SVG renderer — converts a PositionedGraph into an SVG string.
//
// The graph is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) plus its exact crisp serialization, built here from
// the same inputs. renderSvg() is DefaultBackend serialization of that scene,
// so the default path stays byte-identical to the historical string renderer
// (corpus-gated by svg-equivalence.test.ts); styled backends redraw the same
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

/** A shape emission: semantic geometry + the exact crisp serialization. */
interface ShapePiece {
  geometry: Geometry
  crisp: string
}

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
 * Lower a positioned graph to the SceneGraph IR. Mark order matches the
 * historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerGraphScene(
  ctx: RenderContext<PositionedGraph>,
): SceneDoc {
  const { positioned: graph, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: SceneNode[] = []
  const stateVisual = (options as StateRenderOptions).stateVisual
  const style = resolveRenderStyle(options, stateVisual?.styleDefaults)

  // SVG root with CSS variables + style block + defs
  parts.push(marks.prelude(
    {
      id: 'prelude',
      width: graph.width,
      height: graph.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
    },
    svgOpenTag(graph.width, graph.height, colors, transparent) + '\n' +
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport),
  ))
  const defsParts: string[] = []
  defsParts.push('<defs>')
  defsParts.push(arrowMarkerDefs())
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) defsParts.push(shadowDefs)
  // Per-color arrow markers for edges with custom stroke via linkStyle
  const customStrokeColors = new Set<string>()
  if (style.edgeStrokeColor) customStrokeColors.add(style.edgeStrokeColor)
  let needsCircle = false
  let needsCross = false
  for (const edge of graph.edges) {
    if (edge.inlineStyle?.stroke) customStrokeColors.add(edge.inlineStyle.stroke)
    if (edge.startMarker === 'circle' || edge.endMarker === 'circle') needsCircle = true
    if (edge.startMarker === 'cross' || edge.endMarker === 'cross') needsCross = true
  }
  if (needsCircle) defsParts.push(circleMarkerDefs())
  if (needsCross) defsParts.push(crossMarkerDefs())
  for (const color of customStrokeColors) {
    defsParts.push(arrowMarkerDefsForColor(color))
    if (needsCircle) defsParts.push(circleMarkerDefs(color))
    if (needsCross) defsParts.push(crossMarkerDefs(color))
  }
  defsParts.push('</defs>')
  parts.push(marks.raw({ id: 'defs', role: 'defs' }, defsParts.join('\n')))

  // 1. Subgraph backgrounds (group rectangles with header bands)
  for (const group of graph.groups) {
    parts.push(renderGroup(group, font, style))
  }

  // 2. Edges (polylines — rendered behind nodes)
  // Each edge is a <polyline> with semantic data-* attributes
  const edgeOccurrence = new Map<string, number>()
  for (const edge of graph.edges) {
    const pairKey = `${edge.source}->${edge.target}`
    const k = edgeOccurrence.get(pairKey) ?? 0
    edgeOccurrence.set(pairKey, k + 1)
    parts.push(renderEdge(edge, style, `edge:${pairKey}#${k}`))
  }

  // 3. Edge labels (positioned at midpoint of edge)
  // Each label is wrapped in <g class="edge-label">
  const labelOccurrence = new Map<string, number>()
  for (const edge of graph.edges) {
    if (edge.label) {
      const pairKey = `${edge.source}->${edge.target}`
      const k = labelOccurrence.get(pairKey) ?? 0
      labelOccurrence.set(pairKey, k + 1)
      parts.push(renderEdgeLabel(edge, font, style, `edge-label:${pairKey}#${k}`))
    }
  }

  // 4. Nodes (shape + label wrapped in <g class="node">)
  for (const node of graph.nodes) {
    parts.push(renderNode(node, font, style))
  }

  // 5. State-diagram notes (placed by the layout pass on their declared side)
  for (const note of graph.notes ?? []) {
    parts.push(renderStateNote(note, font, style))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'flowchart', width: graph.width, height: graph.height, colors, parts }
}

// ============================================================================
// Arrow marker definitions
// ============================================================================

/**
 * Reusable arrow head markers — both forward (end) and pre-rotated start variants.
 * Start geometry points left in marker space and uses orient="auto". This avoids
 * renderer-dependent auto-start-reverse behavior in SVG rasterizers.
 * Arrow color uses var(--_arrow) CSS variable.
 */
function arrowMarkerDefs(): string {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  // Arrow polygons have both fill and a thin stroke for better definition at small sizes
  const arrowStyle = 'fill="var(--_arrow)" stroke="var(--_arrow)" stroke-width="0.75" stroke-linejoin="round"'
  // Pull arrowhead back slightly (refX = w - 1) to prevent clipping at node boundaries
  const refX = w - 1
  return (
    // Forward arrow (marker-end) — orient="auto" ensures arrow points along line direction
    `  <marker id="arrowhead" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
    `\n  </marker>` +
    // Start arrow is explicitly pre-rotated: its tip is at x=0 and its body
    // extends into the route, while refX=1 keeps the tip at the node boundary.
    `\n  <marker id="arrowhead-start" markerWidth="${w}" markerHeight="${h}" refX="1" refY="${h / 2}" orient="auto">` +
    `\n    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" ${arrowStyle} />` +
    `\n  </marker>`
  )
}

/**
 * Generate arrow markers tinted to a specific color (for linkStyle stroke overrides).
 * IDs are suffixed with a sanitized color string to avoid collisions.
 */
function arrowMarkerDefsForColor(color: string): string {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  const escaped = escapeAttr(color)
  const arrowStyle = `fill="${escaped}" stroke="${escaped}" stroke-width="0.75" stroke-linejoin="round"`
  const refX = w - 1
  const suffix = markerSuffix(color)
  return (
    `  <marker id="arrowhead-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
    `\n  </marker>` +
    `\n  <marker id="arrowhead-start-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="1" refY="${h / 2}" orient="auto">` +
    `\n    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" ${arrowStyle} />` +
    `\n  </marker>`
  )
}

function circleMarkerDefs(color?: string): string {
  const size = ARROW_HEAD.width
  const suffix = color ? `-${markerSuffix(color)}` : ''
  const stroke = color ? escapeAttr(color) : 'var(--_arrow)'
  const r = size / 2 - 0.75
  return (
    `  <marker id="circlehead${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${size - 0.5}" refY="${size / 2}" orient="auto">` +
    `\n    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1" />` +
    `\n  </marker>` +
    `\n  <marker id="circlehead-start${suffix}" markerWidth="${size}" markerHeight="${size}" refX="0.5" refY="${size / 2}" orient="auto">` +
    `\n    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1" />` +
    `\n  </marker>`
  )
}

function crossMarkerDefs(color?: string): string {
  const size = ARROW_HEAD.width
  const suffix = color ? `-${markerSuffix(color)}` : ''
  const stroke = color ? escapeAttr(color) : 'var(--_arrow)'
  const pad = 1.25
  const a = pad
  const b = size - pad
  const style = `stroke="${stroke}" stroke-width="1.25" stroke-linecap="round"`
  return (
    `  <marker id="crosshead${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${b}" refY="${size / 2}" orient="auto">` +
    `\n    <line x1="${a}" y1="${a}" x2="${b}" y2="${b}" ${style} />` +
    `\n    <line x1="${a}" y1="${b}" x2="${b}" y2="${a}" ${style} />` +
    `\n  </marker>` +
    `\n  <marker id="crosshead-start${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${pad}" refY="${size / 2}" orient="auto">` +
    `\n    <line x1="${a}" y1="${a}" x2="${b}" y2="${b}" ${style} />` +
    `\n    <line x1="${a}" y1="${b}" x2="${b}" y2="${a}" ${style} />` +
    `\n  </marker>`
  )
}

function markerIdPrefix(marker: EdgeMarker): string {
  if (marker === 'circle') return 'circlehead'
  if (marker === 'cross') return 'crosshead'
  return 'arrowhead'
}

function markerShape(marker: EdgeMarker): MarkerRef['shape'] {
  if (marker === 'circle') return 'circle'
  if (marker === 'cross') return 'cross'
  return 'arrow'
}

/** Sanitize a color value into a collision-free SVG ID suffix.
 *  Non-alphanumeric chars are hex-encoded so distinct inputs never collapse
 *  (e.g. "var(--line-1)" → "var28--line2d129", "var(--line1)" → "var28--line129"). */
function markerSuffix(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, (ch) => ch.charCodeAt(0).toString(16))
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
      open: `<g class="concurrency-region" data-id="${escapeAttr(group.id)}"${parentId ? ` data-parent-id="${escapeAttr(parentId)}"` : ''}>`,
      close: '</g>',
      children: group.children.map(child => ({ indent: 0, node: renderGroup(child, font, style, group.id) })),
    })
  }

  const headerHeight = style.groupHeaderFontSize + 16
  const children: Array<{ node: SceneNode; indent: number }> = []

  // Opening <g> with semantic attributes for subgraph identification
  // data-id: original Mermaid subgraph ID
  // data-label: display label (may differ from ID)
  const open =
    `<g class="subgraph" data-id="${escapeAttr(group.id)}" data-region="subgraph" data-label="${escapeAttr(group.label)}"${parentId ? ` data-parent-id="${escapeAttr(parentId)}"` : ''}>`

  // Outer rectangle
  const rectFill = style.groupFillColor ?? 'var(--_group-fill)'
  const rectStroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-rect:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
      paint: { fill: rectFill, stroke: rectStroke, strokeWidth: String(style.groupLineWidth) },
    },
      `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" ` +
      `rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" fill="${escapeAttr(rectFill)}" stroke="${escapeAttr(rectStroke)}" stroke-width="${style.groupLineWidth}" />`),
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
      paint: { fill: headerFill, stroke: rectStroke, strokeWidth: String(style.groupLineWidth) },
    },
      `<path d="${headerPath}" ` +
      `fill="${escapeAttr(headerFill)}" stroke="${escapeAttr(rectStroke)}" stroke-width="${style.groupLineWidth}" />`),
  })

  // Header label (supports multi-line via <br> tags)
  const headerText = applyTextTransform(group.label, style.groupTextTransform)
  const headerTextColor = style.groupTextColor ?? 'var(--_text-sec)'
  children.push({
    indent: 2,
    node: marks.text({
      id: `group-label:${group.id}`,
      role: 'group-header',
      text: headerText,
      x: group.x + style.groupLabelPaddingX,
      y: group.y + headerHeight / 2,
      fontSize: style.groupHeaderFontSize,
      anchor: 'start',
      paint: { fill: headerTextColor },
    }, renderMultilineText(
      headerText,
      group.x + style.groupLabelPaddingX,
      group.y + headerHeight / 2,
      style.groupHeaderFontSize,
      `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${style.groupLetterSpacing !== 0 ? ` letter-spacing="${style.groupLetterSpacing}"` : ''} fill="${escapeAttr(headerTextColor)}"`
    )),
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
      },
        `<line class="region-separator" x1="${sep.x1}" y1="${sep.y1}" x2="${sep.x2}" y2="${sep.y2}" ` +
        `stroke="${escapeAttr(rectStroke)}" stroke-width="${style.groupLineWidth}" stroke-dasharray="6 4" />`),
    })
  }

  // Render nested groups recursively (inside this group)
  for (const child of group.children) {
    children.push({ indent: 0, node: renderGroup(child, font, style, group.id) })
  }

  return marks.group({
    id: `group:${group.id}`,
    role: 'group',
    open,
    close: '</g>',
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
// State-note rendering (plan §State 1) — a bordered annotation box anchored
// on the declared side of its state by placeStateNotes.
// ============================================================================

function renderStateNote(note: PositionedStateNote, font: string, style: ResolvedRenderStyle): SceneNode {
  void font
  const { x, y, width: w, height: h } = note
  const rawFill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const rawStroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const rawTextColor = style.edgeTextColor ?? 'var(--_text-sec)'
  const displayText = applyTextTransform(note.text, style.nodeTextTransform)
  const sceneId = `state-note:${note.id}`

  return marks.group({
    id: sceneId,
    role: 'note',
    open: `<g class="state-note" data-id="${escapeAttr(note.id)}" data-target="${escapeAttr(note.target)}" data-side="${note.side}">`,
    close: '</g>',
    children: [
      {
        indent: 2,
        node: marks.shape({
          id: `${sceneId}:rect`,
          role: 'note',
          geometry: { kind: 'rect', x, y, width: w, height: h, rx: 4, ry: 4 },
          paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(STROKE_WIDTHS.innerBox) },
        },
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" ry="4" ` +
          `fill="${escapeAttr(rawFill)}" stroke="${escapeAttr(rawStroke)}" stroke-width="${STROKE_WIDTHS.innerBox}" />`),
      },
      {
        indent: 2,
        node: marks.text({
          id: `${sceneId}:text`,
          role: 'label',
          text: displayText,
          x: x + w / 2,
          y: y + h / 2,
          fontSize: style.edgeLabelFontSize,
          anchor: 'middle',
          paint: { fill: rawTextColor },
        }, renderMultilineText(displayText, x + w / 2, y + h / 2, style.edgeLabelFontSize,
          `text-anchor="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${style.edgeLetterSpacing !== 0 ? ` letter-spacing="${style.edgeLetterSpacing}"` : ''} fill="${escapeAttr(rawTextColor)}"`)),
      },
    ],
  })
}

// ============================================================================
// Edge rendering
// ============================================================================

function renderEdge(edge: PositionedEdge, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  const lineStyle = edge.style === 'dotted' ? 'dotted'
    : edge.style === 'thick' ? 'thick'
    : edge.style === 'invisible' ? 'invisible'
    : 'solid'
  // Invisible links (~~~) shape the layout but draw no stroke or markers.
  if (edge.points.length < 2 || edge.style === 'invisible') {
    return marks.connector({
      id: sceneId,
      role: 'edge',
      geometry: { kind: 'polyline', points: edge.points },
      lineStyle: 'invisible',
      paint: {},
    }, '')
  }

  const pathData = edge.curve ? pointsToCurvePathD(edge.points) : style.edgeBendRadius > 0 ? pointsToPathD(edge.points, style.edgeBendRadius) : pointsToPolylinePath(edge.points)
  const dashArray = edge.style === 'dotted' ? ` stroke-dasharray="${FLOWCHART_DOTTED_DASH.dash} ${FLOWCHART_DOTTED_DASH.gap}"` : ''
  const baseStrokeWidth = edge.style === 'thick' ? style.lineWidth * 2 : style.lineWidth
  const markerColor = edge.inlineStyle?.stroke ?? style.edgeStrokeColor
  const strokeColor = escapeAttr(markerColor ?? 'var(--_line)')
  const strokeWidth = escapeAttr(edge.inlineStyle?.['stroke-width'] ?? String(baseStrokeWidth))

  // Build marker attributes based on arrow direction flags
  // Use color-specific markers when edge has a custom stroke from linkStyle
  const suffix = markerColor ? `-${markerSuffix(markerColor)}` : ''
  let markers = ''
  let endMarker: MarkerRef | undefined
  let startMarker: MarkerRef | undefined
  if (edge.hasArrowEnd) {
    const prefix = markerIdPrefix(edge.endMarker ?? 'arrow')
    endMarker = { id: `${prefix}${suffix}`, shape: markerShape(edge.endMarker ?? 'arrow') }
    markers += ` marker-end="url(#${prefix}${suffix})"`
  }
  if (edge.hasArrowStart) {
    const prefix = markerIdPrefix(edge.startMarker ?? 'arrow')
    startMarker = { id: `${prefix}-start${suffix}`, shape: markerShape(edge.startMarker ?? 'arrow') }
    markers += ` marker-start="url(#${prefix}-start${suffix})"`
  }

  // Semantic data attributes for edge identification and inspection:
  // - class="edge": CSS targeting and type identification
  // - data-id: authored v11.6 edge ID (`e1@-->`) when present — the stable
  //   edge identity contract (X4), mirroring node/subgraph data-id
  // - data-from/data-to: source and target node IDs
  // - data-style: edge style (solid, dotted, thick)
  // - data-arrow-start/end: arrow presence flags
  // - data-label: edge label if present (for quick lookup without traversing DOM)
  const dataAttrs = [
    'class="edge"',
    ...(edge.id ? [`data-id="${escapeAttr(edge.id)}"`] : []),
    `data-from="${escapeAttr(edge.source)}"`,
    `data-to="${escapeAttr(edge.target)}"`,
    `data-style="${edge.style}"`,
    `data-arrow-start="${edge.hasArrowStart}"`,
    `data-arrow-end="${edge.hasArrowEnd}"`,
  ]
  if (edge.hasArrowStart) dataAttrs.push(`data-marker-start="${edge.startMarker ?? 'arrow'}"`)
  if (edge.hasArrowEnd) dataAttrs.push(`data-marker-end="${edge.endMarker ?? 'arrow'}"`)
  if (edge.label) dataAttrs.push(`data-label="${escapeAttr(edge.label)}"`)
  if (edge.curve) dataAttrs.push(`data-curve="${escapeAttr(edge.curve)}"`)
  if (edge.animate) dataAttrs.push(`data-animate="true"`, `data-animation="${edge.animation ?? 'slow'}"`)

  const paint = {
    stroke: markerColor ?? 'var(--_line)',
    strokeWidth: edge.inlineStyle?.['stroke-width'] ?? String(baseStrokeWidth),
    ...(edge.style === 'dotted' ? { strokeDasharray: `${FLOWCHART_DOTTED_DASH.dash} ${FLOWCHART_DOTTED_DASH.gap}` } : {}),
  }

  if (style.edgeBendRadius > 0 || edge.curve) {
    return marks.connector({
      id: sceneId,
      role: 'edge',
      geometry: { kind: 'path', d: pathData, points: edge.points },
      lineStyle,
      paint,
      startMarker,
      endMarker,
    },
      `<path ${dataAttrs.join(' ')} d="${pathData}" fill="none" stroke="${strokeColor}" ` +
      `stroke-width="${strokeWidth}"${dashArray}${edge.animate && edge.style !== 'dotted' ? ' stroke-dasharray="8 4"' : ''}${markers}>${edge.animate ? `<animate attributeName="stroke-dashoffset" from="12" to="0" dur="${edge.animation === 'fast' ? '0.5s' : '1.5s'}" repeatCount="indefinite" />` : ''}</path>`)
  }

  return marks.connector({
    id: sceneId,
    role: 'edge',
    geometry: { kind: 'polyline', points: edge.points },
    lineStyle,
    paint,
    startMarker,
    endMarker,
  },
    `<polyline ${dataAttrs.join(' ')} points="${pathData}" fill="none" stroke="${strokeColor}" ` +
    `stroke-width="${strokeWidth}"${dashArray}${markers} />`)
}

function pointsToCurvePathD(points: Point[]): string {
  const first = points[0]!
  let d = `M ${first.x} ${first.y}`
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!
    const point = points[index]!
    const mx = (previous.x + point.x) / 2
    d += ` C ${mx} ${previous.y}, ${mx} ${point.y}, ${point.x} ${point.y}`
  }
  return d
}

/** Convert points to SVG polyline points attribute: "x1,y1 x2,y2 ..." */
function pointsToPolylinePath(points: Point[]): string {
  return points.map(p => `${p.x},${p.y}`).join(' ')
}

function pointsToPathD(points: Point[], radius: number): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`
  if (radius <= 0 || points.length < 3) {
    return `M${points.map(p => `${p.x},${p.y}`).join(' L')}`
  }

  const parts: string[] = [`M${points[0]!.x},${points[0]!.y}`]

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const prevLen = dist(prev, curr)
    const nextLen = dist(curr, next)
    const r = Math.min(radius, prevLen / 2, nextLen / 2)

    if (r <= 0) {
      parts.push(`L${curr.x},${curr.y}`)
      continue
    }

    const before = pointAlong(curr, prev, r)
    const after = pointAlong(curr, next, r)
    parts.push(`L${before.x},${before.y}`)
    parts.push(`Q${curr.x},${curr.y} ${after.x},${after.y}`)
  }

  const last = points[points.length - 1]!
  parts.push(`L${last.x},${last.y}`)
  return parts.join(' ')
}

function pointAlong(from: Point, to: Point, distance: number): Point {
  const total = dist(from, to)
  if (total === 0) return { ...from }
  const t = distance / total
  return {
    x: roundCoord(from.x + (to.x - from.x) * t),
    y: roundCoord(from.y + (to.y - from.y) * t),
  }
}

/**
 * Round a coordinate to 3 decimal places (sub-pixel precision).
 * Exported for the compact-SVG post-processor and any external renderer that
 * wants to emit identical wire bytes to the built-in path.
 * (Renamed from `roundPathCoord` per the Loop 7 audit consolidation note.)
 */
export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Post-process an SVG string into compact form:
 *  - Numbers with 3+ fractional digits get rounded via `roundCoord` (so
 *    e.g. "123.456789" → "123.457", "100.0001" → "100"). This shrinks ELK-
 *    produced layouts where floats hit 13-digit precision.
 *  - Newlines between elements collapse to nothing — EXCEPT inside <style>
 *    blocks, where CSS line breaks are load-bearing (some CSS parsers tolerate
 *    everything but conservatively we leave the style block formatted).
 *  - `data-*` attributes and `class=` attributes survive — they're agent
 *    inspection hooks (Loop 7 audit). The number-rounding regex only
 *    touches floating-point literals, not identifier strings.
 *
 * Determinism: pure function of the input string. Safe to apply to any SVG
 * the renderer produces; idempotent on already-compact input.
 */
export function compactSvg(svg: string): string {
  // Split into segments alternating non-style and style; only collapse
  // whitespace in non-style segments. Style segments keep their formatting
  // so we don't accidentally break CSS rules that span lines.
  const STYLE_BLOCK_RE = /<style\b[\s\S]*?<\/style>/gi
  const segments: { kind: 'plain' | 'style'; text: string }[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = STYLE_BLOCK_RE.exec(svg)) !== null) {
    if (m.index > last) segments.push({ kind: 'plain', text: svg.slice(last, m.index) })
    segments.push({ kind: 'style', text: m[0] })
    last = m.index + m[0].length
  }
  if (last < svg.length) segments.push({ kind: 'plain', text: svg.slice(last) })

  return segments.map(seg => {
    if (seg.kind === 'style') return seg.text
    // Round numeric literals with 3+ fractional digits.
    //
    // The lookbehind allows SVG path command letters (MLHVCSQTAZ + lowercase)
    // and structural punctuation as valid prefixes — they're how the renderer
    // emits coords (`M78.6115`, `L 202.94`, `cx="50.5"`). It rejects word/
    // dash chars otherwise so we don't touch identifier-like literals
    // (e.g. `data-version="1.0.1234"`).
    let out = seg.text.replace(/(?<=[MLHVCSQTAZmlhvcsqtaz\s,"'(=])(\d+\.\d{3,})/g, (_, num) => {
      const n = parseFloat(num)
      return String(roundCoord(n))
    })
    // Also catch the very first character of the string segment (no prefix).
    out = out.replace(/^(\d+\.\d{3,})/, (_, num) => String(roundCoord(parseFloat(num))))
    // Collapse newlines (the indentation `\n  ` produced by string templates).
    // Tabs and runs of spaces inside attribute values are not affected because
    // attribute values are quoted and don't contain newlines in this renderer.
    out = out.replace(/\n\s*/g, '')
    return out
  }).join('')
}

/**
 * #7540: namespace every SVG def id and its `url(#…)` references with a prefix,
 * so multiple diagrams rendered onto one HTML page don't collide on shared def
 * ids (`arrowhead`, `bm-shadow`, etc.). Node/subgraph groups use `data-id`, not
 * `id`, so this only touches defs/markers/filters — exactly the colliding set.
 *
 * Pure string rewrite, deterministic. Idempotent only if the prefix isn't
 * already applied (callers pass a fresh prefix per diagram). Skips the xmlns
 * and any id that already starts with the prefix.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  if (!prefix) return svg
  if (!/^[A-Za-z0-9_.:-]+$/.test(prefix)) {
    throw new Error('idPrefix may contain only ASCII letters, digits, underscore, hyphen, dot, and colon')
  }
  // Collect declared ids so we only rewrite refs that point at our defs
  // (never an accidental `url(#…)` inside escaped label text).
  const declared = new Set<string>()
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) declared.add(m[1]!)
  const namespaced = (id: string) => id.startsWith(prefix) ? id : `${prefix}${id}`
  let out = svg.replace(/(\sid=")([^"]+)(")/g, (_full, pre, id: string, post) => `${pre}${namespaced(id)}${post}`)
  out = out.replace(/url\(#([^)]+)\)/g, (full, id: string) => declared.has(id) ? `url(#${namespaced(id)})` : full)
  out = out.replace(/(\saria-(?:labelledby|describedby)=")([^"]+)(")/g, (_full, pre, value: string, post) => {
    const refs = value.split(/\s+/).map(id => declared.has(id) ? namespaced(id) : id)
    return `${pre}${refs.join(' ')}${post}`
  })
  out = out.replace(/(\s(?:xlink:)?href=")#([^"]+)(")/g, (full, pre, id: string, post) =>
    declared.has(id) ? `${pre}#${namespaced(id)}${post}` : full,
  )
  return out
}

function renderEdgeLabel(edge: PositionedEdge, font: string, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  // Use layout-computed label position when available (layout-aware, avoids collisions).
  // Fall back to geometric midpoint of the edge polyline.
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const label = applyTextTransform(edge.label!, style.edgeTextTransform)
  const padding = 8
  const strokeWidth = edge.style === 'thick' ? style.lineWidth * 2 : style.lineWidth
  const haloPadding = padding + Math.max(4, strokeWidth * 2)

  // Measure text (works for both single and multi-line)
  const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
  const haloWidth = metrics.width + haloPadding * 2
  const haloHeight = metrics.height + haloPadding * 2
  const haloX = mid.x - haloWidth / 2
  const haloY = mid.y - haloHeight / 2
  const halo = marks.shape({
    id: `${sceneId}:halo`,
    role: 'chrome',
    geometry: { kind: 'rect', x: haloX, y: haloY, width: haloWidth, height: haloHeight, rx: 4, ry: 4 },
    paint: { fill: 'var(--bg)', stroke: 'none' },
  }, `<rect class="edge-label-halo" x="${haloX}" y="${haloY}" ` +
    `width="${haloWidth}" height="${haloHeight}" rx="4" ry="4" fill="var(--bg)" stroke="none" />`)

  // Wrap in <g class="edge-label"> with reference to the edge it belongs to
  const labelTextColor = style.edgeTextColor ?? 'var(--_text-sec)'
  const content = marks.text({
    id: `${sceneId}:text`,
    role: 'label',
    text: label,
    x: mid.x,
    y: mid.y,
    fontSize: style.edgeLabelFontSize,
    anchor: 'middle',
    paint: { fill: labelTextColor },
  }, renderMultilineTextWithBackground(
    label,
    mid.x,
    mid.y,
    metrics.width,
    metrics.height,
    style.edgeLabelFontSize,
    padding,
    // Use --_text-sec for better contrast (was --_text-muted)
    `text-anchor="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${style.edgeLetterSpacing !== 0 ? ` letter-spacing="${style.edgeLetterSpacing}"` : ''} fill="${escapeAttr(labelTextColor)}"`,
    // Increased stroke width from 0.5 to 1 for better label separation from edges
    `rx="2" ry="2" fill="var(--bg)" stroke="var(--_inner-stroke)" stroke-width="1"`
  ))

  // Semantic wrapper: links label to its edge via data-from/data-to
  return marks.group({
    id: sceneId,
    role: 'edge-label',
    open: `<g class="edge-label" data-from="${escapeAttr(edge.source)}" data-to="${escapeAttr(edge.target)}" data-label="${escapeAttr(edge.label!)}">`,
    close: '</g>',
    children: [
      { indent: 2, node: halo },
      { indent: 2, node: content },
    ],
  })
}

/** Get the midpoint of a polyline (by walking segments) */
function edgeMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!

  // Calculate total length
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    totalLength += dist(points[i - 1]!, points[i]!)
  }

  // Walk to the halfway point
  let remaining = totalLength / 2
  for (let i = 1; i < points.length; i++) {
    const segLen = dist(points[i - 1]!, points[i]!)
    if (remaining <= segLen) {
      const t = remaining / segLen
      return {
        x: points[i - 1]!.x + t * (points[i]!.x - points[i - 1]!.x),
        y: points[i - 1]!.y + t * (points[i]!.y - points[i - 1]!.y),
      }
    }
    remaining -= segLen
  }

  return points[points.length - 1]!
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

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
function renderNode(node: PositionedNode, font: string, style: ResolvedRenderStyle): SceneNode {
  const shape = renderNodeShape(node, style)
  const label = renderNodeLabel(node, font, style)

  // Combine shape and label inside a semantic group
  // This enables reliable node identification without heuristics
  // #81: append user-assigned Mermaid class names so external stylesheets can
  // target semantic node classes (e.g. `.hot { ... }`). Sanitize to valid CSS
  // identifier chars; structural `node` class always comes first.
  const userClasses = (node.classNames ?? [])
    .map(c => c.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
  const classAttr = ['node', ...userClasses].join(' ')
  const channels: SemanticChannels | undefined =
    node.shape === 'state-start' ? { status: 'start' } :
    node.shape === 'state-end' ? { status: 'end' } :
    undefined

  const children: Array<{ node: SceneNode; indent: number }> = [{ indent: 2, node: shape }]
  const media = renderFlowchartMedia(node, style)
  if (media) children.push({ indent: 2, node: media })
  if (label) {
    children.push({ indent: 2, node: label })
  }
  // data-semantic-shape names the Mermaid v11 `@{ shape }` id when the drawn
  // geometry is a mapping of it, so agents can explain the semantic shape
  // even when the geometry is approximate (repo #44).
  const semanticShape = node.semanticShape ? ` data-semantic-shape="${escapeAttr(node.semanticShape)}"` : ''
  const interaction = node.href ? ` data-href="${escapeAttr(node.href)}" role="link" tabindex="0"` : ''
  return marks.group({
    id: `node:${node.id}`,
    role: 'node',
    open: `<g class="${classAttr}" data-id="${escapeAttr(node.id)}" data-label="${escapeAttr(node.label)}" data-shape="${node.shape}"${semanticShape}${interaction}>`,
    close: '</g>',
    children,
    channels,
  })
}

function renderFlowchartSemanticShape(node: PositionedNode, fill: string, stroke: string, sw: string): ShapePiece | null {
  const { x, y, width: w, height: h } = node
  const right = x + w, bottom = y + h, cx = x + w / 2, cy = y + h / 2
  const path = (d: string, extra = ''): ShapePiece => ({
    geometry: { kind: 'path', d },
    crisp: `<path d="${d}" fill="${extra.includes('fill="none"') ? 'none' : fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  })
  const polygon = (points: Array<{ x: number; y: number }>): ShapePiece => ({
    geometry: { kind: 'polygon', points },
    crisp: `<polygon points="${points.map(point => `${point.x},${point.y}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  })
  switch (node.semanticShape) {
    case 'bang': {
      const points = Array.from({ length: 16 }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI / 8
        const radius = index % 2 === 0 ? 1 : 0.62
        return { x: cx + Math.cos(angle) * w / 2 * radius, y: cy + Math.sin(angle) * h / 2 * radius }
      })
      return polygon(points)
    }
    case 'notch-rect': return polygon([{ x: x + 10, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }, { x, y: y + 10 }])
    case 'cloud': return path(`M${x + w * .18} ${bottom}C${x - 4} ${bottom} ${x - 4} ${cy} ${x + w * .12} ${cy}C${x + w * .08} ${y + h * .15} ${x + w * .38} ${y - 4} ${x + w * .48} ${y + h * .18}C${x + w * .65} ${y - 5} ${right} ${y + h * .16} ${x + w * .88} ${cy}C${right + 5} ${cy} ${right + 5} ${bottom} ${x + w * .72} ${bottom}Z`)
    case 'hourglass': return polygon([{ x, y }, { x: right, y }, { x: x + w * .62, y: cy }, { x: right, y: bottom }, { x, y: bottom }, { x: x + w * .38, y: cy }])
    case 'bolt': return polygon([{ x: x + w * .55, y }, { x: x + w * .25, y: cy }, { x: x + w * .48, y: cy }, { x: x + w * .35, y: bottom }, { x: x + w * .78, y: y + h * .4 }, { x: x + w * .55, y: y + h * .4 }])
    case 'brace': return path(`M${right} ${y}C${x + w * .4} ${y} ${x + w * .7} ${cy} ${x} ${cy}C${x + w * .7} ${cy} ${x + w * .4} ${bottom} ${right} ${bottom}`, ' fill="none"')
    case 'brace-r': return path(`M${x} ${y}C${x + w * .6} ${y} ${x + w * .3} ${cy} ${right} ${cy}C${x + w * .3} ${cy} ${x + w * .6} ${bottom} ${x} ${bottom}`, ' fill="none"')
    case 'braces': return path(`M${x + w * .25} ${y}C${x} ${y} ${x + w * .15} ${cy} ${x} ${cy}C${x + w * .15} ${cy} ${x} ${bottom} ${x + w * .25} ${bottom}M${x + w * .75} ${y}C${right} ${y} ${x + w * .85} ${cy} ${right} ${cy}C${x + w * .85} ${cy} ${right} ${bottom} ${x + w * .75} ${bottom}`, ' fill="none"')
    case 'datastore': return path(`M${x + 8} ${y}H${right}V${bottom}H${x + 8}M${x + 8} ${y}C${x - 2} ${y + h * .2} ${x - 2} ${bottom - h * .2} ${x + 8} ${bottom}`, ' fill="none"')
    case 'delay': return path(`M${x} ${y}H${right - h / 2}A${h / 2} ${h / 2} 0 0 1 ${right - h / 2} ${bottom}H${x}Z`)
    case 'h-cyl': return path(`M${x + 10} ${y}H${right - 10}A10 ${h / 2} 0 0 1 ${right - 10} ${bottom}H${x + 10}A10 ${h / 2} 0 0 1 ${x + 10} ${y}Z M${right - 10} ${y}A10 ${h / 2} 0 0 0 ${right - 10} ${bottom}`)
    case 'lin-cyl': return path(`M${x} ${y + 8}A${w / 2} 8 0 0 1 ${right} ${y + 8}V${bottom - 8}A${w / 2} 8 0 0 1 ${x} ${bottom - 8}Z M${x} ${y + 8}A${w / 2} 8 0 0 0 ${right} ${y + 8}M${x} ${bottom - 16}A${w / 2} 8 0 0 0 ${right} ${bottom - 16}`)
    case 'curv-trap': return path(`M${x + 12} ${y}Q${cx} ${y + 8} ${right - 12} ${y}L${right} ${bottom}Q${cx} ${bottom - 8} ${x} ${bottom}Z`)
    case 'div-rect': return path(`M${x} ${y}H${right}V${bottom}H${x}ZM${x} ${cy}H${right}`)
    case 'doc': return path(`M${x} ${y}H${right}V${bottom - 8}Q${x + w * .75} ${bottom + 2} ${cx} ${bottom - 8}Q${x + w * .25} ${bottom - 18} ${x} ${bottom - 8}Z`)
    case 'tri': return polygon([{ x: cx, y }, { x: right, y: bottom }, { x, y: bottom }])
    case 'fork': return { geometry: { kind: 'rect', x, y: cy - 4, width: w, height: 8 }, crisp: `<rect x="${x}" y="${cy - 4}" width="${w}" height="8" fill="${stroke}" stroke="${stroke}" stroke-width="${sw}" />` }
    case 'win-pane': return path(`M${x} ${y}H${right}V${bottom}H${x}ZM${x + w * .28} ${y}V${bottom}M${x} ${y + h * .32}H${right}`)
    case 'f-circ': return { geometry: { kind: 'circle', cx, cy, r: Math.min(w, h) / 2 }, crisp: `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" fill="${stroke}" stroke="${stroke}" stroke-width="${sw}" />` }
    case 'lin-doc': return path(`M${x} ${y}H${right}V${bottom - 8}Q${x + w * .75} ${bottom + 2} ${cx} ${bottom - 8}Q${x + w * .25} ${bottom - 18} ${x} ${bottom - 8}ZM${x + 8} ${y + 8}H${right - 8}`)
    case 'lin-rect': return path(`M${x} ${y}H${right}V${bottom}H${x}ZM${x + 6} ${y}V${bottom}M${right - 6} ${y}V${bottom}`)
    case 'notch-pent': return polygon([{ x, y }, { x: right - 10, y }, { x: right, y: cy }, { x: right - 10, y: bottom }, { x, y: bottom }, { x: x + 8, y: cy }])
    case 'flip-tri': return polygon([{ x, y }, { x: right, y }, { x: cx, y: bottom }])
    case 'docs': return path(`M${x + 8} ${y}H${right}V${bottom - 8}Q${x + w * .7} ${bottom} ${x + w * .45} ${bottom - 8}Q${x + w * .22} ${bottom - 16} ${x + 8} ${bottom - 8}ZM${x} ${y + 8}H${x + 8}M${x} ${y + 8}V${bottom}`)
    case 'st-rect': return path(`M${x + 8} ${y}H${right}V${bottom - 8}H${x + 8}ZM${x} ${y + 8}H${right - 8}V${bottom}H${x}Z`)
    case 'flag': return path(`M${x} ${y + 6}Q${x + w * .25} ${y - 4} ${cx} ${y + 6}Q${x + w * .75} ${y + 16} ${right} ${y + 6}V${bottom - 6}Q${x + w * .75} ${bottom + 4} ${cx} ${bottom - 6}Q${x + w * .25} ${bottom - 16} ${x} ${bottom - 6}Z`)
    case 'sm-circ': return { geometry: { kind: 'circle', cx, cy, r: Math.min(w, h) * .22 }, crisp: `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * .22}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` }
    case 'cross-circ': return path(`M${cx} ${y}A${w / 2} ${h / 2} 0 1 1 ${cx - .01} ${y}M${x + w * .28} ${y + h * .28}L${x + w * .72} ${y + h * .72}M${x + w * .72} ${y + h * .28}L${x + w * .28} ${y + h * .72}`)
    case 'bow-rect': return path(`M${x} ${y}Q${x + 12} ${cy} ${x} ${bottom}H${right}Q${right - 12} ${cy} ${right} ${y}Z`)
    case 'tag-doc': return path(`M${x + 10} ${y}H${right}V${bottom - 8}Q${x + w * .7} ${bottom} ${cx} ${bottom - 8}Q${x + w * .25} ${bottom - 16} ${x} ${bottom - 8}V${y + 10}ZM${x} ${y + 10}L${x + 10} ${y}`)
    case 'tag-rect': return polygon([{ x: x + 10, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }, { x, y: y + 10 }])
    case 'text': return { geometry: { kind: 'path', d: `M${x} ${y}` }, crisp: `<path d="M${x} ${y}" fill="none" stroke="none" />` }
    default: return null
  }
}

function renderFlowchartMedia(node: PositionedNode, style: ResolvedRenderStyle): SceneNode | null {
  const color = escapeAttr(style.nodeTextColor ?? 'var(--_text)')
  const size = Math.min(28, node.height * 0.4)
  const cx = node.x + node.width / 2
  const y = node.y + 6
  if (node.icon) {
    const glyph = resolveMindmapIcon(node.icon)
    if (glyph) {
      const scale = size / 24
      const paths = glyph.paths.map(path => `<path d="${path}"/>`).join('')
      return marks.raw({ id: `node:${node.id}:icon`, role: 'icon' }, `<g class="flowchart-icon" data-icon="${escapeAttr(node.icon)}" transform="translate(${cx - size / 2} ${y}) scale(${scale})" fill="${color}" stroke="${color}" stroke-width="0.8">${paths}</g>`)
    }
    const token = node.icon.split(/[:/\s-]+/).filter(Boolean).at(-1)?.slice(0, 2).toUpperCase() || '?'
    return marks.text({ id: `node:${node.id}:icon`, role: 'icon', text: token, x: cx, y: y + size / 2, fontSize: 10, anchor: 'middle', paint: { fill: color } }, `<text class="flowchart-icon-fallback" data-icon="${escapeAttr(node.icon)}" x="${cx}" y="${y + size / 2}" text-anchor="middle" font-size="10" fill="${color}">${escapeXml(token)}</text>`)
  }
  if (node.image) {
    const left = cx - size / 2
    return marks.raw({ id: `node:${node.id}:image`, role: 'icon' }, `<g class="flowchart-image-placeholder" data-image-src="${escapeAttr(node.image)}" fill="none" stroke="${color}" stroke-width="1.2"><rect x="${left}" y="${y}" width="${size}" height="${size * 0.72}" rx="2"/><circle cx="${left + size * 0.72}" cy="${y + size * 0.2}" r="${size * 0.08}"/><path d="M${left + 2} ${y + size * 0.66}L${left + size * 0.36} ${y + size * 0.36}L${left + size * 0.52} ${y + size * 0.5}L${left + size * 0.7} ${y + size * 0.32}L${left + size - 2} ${y + size * 0.66}"/></g>`)
  }
  return null
}

function renderNodeShape(node: PositionedNode, style: ResolvedRenderStyle): SceneNode {
  const { x, y, width, height, shape, inlineStyle } = node

  // Resolve fill and stroke — inline styles (from mermaid `style` directives)
  // override the CSS variable defaults. When no inline style is present, the
  // CSS variable handles theming automatically via color-mix() derivation.
  const rawFill = inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)'
  const rawStroke = inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
  const rawSw = inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth)
  const fill = escapeAttr(rawFill)
  const stroke = escapeAttr(rawStroke)
  const sw = escapeAttr(rawSw)

  const piece = ((): ShapePiece => {
    const semantic = renderFlowchartSemanticShape(node, fill, stroke, sw)
    if (semantic) return semantic
    switch (shape) {
      case 'service':
        return renderRect(x, y, width, height, fill, stroke, sw, style.cornerRadius ?? 0)
      case 'diamond':
        return renderDiamond(x, y, width, height, fill, stroke, sw)
      case 'rounded':
        return renderRoundedRect(x, y, width, height, fill, stroke, sw, style.cornerRadius ?? 6)
      case 'stadium':
        return renderStadium(x, y, width, height, fill, stroke, sw)
      case 'circle':
        return renderCircle(x, y, width, height, fill, stroke, sw)
      case 'subroutine':
        return renderSubroutine(x, y, width, height, fill, stroke, sw, style.cornerRadius ?? 0)
      case 'doublecircle':
        return renderDoubleCircle(x, y, width, height, fill, stroke, sw)
      case 'hexagon':
        return renderHexagon(x, y, width, height, fill, stroke, sw)
      case 'cylinder':
        return renderCylinder(x, y, width, height, fill, stroke, sw)
      case 'asymmetric':
        return renderAsymmetric(x, y, width, height, fill, stroke, sw)
      case 'trapezoid':
        return renderTrapezoid(x, y, width, height, fill, stroke, sw)
      case 'trapezoid-alt':
        return renderTrapezoidAlt(x, y, width, height, fill, stroke, sw)
      case 'lean-r':
        return renderLeanR(x, y, width, height, fill, stroke, sw)
      case 'lean-l':
        return renderLeanL(x, y, width, height, fill, stroke, sw)
      case 'state-start':
        return renderStateStart(x, y, width, height)
      case 'state-end':
        return renderStateEnd(x, y, width, height)
      case 'state-fork':
      case 'state-join':
        return renderStateBar(x, y, width, height)
      case 'state-choice':
        return renderDiamond(x, y, width, height, fill, stroke, sw)
      case 'state-history':
        return renderCircle(x, y, width, height, fill, stroke, sw)
      case 'rectangle':
      default:
        return renderRect(x, y, width, height, fill, stroke, sw, style.cornerRadius ?? 0)
    }
  })()

  const paint = shape === 'state-start' || shape === 'state-fork' || shape === 'state-join'
    ? { fill: 'var(--_text)', stroke: 'none' }
    : shape === 'state-end'
      ? { fill: 'var(--_text)', stroke: 'var(--_text)' }
      : { fill: rawFill, stroke: rawStroke, strokeWidth: rawSw }

  return marks.shape({
    id: `node-shape:${node.id}`,
    role: 'node',
    geometry: piece.geometry,
    paint,
  }, piece.crisp)
}

// --- Basic shapes ---

function renderRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, radius: number = 0): ShapePiece {
  return {
    geometry: { kind: 'rect', x, y, width: w, height: h, rx: radius, ry: radius },
    crisp:
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
      `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

function renderRoundedRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, radius: number = 6): ShapePiece {
  return {
    geometry: { kind: 'rect', x, y, width: w, height: h, rx: radius, ry: radius },
    crisp:
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
      `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

function renderStadium(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const r = h / 2
  return {
    geometry: { kind: 'rect', x, y, width: w, height: h, rx: r, ry: r },
    crisp:
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
      `rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

function renderCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2
  return {
    geometry: { kind: 'circle', cx, cy, r },
    crisp:
      `<circle cx="${cx}" cy="${cy}" r="${r}" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

function renderDiamond(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const cx = x + w / 2
  const cy = y + h / 2
  const hw = w / 2
  const hh = h / 2
  const pts = [
    { x: cx, y: cy - hh },   // top
    { x: cx + hw, y: cy },   // right
    { x: cx, y: cy + hh },   // bottom
    { x: cx - hw, y: cy },   // left
  ]
  const points = pts.map(p => `${p.x},${p.y}`).join(' ')

  return {
    geometry: { kind: 'polygon', points: pts },
    crisp: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

// --- Batch 1 shapes ---

/** Subroutine: rectangle with double vertical borders on left and right */
function renderSubroutine(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, radius: number = 0): ShapePiece {
  const inset = 8 // distance from edge to inner vertical line
  return {
    geometry: {
      kind: 'compound',
      children: [
        { kind: 'rect', x, y, width: w, height: h, rx: radius, ry: radius },
        { kind: 'line', x1: x + inset, y1: y, x2: x + inset, y2: y + h },
        { kind: 'line', x1: x + w - inset, y1: y, x2: x + w - inset, y2: y + h },
      ],
    },
    crisp:
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
      `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
      `\n<line x1="${x + inset}" y1="${y}" x2="${x + inset}" y2="${y + h}" ` +
      `stroke="${stroke}" stroke-width="${sw}" />` +
      `\n<line x1="${x + w - inset}" y1="${y}" x2="${x + w - inset}" y2="${y + h}" ` +
      `stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

/** Double circle: two concentric circles with a gap between them */
function renderDoubleCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2
  const innerR = outerR - 5 // 5px gap between rings
  return {
    geometry: {
      kind: 'compound',
      children: [
        { kind: 'circle', cx, cy, r: outerR },
        { kind: 'circle', cx, cy, r: innerR },
      ],
    },
    crisp:
      `<circle cx="${cx}" cy="${cy}" r="${outerR}" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
      `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

/** Hexagon: 6-point polygon with flat top/bottom and angled sides */
function renderHexagon(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const inset = h / 4 // horizontal inset for the angled sides
  const pts = [
    { x: x + inset, y },               // top-left
    { x: x + w - inset, y },           // top-right
    { x: x + w, y: y + h / 2 },        // mid-right
    { x: x + w - inset, y: y + h },    // bottom-right
    { x: x + inset, y: y + h },        // bottom-left
    { x, y: y + h / 2 },               // mid-left
  ]
  const points = pts.map(p => `${p.x},${p.y}`).join(' ')

  return {
    geometry: { kind: 'polygon', points: pts },
    crisp: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

// --- Batch 2 shapes ---

/** Cylinder / database: top ellipse cap + body rect + bottom ellipse */
function renderCylinder(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const ry = 7 // ellipse vertical radius for the cap
  const cx = x + w / 2
  const bodyTop = y + ry
  const bodyH = h - 2 * ry

  return {
    geometry: {
      kind: 'compound',
      children: [
        { kind: 'rect', x, y: bodyTop, width: w, height: bodyH },
        { kind: 'line', x1: x, y1: bodyTop, x2: x, y2: bodyTop + bodyH },
        { kind: 'line', x1: x + w, y1: bodyTop, x2: x + w, y2: bodyTop + bodyH },
        { kind: 'ellipse', cx, cy: y + h - ry, rx: w / 2, ry },
        { kind: 'ellipse', cx, cy: bodyTop, rx: w / 2, ry },
      ],
    },
    crisp: (
      // Body rectangle (no top border — covered by top ellipse)
      `<rect x="${x}" y="${bodyTop}" width="${w}" height="${bodyH}" ` +
      `fill="${fill}" stroke="none" />` +
      // Left and right body borders
      `\n<line x1="${x}" y1="${bodyTop}" x2="${x}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />` +
      `\n<line x1="${x + w}" y1="${bodyTop}" x2="${x + w}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />` +
      // Bottom ellipse (half visible)
      `\n<ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
      // Top ellipse (full, on top)
      `\n<ellipse cx="${cx}" cy="${bodyTop}" rx="${w / 2}" ry="${ry}" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
    ),
  }
}

/** Asymmetric / flag: rectangle with a pointed left edge */
function renderAsymmetric(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const indent = 12 // how far the point indents
  const pts = [
    { x: x + indent, y },           // top-left (indented)
    { x: x + w, y },                // top-right
    { x: x + w, y: y + h },         // bottom-right
    { x: x + indent, y: y + h },    // bottom-left (indented)
    { x, y: y + h / 2 },            // left point
  ]
  const points = pts.map(p => `${p.x},${p.y}`).join(' ')

  return {
    geometry: { kind: 'polygon', points: pts },
    crisp: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

/** Trapezoid [/text\]: wider bottom, narrower top */
function renderTrapezoid(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const inset = w * 0.15 // top edge is narrower by this amount on each side
  const pts = [
    { x: x + inset, y },           // top-left (indented)
    { x: x + w - inset, y },       // top-right (indented)
    { x: x + w, y: y + h },        // bottom-right (full width)
    { x, y: y + h },               // bottom-left (full width)
  ]
  const points = pts.map(p => `${p.x},${p.y}`).join(' ')

  return {
    geometry: { kind: 'polygon', points: pts },
    crisp: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

/** Trapezoid-alt [\text/]: wider top, narrower bottom */
function renderTrapezoidAlt(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const inset = w * 0.15 // bottom edge is narrower
  const pts = [
    { x, y },                          // top-left (full width)
    { x: x + w, y },                   // top-right (full width)
    { x: x + w - inset, y: y + h },    // bottom-right (indented)
    { x: x + inset, y: y + h },        // bottom-left (indented)
  ]
  const points = pts.map(p => `${p.x},${p.y}`).join(' ')

  return {
    geometry: { kind: 'polygon', points: pts },
    crisp: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

/** Parallelogram [/text/]: leans right (top edge shifted right) */
function renderLeanR(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const inset = w * 0.15 // horizontal shear of the slanted sides
  const pts = [
    { x: x + inset, y },               // top-left (shifted right)
    { x: x + w, y },                   // top-right (full width)
    { x: x + w - inset, y: y + h },    // bottom-right (shifted left)
    { x, y: y + h },                   // bottom-left (full width)
  ]
  const points = pts.map(p => `${p.x},${p.y}`).join(' ')

  return {
    geometry: { kind: 'polygon', points: pts },
    crisp: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

/** Parallelogram [\text\]: leans left (top edge shifted left) */
function renderLeanL(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): ShapePiece {
  const inset = w * 0.15 // horizontal shear of the slanted sides
  const pts = [
    { x, y },                          // top-left (full width)
    { x: x + w - inset, y },           // top-right (shifted left)
    { x: x + w, y: y + h },            // bottom-right (full width)
    { x: x + inset, y: y + h },        // bottom-left (shifted right)
  ]
  const points = pts.map(p => `${p.x},${p.y}`).join(' ')

  return {
    geometry: { kind: 'polygon', points: pts },
    crisp: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`,
  }
}

// --- Batch 3: State diagram pseudostates ---

/** State start: small filled circle using primary text color */
function renderStateStart(x: number, y: number, w: number, h: number): ShapePiece {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2 - 2
  return {
    geometry: { kind: 'circle', cx, cy, r },
    crisp: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--_text)" stroke="none" />`,
  }
}

/** State end: bullseye — outer ring + inner filled circle using primary text color */
function renderStateEnd(x: number, y: number, w: number, h: number): ShapePiece {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2 - 2
  const innerR = outerR - 4
  return {
    geometry: {
      kind: 'compound',
      children: [
        { kind: 'circle', cx, cy, r: outerR },
        { kind: 'circle', cx, cy, r: innerR },
      ],
    },
    crisp:
      `<circle cx="${cx}" cy="${cy}" r="${outerR}" ` +
      `fill="none" stroke="var(--_text)" stroke-width="${STROKE_WIDTHS.innerBox * 2}" />` +
      `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--_text)" stroke="none" />`,
  }
}

/** Fork/join bar: filled rounded bar using primary text color (upstream #2514
 *  renders these as plain boxes — the bar is the standard UML notation). */
function renderStateBar(x: number, y: number, w: number, h: number): ShapePiece {
  const r = Math.min(w, h) / 2
  return {
    geometry: { kind: 'rect', x, y, width: w, height: h, rx: r, ry: r },
    crisp: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="var(--_text)" stroke="none" />`,
  }
}

// ============================================================================
// Node label rendering
// ============================================================================

function renderNodeLabel(node: PositionedNode, font: string, style: ResolvedRenderStyle): SceneNode | null {
  // State pseudostates have no label (history keeps its H/H* glyph)
  if (node.shape === 'state-start' || node.shape === 'state-end' ||
      node.shape === 'state-fork' || node.shape === 'state-join' || node.shape === 'state-choice') {
    if (!node.label) return null
  }

  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2

  const rawTextColor = resolveInlineNodeTextColor(node.inlineStyle, style.nodeTextColor ?? 'var(--_text)')
  const textColor = escapeAttr(rawTextColor)
  const label = applyTextTransform(node.label, style.nodeTextTransform)

  return marks.text({
    id: `node-label:${node.id}`,
    role: 'label',
    text: label,
    x: cx,
    y: cy,
    fontSize: style.nodeLabelFontSize,
    anchor: 'middle',
    paint: { fill: rawTextColor },
  }, renderMultilineText(
    label,
    cx,
    cy,
    style.nodeLabelFontSize,
    `text-anchor="middle" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${style.nodeLetterSpacing !== 0 ? ` letter-spacing="${style.nodeLetterSpacing}"` : ''} fill="${textColor}"`
  ))
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape a string for use as an XML/HTML attribute value.
 * Escapes quotes and ampersands to prevent attribute injection.
 */
