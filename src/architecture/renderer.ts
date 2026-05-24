import type {
  PositionedArchitectureDiagram,
  PositionedArchitectureEdge,
  PositionedArchitectureGroup,
  PositionedArchitectureJunction,
  PositionedArchitectureService,
} from './types.ts'
import type { ArchitectureVisualConfig } from './config.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from './config.ts'
import type { DiagramColors } from '../theme.ts'
import type { Point } from '../types.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { renderMultilineText, renderMultilineTextWithBackground, escapeXml } from '../multiline-utils.ts'
import { measureMultilineText } from '../text-metrics.ts'

/**
 * Render a positioned architecture diagram as SVG.
 */
export function renderArchitectureSvg(
  diagram: PositionedArchitectureDiagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  visual: ArchitectureVisualConfig = DEFAULT_ARCHITECTURE_VISUAL,
): string {
  const parts: string[] = []
  const archVars = [
    visual.groupSurface ? `--arch-group-fill:${visual.groupSurface}` : '',
    visual.groupBorder ? `--arch-group-stroke:${visual.groupBorder}` : '',
    visual.serviceSurface ? `--arch-service-fill:${visual.serviceSurface}` : '',
    visual.serviceBorder ? `--arch-service-stroke:${visual.serviceBorder}` : '',
  ].filter(Boolean).join(';')

  const hasTitle = Boolean(diagram.accessibilityTitle)
  const hasDesc = Boolean(diagram.accessibilityDescription)
  const uid = `arch-${hashDiagram(diagram)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const a11yAttrs: Record<string, string | undefined> = {}
  if (hasTitle || hasDesc) {
    a11yAttrs['role'] = 'img'
    a11yAttrs['aria-roledescription'] = 'architecture'
  }
  if (hasTitle) a11yAttrs['aria-labelledby'] = titleId
  if (hasDesc) a11yAttrs['aria-describedby'] = descId

  parts.push(svgOpenTag(diagram.width, diagram.height, colors, transparent, {
    style: archVars,
    attrs: a11yAttrs,
  }))
  if (hasTitle) parts.push(`<title id="${titleId}">${escapeXml(diagram.accessibilityTitle!)}</title>`)
  if (hasDesc) parts.push(`<desc id="${descId}">${escapeXml(diagram.accessibilityDescription!)}</desc>`)
  parts.push(buildStyleBlock(font, false))
  parts.push(architectureStyles(visual))
  parts.push('<defs>')
  parts.push(arrowMarkerDefs())
  parts.push('</defs>')

  for (const group of diagram.groups) {
    parts.push(renderGroup(group, visual))
  }

  for (const edge of diagram.edges) {
    parts.push(renderEdge(edge, visual))
  }

  for (const edge of diagram.edges) {
    if (edge.label) parts.push(renderEdgeLabel(edge, visual))
  }

  for (const junction of diagram.junctions) {
    parts.push(renderJunction(junction, visual))
  }

  for (const service of diagram.services) {
    parts.push(renderService(service, visual))
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function architectureStyles(visual: ArchitectureVisualConfig): string {
  return `<style>
  .architecture-group-frame { fill: var(--arch-group-fill, color-mix(in srgb, var(--_node-fill) 82%, var(--bg))); stroke: var(--arch-group-stroke, var(--_node-stroke)); stroke-width: ${visual.groupLineWidth}; }
  .architecture-group-band { fill: color-mix(in srgb, var(--_arrow) 5%, var(--arch-group-fill, var(--bg))); stroke: var(--arch-group-stroke, var(--_node-stroke)); stroke-width: ${visual.groupLineWidth}; }
  .architecture-group-label { fill: var(--_text-sec); }
  .architecture-service-card { fill: var(--arch-service-fill, color-mix(in srgb, var(--_node-fill) 92%, var(--bg))); stroke: var(--arch-service-stroke, var(--_node-stroke)); stroke-width: ${visual.serviceLineWidth}; }
  .architecture-service-accent { fill: color-mix(in srgb, var(--_arrow) 18%, var(--bg)); }
  .architecture-service-label { fill: var(--_text); }
  .architecture-edge { fill: none; stroke: var(--_line); stroke-width: ${visual.edgeLineWidth}; stroke-linejoin: round; }
  .architecture-edge-label-bg { fill: color-mix(in srgb, var(--bg) 90%, var(--_group-hdr)); stroke: color-mix(in srgb, var(--_line) 18%, var(--bg)); stroke-width: 0.75; }
  .architecture-edge-label-text { fill: var(--_text-muted); }
  .architecture-junction-ring { fill: var(--bg); stroke: var(--_arrow); stroke-width: 1.25; }
  .architecture-junction-core { fill: color-mix(in srgb, var(--_arrow) 24%, var(--bg)); stroke: var(--_arrow); stroke-width: 0.75; }
  .architecture-icon-bg { fill: color-mix(in srgb, var(--_arrow) 12%, var(--bg)); stroke: color-mix(in srgb, var(--_arrow) 26%, var(--bg)); stroke-width: 1; }
  .architecture-icon-mark { fill: none; stroke: var(--_arrow); stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
  .architecture-icon-fill { fill: color-mix(in srgb, var(--_arrow) 30%, var(--bg)); stroke: var(--_arrow); stroke-width: 0.75; }
  .architecture-icon-glyph { fill: var(--_arrow); }
</style>`
}

function renderGroup(group: PositionedArchitectureGroup, visual: ArchitectureVisualConfig): string {
  const parts: string[] = []
  parts.push(
    `<g class="architecture-group" data-id="${escapeAttr(group.id)}" data-label="${escapeAttr(group.label)}">`
  )
  parts.push(
    `  <rect class="architecture-group-frame" x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${visual.groupCornerRadius}" ry="${visual.groupCornerRadius}" />`
  )
  parts.push(
    `  <rect class="architecture-group-band" x="${group.x}" y="${group.y}" width="${group.width}" height="${visual.groupHeaderHeight}" rx="${visual.groupCornerRadius}" ry="${visual.groupCornerRadius}" />`
  )

  if (group.icon) {
    parts.push(`  ${renderIconBadge(group.x + 10, group.y + 6, visual.iconSize, group.icon, true)}`)
  }

  parts.push(
    '  ' + renderMultilineText(
      transformText(group.label, visual.groupTextTransform),
      group.x + (group.icon ? 36 : visual.groupLabelPaddingX),
      group.y + visual.groupHeaderHeight / 2,
      visual.groupFontSize,
      `class="architecture-group-label" text-anchor="start" font-size="${visual.groupFontSize}" font-weight="${visual.groupFontWeight}"${visual.groupFont ? ` font-family="${escapeAttr(visual.groupFont)}"` : ''}${letterAttr(visual.groupLetterSpacing)}`,
    )
  )

  for (const child of group.children) {
    parts.push(renderGroup(child, visual))
  }

  parts.push('</g>')
  return parts.join('\n')
}

function renderService(service: PositionedArchitectureService, visual: ArchitectureVisualConfig): string {
  const parts: string[] = []
  const accentWidth = 4
  const iconX = service.x + Math.max(10, visual.servicePaddingX * 0.7)
  const iconY = service.y + service.height / 2 - visual.serviceIconSize / 2
  const labelX = iconX + visual.serviceIconSize + Math.max(10, visual.servicePaddingX * 0.7)

  parts.push(
    `<g class="architecture-service" data-id="${escapeAttr(service.id)}" data-label="${escapeAttr(service.label)}">`
  )
  parts.push(
    `  <rect class="architecture-service-card" x="${service.x}" y="${service.y}" width="${service.width}" height="${service.height}" rx="${visual.serviceCornerRadius}" ry="${visual.serviceCornerRadius}" />`
  )
  parts.push(
    `  <rect class="architecture-service-accent" x="${service.x}" y="${service.y}" width="${accentWidth}" height="${service.height}" rx="${visual.serviceCornerRadius}" ry="${visual.serviceCornerRadius}" />`
  )

  if (service.icon) {
    parts.push(`  ${renderIconBadge(iconX, iconY, visual.serviceIconSize, service.icon, false)}`)
  } else {
    parts.push(
      `  <rect class="architecture-icon-bg" x="${iconX}" y="${iconY}" width="${visual.serviceIconSize}" height="${visual.serviceIconSize}" rx="0" ry="0" />`
    )
    parts.push(
      `  <rect class="architecture-icon-fill" x="${iconX + 5}" y="${iconY + 5}" width="${visual.serviceIconSize - 10}" height="${visual.serviceIconSize - 10}" rx="0" ry="0" />`
    )
  }

  parts.push(
    '  ' + renderMultilineText(
      service.label,
      labelX,
      service.y + service.height / 2,
      visual.serviceFontSize,
      `class="architecture-service-label" text-anchor="start" font-size="${visual.serviceFontSize}" font-weight="${visual.serviceFontWeight}"${letterAttr(visual.serviceLetterSpacing)}`,
    )
  )
  parts.push('</g>')
  return parts.join('\n')
}

function renderJunction(junction: PositionedArchitectureJunction, visual: ArchitectureVisualConfig): string {
  const cx = junction.x + junction.width / 2
  const cy = junction.y + junction.height / 2

  return [
    `<g class="architecture-junction" data-id="${escapeAttr(junction.id)}">`,
    `  <circle class="architecture-junction-ring" cx="${cx}" cy="${cy}" r="${visual.junctionOuterRadius}" />`,
    `  <circle class="architecture-junction-core" cx="${cx}" cy="${cy}" r="${visual.junctionInnerRadius}" />`,
    '</g>',
  ].join('\n')
}

function renderEdge(edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig): string {
  const points = edge.points.map((point) => `${point.x},${point.y}`).join(' ')
  let markers = ''
  if (edge.hasArrowStart) markers += ' marker-start="url(#architecture-arrow-start)"'
  if (edge.hasArrowEnd) markers += ' marker-end="url(#architecture-arrow-end)"'

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

  if (visual.edgeBendRadius > 0 && edge.points.length > 2) {
    return `<path ${attrs.join(' ')} d="${pointsToPathD(edge.points, visual.edgeBendRadius)}"${markers} />`
  }
  return `<polyline ${attrs.join(' ')} points="${points}"${markers} />`
}

function renderEdgeLabel(edge: PositionedArchitectureEdge, visual: ArchitectureVisualConfig): string {
  const label = edge.label!
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const metrics = measureMultilineText(label, visual.edgeFontSize, visual.edgeFontWeight)

  return renderMultilineTextWithBackground(
    label,
    mid.x,
    mid.y,
    metrics.width,
    metrics.height,
    visual.edgeFontSize,
    7,
    `class="architecture-edge-label-text" text-anchor="middle" font-size="${visual.edgeFontSize}" font-weight="${visual.edgeFontWeight}"${letterAttr(visual.edgeLetterSpacing)}`,
    `class="architecture-edge-label-bg" rx="0" ry="0"`,
  )
}

function renderIconBadge(x: number, y: number, size: number, icon: string, compact: boolean): string {
  const parts: string[] = []
  parts.push(`<g class="architecture-icon" data-icon="${escapeAttr(icon)}">`)
  parts.push(`  <rect class="architecture-icon-bg" x="${x}" y="${y}" width="${size}" height="${size}" rx="0" ry="0" />`)
  parts.push(`  ${renderIconGlyph(x, y, size, icon, compact)}`)
  parts.push('</g>')
  return parts.join('\n')
}

function renderIconGlyph(x: number, y: number, size: number, icon: string, compact: boolean): string {
  const name = normalizeIconName(icon)
  const cx = x + size / 2
  const cy = y + size / 2
  const s = compact ? size * 0.92 : size

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
        `<circle class="architecture-icon-fill" cx="${cx - s * 0.12}" cy="${cy + s * 0.16}" r="${s * 0.03}" />`,
        `<circle class="architecture-icon-fill" cx="${cx + s * 0.12}" cy="${cy + s * 0.16}" r="${s * 0.03}" />`,
      ].join('\n')
    default: {
      const glyph = fallbackIconGlyph(icon)
      return renderMultilineText(
        glyph,
        cx,
        cy,
        Math.max(10, size * 0.56),
        `class="architecture-icon-glyph" text-anchor="middle" font-size="${Math.max(10, size * 0.56)}" font-weight="700"`,
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

function arrowMarkerDefs(): string {
  return [
    '  <marker id="architecture-arrow-end" markerWidth="8" markerHeight="5" refX="7" refY="2.5" orient="auto">',
    '    <polygon points="0 0, 8 2.5, 0 5" fill="var(--_arrow)" stroke="var(--_arrow)" stroke-width="0.75" stroke-linejoin="round" />',
    '  </marker>',
    '  <marker id="architecture-arrow-start" markerWidth="8" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse">',
    '    <polygon points="8 0, 0 2.5, 8 5" fill="var(--_arrow)" stroke="var(--_arrow)" stroke-width="0.75" stroke-linejoin="round" />',
    '  </marker>',
  ].join('\n')
}

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

function pointsToPathD(points: Point[], radius: number): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`
  const parts = [`M${points[0]!.x},${points[0]!.y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const prevLen = segmentLength(prev, curr)
    const nextLen = segmentLength(curr, next)
    const r = Math.min(radius, prevLen / 2, nextLen / 2)
    if (r <= 0) {
      parts.push(`L${curr.x},${curr.y}`)
      continue
    }
    const before = pointToward(curr, prev, r)
    const after = pointToward(curr, next, r)
    parts.push(`L${before.x},${before.y}`)
    parts.push(`Q${curr.x},${curr.y} ${after.x},${after.y}`)
  }
  const last = points[points.length - 1]!
  parts.push(`L${last.x},${last.y}`)
  return parts.join(' ')
}

function pointToward(from: Point, to: Point, distance: number): Point {
  const total = segmentLength(from, to)
  if (total === 0) return { ...from }
  const t = distance / total
  return {
    x: Math.round((from.x + (to.x - from.x) * t) * 1000) / 1000,
    y: Math.round((from.y + (to.y - from.y) * t) * 1000) / 1000,
  }
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}

function transformText(text: string, transform: string | undefined): string {
  switch (transform) {
    case 'uppercase': return text.toUpperCase()
    case 'lowercase': return text.toLowerCase()
    case 'capitalize': return text.replace(/\b\p{L}/gu, ch => ch.toUpperCase())
    default: return text
  }
}

function escapeAttr(text: string): string {
  return escapeXml(text)
}

function hashDiagram(diagram: PositionedArchitectureDiagram): string {
  let h = 0x811c9dc5
  const s = `${diagram.width}|${diagram.height}|${diagram.services.map(s => s.id).join(',')}|${diagram.groups.map(g => g.id).join(',')}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
