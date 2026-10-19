import type {
  PositionedArchitectureDiagram,
  PositionedArchitectureEdge,
  PositionedArchitectureGroup,
  PositionedArchitectureJunction,
  PositionedArchitectureService,
} from './types.ts'
import type { ArchitectureVisualConfig } from './config.ts'
import { ARCHITECTURE_GROUP_ICON_TITLE_OFFSET, DEFAULT_ARCHITECTURE_VISUAL } from './config.ts'
import { ARCHITECTURE_TITLE_FONT_SIZE, ARCHITECTURE_TITLE_FONT_WEIGHT, edgeMidpoint } from './layout.ts'
import type { RenderContext } from '../types.ts'
import { resolvedColorValue, type DiagramColors } from '../theme.ts'
import { toneOnFill } from '../color-resolver.ts'
import { mixHex } from '../shared/color-math.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { fallbackIconGlyph, normalizeIconName } from './icon-layout.ts'
import { topRoundedRectPath } from '../svg-paths.ts'
import type { Geometry, MarkPaint, MarkerDescriptor, SceneDoc, SceneNode, SceneOwner, SceneTransform } from '../scene/ir.ts'
import { semanticChildId } from '../scene/identity.ts'
import { hashId } from '../scene/seed.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveArchitectureIcon } from './icons.ts'
import { tipAnchoredArrow } from '../scene/marker-resources.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgEmissionRecipe, type SvgGeometryField, type SvgPrimitiveEmission } from '../scene/svg-emission.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'

// ============================================================================
// Architecture renderer — lowers a PositionedArchitectureDiagram to the
// SceneGraph IR (SPEC §3.1) and serializes it via the DefaultBackend.
//
// Mark constructors attach bounded typed presentation recipes while the
// Scene document remains the semantic authority.
// ============================================================================

function primitive(className: string, geometry: readonly SvgGeometryField[]): SvgPrimitiveEmission {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
    { name: 'class', value: v.meta(className) }, ...geometry.map(name => ({ name, value: v.geometry(name) })),
  ] }) as SvgPrimitiveEmission
}
const ROUND_RECT_FIELDS = ['x', 'y', 'width', 'height', 'rx', 'ry'] as const
const CIRCLE_FIELDS = ['cx', 'cy', 'r'] as const
const GROUP_FRAME_EMISSION = primitive('architecture-group-frame', ROUND_RECT_FIELDS)
const GROUP_BAND_EMISSION = primitive('architecture-group-band', ['d'])
const GROUP_OUTLINE_EMISSION = primitive('architecture-group-outline', ROUND_RECT_FIELDS)
const SERVICE_CARD_EMISSION = primitive('architecture-service-card', ROUND_RECT_FIELDS)
const SERVICE_OUTLINE_EMISSION = primitive('architecture-service-outline', ROUND_RECT_FIELDS)
const JUNCTION_RING_EMISSION = primitive('architecture-junction-ring', CIRCLE_FIELDS)
const JUNCTION_CORE_EMISSION = primitive('architecture-junction-core', CIRCLE_FIELDS)
const MARKER_EMISSION = snapshotSvgEmissionRecipe({ kind: 'resources', resources: ['markers'] })
const EDGE_LABEL_BG_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  ...(['x', 'y', 'width', 'height'] as const).map(name => ({ name, value: v.geometry(name) })),
  { name: 'class', value: v.meta('architecture-edge-label-bg') }, { name: 'rx', value: v.geometry('rx') }, { name: 'ry', value: v.geometry('ry') },
] })
function textAttributes(className: string, fill = false): SvgAttribute[] {
  return [
    { name: 'class', value: v.meta(className) }, { name: 'text-anchor', value: v.text('anchor') },
    { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') },
    ...(fill ? [{ name: 'fill' as const, value: v.paint('fill') }] : []),
  ]
}
const TITLE_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: textAttributes('architecture-title', true) })
const SERVICE_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...textAttributes('architecture-service-label'), { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
] })
const EDGE_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...textAttributes('architecture-edge-label-text'), { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
] })
const ICON_EMISSIONS = {
  path: primitive('architecture-icon-mark', ['d']), circle: primitive('architecture-icon-mark', CIRCLE_FIELDS),
  ellipse: primitive('architecture-icon-mark', ['cx', 'cy', 'rx', 'ry']), rect: primitive('architecture-icon-mark', ROUND_RECT_FIELDS),
}
const ICON_GLYPH_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  { name: 'class', value: v.meta('architecture-icon-glyph') }, { name: 'd', value: v.geometry('d') },
  { name: 'transform', value: { source: 'transform', form: 'translate-scale-space' } },
] }) as SvgPrimitiveEmission
const FALLBACK_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  { name: 'class', value: v.meta('architecture-icon-glyph architecture-icon-fallback') }, { name: 'data-fallback', value: v.meta(true) },
  { name: 'text-anchor', value: v.text('anchor') }, { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') },
] })

/**
 * Render a positioned architecture diagram as SVG.
 */
export function renderArchitectureSvg(
  ctx: RenderContext<PositionedArchitectureDiagram>,
): string {
  return DefaultBackend.render(lowerArchitectureScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned architecture diagram to the SceneGraph IR in canonical mark order.
 */
export function lowerArchitectureScene(
  ctx: RenderContext<PositionedArchitectureDiagram>,
): SceneDoc {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const visual: ArchitectureVisualConfig = {
    ...DEFAULT_ARCHITECTURE_VISUAL,
    ...((resolved.familyAppearance as { visual?: ArchitectureVisualConfig } | undefined)?.visual
      ?? options.architecture?.visual),
  }
  const parts: SceneNode[] = []
  const archVars = [
    visual.groupSurface ? `--arch-group-fill:${visual.groupSurface}` : '',
    visual.groupHeaderSurface ? `--arch-group-band:${visual.groupHeaderSurface}` : '',
    visual.groupBorder ? `--arch-group-stroke:${visual.groupBorder}` : '',
    visual.groupText ? `--arch-group-label:${visual.groupText}` : '',
    visual.serviceSurface ? `--arch-service-fill:${visual.serviceSurface}` : '',
    visual.serviceBorder ? `--arch-service-stroke:${visual.serviceBorder}` : '',
    visual.serviceText ? `--arch-service-label:${visual.serviceText}` : '',
    visual.edgeStroke ? `--arch-edge-stroke:${visual.edgeStroke}` : '',
    visual.edgeText ? `--arch-edge-label:${visual.edgeText}` : '',
  ].filter(Boolean).join(';')
  const labels = labelPaints(visual, colors)

  const accessibleTitle = diagram.accessibilityTitle ?? diagram.title?.text
  const hasTitle = Boolean(accessibleTitle)
  const hasDesc = Boolean(diagram.accessibilityDescription)
  const uid = `arch-${hashId(diagram.width, diagram.height, diagram.title?.text ?? '', diagram.services.map(s => s.id).join(','), diagram.groups.map(g => g.id).join(','))}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const a11yAttrs: Record<string, string | undefined> = {}
  if (hasTitle || hasDesc) {
    a11yAttrs['role'] = 'img'
    a11yAttrs['aria-roledescription'] = 'architecture'
  }
  if (hasTitle) a11yAttrs['aria-labelledby'] = titleId
  if (hasDesc) a11yAttrs['aria-describedby'] = descId

  // Document shell: SVG open tag, accessibility elements, shared style block,
  // and architecture CSS in canonical order.
  const archCss = architectureStyles(visual, labels)
  parts.push(marks.documentOpen({
    id: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: false, extraCss: archCss,
  }, { kind: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: false,
    extraStyle: archVars,
    attributes: Object.entries(a11yAttrs).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => ({ name: name as SvgAttribute['name'], value: v.meta(value) })),
    children: [
      ...(hasTitle ? [{ kind: 'documentText' as const, element: 'title' as const, domId: titleId, text: accessibleTitle! }] : []),
      ...(hasDesc ? [{ kind: 'documentText' as const, element: 'desc' as const, domId: descId, text: diagram.accessibilityDescription! }] : []),
      { kind: 'sharedStyle', shadow: false }, { kind: 'stylesheet', css: archCss },
    ],
  }))

  parts.push(marks.definitions({ id: 'defs', markerResources: ARCHITECTURE_MARKERS }, MARKER_EMISSION))

  if (diagram.title) {
    parts.push(marks.text({
      id: 'title',
      role: 'title',
      text: diagram.title.text,
      x: diagram.title.x,
      y: diagram.title.y,
      fontSize: ARCHITECTURE_TITLE_FONT_SIZE, fontWeight: ARCHITECTURE_TITLE_FONT_WEIGHT,
      block: diagram.title.block,
      anchor: 'middle',
      paint: { fill: 'var(--arch-service-label, var(--_text))' },
    }, TITLE_EMISSION))
  }

  for (const group of diagram.groups) {
    parts.push(lowerGroup(group, visual, labels))
  }

  const edgeOccurrence = new Map<string, number>()
  for (const edge of diagram.edges) {
    const pairKey = `${edge.source.id}->${edge.target.id}`
    const k = edgeOccurrence.get(pairKey) ?? 0
    edgeOccurrence.set(pairKey, k + 1)
    parts.push(lowerEdge(edge, visual, `edge:${pairKey}#${k}`))
  }

  const labelOccurrence = new Map<string, number>()
  for (const edge of diagram.edges) {
    if (!edge.label) continue
    const pairKey = `${edge.source.id}->${edge.target.id}`
    const k = labelOccurrence.get(pairKey) ?? 0
    labelOccurrence.set(pairKey, k + 1)
    // The string renderer emitted "<rect bg>\n<text>" as one part; two flat
    // marks joined with '\n' by the backend produce the same bytes.
    for (const mark of lowerEdgeLabel(edge, visual, `edge-label:${pairKey}#${k}`)) {
      parts.push(mark)
    }
  }

  for (const junction of diagram.junctions) {
    parts.push(lowerJunction(junction, visual))
  }

  for (const service of diagram.services) {
    parts.push(lowerService(service, visual, labels))
  }

  parts.push(marks.documentClose())

  return { family: 'architecture', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

interface ArchitectureLabelPaints { group: string; service: string }

/** Paints for group and service labels. A label color set through the
 *  visual config (`--arch-group-label`, `--arch-service-label`) wins; the
 *  theme tone it falls back to is inked against the band or card the label
 *  sits on, whose fill a custom surface can put far from the page the tones
 *  are repaired against. The fills mirror architectureStyles(). */
function labelPaints(visual: ArchitectureVisualConfig, colors: DiagramColors): ArchitectureLabelPaints {
  const page = resolvedColorValue('var(--bg)', colors)
  const nodeFill = resolvedColorValue('var(--_node-fill)', colors)
  const groupFill = page ? resolvedColorValue(visual.groupSurface ?? page, colors) : undefined
  const edge = resolvedColorValue(visual.edgeStroke ?? 'var(--_arrow)', colors)
  const band = visual.groupHeaderSurface ?? (groupFill && edge ? mixHex(edge, groupFill, 5) : undefined)
  const card = visual.serviceSurface ?? (page && nodeFill ? mixHex(nodeFill, page, 92) : undefined)
  return {
    group: `var(--arch-group-label, ${band ? toneOnFill('var(--_text-sec)', band, colors) : 'var(--_text-sec)'})`,
    service: `var(--arch-service-label, ${card ? toneOnFill('var(--_text)', card, colors) : 'var(--_text)'})`,
  }
}

function architectureStyles(visual: ArchitectureVisualConfig, labels: ArchitectureLabelPaints): string {
  return `
  .architecture-group-frame { fill: var(--arch-group-fill, color-mix(in srgb, var(--_node-fill) 82%, var(--bg))); stroke: none; }
  .architecture-group-band { fill: var(--arch-group-band, color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 5%, var(--arch-group-fill, var(--bg)))); stroke: none; }
  .architecture-group-outline { fill: none; stroke: var(--arch-group-stroke, var(--_node-stroke)); stroke-width: ${visual.groupLineWidth}; }
  .architecture-group-label { fill: ${labels.group}; }
  .architecture-service-card { fill: var(--arch-service-fill, color-mix(in srgb, var(--_node-fill) 92%, var(--bg))); stroke: none; }
  .architecture-service-outline { fill: none; stroke: var(--arch-service-stroke, var(--_node-stroke)); stroke-width: ${visual.serviceLineWidth}; }
  .architecture-service-label { fill: ${labels.service}; }
  .architecture-edge { fill: none; stroke: var(--arch-edge-stroke, var(--_line)); stroke-width: ${visual.edgeLineWidth}; stroke-linejoin: round; }
  .architecture-edge-label-bg { fill: color-mix(in srgb, var(--bg) 90%, var(--_group-hdr)); stroke: color-mix(in srgb, var(--arch-edge-stroke, var(--_line)) 18%, var(--bg)); stroke-width: 0.75; }
  .architecture-edge-label-text { fill: var(--arch-edge-label, var(--_text-muted)); }
  .architecture-junction-ring { fill: var(--bg); stroke: var(--arch-edge-stroke, var(--_arrow)); stroke-width: 1.25; }
  .architecture-junction-core { fill: color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 24%, var(--bg)); stroke: var(--arch-edge-stroke, var(--_arrow)); stroke-width: 0.75; }
  .architecture-icon-mark { fill: none; stroke: var(--arch-edge-stroke, var(--_arrow)); stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
  .architecture-icon-glyph { fill: var(--arch-edge-stroke, var(--_arrow)); }
`
}

function lowerGroup(group: PositionedArchitectureGroup, visual: ArchitectureVisualConfig, labels: ArchitectureLabelPaints): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []
  const emission = { kind: 'group' as const, attributes: [
    { name: 'class' as const, value: v.meta('architecture-group') }, { name: 'data-id' as const, value: v.meta(group.id) },
    { name: 'data-label' as const, value: v.meta(group.label), display: true },
  ] }

  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-frame:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: visual.groupCornerRadius, ry: visual.groupCornerRadius },
      paint: { fill: 'var(--arch-group-fill, color-mix(in srgb, var(--_node-fill) 82%, var(--bg)))', stroke: 'none' },
    },
      GROUP_FRAME_EMISSION),
  })

  const bandPath = topRoundedRectPath(group.x, group.y, group.width, group.headerHeight ?? visual.groupHeaderHeight, visual.groupCornerRadius)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-band:${group.id}`,
      role: 'group-header',
      geometry: { kind: 'path', d: bandPath },
      paint: { fill: 'var(--arch-group-band, color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 5%, var(--arch-group-fill, var(--bg))))', stroke: 'none' },
    },
      GROUP_BAND_EMISSION),
  })

  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-outline:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: visual.groupCornerRadius, ry: visual.groupCornerRadius },
      paint: { fill: 'none', stroke: 'var(--arch-group-stroke, var(--_node-stroke))', strokeWidth: String(visual.groupLineWidth) },
    },
      GROUP_OUTLINE_EMISSION),
  })

  if (group.icon) {
    // The string renderer indented only the first line of the multi-line icon
    // chunk (`parts.push(`  ${renderIcon(...)}`)`), so the two-space prefix is
    // baked into the raw crisp instead of using the group's indent machinery
    // (which indents every line).
    children.push({
      indent: 0,
      node: renderIcon(group.x + 10, group.y + 6, visual.iconSize, group.icon, true, `icon:${group.id}`, { id: group.id, role: 'group' }, group.iconFallbackBlock),
    })
  }

  const block = group.labelBlock ?? preparePixelText(group.label, { display: 'formatted', transform: visual.groupTextTransform, fontSize: visual.groupFontSize, fontWeight: visual.groupFontWeight, letterSpacing: visual.groupLetterSpacing, fontFamily: visual.groupFont })
  const labelText = block.text
  const labelX = group.x + (group.icon ? ARCHITECTURE_GROUP_ICON_TITLE_OFFSET : visual.groupLabelPaddingX)
  const labelY = group.y + (group.headerHeight ?? visual.groupHeaderHeight) / 2
  children.push({
    indent: 2,
    node: marks.text({
      id: `group-label:${group.id}`,
      role: 'label',
      text: labelText,
      x: labelX,
      y: labelY,
      fontSize: visual.groupFontSize, fontWeight: visual.groupFontWeight, letterSpacing: visual.groupLetterSpacing,
      block,
      anchor: 'start',
      paint: { fill: labels.group },
    }, { kind: 'text', layout: 'multiline', attributes: [
      ...textAttributes('architecture-group-label'), ...(visual.groupFont ? [{ name: 'font-family' as const, value: v.meta(visual.groupFont) }] : []),
      { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
    ] }),
  })

  for (const child of group.children) {
    children.push({ indent: 0, node: lowerGroup(child, visual, labels) })
  }

  return marks.group({
    id: `group:${group.id}`,
    role: 'group',
    emission,
    children,
  })
}

function lowerService(service: PositionedArchitectureService, visual: ArchitectureVisualConfig, labels: ArchitectureLabelPaints): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []
  const hasIcon = Boolean(service.icon)
  const iconX = service.x + visual.servicePaddingX
  const iconY = service.y + service.height / 2 - visual.serviceIconSize / 2
  const labelX = service.labelPosition?.x ?? (hasIcon
    ? iconX + visual.serviceIconSize + Math.max(10, visual.servicePaddingX * 0.7)
    : service.x + visual.servicePaddingX)

  const emission = { kind: 'group' as const, attributes: [
    { name: 'class' as const, value: v.meta('architecture-service') }, { name: 'data-id' as const, value: v.meta(service.id) },
    { name: 'data-label' as const, value: v.meta(service.label), display: true },
  ] }

  children.push({
    indent: 2,
    node: marks.shape({
      id: `service-card:${service.id}`,
      role: 'service',
      geometry: { kind: 'rect', x: service.x, y: service.y, width: service.width, height: service.height, rx: visual.serviceCornerRadius, ry: visual.serviceCornerRadius },
      paint: { fill: 'var(--arch-service-fill, color-mix(in srgb, var(--_node-fill) 92%, var(--bg)))', stroke: 'none' },
    },
      SERVICE_CARD_EMISSION),
  })

  children.push({
    indent: 2,
    node: marks.shape({
      id: `service-outline:${service.id}`,
      role: 'service',
      geometry: { kind: 'rect', x: service.x, y: service.y, width: service.width, height: service.height, rx: visual.serviceCornerRadius, ry: visual.serviceCornerRadius },
      paint: { fill: 'none', stroke: 'var(--arch-service-stroke, var(--_node-stroke))', strokeWidth: String(visual.serviceLineWidth) },
    },
      SERVICE_OUTLINE_EMISSION),
  })

  if (service.icon) {
    // Same first-line-only indent as group icons (see lowerGroup).
    children.push({
      indent: 0,
      node: renderIcon(iconX, iconY, visual.serviceIconSize, service.icon, false, `icon:${service.id}`, { id: service.id, role: 'service' }, service.iconFallbackBlock),
    })
  }

  const labelY = service.labelPosition?.y ?? service.y + service.height / 2
  const block = service.labelBlock ?? preparePixelText(service.label, { display: 'formatted', transform: visual.serviceTextTransform, fontSize: visual.serviceFontSize, fontWeight: visual.serviceFontWeight, letterSpacing: visual.serviceLetterSpacing })
  const labelText = block.text
  children.push({
    indent: 2,
    node: marks.text({
      id: `service-label:${service.id}`,
      role: 'label',
      text: labelText,
      x: labelX,
      y: labelY,
      fontSize: visual.serviceFontSize, fontWeight: visual.serviceFontWeight, letterSpacing: visual.serviceLetterSpacing,
      block,
      anchor: 'start',
      paint: { fill: labels.service },
    }, SERVICE_TEXT_EMISSION),
  })

  return marks.group({
    id: `service:${service.id}`,
    role: 'service',
    emission,
    children,
  })
}

function lowerJunction(junction: PositionedArchitectureJunction, visual: ArchitectureVisualConfig): SceneNode {
  const cx = junction.x + junction.width / 2
  const cy = junction.y + junction.height / 2

  const ring = marks.shape({
    id: `junction-ring:${junction.id}`,
    role: 'junction',
    geometry: { kind: 'circle', cx, cy, r: visual.junctionOuterRadius },
    paint: { fill: 'var(--bg)', stroke: 'var(--arch-edge-stroke, var(--_arrow))', strokeWidth: '1.25' },
  }, JUNCTION_RING_EMISSION)
  const core = marks.shape({
    id: `junction-core:${junction.id}`,
    role: 'junction',
    geometry: { kind: 'circle', cx, cy, r: visual.junctionInnerRadius },
    paint: { fill: 'color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 24%, var(--bg))', stroke: 'var(--arch-edge-stroke, var(--_arrow))', strokeWidth: '0.75' },
  }, JUNCTION_CORE_EMISSION)
  return marks.group({
    id: `junction:${junction.id}`,
    role: 'junction',
    emission: { kind: 'group', attributes: [{ name: 'class', value: v.meta('architecture-junction') }, { name: 'data-id', value: v.meta(junction.id) }] },
    children: [
      { indent: 2, node: ring },
      { indent: 2, node: core },
    ],
  })
}

function lowerEdge(edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig, sceneId: string): SceneNode {
  const startMarker = edge.hasArrowStart ? ARCHITECTURE_MARKERS[1] : undefined
  const endMarker = edge.hasArrowEnd ? ARCHITECTURE_MARKERS[0] : undefined
  const attributes: SvgAttribute[] = [
    { name: 'class', value: v.meta('architecture-edge') }, { name: 'data-from', value: v.identity('from') }, { name: 'data-to', value: v.identity('to') },
    { name: 'data-from-side', value: v.meta(edge.source.side) }, { name: 'data-to-side', value: v.meta(edge.target.side) },
    { name: 'data-from-boundary', value: v.meta(edge.source.boundary) }, { name: 'data-to-boundary', value: v.meta(edge.target.boundary) },
    ...(edge.label ? [{ name: 'data-label' as const, value: { source: 'connectorLabel' as const, index: 0 }, display: true }] : []),
  ]
  const emission = (field: 'd' | 'points'): SvgEmissionRecipe => ({ kind: 'primitive', attributes: [...attributes, { name: field, value: v.geometry(field) }] })

  const paint = { stroke: 'var(--arch-edge-stroke, var(--_line))', strokeWidth: String(visual.edgeLineWidth) }
  const connectorSemantics = {
    endpoints: { from: edge.source.id, to: edge.target.id },
    relationship: { kind: 'architecture-edge' },
    route: {
      ownership: 'layout',
      bendRadius: visual.edgeBendRadius,
      labelAnchors: edge.labelPosition ? [edge.labelPosition] : [],
    },
    labels: edge.label ? [{ text: edge.label, ...(edge.labelPosition ? { anchor: edge.labelPosition } : {}) }] : [],
  } as const

  if (visual.edgeBendRadius > 0 && edge.points.length > 2) {
    const projection = projectRoundedConnectorPath(edge.points, visual.edgeBendRadius, {
      metric: 'manhattan',
      precision: 3,
    })
    return marks.connector({
      id: sceneId,
      role: 'edge',
      geometry: projection.geometry,
      lineStyle: 'solid',
      paint,
      markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
      ...connectorSemantics,
      route: { ...connectorSemantics.route, contours: projection.contours },
    }, emission('d'))
  }
  return marks.connector({
    id: sceneId,
    role: 'edge',
    geometry: { kind: 'polyline', points: edge.points },
    lineStyle: 'solid',
    paint,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    ...connectorSemantics,
  }, emission('points'))
}

function lowerEdgeLabel(edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig, sceneId: string): SceneNode[] {
  const block = edge.labelBlock ?? preparePixelText(edge.label!, { display: 'formatted', transform: visual.edgeTextTransform, fontSize: visual.edgeFontSize, fontWeight: visual.edgeFontWeight, letterSpacing: visual.edgeLetterSpacing })
  const label = block.text
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const metrics = block
  const padding = 7

  const bgWidth = metrics.width + padding * 2
  const bgHeight = metrics.height + padding * 2
  return [
    marks.shape({
      id: `${sceneId}:bg`,
      role: 'chrome',
      geometry: { kind: 'rect', x: mid.x - bgWidth / 2, y: mid.y - bgHeight / 2, width: bgWidth, height: bgHeight, rx: 0, ry: 0 },
      paint: {
        fill: 'color-mix(in srgb, var(--bg) 90%, var(--_group-hdr))',
        stroke: 'color-mix(in srgb, var(--arch-edge-stroke, var(--_line)) 18%, var(--bg))',
        strokeWidth: '0.75',
      },
    }, EDGE_LABEL_BG_EMISSION),
    marks.text({
      id: sceneId,
      role: 'label',
      text: label,
      x: mid.x,
      y: mid.y,
      fontSize: visual.edgeFontSize, fontWeight: visual.edgeFontWeight, letterSpacing: visual.edgeLetterSpacing,
      block,
      anchor: 'middle',
      paint: { fill: 'var(--arch-edge-label, var(--_text-muted))' },
    }, EDGE_TEXT_EMISSION),
  ]
}

function renderIcon(x: number, y: number, size: number, icon: string, compact: boolean, id: string, owner: SceneOwner, fallbackBlock?: PixelTextBlock): SceneNode {
  const rawName = icon.trim().toLowerCase()
  const native = !rawName.includes(':') && !rawName.includes('/')
    && ['cloud', 'database', 'disk', 'internet', 'server'].includes(rawName)
  const resolved = native ? null : resolveArchitectureIcon(icon)
  const ink = 'var(--arch-edge-stroke, var(--_arrow))'
  const stroke: MarkPaint = { fill: 'none', stroke: ink, strokeWidth: '1.25', strokeLinecap: 'round', strokeLinejoin: 'round' }
  const children: SceneNode[] = []
  const add = (geometry: Geometry, emission: SvgPrimitiveEmission, paint = stroke, transform?: SceneTransform): void => {
    children.push(marks.shape({ id: semanticChildId(id, 'part', children.length), role: 'icon', owner, geometry, paint,
      ...(transform ? { transform } : {}),
    }, emission))
  }
  const path = (d: string): void => add({ kind: 'path', d }, ICON_EMISSIONS.path)
  const circle = (cx: number, cy: number, r: number): void => add({ kind: 'circle', cx, cy, r }, ICON_EMISSIONS.circle)
  const ellipse = (cx: number, cy: number, rx: number, ry: number): void => add({ kind: 'ellipse', cx, cy, rx, ry }, ICON_EMISSIONS.ellipse)
  const name = normalizeIconName(icon), cx = x + size / 2, cy = y + size / 2, s = compact ? size * 0.92 : size
  if (resolved) {
    const inset = (size - s) / 2, scale = s / 24
    add({ kind: 'path', d: resolved.path }, ICON_GLYPH_EMISSION,
      { fill: ink }, { kind: 'matrix', a: scale, b: 0, c: 0, d: scale, e: x + inset, f: y + inset })
  } else switch (name) {
    case 'cloud':
      circle(cx - s * 0.18, cy + s * 0.02, s * 0.16)
      circle(cx + s * 0.02, cy - s * 0.08, s * 0.2)
      circle(cx + s * 0.2, cy + s * 0.02, s * 0.15)
      path(`M ${cx - s * 0.34} ${cy + s * 0.16} H ${cx + s * 0.33}`)
      break
    case 'database':
      ellipse(cx, cy - s * 0.16, s * 0.24, s * 0.1)
      path(`M ${cx - s * 0.24} ${cy - s * 0.16} V ${cy + s * 0.2}`)
      path(`M ${cx + s * 0.24} ${cy - s * 0.16} V ${cy + s * 0.2}`)
      ellipse(cx, cy + s * 0.02, s * 0.24, s * 0.1)
      ellipse(cx, cy + s * 0.2, s * 0.24, s * 0.1)
      break
    case 'disk':
      circle(cx, cy, s * 0.26)
      circle(cx, cy, s * 0.09)
      break
    case 'internet':
      circle(cx, cy, s * 0.26)
      path(`M ${cx - s * 0.26} ${cy} H ${cx + s * 0.26}`)
      path(`M ${cx} ${cy - s * 0.26} V ${cy + s * 0.26}`)
      path(`M ${cx - s * 0.14} ${cy - s * 0.22} Q ${cx} ${cy} ${cx - s * 0.14} ${cy + s * 0.22}`)
      path(`M ${cx + s * 0.14} ${cy - s * 0.22} Q ${cx} ${cy} ${cx + s * 0.14} ${cy + s * 0.22}`)
      break
    case 'server':
      add({ kind: 'rect', x: cx - s * 0.22, y: cy - s * 0.24, width: s * 0.44, height: s * 0.48, rx: 0, ry: 0 }, ICON_EMISSIONS.rect)
      path(`M ${cx - s * 0.16} ${cy - s * 0.08} H ${cx + s * 0.16}`)
      path(`M ${cx - s * 0.16} ${cy + s * 0.06} H ${cx + s * 0.16}`)
      break
    default: {
      const glyph = fallbackIconGlyph(icon), fontSize = Math.max(10, size * 0.56)
      const block = fallbackBlock
      children.push(marks.text({ id: semanticChildId(id, 'fallback'), role: 'icon', owner, text: glyph, block,
        x: cx, y: cy, fontSize, fontWeight: 700, anchor: 'middle', paint: { fill: ink },
      }, FALLBACK_EMISSION))
    }
  }
  return marks.group({ id, role: 'icon', owner,
    emission: { kind: 'group', leadingWhitespace: '  ', attributes: [
      { name: 'class', value: v.meta('architecture-icon') }, { name: 'data-icon', value: v.meta(icon) },
      ...(resolved ? [{ name: 'data-icon-source' as const, value: v.meta(resolved.source) }, { name: 'data-icon-license' as const, value: v.meta(resolved.license) }] : []),
    ] },
    children: children.map((node, index) => ({ node, indent: index === 0 ? 2 : 0 })),
  })
}

const ARCHITECTURE_MARKER_PAINT = {
  fill: 'var(--arch-edge-stroke, var(--_arrow))',
  stroke: 'var(--arch-edge-stroke, var(--_arrow))',
  strokeWidth: '0.75',
  strokeLinejoin: 'round' as const,
}

const ARCHITECTURE_MARKERS: readonly MarkerDescriptor[] = [
  tipAnchoredArrow('architecture-arrow-end', { width: 8, height: 5 }, 'end', ARCHITECTURE_MARKER_PAINT),
  tipAnchoredArrow('architecture-arrow-start', { width: 8, height: 5 }, 'start', ARCHITECTURE_MARKER_PAINT),
]
