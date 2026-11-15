import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
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
import type { Point, RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock, resolvedColorValue, type DiagramColors } from '../theme.ts'
import { toneOnFill } from '../color-resolver.ts'
import { mixHex } from '../shared/color-math.ts'
import { escapeAttr, escapeDisplayAttr, escapeXml } from '../multiline-utils.ts'
import { sanitizeDisplayLines } from '../shared/text-controls.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { fallbackIconGlyph, normalizeIconName } from './icon-layout.ts'
import { topRoundedRectPath } from '../scene/svg-writer.ts'
import type { Geometry, MarkAttributes, MarkPaint, MarkerDescriptor, SceneOwner, SceneTransform } from '../scene/ir.ts'
import { semanticChildId } from '../scene/identity.ts'
import { hashId } from '../scene/seed.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveArchitectureIcon } from './icons.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { ARCHITECTURE_MARKERS, architectureMarkerTerminal } from './markers.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { arrowheadDirection } from '../shared/relation-direction.ts'

// ============================================================================
// Architecture renderer — lowers a PositionedArchitectureDiagram to the
// SceneGraph IR (SPEC §3.1) and serializes it via the DefaultBackend.
//
// The default backend writes every mark from its typed fields.
// ============================================================================

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
export function lowerArchitectureDrawing<T>(
  marks: DrawingFactory<T>,
  ctx: RenderContext<PositionedArchitectureDiagram>,
): DrawingDocument<T> {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const visual: ArchitectureVisualConfig = {
    ...DEFAULT_ARCHITECTURE_VISUAL,
    ...((resolved.familyAppearance as { visual?: ArchitectureVisualConfig } | undefined)?.visual
      ?? options.architecture?.visual),
  }
  const parts: T[] = []
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

  // Document shell: SVG open tag, accessibility elements and the shared style
  // block. Every mark is painted from its typed fields.
  const preludeParts: string[] = []
  preludeParts.push(svgOpenTag(diagram.width, diagram.height, colors, transparent, {
    style: archVars,
    attrs: a11yAttrs,
  }))
  if (hasTitle) preludeParts.push(`<title id="${titleId}">${escapeXml(accessibleTitle!)}</title>`)
  if (hasDesc) preludeParts.push(`<desc id="${descId}">${escapeXml(diagram.accessibilityDescription!)}</desc>`)
  preludeParts.push(buildStyleBlock(font, false, undefined, colors.embedFontImport))
  parts.push(marks.documentOpen({
    id: 'prelude',
    width: diagram.width,
    height: diagram.height,
    colors,
    transparent,
    font,
    hasMonoFont: false,
  }, preludeParts.join('\n')))

  parts.push(marks.definitions(
    { id: 'defs', markerResources: ARCHITECTURE_MARKERS },
    ['<defs>', serializeMarkerResources(ARCHITECTURE_MARKERS), '</defs>'].join('\n'),
  ))

  if (diagram.title) {
    parts.push(marks.text({
      id: 'title',
      role: 'title',
      text: diagram.title.text,
      x: diagram.title.x,
      y: diagram.title.y,
      fontSize: ARCHITECTURE_TITLE_FONT_SIZE,
      block: diagram.title.block,
      anchor: 'middle',
      fontWeight: ARCHITECTURE_TITLE_FONT_WEIGHT,
      paint: { fill: 'var(--arch-service-label, var(--_text))' },
      attributes: { className: 'architecture-title' },
    }))
  }

  for (const group of diagram.groups) {
    parts.push(lowerGroup(marks, group, visual, labels))
  }

  const edgeOccurrence = new Map<string, number>()
  for (const edge of diagram.edges) {
    const pairKey = `${edge.source.id}->${edge.target.id}`
    const k = edgeOccurrence.get(pairKey) ?? 0
    edgeOccurrence.set(pairKey, k + 1)
    parts.push(lowerEdge(marks, edge, visual, `edge:${pairKey}#${k}`))
  }

  const labelOccurrence = new Map<string, number>()
  for (const edge of diagram.edges) {
    if (!edge.label) continue
    const pairKey = `${edge.source.id}->${edge.target.id}`
    const k = labelOccurrence.get(pairKey) ?? 0
    labelOccurrence.set(pairKey, k + 1)
    // The string renderer emitted "<rect bg>\n<text>" as one part; two flat
    // marks joined with '\n' by the backend produce the same bytes.
    for (const mark of lowerEdgeLabel(marks, edge, visual, `edge-label:${pairKey}#${k}`)) {
      parts.push(mark)
    }
  }

  for (const junction of diagram.junctions) {
    parts.push(lowerJunction(marks, junction, visual))
  }

  for (const service of diagram.services) {
    parts.push(lowerService(marks, service, visual, labels))
  }

  parts.push(marks.documentClose())

  return { family: 'architecture', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

interface ArchitectureLabelPaints { group: string; service: string }

/** Paints for group and service labels. A label color set through the
 *  visual config (`--arch-group-label`, `--arch-service-label`) wins; the
 *  theme tone it falls back to is inked against the band or card the label
 *  sits on, whose fill a custom surface can put far from the page the tones
 *  are repaired against. The fills mirror the group band and service card
 *  marks' paint. */
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

function lowerGroup<T>(marks: DrawingFactory<T>, group: PositionedArchitectureGroup, visual: ArchitectureVisualConfig, labels: ArchitectureLabelPaints): T {
  const children: Array<{ node: T; indent: number }> = []
  const open =
    `<g class="architecture-group" data-id="${escapeAttr(group.id)}" data-label="${escapeDisplayAttr(group.label)}">`

  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-frame:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: visual.groupCornerRadius, ry: visual.groupCornerRadius },
      paint: { fill: 'var(--arch-group-fill, color-mix(in srgb, var(--_node-fill) 82%, var(--bg)))', stroke: 'none' },
      attributes: { className: 'architecture-group-frame' },
    }),
  })

  const bandPath = topRoundedRectPath(group.x, group.y, group.width, group.headerHeight ?? visual.groupHeaderHeight, visual.groupCornerRadius)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-band:${group.id}`,
      role: 'group-header',
      geometry: { kind: 'path', d: bandPath },
      paint: { fill: 'var(--arch-group-band, color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 5%, var(--arch-group-fill, var(--bg))))', stroke: 'none' },
      attributes: { className: 'architecture-group-band' },
    }),
  })

  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-outline:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: visual.groupCornerRadius, ry: visual.groupCornerRadius },
      paint: { fill: 'none', stroke: 'var(--arch-group-stroke, var(--_node-stroke))', strokeWidth: String(visual.groupLineWidth) },
      attributes: { className: 'architecture-group-outline' },
    }),
  })

  if (group.icon) {
    // The string renderer indented only the first line of the multi-line icon
    // chunk (`parts.push(`  ${renderIcon(...)}`)`), so the two-space prefix is
    // baked into the raw crisp instead of using the group's indent machinery
    // (which indents every line).
    children.push({
      indent: 0,
      node: renderIcon(marks, group.x + 10, group.y + 6, visual.iconSize, group.icon, true, `icon:${group.id}`, { id: group.id, role: 'group' }, group.iconFallbackBlock),
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
      fontSize: visual.groupFontSize,
      block,
      anchor: 'start',
      paint: { fill: labels.group },
      attributes: { className: 'architecture-group-label' },
    }),
  })

  for (const child of group.children) {
    children.push({ indent: 0, node: lowerGroup(marks, child, visual, labels) })
  }

  return marks.group({
    id: `group:${group.id}`,
    role: 'group',
    open,
    close: '</g>',
    children,
  })
}

function lowerService<T>(marks: DrawingFactory<T>, service: PositionedArchitectureService, visual: ArchitectureVisualConfig, labels: ArchitectureLabelPaints): T {
  const children: Array<{ node: T; indent: number }> = []
  const hasIcon = Boolean(service.icon)
  const textIconBlock = service.iconText === undefined ? undefined : service.iconTextBlock ?? preparePixelText(service.iconText, { display: 'literal', fontSize: visual.serviceFontSize, fontWeight: 700 })
  const iconX = service.x + visual.servicePaddingX
  const iconY = service.y + service.height / 2 - visual.serviceIconSize / 2
  const labelX = service.labelPosition?.x ?? (textIconBlock
    ? iconX + textIconBlock.width + (textIconBlock.width ? 10 : 0)
    : hasIcon
    ? iconX + visual.serviceIconSize + Math.max(10, visual.servicePaddingX * 0.7)
    : service.x + visual.servicePaddingX)

  const open =
    `<g class="architecture-service" data-id="${escapeAttr(service.id)}" data-label="${escapeDisplayAttr(service.label)}">`

  children.push({
    indent: 2,
    node: marks.shape({
      id: `service-card:${service.id}`,
      role: 'service',
      geometry: { kind: 'rect', x: service.x, y: service.y, width: service.width, height: service.height, rx: visual.serviceCornerRadius, ry: visual.serviceCornerRadius },
      paint: { fill: 'var(--arch-service-fill, color-mix(in srgb, var(--_node-fill) 92%, var(--bg)))', stroke: 'none' },
      attributes: { className: 'architecture-service-card' },
    }),
  })

  children.push({
    indent: 2,
    node: marks.shape({
      id: `service-outline:${service.id}`,
      role: 'service',
      geometry: { kind: 'rect', x: service.x, y: service.y, width: service.width, height: service.height, rx: visual.serviceCornerRadius, ry: visual.serviceCornerRadius },
      paint: { fill: 'none', stroke: 'var(--arch-service-stroke, var(--_node-stroke))', strokeWidth: String(visual.serviceLineWidth) },
      attributes: { className: 'architecture-service-outline' },
    }),
  })

  if (service.icon) {
    // Same first-line-only indent as group icons (see lowerGroup).
    children.push({
      indent: 0,
      node: renderIcon(marks, iconX, iconY, visual.serviceIconSize, service.icon, false, `icon:${service.id}`, { id: service.id, role: 'service' }, service.iconFallbackBlock),
    })
  }

  if (textIconBlock) {
    const block = textIconBlock
    children.push({ indent: 2, node: marks.text({
      id: `icon-text:${service.id}`, role: 'icon', text: block.text, block,
      x: iconX, y: service.y + service.height / 2, anchor: 'start',
      fontSize: visual.serviceFontSize, fontWeight: 700,
      paint: { fill: labels.service }, attributes: { className: 'architecture-icon-text' },
    }) })
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
      fontSize: visual.serviceFontSize,
      block,
      anchor: 'start',
      paint: { fill: labels.service },
      attributes: { className: 'architecture-service-label' },
    }),
  })

  return marks.group({
    id: `service:${service.id}`,
    role: 'service',
    open,
    close: '</g>',
    children,
  })
}

function lowerJunction<T>(marks: DrawingFactory<T>, junction: PositionedArchitectureJunction, visual: ArchitectureVisualConfig): T {
  const cx = junction.x + junction.width / 2
  const cy = junction.y + junction.height / 2

  const ring = marks.shape({
    id: `junction-ring:${junction.id}`,
    role: 'junction',
    geometry: { kind: 'circle', cx, cy, r: junction.width / 2 },
    paint: { fill: 'var(--bg)', stroke: 'var(--arch-edge-stroke, var(--_arrow))', strokeWidth: '1.25' },
    attributes: { className: 'architecture-junction-ring' },
  })
  const core = marks.shape({
    id: `junction-core:${junction.id}`,
    role: 'junction',
    geometry: { kind: 'circle', cx, cy, r: visual.junctionInnerRadius },
    paint: { fill: 'color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 24%, var(--bg))', stroke: 'var(--arch-edge-stroke, var(--_arrow))', strokeWidth: '0.75' },
    attributes: { className: 'architecture-junction-core' },
  })
  return marks.group({
    id: `junction:${junction.id}`,
    role: 'junction',
    open: `<g class="architecture-junction" data-id="${escapeAttr(junction.id)}">`,
    close: '</g>',
    children: [
      { indent: 2, node: ring },
      { indent: 2, node: core },
    ],
  })
}

function lowerEdge<T>(marks: DrawingFactory<T>, edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig, sceneId: string): T {
  const startMarker = edge.hasArrowStart ? ARCHITECTURE_MARKERS[1] : undefined
  const endMarker = edge.hasArrowEnd ? ARCHITECTURE_MARKERS[0] : undefined
  const attributes: MarkAttributes = {
    className: 'architecture-edge',
    data: {
      'from-side': edge.source.side,
      'to-side': edge.target.side,
      'from-boundary': edge.source.boundary,
      'to-boundary': edge.target.boundary,
      ...(edge.label ? { label: sanitizeDisplayLines(edge.label) } : {}),
    },
  }

  const paint: MarkPaint = { stroke: 'var(--arch-edge-stroke, var(--_line))', strokeWidth: String(visual.edgeLineWidth), strokeLinejoin: 'round' }
  const connectorSemantics = {
    endpoints: { from: edge.source.id, to: edge.target.id },
    relationship: { kind: 'architecture-edge', direction: edge.source.id === edge.target.id ? 'self' : arrowheadDirection(edge.hasArrowStart, edge.hasArrowEnd) },
    route: {
      ownership: 'layout',
      bendRadius: visual.edgeBendRadius,
      labelAnchors: edge.labelPosition ? [edge.labelPosition] : [],
    },
    labels: edge.label ? [{ text: edge.label, ...(edge.labelPosition ? { anchor: edge.labelPosition } : {}) }] : [],
    attributes,
  } as const

  if (visual.edgeBendRadius > 0 && edge.points.length > 2) {
    const projection = projectRoundedConnectorPath(edge.points, visual.edgeBendRadius, {
      terminalClearance: { start: architectureMarkerTerminal(startMarker?.id, visual.edgeLineWidth, 'start'), end: architectureMarkerTerminal(endMarker?.id, visual.edgeLineWidth, 'end') },
      metric: 'manhattan',
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
    })
  }
  return marks.connector({
    id: sceneId,
    role: 'edge',
    geometry: { kind: 'polyline', points: edge.points },
    lineStyle: 'solid',
    paint,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    ...connectorSemantics,
  })
}

function lowerEdgeLabel<T>(marks: DrawingFactory<T>, edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig, sceneId: string): T[] {
  const block = edge.labelBlock ?? preparePixelText(edge.label!, { display: 'formatted', transform: visual.edgeTextTransform, fontSize: visual.edgeFontSize, fontWeight: visual.edgeFontWeight, letterSpacing: visual.edgeLetterSpacing })
  const label = block.text
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const padding = 7
  const bgWidth = block.width + padding * 2
  const bgHeight = block.height + padding * 2
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
      attributes: { className: 'architecture-edge-label-bg' },
    }),
    marks.text({
      id: sceneId,
      role: 'label',
      text: label,
      x: mid.x,
      y: mid.y,
      fontSize: visual.edgeFontSize,
      block,
      anchor: 'middle',
      paint: { fill: 'var(--arch-edge-label, var(--_text-muted))' },
      attributes: { className: 'architecture-edge-label-text' },
    }),
  ]
}

function renderIcon<T>(marks: DrawingFactory<T>, x: number, y: number, size: number, icon: string, compact: boolean, id: string, owner: SceneOwner, fallbackBlock?: PixelTextBlock): T {
  const rawName = icon.trim().toLowerCase()
  const native = !rawName.includes(':') && !rawName.includes('/')
    && ['cloud', 'database', 'disk', 'internet', 'server'].includes(rawName)
  const resolved = native ? null : resolveArchitectureIcon(icon)
  const metadata = resolved
    ? ` data-icon-source="${resolved.source}" data-icon-license="${resolved.license}"`
    : ''
  const ink = 'var(--arch-edge-stroke, var(--_arrow))'
  const stroke: MarkPaint = { fill: 'none', stroke: ink, strokeWidth: '1.25', strokeLinecap: 'round', strokeLinejoin: 'round' }
  const children: T[] = []
  const add = (geometry: Geometry, className = 'architecture-icon-mark', paint = stroke, transform?: SceneTransform): void => {
    children.push(marks.shape({ id: semanticChildId(id, 'part', children.length), role: 'icon', owner, geometry, paint,
      ...(transform ? { transform } : {}),
      attributes: { className },
    }))
  }
  const path = (d: string): void => add({ kind: 'path', d })
  const circle = (cx: number, cy: number, r: number): void => add({ kind: 'circle', cx, cy, r })
  const ellipse = (cx: number, cy: number, rx: number, ry: number): void => add({ kind: 'ellipse', cx, cy, rx, ry })
  const name = normalizeIconName(icon), cx = x + size / 2, cy = y + size / 2, s = compact ? size * 0.92 : size
  if (resolved) {
    const inset = (size - s) / 2, scale = s / 24
    add({ kind: 'path', d: resolved.path }, 'architecture-icon-glyph', { fill: ink }, { kind: 'matrix', a: scale, b: 0, c: 0, d: scale, e: x + inset, f: y + inset })
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
      add({ kind: 'rect', x: cx - s * 0.22, y: cy - s * 0.24, width: s * 0.44, height: s * 0.48, rx: 0, ry: 0 })
      path(`M ${cx - s * 0.16} ${cy - s * 0.08} H ${cx + s * 0.16}`)
      path(`M ${cx - s * 0.16} ${cy + s * 0.06} H ${cx + s * 0.16}`)
      break
    default: {
      const glyph = fallbackIconGlyph(icon), fontSize = Math.max(10, size * 0.56)
      const block = fallbackBlock
      children.push(marks.text({ id: semanticChildId(id, 'fallback'), role: 'icon', owner, text: glyph, block,
        x: cx, y: cy, fontSize, fontWeight: 700, anchor: 'middle', paint: { fill: ink },
        attributes: { className: 'architecture-icon-glyph architecture-icon-fallback', data: { fallback: 'true' } },
      }))
    }
  }
  return marks.group({ id, role: 'icon', owner,
    open: `  <g class="architecture-icon" data-icon="${escapeAttr(icon)}"${metadata}>`, close: '</g>',
    children: children.map((node, index) => ({ node, indent: index === 0 ? 2 : 0 })),
  })
}

export const lowerArchitectureScene = sceneLowering<PositionedArchitectureDiagram>(lowerArchitectureDrawing)
