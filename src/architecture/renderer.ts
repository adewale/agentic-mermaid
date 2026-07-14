import type {
  PositionedArchitectureDiagram,
  PositionedArchitectureEdge,
  PositionedArchitectureGroup,
  PositionedArchitectureJunction,
  PositionedArchitectureService,
} from './types.ts'
import type { ArchitectureVisualConfig } from './config.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from './config.ts'
import type { Point, RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { escapeAttr, renderMultilineText, renderMultilineTextWithBackground, escapeXml } from '../multiline-utils.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { applyTextTransform } from '../styles.ts'
import { topRoundedRectPath } from '../svg-paths.ts'
import type { MarkerDescriptor, MarkerRef, SceneDoc, SceneNode } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveArchitectureIcon } from './icons.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'

// ============================================================================
// Architecture renderer — lowers a PositionedArchitectureDiagram to the
// SceneGraph IR (SPEC §3.1) and serializes it via the DefaultBackend.
//
// Every crisp template below is the historical string renderer's template
// moved verbatim into a mark constructor call, and doc.parts order matches
// the historical parts[] order, so DefaultBackend output stays byte-identical
// (corpus-gated by svg-equivalence.test.ts).
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
 * Lower a positioned architecture diagram to the SceneGraph IR. Mark order
 * matches the historical parts[] order exactly; DefaultBackend joins crisps
 * with '\n'.
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

  // Document prelude: svg open tag + shared style block + architecture CSS,
  // joined the way the string renderer pushed them. The accessibility
  // <title>/<desc> lines sit between the open tag and the style block in the
  // historical byte stream, so when present they are folded into the prelude
  // crisp at that exact position (a separate part after the prelude would
  // reorder them below the style blocks and drift the output bytes).
  const archCss = architectureStyles(visual)
  const preludeParts: string[] = []
  preludeParts.push(svgOpenTag(diagram.width, diagram.height, colors, transparent, {
    style: archVars,
    attrs: a11yAttrs,
  }))
  if (hasTitle) preludeParts.push(`<title id="${titleId}">${escapeXml(accessibleTitle!)}</title>`)
  if (hasDesc) preludeParts.push(`<desc id="${descId}">${escapeXml(diagram.accessibilityDescription!)}</desc>`)
  preludeParts.push(buildStyleBlock(font, false, undefined, colors.embedFontImport))
  preludeParts.push(archCss)
  parts.push(marks.prelude({
    id: 'prelude',
    width: diagram.width,
    height: diagram.height,
    colors,
    transparent,
    font,
    hasMonoFont: false,
    extraCss: archCss,
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
      fontSize: 18,
      anchor: 'middle',
      paint: { fill: 'var(--arch-service-label, var(--_text))' },
    }, renderMultilineText(
      diagram.title.text,
      diagram.title.x,
      diagram.title.y,
      18,
      'class="architecture-title" text-anchor="middle" font-size="18" font-weight="600" fill="var(--arch-service-label, var(--_text))"',
    )))
  }

  for (const group of diagram.groups) {
    parts.push(lowerGroup(group, visual))
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
    parts.push(lowerService(service, visual))
  }

  parts.push(marks.documentClose())

  return { family: 'architecture', width: diagram.width, height: diagram.height, colors, parts }
}

function architectureStyles(visual: ArchitectureVisualConfig): string {
  return `<style>
  .architecture-group-frame { fill: var(--arch-group-fill, color-mix(in srgb, var(--_node-fill) 82%, var(--bg))); stroke: none; }
  .architecture-group-band { fill: var(--arch-group-band, color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 5%, var(--arch-group-fill, var(--bg)))); stroke: none; }
  .architecture-group-outline { fill: none; stroke: var(--arch-group-stroke, var(--_node-stroke)); stroke-width: ${visual.groupLineWidth}; }
  .architecture-group-label { fill: var(--arch-group-label, var(--_text-sec)); }
  .architecture-service-card { fill: var(--arch-service-fill, color-mix(in srgb, var(--_node-fill) 92%, var(--bg))); stroke: none; }
  .architecture-service-outline { fill: none; stroke: var(--arch-service-stroke, var(--_node-stroke)); stroke-width: ${visual.serviceLineWidth}; }
  .architecture-service-label { fill: var(--arch-service-label, var(--_text)); }
  .architecture-edge { fill: none; stroke: var(--arch-edge-stroke, var(--_line)); stroke-width: ${visual.edgeLineWidth}; stroke-linejoin: round; }
  .architecture-edge-label-bg { fill: color-mix(in srgb, var(--bg) 90%, var(--_group-hdr)); stroke: color-mix(in srgb, var(--arch-edge-stroke, var(--_line)) 18%, var(--bg)); stroke-width: 0.75; }
  .architecture-edge-label-text { fill: var(--arch-edge-label, var(--_text-muted)); }
  .architecture-junction-ring { fill: var(--bg); stroke: var(--arch-edge-stroke, var(--_arrow)); stroke-width: 1.25; }
  .architecture-junction-core { fill: color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 24%, var(--bg)); stroke: var(--arch-edge-stroke, var(--_arrow)); stroke-width: 0.75; }
  .architecture-icon-mark { fill: none; stroke: var(--arch-edge-stroke, var(--_arrow)); stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
  .architecture-icon-glyph { fill: var(--arch-edge-stroke, var(--_arrow)); }
</style>`
}

function lowerGroup(group: PositionedArchitectureGroup, visual: ArchitectureVisualConfig): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []
  const open =
    `<g class="architecture-group" data-id="${escapeAttr(group.id)}" data-label="${escapeAttr(group.label)}">`

  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-frame:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: visual.groupCornerRadius, ry: visual.groupCornerRadius },
      paint: { fill: 'var(--arch-group-fill, color-mix(in srgb, var(--_node-fill) 82%, var(--bg)))', stroke: 'none' },
    },
      `<rect class="architecture-group-frame" x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${visual.groupCornerRadius}" ry="${visual.groupCornerRadius}" />`),
  })

  const bandPath = topRoundedRectPath(group.x, group.y, group.width, visual.groupHeaderHeight, visual.groupCornerRadius)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-band:${group.id}`,
      role: 'group-header',
      geometry: { kind: 'path', d: bandPath },
      paint: { fill: 'var(--arch-group-band, color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 5%, var(--arch-group-fill, var(--bg))))', stroke: 'none' },
    },
      `<path class="architecture-group-band" d="${bandPath}" />`),
  })

  children.push({
    indent: 2,
    node: marks.shape({
      id: `group-outline:${group.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: visual.groupCornerRadius, ry: visual.groupCornerRadius },
      paint: { fill: 'none', stroke: 'var(--arch-group-stroke, var(--_node-stroke))', strokeWidth: String(visual.groupLineWidth) },
    },
      `<rect class="architecture-group-outline" x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${visual.groupCornerRadius}" ry="${visual.groupCornerRadius}" />`),
  })

  if (group.icon) {
    // The string renderer indented only the first line of the multi-line icon
    // chunk (`parts.push(`  ${renderIcon(...)}`)`), so the two-space prefix is
    // baked into the raw crisp instead of using the group's indent machinery
    // (which indents every line).
    children.push({
      indent: 0,
      node: marks.raw(
        { id: `icon:${group.id}`, role: 'icon' },
        `  ${renderIcon(group.x + 10, group.y + 6, visual.iconSize, group.icon, true)}`,
      ),
    })
  }

  const labelText = applyTextTransform(group.label, visual.groupTextTransform)
  const labelX = group.x + (group.icon ? 36 : visual.groupLabelPaddingX)
  const labelY = group.y + visual.groupHeaderHeight / 2
  children.push({
    indent: 2,
    node: marks.text({
      id: `group-label:${group.id}`,
      role: 'label',
      text: labelText,
      x: labelX,
      y: labelY,
      fontSize: visual.groupFontSize,
      anchor: 'start',
      paint: { fill: 'var(--arch-group-label, var(--_text-sec))' },
    }, renderMultilineText(
      labelText,
      labelX,
      labelY,
      visual.groupFontSize,
      `class="architecture-group-label" text-anchor="start" font-size="${visual.groupFontSize}" font-weight="${visual.groupFontWeight}"${visual.groupFont ? ` font-family="${escapeAttr(visual.groupFont)}"` : ''}${letterAttr(visual.groupLetterSpacing)}`,
    )),
  })

  for (const child of group.children) {
    children.push({ indent: 0, node: lowerGroup(child, visual) })
  }

  return marks.group({
    id: `group:${group.id}`,
    role: 'group',
    open,
    close: '</g>',
    children,
  })
}

function lowerService(service: PositionedArchitectureService, visual: ArchitectureVisualConfig): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []
  const hasIcon = Boolean(service.icon)
  const iconX = service.x + visual.servicePaddingX
  const iconY = service.y + service.height / 2 - visual.serviceIconSize / 2
  const labelX = hasIcon
    ? iconX + visual.serviceIconSize + Math.max(10, visual.servicePaddingX * 0.7)
    : service.x + visual.servicePaddingX

  const open =
    `<g class="architecture-service" data-id="${escapeAttr(service.id)}" data-label="${escapeAttr(service.label)}">`

  children.push({
    indent: 2,
    node: marks.shape({
      id: `service-card:${service.id}`,
      role: 'service',
      geometry: { kind: 'rect', x: service.x, y: service.y, width: service.width, height: service.height, rx: visual.serviceCornerRadius, ry: visual.serviceCornerRadius },
      paint: { fill: 'var(--arch-service-fill, color-mix(in srgb, var(--_node-fill) 92%, var(--bg)))', stroke: 'none' },
    },
      `<rect class="architecture-service-card" x="${service.x}" y="${service.y}" width="${service.width}" height="${service.height}" rx="${visual.serviceCornerRadius}" ry="${visual.serviceCornerRadius}" />`),
  })

  children.push({
    indent: 2,
    node: marks.shape({
      id: `service-outline:${service.id}`,
      role: 'service',
      geometry: { kind: 'rect', x: service.x, y: service.y, width: service.width, height: service.height, rx: visual.serviceCornerRadius, ry: visual.serviceCornerRadius },
      paint: { fill: 'none', stroke: 'var(--arch-service-stroke, var(--_node-stroke))', strokeWidth: String(visual.serviceLineWidth) },
    },
      `<rect class="architecture-service-outline" x="${service.x}" y="${service.y}" width="${service.width}" height="${service.height}" rx="${visual.serviceCornerRadius}" ry="${visual.serviceCornerRadius}" />`),
  })

  if (service.icon) {
    // Same first-line-only indent as group icons (see lowerGroup).
    children.push({
      indent: 0,
      node: marks.raw(
        { id: `icon:${service.id}`, role: 'icon' },
        `  ${renderIcon(iconX, iconY, visual.serviceIconSize, service.icon, false)}`,
      ),
    })
  }

  const labelY = service.y + service.height / 2
  const labelText = applyTextTransform(service.label, visual.serviceTextTransform)
  children.push({
    indent: 2,
    node: marks.text({
      id: `service-label:${service.id}`,
      role: 'label',
      text: labelText,
      x: labelX,
      y: labelY,
      fontSize: visual.serviceFontSize,
      anchor: 'start',
      paint: { fill: 'var(--arch-service-label, var(--_text))' },
    }, renderMultilineText(
      labelText,
      labelX,
      labelY,
      visual.serviceFontSize,
      `class="architecture-service-label" text-anchor="start" font-size="${visual.serviceFontSize}" font-weight="${visual.serviceFontWeight}"${letterAttr(visual.serviceLetterSpacing)}`,
    )),
  })

  return marks.group({
    id: `service:${service.id}`,
    role: 'service',
    open,
    close: '</g>',
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
  }, `<circle class="architecture-junction-ring" cx="${cx}" cy="${cy}" r="${visual.junctionOuterRadius}" />`)
  const core = marks.shape({
    id: `junction-core:${junction.id}`,
    role: 'junction',
    geometry: { kind: 'circle', cx, cy, r: visual.junctionInnerRadius },
    paint: { fill: 'color-mix(in srgb, var(--arch-edge-stroke, var(--_arrow)) 24%, var(--bg))', stroke: 'var(--arch-edge-stroke, var(--_arrow))', strokeWidth: '0.75' },
  }, `<circle class="architecture-junction-core" cx="${cx}" cy="${cy}" r="${visual.junctionInnerRadius}" />`)
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

function lowerEdge(edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig, sceneId: string): SceneNode {
  const points = edge.points.map((point) => `${point.x},${point.y}`).join(' ')
  let markers = ''
  let startMarker: MarkerRef | undefined
  let endMarker: MarkerRef | undefined
  if (edge.hasArrowStart) {
    startMarker = ARCHITECTURE_MARKERS[1]
    markers += ' marker-start="url(#architecture-arrow-start)"'
  }
  if (edge.hasArrowEnd) {
    endMarker = ARCHITECTURE_MARKERS[0]
    markers += ' marker-end="url(#architecture-arrow-end)"'
  }

  const attrs = [
    'class="architecture-edge"',
    `data-from="${escapeAttr(edge.source.id)}"`,
    `data-to="${escapeAttr(edge.target.id)}"`,
    `data-from-side="${edge.source.side}"`,
    `data-to-side="${edge.target.side}"`,
    `data-from-boundary="${edge.source.boundary}"`,
    `data-to-boundary="${edge.target.boundary}"`,
  ]
  if (edge.label) attrs.push(`data-label="${escapeAttr(edge.label)}"`)

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
    projectAccessibilityToSvg: true,
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
      startMarker,
      endMarker,
      ...connectorSemantics,
      route: { ...connectorSemantics.route, contours: projection.contours },
    }, `<path ${attrs.join(' ')} d="${projection.geometry.d}"${markers} />`)
  }
  return marks.connector({
    id: sceneId,
    role: 'edge',
    geometry: { kind: 'polyline', points: edge.points },
    lineStyle: 'solid',
    paint,
    startMarker,
    endMarker,
    ...connectorSemantics,
  }, `<polyline ${attrs.join(' ')} points="${points}"${markers} />`)
}

function lowerEdgeLabel(edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig, sceneId: string): SceneNode[] {
  const label = applyTextTransform(edge.label!, visual.edgeTextTransform)
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const metrics = measureMultilineText(label, visual.edgeFontSize, visual.edgeFontWeight)
  const padding = 7

  const crisp = renderMultilineTextWithBackground(
    label,
    mid.x,
    mid.y,
    metrics.width,
    metrics.height,
    visual.edgeFontSize,
    padding,
    `class="architecture-edge-label-text" text-anchor="middle" font-size="${visual.edgeFontSize}" font-weight="${visual.edgeFontWeight}"${letterAttr(visual.edgeLetterSpacing)}`,
    `class="architecture-edge-label-bg" rx="0" ry="0"`,
  )
  // renderMultilineTextWithBackground emits "<rect bg>\n<text>" — split at the
  // single '\n' so the background and text become distinct semantic marks with
  // their exact crisp bytes.
  const split = crisp.indexOf('\n')
  const bgCrisp = crisp.slice(0, split)
  const textCrisp = crisp.slice(split + 1)

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
    }, bgCrisp),
    marks.text({
      id: sceneId,
      role: 'label',
      text: label,
      x: mid.x,
      y: mid.y,
      fontSize: visual.edgeFontSize,
      anchor: 'middle',
      paint: { fill: 'var(--arch-edge-label, var(--_text-muted))' },
    }, textCrisp),
  ]
}

function renderIcon(x: number, y: number, size: number, icon: string, compact: boolean): string {
  const parts: string[] = []
  const rawName = icon.trim().toLowerCase()
  const native = !rawName.includes(':') && !rawName.includes('/')
    && ['cloud', 'database', 'disk', 'internet', 'server'].includes(rawName)
  const resolved = native ? null : resolveArchitectureIcon(icon)
  const metadata = resolved
    ? ` data-icon-source="${resolved.source}" data-icon-license="${resolved.license}"`
    : ''
  parts.push(`<g class="architecture-icon" data-icon="${escapeAttr(icon)}"${metadata}>`)
  parts.push(`  ${renderIconGlyph(x, y, size, icon, compact, resolved)}`)
  parts.push('</g>')
  return parts.join('\n')
}

function renderIconGlyph(
  x: number,
  y: number,
  size: number,
  icon: string,
  compact: boolean,
  resolved: ReturnType<typeof resolveArchitectureIcon>,
): string {
  const name = normalizeIconName(icon)
  const cx = x + size / 2
  const cy = y + size / 2
  const s = compact ? size * 0.92 : size

  if (resolved) {
    const inset = (size - s) / 2
    const scale = s / 24
    return `<path class="architecture-icon-glyph" d="${resolved.path}" transform="translate(${x + inset} ${y + inset}) scale(${scale})" />`
  }

  switch (name) {
    case 'cloud':
      return [
        `<circle class="architecture-icon-mark" cx="${cx - s * 0.18}" cy="${cy + s * 0.02}" r="${s * 0.16}" />`,
        `<circle class="architecture-icon-mark" cx="${cx + s * 0.02}" cy="${cy - s * 0.08}" r="${s * 0.2}" />`,
        `<circle class="architecture-icon-mark" cx="${cx + s * 0.2}" cy="${cy + s * 0.02}" r="${s * 0.15}" />`,
        `<path class="architecture-icon-mark" d="M ${cx - s * 0.34} ${cy + s * 0.16} H ${cx + s * 0.33}" />`,
      ].join('\n')
    case 'database':
      return [
        `<ellipse class="architecture-icon-mark" cx="${cx}" cy="${cy - s * 0.16}" rx="${s * 0.24}" ry="${s * 0.1}" />`,
        `<path class="architecture-icon-mark" d="M ${cx - s * 0.24} ${cy - s * 0.16} V ${cy + s * 0.2}" />`,
        `<path class="architecture-icon-mark" d="M ${cx + s * 0.24} ${cy - s * 0.16} V ${cy + s * 0.2}" />`,
        `<ellipse class="architecture-icon-mark" cx="${cx}" cy="${cy + s * 0.02}" rx="${s * 0.24}" ry="${s * 0.1}" />`,
        `<ellipse class="architecture-icon-mark" cx="${cx}" cy="${cy + s * 0.2}" rx="${s * 0.24}" ry="${s * 0.1}" />`,
      ].join('\n')
    case 'disk':
      return [
        `<circle class="architecture-icon-mark" cx="${cx}" cy="${cy}" r="${s * 0.26}" />`,
        `<circle class="architecture-icon-mark" cx="${cx}" cy="${cy}" r="${s * 0.09}" />`,
      ].join('\n')
    case 'internet':
      return [
        `<circle class="architecture-icon-mark" cx="${cx}" cy="${cy}" r="${s * 0.26}" />`,
        `<path class="architecture-icon-mark" d="M ${cx - s * 0.26} ${cy} H ${cx + s * 0.26}" />`,
        `<path class="architecture-icon-mark" d="M ${cx} ${cy - s * 0.26} V ${cy + s * 0.26}" />`,
        `<path class="architecture-icon-mark" d="M ${cx - s * 0.14} ${cy - s * 0.22} Q ${cx} ${cy} ${cx - s * 0.14} ${cy + s * 0.22}" />`,
        `<path class="architecture-icon-mark" d="M ${cx + s * 0.14} ${cy - s * 0.22} Q ${cx} ${cy} ${cx + s * 0.14} ${cy + s * 0.22}" />`,
      ].join('\n')
    case 'server':
      return [
        `<rect class="architecture-icon-mark" x="${cx - s * 0.22}" y="${cy - s * 0.24}" width="${s * 0.44}" height="${s * 0.48}" rx="0" ry="0" />`,
        `<path class="architecture-icon-mark" d="M ${cx - s * 0.16} ${cy - s * 0.08} H ${cx + s * 0.16}" />`,
        `<path class="architecture-icon-mark" d="M ${cx - s * 0.16} ${cy + s * 0.06} H ${cx + s * 0.16}" />`,
      ].join('\n')
    default: {
      const glyph = fallbackIconGlyph(icon)
      return renderMultilineText(
        glyph,
        cx,
        cy,
        Math.max(10, size * 0.56),
        `class="architecture-icon-glyph architecture-icon-fallback" data-fallback="true" text-anchor="middle" font-size="${Math.max(10, size * 0.56)}" font-weight="700"`,
      )
    }
  }
}

function normalizeIconName(icon: string): string {
  return icon.trim().toLowerCase().split(/[:/]/).pop() ?? icon.trim().toLowerCase()
}

function fallbackIconGlyph(icon: string): string {
  const token = normalizeIconName(icon).replace(/[^a-z0-9]/g, '')
  return (token[0] ?? '?').toUpperCase()
}

const ARCHITECTURE_MARKER_PAINT = {
  fill: 'var(--arch-edge-stroke, var(--_arrow))',
  stroke: 'var(--arch-edge-stroke, var(--_arrow))',
  strokeWidth: '0.75',
  strokeLinejoin: 'round' as const,
}

const ARCHITECTURE_MARKERS: readonly MarkerDescriptor[] = [
  {
    id: 'architecture-arrow-end', shape: 'arrow',
    size: { width: 8, height: 5 }, ref: { x: 7, y: 2.5 }, orient: 'auto',
    geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 8, y: 2.5 }, { x: 0, y: 5 }] },
    paint: ARCHITECTURE_MARKER_PAINT,
  },
  {
    id: 'architecture-arrow-start', shape: 'arrow',
    size: { width: 8, height: 5 }, ref: { x: 1, y: 2.5 }, orient: 'auto-start-reverse',
    geometry: { kind: 'polygon', points: [{ x: 8, y: 0 }, { x: 0, y: 2.5 }, { x: 8, y: 5 }] },
    paint: ARCHITECTURE_MARKER_PAINT,
  },
]

function edgeMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!

  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += segmentLength(points[i - 1]!, points[i]!)
  }

  let remaining = total / 2
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1]!
    const end = points[i]!
    const length = segmentLength(start, end)
    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      }
    }
    remaining -= length
  }

  return points[points.length - 1]!
}

function segmentLength(a: Point, b: Point): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}
