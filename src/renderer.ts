import { sceneLowering, type DrawingFactory, type DrawingDocument } from './scene/drawing.ts'
import { prepareDisplayText, resolveLabelContent } from './shared/display-text.ts'
import { graphTextBlock } from './graph-text.ts'
import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, PositionedStateNote, RenderContext, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from './theme.ts'
import { STROKE_WIDTHS, resolveRenderStyle, diagramTitleFields } from './styles.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import { escapeAttr, escapeDisplayAttr } from './multiline-utils.ts'
import { topRoundedRectPath } from './scene/svg-writer.ts'
import { resolveInlineNodeTextColor, toneOnFill } from './color-resolver.ts'
import type { ConnectorLabelDescriptor, MarkAttributes, MarkerDescriptor, SemanticChannels } from './scene/ir.ts'
import { sanitizeDisplayLines } from './shared/text-controls.ts'
import { iconFallbackToken } from './shared/icon-fallback.ts'
import { DefaultBackend } from './scene/backend.ts'
import type { ResolvedStateVisualConfig } from './state/config.ts'
import { resolveMindmapIcon } from './mindmap/icons.ts'
import { serializeMarkerResources } from './scene/marker-resources.ts'
import { flowchartMarkerResources, markerIdPrefix, markerSuffix, graphEdgePathProjection, graphEdgeDashArray } from './graph-connectors.ts'
export { compactSvg, namespaceSvgIds } from './svg-postprocess.ts'
import { paintsNodeFill, shapeOutline } from './shape-outline.ts'
import { LABEL_PILL_PADDING, labelHaloExtension } from './shared/edge-label-geometry.ts'
import { calculatePathMidpoint } from './layout/geometry.ts'

// ============================================================================
// SVG renderer — converts a PositionedGraph into an SVG string.
//
// One typed lowering draws native crisp fragments or the Scene tree consumed
// by styled backends, verification and inspection. Both use the same primitive
// fields and writers without re-parsing SVG.
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
 * Draw a positioned graph in canonical mark order for the selected consumer.
 */
export function lowerGraphDrawing<T>(
  marks: DrawingFactory<T>,
  ctx: RenderContext<PositionedGraph>,
  composition?: { surfaces?: boolean; edgeLabels?: boolean; beforeEdges?: () => T[] },
): DrawingDocument<T> {
  const { positioned: graph, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: T[] = []
  const stateVisual = (resolved.familyAppearance as { visual?: ResolvedStateVisualConfig } | undefined)?.visual
    ?? (options as RenderOptions & { stateVisual?: ResolvedStateVisualConfig }).stateVisual
  const style = resolveRenderStyle(options, stateVisual?.styleDefaults, resolved.styleFace)

  // SVG root with CSS variables + style block + defs
  parts.push(marks.documentOpen(
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
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) defsParts.push(shadowDefs)
  // Per-color arrow markers for edges with custom stroke via linkStyle
  const customStrokeColors = new Set<string>()
  const fixedMarkerColors = new Set<string | undefined>()
  if (style.edgeStrokeColor) customStrokeColors.add(style.edgeStrokeColor)
  let needsCircle = false
  let needsCross = false
  for (const edge of graph.edges) {
    if (edge.inlineStyle?.stroke) customStrokeColors.add(edge.inlineStyle.stroke)
    if (edge.inlineStyle?.['stroke-width']) fixedMarkerColors.add(edge.inlineStyle.stroke ?? style.edgeStrokeColor)
    if (edge.startMarker === 'circle' || edge.endMarker === 'circle') needsCircle = true
    if (edge.startMarker === 'cross' || edge.endMarker === 'cross') needsCross = true
  }
  const markerResources = flowchartMarkerResources(customStrokeColors, fixedMarkerColors, needsCircle, needsCross)
  defsParts.splice(1, 0, serializeMarkerResources(markerResources))
  defsParts.push('</defs>')
  parts.push(marks.definitions({ id: 'defs', markerResources }, defsParts.join('\n')))

  // 0. The diagram's frontmatter title, in the band layout reserved above.
  if (graph.title) parts.push(marks.text(diagramTitleFields(graph.title, style)))

  // 1. Subgraph backgrounds (group rectangles with header bands)
  for (const group of composition?.surfaces === false ? [] : graph.groups) {
    parts.push(renderGroup(marks, group, font, style))
  }

  if (composition?.beforeEdges) parts.push(...composition.beforeEdges())

  // 2. Edges (polylines — rendered behind nodes)
  // Each edge is a <polyline> with semantic data-* attributes. Its authored
  // edge id is its identity, unless a node or subgraph has that id too
  // (`A A@--> B`, which Mermaid accepts): that edge keeps its generated one.
  const nodeAndGroupIds = new Set(graph.nodes.map(node => node.id))
  const addGroupIds = (groups: readonly PositionedGroup[]): void => groups.forEach(group => { nodeAndGroupIds.add(group.id); addGroupIds(group.children) })
  addGroupIds(graph.groups)
  const edgeOccurrence = new Map<string, number>()
  const edgeSceneIds = new Map<PositionedEdge, string>()
  for (const edge of graph.edges) {
    if (edge.points.length < 2) continue
    const pairKey = `${edge.source}->${edge.target}`
    const k = edgeOccurrence.get(pairKey) ?? 0
    edgeOccurrence.set(pairKey, k + 1)
    const sceneId = `edge:${pairKey}#${k}`
    edgeSceneIds.set(edge, sceneId)
    const identity = edge.id !== undefined && !nodeAndGroupIds.has(edge.id) ? edge.id : sceneId
    parts.push(renderEdge(marks, edge, style, sceneId, identity, markerResources))
  }

  // 3. Edge labels (positioned at midpoint of edge)
  // Each label is wrapped in <g class="edge-label">
  for (const edge of graph.edges) {
    const connectorSceneId = edgeSceneIds.get(edge)
    if (composition?.edgeLabels !== false && edge.label && connectorSceneId) parts.push(renderEdgeLabel(marks, edge, font, style, connectorLabelSceneId(connectorSceneId)))
  }

  // 4. Nodes (shape + label wrapped in <g class="node">)
  for (const node of composition?.surfaces === false ? [] : graph.nodes) {
    parts.push(renderNode(marks, node, font, style, colors, options.security !== 'strict'))
  }

  // 5. State-diagram notes (placed by the layout pass on their declared side)
  for (const note of graph.notes ?? []) {
    parts.push(renderStateNote(marks, note, font, style))
  }

  parts.push(marks.documentClose())

  return { family: 'flowchart', width: graph.width, height: graph.height, colors, transparent, parts }
}

// ============================================================================
// Group rendering (subgraph backgrounds)
// ============================================================================

function renderGroup<T>(marks: DrawingFactory<T>, group: PositionedGroup, font: string, style: ResolvedRenderStyle, parentId?: string): T {
  // Concurrency regions (plan §State 2c) draw no box/header of their own —
  // the parent composite draws dashed separators between them instead. Nested
  // composites inside a region still render normally.
  if (group.concurrencyRegion) {
    return marks.group({
      id: `group:${group.id}`,
      role: 'group',
      open: `<g class="concurrency-region" data-id="${escapeAttr(group.id)}"${parentId ? ` data-parent-id="${escapeAttr(parentId)}"` : ''}>`,
      close: '</g>',
      children: group.children.map(child => ({ indent: 0, node: renderGroup(marks, child, font, style, group.id) })),
    })
  }

  const headerBlock = group.labelBlock ?? graphTextBlock(resolveLabelContent(group.label, group.labelContent), style, 'group')
  const headerHeight = group.headerHeight ?? style.groupHeaderFontSize + 16 + headerBlock.height - headerBlock.lineHeight
  const children: Array<{ node: T; indent: number }> = []

  // Opening <g> with semantic attributes for subgraph identification
  // data-id: original Mermaid subgraph ID
  // data-label: display label (may differ from ID)
  const open =
    `<g class="subgraph" data-id="${escapeAttr(group.id)}" data-region="subgraph" data-label="${escapeDisplayAttr(group.label)}"${parentId ? ` data-parent-id="${escapeAttr(parentId)}"` : ''}>`

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
    }),
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
    }),
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
      fontSize: style.groupHeaderFontSize,
      anchor: 'start',
      paint: { fill: headerTextColor },
    }),
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
      }),
    })
  }

  // Render nested groups recursively (inside this group)
  for (const child of group.children) {
    children.push({ indent: 0, node: renderGroup(marks, child, font, style, group.id) })
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

function renderStateNote<T>(marks: DrawingFactory<T>, note: PositionedStateNote, font: string, style: ResolvedRenderStyle): T {
  void font
  const { x, y, width: w, height: h } = note
  const rawFill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const rawStroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const rawTextColor = style.edgeTextColor ?? 'var(--_text-sec)'
  const textBlock = note.textBlock ?? graphTextBlock(resolveLabelContent(note.text, note.textContent), style, 'note')
  const displayText = textBlock.text
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
        }),
      },
      {
        indent: 2,
        node: marks.text({
          id: `${sceneId}:text`,
          role: 'label',
          text: displayText, block: textBlock,
          x: x + w / 2,
          y: y + h / 2,
          fontSize: style.edgeLabelFontSize,
          anchor: 'middle',
          paint: { fill: rawTextColor },
        }),
      },
    ],
  })
}

// ============================================================================
// Edge rendering
// ============================================================================

function renderEdge<T>(
  marks: DrawingFactory<T>,
  edge: PositionedEdge,
  style: ResolvedRenderStyle,
  sceneId: string,
  identityId: string,
  markerResources: readonly MarkerDescriptor[],
): T {
  const lineStyle = edge.style === 'dotted' ? 'dotted'
    : edge.style === 'thick' ? 'thick'
    : edge.style === 'invisible' ? 'invisible'
    : 'solid'
  const labelSceneId = connectorLabelSceneId(sceneId)
  const labelAnchor = edge.labelPosition ?? calculatePathMidpoint(edge.points)
  const labelTextColor = style.edgeTextColor ?? 'var(--_text-sec)'
  const labels: readonly ConnectorLabelDescriptor[] = edge.label ? [{
    id: `${sceneId}:label`,
    text: edge.label,
    textContent: { value: edge.label, prepared: prepareDisplayText(resolveLabelContent(edge.label, edge.labelContent)) },
    anchor: labelAnchor,
    paint: { fill: labelTextColor },
    fontSize: style.edgeLabelFontSize,
    textAnchor: 'middle',
    visual: { kind: 'companion', markId: `${labelSceneId}:text` },
  }] : []
  const authoredClassNames = (edge.classNames ?? [])
    .map(name => name.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
  const connectorSemantics = {
    identity: { id: identityId, ...(authoredClassNames.length ? { classNames: authoredClassNames } : {}) },
    endpoints: { from: edge.source, to: edge.target },
    relationship: {
      kind: 'flowchart-edge',
      direction: edge.source === edge.target ? 'self'
        : edge.hasArrowStart && edge.hasArrowEnd ? 'bidirectional'
          : edge.hasArrowStart ? 'reverse' : edge.hasArrowEnd ? 'forward' : 'undirected',
    },
    route: {
      ownership: 'layout',
      bendRadius: style.edgeBendRadius,
      labelAnchors: edge.labelPosition ? [edge.labelPosition] : [],
    },
    labels,
  } as const
  // Invisible links (~~~) shape the layout but draw no stroke or markers.
  if (edge.style === 'invisible') {
    return marks.connector({
      id: sceneId,
      role: 'edge',
      geometry: { kind: 'polyline', points: edge.points },
      lineStyle: 'invisible',
      paint: {},
      ...connectorSemantics,
    })
  }

  const pathProjection = graphEdgePathProjection(edge, style)
  // Section A output is static and active SVG is rejected in every security
  // mode. Preserve authored animation intent as typed metadata plus a stable
  // dashed projection; a future motion layer can consume the same metadata.
  const effectiveDashArray = graphEdgeDashArray(edge)
  const baseStrokeWidth = edge.style === 'thick' ? style.lineWidth * 2 : style.lineWidth
  const markerColor = edge.inlineStyle?.stroke ?? style.edgeStrokeColor

  // Color-specific markers when the edge has a custom stroke from linkStyle
  const suffix = `${markerColor ? `-${markerSuffix(markerColor)}` : ''}${edge.inlineStyle?.['stroke-width'] ? '-fixed' : ''}`
  let endMarker: MarkerDescriptor | undefined
  let startMarker: MarkerDescriptor | undefined
  if (edge.hasArrowEnd) {
    const prefix = markerIdPrefix(edge.endMarker ?? 'arrow')
    endMarker = markerResources.find(marker => marker.id === `${prefix}${suffix}`)
    if (!endMarker) throw new Error(`Missing marker resource "${prefix}${suffix}"`)
  }
  if (edge.hasArrowStart) {
    const prefix = markerIdPrefix(edge.startMarker ?? 'arrow')
    startMarker = markerResources.find(marker => marker.id === `${prefix}-start${suffix}`)
    if (!startMarker) throw new Error(`Missing marker resource "${prefix}-start${suffix}"`)
  }

  // Inspection hooks: the authored classes, and data-* attributes for the
  // edge style, arrow presence and markers, the label, curve and animation.
  // Identity (data-id from an authored v11.6 edge ID, data-from/data-to) comes
  // from the connector's typed identity.
  const attributes: MarkAttributes = {
    className: ['edge', ...authoredClassNames].join(' '),
    data: {
      style: edge.style,
      'arrow-start': String(edge.hasArrowStart),
      'arrow-end': String(edge.hasArrowEnd),
      ...(edge.hasArrowStart ? { 'marker-start': edge.startMarker ?? 'arrow' } : {}),
      ...(edge.hasArrowEnd ? { 'marker-end': edge.endMarker ?? 'arrow' } : {}),
      ...(edge.label ? { label: sanitizeDisplayLines(edge.label) } : {}),
      ...(edge.curve ? { curve: edge.curve } : {}),
      ...(edge.animate ? { animate: 'true', animation: edge.animation ?? 'slow' } : {}),
    },
  }

  const paint = {
    stroke: markerColor ?? 'var(--_line)',
    strokeWidth: edge.inlineStyle?.['stroke-width'] ?? String(baseStrokeWidth),
    ...(effectiveDashArray ? { strokeDasharray: effectiveDashArray } : {}),
  }

  if (style.edgeBendRadius > 0 || edge.curve) {
    if (!pathProjection) throw new Error(`Missing path projection for flowchart edge "${sceneId}"`)
    return marks.connector({
      id: sceneId,
      role: 'edge',
      geometry: pathProjection.geometry,
      lineStyle,
      paint,
      markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
      ...connectorSemantics,
      route: { ...connectorSemantics.route, contours: pathProjection.contours },
      attributes,
    })
  }

  return marks.connector({
    id: sceneId,
    role: 'edge',
    geometry: { kind: 'polyline', points: edge.points },
    lineStyle,
    paint,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    ...connectorSemantics,
    attributes,
  })
}

function connectorLabelSceneId(connectorSceneId: string): string {
  return connectorSceneId.startsWith('edge:')
    ? `edge-label:${connectorSceneId.slice('edge:'.length)}`
    : `${connectorSceneId}:label`
}

function renderEdgeLabel<T>(marks: DrawingFactory<T>, edge: PositionedEdge, font: string, style: ResolvedRenderStyle, sceneId: string): T {
  // Use layout-computed label position when available (layout-aware, avoids collisions).
  // Fall back to geometric midpoint of the edge polyline.
  const mid = edge.labelPosition ?? calculatePathMidpoint(edge.points)
  const block = edge.labelBlock ?? graphTextBlock(resolveLabelContent(edge.label!, edge.labelContent), style, 'edge')
  const label = block.text
  const padding = LABEL_PILL_PADDING
  const haloPadding = padding + labelHaloExtension(edge, style.lineWidth)

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
  })

  // Wrap in <g class="edge-label"> with reference to the edge it belongs to
  // The label's pill: the text's own band plus padding.
  const pillWidth = metrics.width + padding * 2
  const pillHeight = metrics.height + padding * 2
  const pill = marks.shape({
    id: `${sceneId}:pill`,
    role: 'chrome',
    geometry: { kind: 'rect', x: mid.x - pillWidth / 2, y: mid.y - pillHeight / 2, width: pillWidth, height: pillHeight, rx: 2, ry: 2 },
    paint: { fill: 'var(--bg)', stroke: 'var(--_inner-stroke)', strokeWidth: '1' },
  })
  const labelTextColor = style.edgeTextColor ?? 'var(--_text-sec)'
  const content = marks.text({
    id: `${sceneId}:text`,
    role: 'label',
    text: label, block,
    x: mid.x,
    y: mid.y,
    fontSize: style.edgeLabelFontSize,
    anchor: 'middle',
    paint: { fill: labelTextColor },
  })

  // Semantic wrapper: links label to its edge via data-from/data-to
  return marks.group({
    id: sceneId,
    role: 'edge-label',
    open: `<g class="edge-label" data-from="${escapeAttr(edge.source)}" data-to="${escapeAttr(edge.target)}" data-label="${escapeDisplayAttr(edge.label!)}">`,
    close: '</g>',
    children: [
      { indent: 2, node: halo },
      { indent: 2, node: pill },
      { indent: 2, node: content },
    ],
  })
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
function renderNode<T>(marks: DrawingFactory<T>, node: PositionedNode, font: string, style: ResolvedRenderStyle, colors: DiagramColors, includeInteraction: boolean): T {
  const shape = renderNodeShape(marks, node, style)
  const ink = nodeTextInk(node, style, colors)
  const label = renderNodeLabel(marks, node, font, style, ink)

  // Combine shape and label inside a semantic group
  // This enables reliable node identification without heuristics
  // #81: append user-assigned Mermaid class names so external stylesheets can
  // target semantic node classes (e.g. `.hot { ... }`). Sanitize to valid CSS
  // identifier chars; structural `node` class always comes first.
  const userClasses = (node.classNames ?? [])
    .map(c => c.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
  const classAttr = ['node', ...(node.shape === 'state-note' ? ['state-note'] : []), ...userClasses].join(' ')
  const channels: SemanticChannels | undefined =
    node.shape === 'state-start' ? { status: 'start' } :
    node.shape === 'state-end' ? { status: 'end' } :
    undefined

  const children: Array<{ node: T; indent: number }> = [{ indent: 2, node: shape }]
  const media = renderFlowchartMedia(marks, node, ink)
  if (media) children.push({ indent: 2, node: media })
  if (label) {
    children.push({ indent: 2, node: label })
  }
  // data-semantic-shape names the Mermaid v11 `@{ shape }` id when the drawn
  // geometry is a mapping of it, so agents can explain the semantic shape
  // even when the geometry is approximate (repo #44).
  const semanticShape = node.semanticShape ? ` data-semantic-shape="${escapeAttr(node.semanticShape)}"` : ''
  const interaction = includeInteraction && node.href ? ` data-href="${escapeAttr(node.href)}" role="link" tabindex="0"` : ''
  const floatingNote = node.floatingNoteId === undefined ? '' : ` data-floating-note-id="${escapeAttr(node.floatingNoteId)}"`
  return marks.group({
    id: `node:${node.id}`,
    role: node.shape === 'state-note' ? 'note' : 'node',
    open: `<g class="${classAttr}" data-id="${escapeAttr(node.id)}" data-label="${escapeDisplayAttr(node.label)}" data-shape="${node.shape}"${semanticShape}${interaction}${floatingNote}>`,
    close: '</g>',
    children,
    channels,
  })
}

function renderFlowchartMedia<T>(marks: DrawingFactory<T>, node: PositionedNode, ink: string): T | null {
  const size = Math.min(28, node.height * 0.4)
  const cx = node.x + node.width / 2
  const y = node.y + 6
  if (node.icon) {
    const glyph = resolveMindmapIcon(node.icon)
    if (glyph) {
      const scale = size / 24
      return marks.pathArtwork({ id: `node:${node.id}:icon`, paths: glyph.paths,
        owner: { id: node.id, role: 'node' },
        open: `<g class="flowchart-icon" data-icon="${escapeAttr(node.icon)}" transform="translate(${cx - size / 2} ${y}) scale(${scale})">`,
        transform: { kind: 'matrix', a: scale, b: 0, c: 0, d: scale, e: cx - size / 2, f: y },
        paint: { fill: ink, stroke: ink, strokeWidth: '0.8' },
      })
    }
    const token = iconFallbackToken(node.icon)
    return marks.text({ id: `node:${node.id}:icon`, role: 'icon', owner: { id: node.id, role: 'node' }, text: token,
      block: node.iconFallbackBlock,
      x: cx, y: y + size / 2, fontSize: 10, anchor: 'middle', paint: { fill: ink }, baselineShift: 0,
      attributes: { className: 'flowchart-icon-fallback', data: { icon: node.icon } } })
  }
  if (node.image) {
    const left = cx - size / 2
    const d = `M${left + 2} ${y + size * 0.66}L${left + size * 0.36} ${y + size * 0.36}L${left + size * 0.52} ${y + size * 0.5}L${left + size * 0.7} ${y + size * 0.32}L${left + size - 2} ${y + size * 0.66}`
    const paint = { fill: 'none', stroke: ink, strokeWidth: '1.2' }
    const owner = { id: node.id, role: 'node' as const }
    return marks.group({ id: `node:${node.id}:image`, role: 'icon', owner,
      open: `<g class="flowchart-image-placeholder" data-image-src="${escapeAttr(node.image)}">`, close: '</g>', join: '',
      children: [
        { indent: 0, node: marks.shape({ id: `node:${node.id}:image:frame`, role: 'icon', owner, geometry: { kind: 'rect', x: left, y, width: size, height: size * 0.72, rx: 2 }, paint }) },
        { indent: 0, node: marks.shape({ id: `node:${node.id}:image:sun`, role: 'icon', owner, geometry: { kind: 'circle', cx: left + size * 0.72, cy: y + size * 0.2, r: size * 0.08 }, paint }) },
        { indent: 0, node: marks.shape({ id: `node:${node.id}:image:landscape`, role: 'icon', owner, geometry: { kind: 'path', d }, paint }) },
      ],
    })
  }
  return null
}

function renderNodeShape<T>(marks: DrawingFactory<T>, node: PositionedNode, style: ResolvedRenderStyle): T {
  const { x, y, width, height, shape, inlineStyle } = node

  // Resolve fill and stroke — inline styles (from mermaid `style` directives)
  // override the CSS variable defaults. When no inline style is present, the
  // CSS variable handles theming automatically via color-mix() derivation.
  const fill = inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)'
  const stroke = inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
  const strokeWidth = inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth)
  const piece = shapeOutline(node, { fill, stroke, strokeWidth }, style.cornerRadius)

  return marks.shape({
    id: `node-shape:${node.id}`,
    role: node.shape === 'state-note' ? 'note' : 'node',
    geometry: piece.geometry,
    paint: piece.paint,
    ...(piece.childPaints ? { childPaints: piece.childPaints } : {}),
  })
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

function renderNodeLabel<T>(marks: DrawingFactory<T>, node: PositionedNode, font: string, style: ResolvedRenderStyle, rawTextColor: string): T | null {
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
    fontSize: style.nodeLabelFontSize,
    anchor: 'middle',
    paint: { fill: rawTextColor },
  })
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape a string for use as an XML/HTML attribute value.
 * Escapes quotes and ampersands to prevent attribute injection.
 */

export const lowerGraphScene = sceneLowering<PositionedGraph>(lowerGraphDrawing)
