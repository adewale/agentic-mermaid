/** Common graph document, route inputs and notes. C4 composes these without
 * importing generic graph node/group/media rendering. Geometry algorithms stay
 * in their existing owners; only the final Scene construction is shared here. */
import { prepareDisplayText, resolveLabelContent } from './shared/display-text.ts'
import { sanitizeDisplayLines } from './shared/text-controls.ts'
import { calculatePathMidpoint } from './layout/geometry.ts'
import { graphTextBlock } from './graph-text.ts'
import type { PositionedGraph, PositionedEdge, PositionedStateNote, Point, RenderContext, RenderOptions } from './types.ts'
import { STROKE_WIDTHS, FLOWCHART_DOTTED_DASH, resolveRenderStyle, diagramTitleMark } from './styles.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import type { ResolvedStateVisualConfig } from './state/config.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgGeometryField, type SvgPrimitiveEmission } from './scene/svg-emission.ts'
import type { ConnectorLabelDescriptor, MarkAttributes, MarkerDescriptor, SceneNode } from './scene/ir.ts'
import * as marks from './scene/marks.ts'
import { flowchartMarkerResources, markerIdPrefix, markerSuffix, graphEdgePathProjection } from './graph-connectors.ts'

export const PAINT_ATTRIBUTES: readonly SvgAttribute[] = [
  { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
]
export function primitive(fields: readonly SvgGeometryField[], before: readonly SvgAttribute[] = [], after: readonly SvgAttribute[] = PAINT_ATTRIBUTES, close: ' />' | '/>' = ' />') {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', close, attributes: [
    ...before, ...fields.map(name => ({ name, value: v.geometry(name) })), ...after,
  ] })
}
export const RECT_EMISSION = primitive(['x', 'y', 'width', 'height', 'rx', 'ry'])

export const LABEL_ATTRIBUTES: readonly SvgAttribute[] = [
  { name: 'text-anchor', value: v.text('anchor') }, { name: 'font-size', value: v.text('fontSize') },
  { name: 'font-weight', value: v.text('fontWeight') }, { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
  { name: 'fill', value: v.paint('fill') },
]
export const LABEL_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: LABEL_ATTRIBUTES })
const EMPTY_EMISSION = snapshotSvgEmissionRecipe({ kind: 'sequence', children: [], join: '' })

/** Common document furniture, independent of a family's surfaces and labels. */
export function graphSceneShell(ctx: RenderContext<PositionedGraph>) {
  const { positioned: graph, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: SceneNode[] = []
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
    { kind: 'prelude', width: graph.width, height: graph.height, colors, transparent, font, hasMonoFont: false,
      children: [{ kind: 'sharedStyle' }],
    },
  ))
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
  parts.push(marks.definitions({ id: 'defs', markerResources }, {
    kind: 'resources', resources: ['markers', ...(colors.shadow ? [{ kind: 'shadow' as const, colors }] : [])],
  }))

  // 0. The diagram's frontmatter title, in the band layout reserved above.
  if (graph.title) parts.push(diagramTitleMark(graph.title, style))

  return { opening: parts, font, transparent, style, markerResources }
}


export function renderGraphSceneNote(note: PositionedStateNote, font: string, style: ResolvedRenderStyle): SceneNode {
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
    emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta('state-note') }, { name: 'data-id', value: v.meta(note.id) },
      { name: 'data-target', value: v.meta(note.target) }, { name: 'data-side', value: v.meta(note.side) },
    ] },
    children: [
      {
        indent: 2,
        node: marks.shape({
          id: `${sceneId}:rect`,
          role: 'note',
          geometry: { kind: 'rect', x, y, width: w, height: h, rx: 4, ry: 4 },
          paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(STROKE_WIDTHS.innerBox) },
        }, RECT_EMISSION),
      },
      {
        indent: 2,
        node: marks.text({
          id: `${sceneId}:text`,
          role: 'label',
          text: displayText, block: textBlock,
          x: x + w / 2,
          y: y + h / 2,
          fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing,
          anchor: 'middle',
          paint: { fill: rawTextColor },
        }, LABEL_EMISSION),
      },
    ],
  })
}


/** Common routed semantics before a family constructs its final connector. */
export function graphEdgeFields(
  edge: PositionedEdge,
  style: ResolvedRenderStyle,
  sceneId: string,
  markerResources: readonly MarkerDescriptor[],
): marks.ConnectorFields {
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
    identity: { id: edge.id ?? sceneId, ...(authoredClassNames.length ? { classNames: authoredClassNames } : {}) },
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
    return {
      id: sceneId,
      role: 'edge',
      geometry: { kind: 'polyline', points: edge.points },
      lineStyle: 'invisible',
      paint: {},
      ...connectorSemantics,
    }
  }

  const pathProjection = graphEdgePathProjection(edge, style)
  // Section A output is static and active SVG is rejected in every security
  // mode. Preserve authored animation intent as typed metadata plus a stable
  // dashed projection; a future motion layer can consume the same metadata.
  const effectiveDashArray = edge.style === 'dotted'
    ? `${FLOWCHART_DOTTED_DASH.dash} ${FLOWCHART_DOTTED_DASH.gap}`
    : edge.animate ? '8 4' : undefined
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

  const paint = {
    stroke: markerColor ?? 'var(--_line)',
    strokeWidth: edge.inlineStyle?.['stroke-width'] ?? String(baseStrokeWidth),
    ...(effectiveDashArray ? { strokeDasharray: effectiveDashArray } : {}),
  }
  if (style.edgeBendRadius > 0 || edge.curve) {
    if (!pathProjection) throw new Error(`Missing path projection for flowchart edge "${sceneId}"`)
    return {
      id: sceneId, role: 'edge', geometry: pathProjection.geometry, lineStyle, paint,
      markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
      ...connectorSemantics, route: { ...connectorSemantics.route, contours: pathProjection.contours },
    }
  }
  return {
    id: sceneId, role: 'edge', geometry: { kind: 'polyline', points: edge.points }, lineStyle, paint,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    ...connectorSemantics,
  }
}


/** Generic graph lexical presentation; C4 supplies its own final recipe. */
export function renderGraphEdgeFields(edge: PositionedEdge, fields: marks.ConnectorFields): SceneNode {
  return emitGraphEdgeFields(edge, fields)
}

/** One lowering owns at most32 immutable common-presentation programs. */
export function createGraphEdgeEmitter(): typeof renderGraphEdgeFields {
  const programs = new Map<number, SvgPrimitiveEmission>()
  return (edge, fields) => emitGraphEdgeFields(edge, fields, programs)
}

function emitGraphEdgeFields(edge: PositionedEdge, fields: marks.ConnectorFields, programs?: Map<number, SvgPrimitiveEmission>): SceneNode {
  if (fields.lineStyle === 'invisible') return marks.connector(fields, EMPTY_EMISSION)
  const startMarker = fields.markers?.start, endMarker = fields.markers?.end
  // Semantic data attributes for edge identification and inspection:
  // - class="edge": CSS targeting and type identification
  // - data-id: authored v11.6 edge ID (`e1@-->`) when present — the stable
  //   edge identity contract (X4), mirroring node/subgraph data-id
  // - data-from/data-to: source and target node IDs
  // - data-style: edge style (solid, dotted, thick)
  // - data-arrow-start/end: arrow presence flags
  // - data-label: edge label if present (for quick lookup without traversing DOM)
  // Values remain per-connector projections. The key covers every lexical
  // choice in this common presentation; uncommon authored options are uncached.
  const profile = programs && (fields.identity?.classNames?.length ?? 0) === 0
    && edge.curve === undefined && (edge.animate === undefined || edge.animate === false)
    ? (fields.geometry.kind === 'path' ? 1 : 0) | (edge.id ? 2 : 0) | (edge.label ? 4 : 0)
      | (startMarker ? 8 : 0) | (endMarker ? 16 : 0)
    : undefined
  const cached = profile === undefined ? undefined : programs!.get(profile)
  let emission = cached
  if (!emission) {
    const attributes: SvgAttribute[] = [
      { name: 'class', value: v.meta(['edge', ...(fields.identity?.classNames ?? [])].join(' ')) },
      ...(edge.id ? [{ name: 'data-id' as const, value: v.identity('id') }] : []),
      { name: 'data-style', value: v.connector('lineStyle') },
      { name: 'data-arrow-start', value: v.connector('hasMarkerStart') }, { name: 'data-arrow-end', value: v.connector('hasMarkerEnd') },
      ...(edge.hasArrowStart ? [{ name: 'data-marker-start' as const, value: v.connector('markerStartShape') }] : []),
      ...(edge.hasArrowEnd ? [{ name: 'data-marker-end' as const, value: v.connector('markerEndShape') }] : []),
      ...(edge.label ? [{ name: 'data-label' as const, value: { source: 'connectorLabel' as const, index: 0 }, display: true }] : []),
      ...(edge.curve ? [{ name: 'data-curve' as const, value: v.meta(edge.curve) }] : []),
      ...(edge.animate ? [{ name: 'data-animate' as const, value: v.meta(true) }, { name: 'data-animation' as const, value: v.meta(edge.animation ?? 'slow') }] : []),
      { name: fields.geometry.kind === 'path' ? 'd' : 'points', value: v.geometry(fields.geometry.kind === 'path' ? 'd' : 'points') },
      ...PAINT_ATTRIBUTES, { name: 'stroke-dasharray', value: v.paint('strokeDasharray') },
      ...(endMarker ? [{ name: 'marker-end' as const, value: { source: 'marker' as const, position: 'end' as const } }] : []),
      ...(startMarker ? [{ name: 'marker-start' as const, value: { source: 'marker' as const, position: 'start' as const } }] : []),
    ]
    const draft: SvgPrimitiveEmission = { kind: 'primitive', attributes }
    emission = profile === undefined ? draft : snapshotSvgEmissionRecipe(draft) as SvgPrimitiveEmission
  }
  // Inspection hooks: the authored classes, and data-* attributes for the
  // edge style, arrow presence and markers, the label, curve and animation.
  // Identity (data-id from an authored v11.6 edge ID, data-from/data-to) comes
  // from the connector's typed identity.
  const markAttributes: MarkAttributes = {
    className: ['edge', ...(fields.identity?.classNames ?? [])].join(' '),
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

  const connector = marks.connector({ ...fields, attributes: markAttributes }, emission)
  // Failed normalization never populates the request-local table.
  if (profile !== undefined && !cached) programs!.set(profile, emission)
  return connector
}


export function connectorLabelSceneId(connectorSceneId: string): string {
  return connectorSceneId.startsWith('edge:')
    ? `edge-label:${connectorSceneId.slice('edge:'.length)}`
    : `${connectorSceneId}:label`
}


export function edgeMidpoint(points: Point[]): Point {
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
