import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, Point, EdgeMarker, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from './theme.ts'
import { STROKE_WIDTHS, ARROW_HEAD, FLOWCHART_DOTTED_DASH, resolveRenderStyle } from './styles.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import { measureMultilineText } from './text-metrics.ts'
import { renderMultilineText, renderMultilineTextWithBackground, escapeXml } from './multiline-utils.ts'
import { topRoundedRectPath } from './svg-paths.ts'

// ============================================================================
// SVG renderer — converts a PositionedGraph into an SVG string.
//
// Pure string concatenation, no DOM manipulation.
// Renders back-to-front: groups → edges → arrow heads → edge labels → nodes → node labels.
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
  graph: PositionedGraph,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  options: RenderOptions = {},
): string {
  const parts: string[] = []
  const style = resolveRenderStyle(options)

  // SVG root with CSS variables + style block + defs
  parts.push(svgOpenTag(graph.width, graph.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  parts.push('<defs>')
  parts.push(arrowMarkerDefs())
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(shadowDefs)
  // Per-color arrow markers for edges with custom stroke via linkStyle
  const customStrokeColors = new Set<string>()
  let needsCircle = false
  let needsCross = false
  for (const edge of graph.edges) {
    if (edge.inlineStyle?.stroke) customStrokeColors.add(edge.inlineStyle.stroke)
    if (edge.startMarker === 'circle' || edge.endMarker === 'circle') needsCircle = true
    if (edge.startMarker === 'cross' || edge.endMarker === 'cross') needsCross = true
  }
  if (needsCircle) parts.push(circleMarkerDefs())
  if (needsCross) parts.push(crossMarkerDefs())
  for (const color of customStrokeColors) {
    parts.push(arrowMarkerDefsForColor(color))
    if (needsCircle) parts.push(circleMarkerDefs(color))
    if (needsCross) parts.push(crossMarkerDefs(color))
  }
  parts.push('</defs>')

  // 1. Subgraph backgrounds (group rectangles with header bands)
  for (const group of graph.groups) {
    parts.push(renderGroup(group, font, style))
  }

  // 2. Edges (polylines — rendered behind nodes)
  // Each edge is a <polyline> with semantic data-* attributes
  for (const edge of graph.edges) {
    parts.push(renderEdge(edge, style))
  }

  // 3. Edge labels (positioned at midpoint of edge)
  // Each label is wrapped in <g class="edge-label">
  for (const edge of graph.edges) {
    if (edge.label) {
      parts.push(renderEdgeLabel(edge, font, style))
    }
  }

  // 4. Nodes (shape + label wrapped in <g class="node">)
  for (const node of graph.nodes) {
    parts.push(renderNode(node, font, style))
  }

  parts.push('</svg>')

  return parts.join('\n')
}

// ============================================================================
// Arrow marker definitions
// ============================================================================

/**
 * Reusable arrow head markers — both forward (end) and reverse (start) variants.
 * The reverse marker uses orient="auto-start-reverse" to flip automatically.
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
    `  <marker id="arrowhead" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
    `\n  </marker>` +
    // Reverse arrow (marker-start) uses the same geometry as marker-end;
    // auto-start-reverse handles orientation without a hand-flipped polygon.
    `\n  <marker id="arrowhead-start" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
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
    `  <marker id="arrowhead-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
    `\n  </marker>` +
    `\n  <marker id="arrowhead-start-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
    `\n  </marker>`
  )
}

function circleMarkerDefs(color?: string): string {
  const size = ARROW_HEAD.width
  const suffix = color ? `-${markerSuffix(color)}` : ''
  const stroke = color ? escapeAttr(color) : 'var(--_arrow)'
  const r = size / 2 - 0.75
  return (
    `  <marker id="circlehead${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${size - 0.5}" refY="${size / 2}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1" />` +
    `\n  </marker>` +
    `\n  <marker id="circlehead-start${suffix}" markerWidth="${size}" markerHeight="${size}" refX="0.5" refY="${size / 2}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">` +
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
    `  <marker id="crosshead${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${size / 2}" refY="${size / 2}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <line x1="${a}" y1="${a}" x2="${b}" y2="${b}" ${style} />` +
    `\n    <line x1="${a}" y1="${b}" x2="${b}" y2="${a}" ${style} />` +
    `\n  </marker>` +
    `\n  <marker id="crosshead-start${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${size / 2}" refY="${size / 2}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">` +
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

/** Sanitize a color value into a collision-free SVG ID suffix.
 *  Non-alphanumeric chars are hex-encoded so distinct inputs never collapse
 *  (e.g. "var(--line-1)" → "var28--line2d129", "var(--line1)" → "var28--line129"). */
function markerSuffix(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, (ch) => ch.charCodeAt(0).toString(16))
}

// ============================================================================
// Group rendering (subgraph backgrounds)
// ============================================================================

function renderGroup(group: PositionedGroup, font: string, style: ResolvedRenderStyle): string {
  const headerHeight = style.groupHeaderFontSize + 16
  const parts: string[] = []

  // Opening <g> with semantic attributes for subgraph identification
  // data-id: original Mermaid subgraph ID
  // data-label: display label (may differ from ID)
  parts.push(
    `<g class="subgraph" data-id="${escapeAttr(group.id)}" data-label="${escapeAttr(group.label)}">`
  )

  // Outer rectangle
  parts.push(
    `  <rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" ` +
    `rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" fill="var(--_group-fill)" stroke="${escapeAttr(style.groupBorderColor ?? 'var(--_node-stroke)')}" stroke-width="${style.groupLineWidth}" />`
  )

  // Header band
  parts.push(
    `  <path d="${topRoundedRectPath(group.x, group.y, group.width, headerHeight, style.groupCornerRadius)}" ` +
    `fill="var(--_group-hdr)" stroke="${escapeAttr(style.groupBorderColor ?? 'var(--_node-stroke)')}" stroke-width="${style.groupLineWidth}" />`
  )

  // Header label (supports multi-line via <br> tags)
  parts.push(
    '  ' + renderMultilineText(
      transformText(group.label, style.groupTextTransform),
      group.x + style.groupLabelPaddingX,
      group.y + headerHeight / 2,
      style.groupHeaderFontSize,
      `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${style.groupLetterSpacing !== 0 ? ` letter-spacing="${style.groupLetterSpacing}"` : ''} fill="var(--_text-sec)"`
    )
  )

  // Render nested groups recursively (inside this group)
  for (const child of group.children) {
    parts.push(renderGroup(child, font, style))
  }

  parts.push('</g>')

  return parts.join('\n')
}

// ============================================================================
// Edge rendering
// ============================================================================

function renderEdge(edge: PositionedEdge, style: ResolvedRenderStyle): string {
  if (edge.points.length < 2) return ''
  // Invisible links (~~~) shape the layout but draw no stroke or markers.
  if (edge.style === 'invisible') return ''

  const pathData = style.edgeBendRadius > 0 ? pointsToPathD(edge.points, style.edgeBendRadius) : pointsToPolylinePath(edge.points)
  const dashArray = edge.style === 'dotted' ? ` stroke-dasharray="${FLOWCHART_DOTTED_DASH.dash} ${FLOWCHART_DOTTED_DASH.gap}"` : ''
  const baseStrokeWidth = edge.style === 'thick' ? style.lineWidth * 2 : style.lineWidth
  const strokeColor = escapeAttr(edge.inlineStyle?.stroke ?? 'var(--_line)')
  const strokeWidth = escapeAttr(edge.inlineStyle?.['stroke-width'] ?? String(baseStrokeWidth))

  // Build marker attributes based on arrow direction flags
  // Use color-specific markers when edge has a custom stroke from linkStyle
  const suffix = edge.inlineStyle?.stroke ? `-${markerSuffix(edge.inlineStyle.stroke)}` : ''
  let markers = ''
  if (edge.hasArrowEnd) {
    const prefix = markerIdPrefix(edge.endMarker ?? 'arrow')
    markers += ` marker-end="url(#${prefix}${suffix})"`
  }
  if (edge.hasArrowStart) {
    const prefix = markerIdPrefix(edge.startMarker ?? 'arrow')
    markers += ` marker-start="url(#${prefix}-start${suffix})"`
  }

  // Semantic data attributes for edge identification and inspection:
  // - class="edge": CSS targeting and type identification
  // - data-from/data-to: source and target node IDs
  // - data-style: edge style (solid, dotted, thick)
  // - data-arrow-start/end: arrow presence flags
  // - data-label: edge label if present (for quick lookup without traversing DOM)
  const dataAttrs = [
    'class="edge"',
    `data-from="${escapeAttr(edge.source)}"`,
    `data-to="${escapeAttr(edge.target)}"`,
    `data-style="${edge.style}"`,
    `data-arrow-start="${edge.hasArrowStart}"`,
    `data-arrow-end="${edge.hasArrowEnd}"`,
  ]
  if (edge.hasArrowStart) dataAttrs.push(`data-marker-start="${edge.startMarker ?? 'arrow'}"`)
  if (edge.hasArrowEnd) dataAttrs.push(`data-marker-end="${edge.endMarker ?? 'arrow'}"`)
  if (edge.label) {
    dataAttrs.push(`data-label="${escapeAttr(edge.label)}"`)
  }

  if (style.edgeBendRadius > 0) {
    return (
      `<path ${dataAttrs.join(' ')} d="${pathData}" fill="none" stroke="${strokeColor}" ` +
      `stroke-width="${strokeWidth}"${dashArray}${markers} />`
    )
  }

  return (
    `<polyline ${dataAttrs.join(' ')} points="${pathData}" fill="none" stroke="${strokeColor}" ` +
    `stroke-width="${strokeWidth}"${dashArray}${markers} />`
  )
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
  // Collect declared ids so we only rewrite refs that point at our defs
  // (never an accidental `url(#…)` inside escaped label text).
  const declared = new Set<string>()
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) declared.add(m[1]!)
  let out = svg.replace(/(\sid=")([^"]+)(")/g, (_full, pre, id: string, post) => `${pre}${prefix}${id}${post}`)
  out = out.replace(/url\(#([^)]+)\)/g, (full, id: string) => declared.has(id) ? `url(#${prefix}${id})` : full)
  return out
}

function renderEdgeLabel(edge: PositionedEdge, font: string, style: ResolvedRenderStyle): string {
  // Use layout-computed label position when available (layout-aware, avoids collisions).
  // Fall back to geometric midpoint of the edge polyline.
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const label = edge.label!
  const padding = 8
  const strokeWidth = edge.style === 'thick' ? style.lineWidth * 2 : style.lineWidth
  const haloPadding = padding + Math.max(4, strokeWidth * 2)

  // Measure text (works for both single and multi-line)
  const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
  const haloWidth = metrics.width + haloPadding * 2
  const haloHeight = metrics.height + haloPadding * 2
  const halo = `<rect class="edge-label-halo" x="${mid.x - haloWidth / 2}" y="${mid.y - haloHeight / 2}" ` +
    `width="${haloWidth}" height="${haloHeight}" rx="4" ry="4" fill="var(--bg)" stroke="none" />`

  // Wrap in <g class="edge-label"> with reference to the edge it belongs to
  const content = renderMultilineTextWithBackground(
    label,
    mid.x,
    mid.y,
    metrics.width,
    metrics.height,
    style.edgeLabelFontSize,
    padding,
    // Use --_text-sec for better contrast (was --_text-muted)
    `text-anchor="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${style.edgeLetterSpacing !== 0 ? ` letter-spacing="${style.edgeLetterSpacing}"` : ''} fill="var(--_text-sec)"`,
    // Increased stroke width from 0.5 to 1 for better label separation from edges
    `rx="2" ry="2" fill="var(--bg)" stroke="var(--_inner-stroke)" stroke-width="1"`
  )

  // Semantic wrapper: links label to its edge via data-from/data-to
  return (
    `<g class="edge-label" data-from="${escapeAttr(edge.source)}" data-to="${escapeAttr(edge.target)}" data-label="${escapeAttr(label)}">\n` +
    `  ${halo}\n` +
    `  ${content.replace(/\n/g, '\n  ')}\n` +
    `</g>`
  )
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
function renderNode(node: PositionedNode, font: string, style: ResolvedRenderStyle): string {
  const shape = renderNodeShape(node, style)
  const label = renderNodeLabel(node, font, style)

  // Combine shape and label inside a semantic group
  // This enables reliable node identification without heuristics
  const parts: string[] = []
  // #81: append user-assigned Mermaid class names so external stylesheets can
  // target semantic node classes (e.g. `.hot { ... }`). Sanitize to valid CSS
  // identifier chars; structural `node` class always comes first.
  const userClasses = (node.classNames ?? [])
    .map(c => c.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
  const classAttr = ['node', ...userClasses].join(' ')
  parts.push(
    `<g class="${classAttr}" data-id="${escapeAttr(node.id)}" data-label="${escapeAttr(node.label)}" data-shape="${node.shape}">`
  )
  parts.push(`  ${shape.replace(/\n/g, '\n  ')}`)
  if (label) {
    parts.push(`  ${label.replace(/\n/g, '\n  ')}`)
  }
  parts.push('</g>')

  return parts.join('\n')
}

function renderNodeShape(node: PositionedNode, style: ResolvedRenderStyle): string {
  const { x, y, width, height, shape, inlineStyle } = node

  // Resolve fill and stroke — inline styles (from mermaid `style` directives)
  // override the CSS variable defaults. When no inline style is present, the
  // CSS variable handles theming automatically via color-mix() derivation.
  const fill = escapeAttr(inlineStyle?.fill ?? 'var(--_node-fill)')
  const stroke = escapeAttr(inlineStyle?.stroke ?? 'var(--_node-stroke)')
  const sw = escapeAttr(inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth))

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
    case 'rectangle':
    default:
      return renderRect(x, y, width, height, fill, stroke, sw, style.cornerRadius ?? 0)
  }
}

// --- Basic shapes ---

function renderRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, radius: number = 0): string {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderRoundedRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, radius: number = 6): string {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderStadium(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const r = h / 2
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderDiamond(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const hw = w / 2
  const hh = h / 2
  const points = [
    `${cx},${cy - hh}`,   // top
    `${cx + hw},${cy}`,   // right
    `${cx},${cy + hh}`,   // bottom
    `${cx - hw},${cy}`,   // left
  ].join(' ')

  return (
    `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

// --- Batch 1 shapes ---

/** Subroutine: rectangle with double vertical borders on left and right */
function renderSubroutine(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, radius: number = 0): string {
  const inset = 8 // distance from edge to inner vertical line
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + inset}" y1="${y}" x2="${x + inset}" y2="${y + h}" ` +
    `stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + w - inset}" y1="${y}" x2="${x + w - inset}" y2="${y + h}" ` +
    `stroke="${stroke}" stroke-width="${sw}" />`
  )
}

/** Double circle: two concentric circles with a gap between them */
function renderDoubleCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2
  const innerR = outerR - 5 // 5px gap between rings
  return (
    `<circle cx="${cx}" cy="${cy}" r="${outerR}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

/** Hexagon: 6-point polygon with flat top/bottom and angled sides */
function renderHexagon(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = h / 4 // horizontal inset for the angled sides
  const points = [
    `${x + inset},${y}`,           // top-left
    `${x + w - inset},${y}`,       // top-right
    `${x + w},${y + h / 2}`,       // mid-right
    `${x + w - inset},${y + h}`,   // bottom-right
    `${x + inset},${y + h}`,       // bottom-left
    `${x},${y + h / 2}`,           // mid-left
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

// --- Batch 2 shapes ---

/** Cylinder / database: top ellipse cap + body rect + bottom ellipse */
function renderCylinder(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const ry = 7 // ellipse vertical radius for the cap
  const cx = x + w / 2
  const bodyTop = y + ry
  const bodyH = h - 2 * ry

  return (
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
  )
}

/** Asymmetric / flag: rectangle with a pointed left edge */
function renderAsymmetric(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const indent = 12 // how far the point indents
  const points = [
    `${x + indent},${y}`,       // top-left (indented)
    `${x + w},${y}`,            // top-right
    `${x + w},${y + h}`,        // bottom-right
    `${x + indent},${y + h}`,   // bottom-left (indented)
    `${x},${y + h / 2}`,        // left point
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** Trapezoid [/text\]: wider bottom, narrower top */
function renderTrapezoid(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15 // top edge is narrower by this amount on each side
  const points = [
    `${x + inset},${y}`,         // top-left (indented)
    `${x + w - inset},${y}`,     // top-right (indented)
    `${x + w},${y + h}`,         // bottom-right (full width)
    `${x},${y + h}`,             // bottom-left (full width)
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** Trapezoid-alt [\text/]: wider top, narrower bottom */
function renderTrapezoidAlt(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15 // bottom edge is narrower
  const points = [
    `${x},${y}`,                     // top-left (full width)
    `${x + w},${y}`,                 // top-right (full width)
    `${x + w - inset},${y + h}`,     // bottom-right (indented)
    `${x + inset},${y + h}`,         // bottom-left (indented)
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** Parallelogram [/text/]: leans right (top edge shifted right) */
function renderLeanR(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15 // horizontal shear of the slanted sides
  const points = [
    `${x + inset},${y}`,             // top-left (shifted right)
    `${x + w},${y}`,                 // top-right (full width)
    `${x + w - inset},${y + h}`,     // bottom-right (shifted left)
    `${x},${y + h}`,                 // bottom-left (full width)
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** Parallelogram [\text\]: leans left (top edge shifted left) */
function renderLeanL(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15 // horizontal shear of the slanted sides
  const points = [
    `${x},${y}`,                     // top-left (full width)
    `${x + w - inset},${y}`,         // top-right (shifted left)
    `${x + w},${y + h}`,             // bottom-right (full width)
    `${x + inset},${y + h}`,         // bottom-left (shifted right)
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

// --- Batch 3: State diagram pseudostates ---

/** State start: small filled circle using primary text color */
function renderStateStart(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2 - 2
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--_text)" stroke="none" />`
}

/** State end: bullseye — outer ring + inner filled circle using primary text color */
function renderStateEnd(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2 - 2
  const innerR = outerR - 4
  return (
    `<circle cx="${cx}" cy="${cy}" r="${outerR}" ` +
    `fill="none" stroke="var(--_text)" stroke-width="${STROKE_WIDTHS.innerBox * 2}" />` +
    `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--_text)" stroke="none" />`
  )
}

// ============================================================================
// Node label rendering
// ============================================================================

function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  if (!match) return null
  const raw = match[1]!
  const full = raw.length === 3
    ? raw.split('').map(ch => ch + ch).join('')
    : raw
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

function parseRgbFunction(color: string): { r: number; g: number; b: number } | null {
  const match = color.match(/^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})/i)
  if (!match) return null
  const rgb = {
    r: Number.parseInt(match[1]!, 10),
    g: Number.parseInt(match[2]!, 10),
    b: Number.parseInt(match[3]!, 10),
  }
  return Object.values(rgb).every(v => v >= 0 && v <= 255) ? rgb : null
}

function contrastTextColor(fill: string): string | undefined {
  const rgb = parseHexToRgb(fill) ?? parseRgbFunction(fill)
  if (!rgb) return undefined
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000
  return brightness > 140 ? '#000000' : '#FFFFFF'
}

function nodeTextColor(node: PositionedNode): string {
  if (node.inlineStyle?.color) return node.inlineStyle.color
  if (node.inlineStyle?.fill) return contrastTextColor(node.inlineStyle.fill) ?? 'var(--_text)'
  return 'var(--_text)'
}

function renderNodeLabel(node: PositionedNode, font: string, style: ResolvedRenderStyle): string {
  // State pseudostates have no label
  if (node.shape === 'state-start' || node.shape === 'state-end') {
    if (!node.label) return ''
  }

  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2

  const textColor = escapeAttr(nodeTextColor(node))

  return renderMultilineText(
    node.label,
    cx,
    cy,
    style.nodeLabelFontSize,
    `text-anchor="middle" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${style.nodeLetterSpacing !== 0 ? ` letter-spacing="${style.nodeLetterSpacing}"` : ''} fill="${textColor}"`
  )
}

// ============================================================================
// Utilities
// ============================================================================

function transformText(text: string, transform: string | undefined): string {
  switch (transform?.toLowerCase()) {
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'capitalize':
      return text.replace(/\b\p{L}/gu, ch => ch.toUpperCase())
    default:
      return text
  }
}

/**
 * Escape a string for use as an XML/HTML attribute value.
 * Escapes quotes and ampersands to prevent attribute injection.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
