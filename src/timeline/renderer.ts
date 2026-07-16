import type { PositionedTimelineDiagram, PositionedTimelineSection, PositionedTimelinePeriod, PositionedTimelineEvent } from './types.ts'
import type { RenderContext, RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { TIMELINE_STYLE_DEFAULTS } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { escapeAttr, renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { MermaidThemeVariables, TimelineRuntimeConfig } from '../mermaid-source.ts'
import { topRoundedRectPath } from '../svg-paths.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'

// ============================================================================
// Timeline diagram SVG renderer
//
// Visual language:
//   - crisp section frames aligned with the rest of Agentic Mermaid
//   - a single horizontal rail
//   - period pills above the rail
//   - stacked event cards below the rail
//   - color families only when explicitly configured by Mermaid/theme variables
//
// The positioned diagram is lowered to the SceneGraph IR (SPEC §3.1): every
// visual mark carries semantic fields (role, geometry, paint, channels,
// stable id). renderTimelineSvg() uses DefaultBackend serialization of that scene.
// ============================================================================

const TL = {
  titleFontSize: 18,
  titleFontWeight: 600,
  sectionFontSize: 12,
  sectionFontWeight: 600,
  pillFontSize: 12,
  pillFontWeight: 600,
  eventFontSize: 12,
  eventFontWeight: 400,
  markerOuterRadius: 8,
  markerInnerRadius: 4.5,
} as const

export interface TimelineFamilyPalette {
  accent: string
  fill: string
  label: string
  line: string
}

export interface TimelineRequestAppearance {
  timelineConfig: TimelineRuntimeConfig
  familyPalettes: readonly TimelineFamilyPalette[]
}

/**
 * Render a positioned timeline diagram as an SVG string.
 */
export function renderTimelineSvg(
  ctx: RenderContext<PositionedTimelineDiagram>,
): string {
  return DefaultBackend.render(lowerTimelineScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned timeline diagram to the SceneGraph IR in canonical mark order.
 */
export function lowerTimelineScene(
  ctx: RenderContext<PositionedTimelineDiagram>,
): SceneDoc {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const timelineAppearance = resolved.familyAppearance as TimelineRequestAppearance | undefined
  if (!timelineAppearance) throw new Error('Timeline rendering requires request-boundary family appearance resolution')
  const timelineConfig = timelineAppearance.timelineConfig
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, TIMELINE_STYLE_DEFAULTS, resolved.styleFace)
  const paints = timelinePaints(style)
  const accessibleTitle = diagram.accessibilityTitle ?? diagram.title?.text.replace(/\n+/g, ' ')
  const accessibleDescription = diagram.accessibilityDescription
  const familyPalettes = timelineAppearance.familyPalettes
  // disableMulticolor collapses every color family to 0 — for per-period
  // families AND labeled per-section families (upstream semantics; the old
  // gate skipped labeled sections, plan §Timeline 3).
  const allowMulticolor = !timelineConfig.disableMulticolor
  const useSectionFamilies = allowMulticolor && diagram.sections.some(section => Boolean(section.label))
  const uid = `tl-${hashId(diagram.width, diagram.height, diagram.sections.map(s => s.periods.length).join(','))}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const rootAttrs = buildAccessibilityAttrs(accessibleTitle, accessibleDescription, titleId, descId)

  // SVG root with CSS variables + shared style block (+ optional shadow defs)
  // + timeline CSS — the exact chunks the string renderer pushed, joined '\n'.
  // The shadow <defs> sit between the two style blocks (matching the historical
  // push order); they are re-derivable from prelude.colors, so styled backends
  // lose nothing by their living inside the prelude crisp.
  const extraCss = timelineStyles(style)
  const preludeSegments = [
    svgOpenTag(diagram.width, diagram.height, colors, transparent, rootAttrs),
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport),
  ]
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) preludeSegments.push(`<defs>${shadowDefs}</defs>`)
  preludeSegments.push(extraCss)
  parts.push(marks.documentOpen(
    {
      id: 'prelude',
      width: diagram.width,
      height: diagram.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      extraCss,
    },
    preludeSegments.join('\n'),
  ))

  if (accessibleTitle) {
    parts.push(marks.documentContent(
      { id: 'a11y-title', role: 'chrome' },
      `<title id="${titleId}">${escapeXml(accessibleTitle)}</title>`,
    ))
  }
  if (accessibleDescription) {
    parts.push(marks.documentContent(
      { id: 'a11y-desc', role: 'chrome' },
      `<desc id="${descId}">${escapeXml(accessibleDescription)}</desc>`,
    ))
  }

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const familyIndex = useSectionFamilies ? sectionIndex : 0
    if (section.framed) {
      parts.push(lowerSectionFrame(section, familyIndex, familyPalettes, style, paints))
    }
  }

  // The rail segment is horizontal in LR (y1 === y2) and vertical in TD
  // (x1 === x2) — the crisp emits the positioned endpoints either way.
  parts.push(marks.shape(
    {
      id: 'rail',
      role: 'rail',
      geometry: { kind: 'line', x1: diagram.rail.x1, y1: diagram.rail.y1, x2: diagram.rail.x2, y2: diagram.rail.y2 },
      paint: paints.rail,
    },
    `<line class="timeline-rail" x1="${diagram.rail.x1}" y1="${diagram.rail.y1}" x2="${diagram.rail.x2}" y2="${diagram.rail.y2}" />`,
  ))

  let periodFamilyIndex = 0
  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const sectionFamilyIndex = useSectionFamilies ? sectionIndex : undefined
    for (const period of section.periods) {
      const familyIndex = sectionFamilyIndex ?? (allowMulticolor ? periodFamilyIndex++ : 0)
      parts.push(lowerPeriod(period, section.label, familyIndex, familyPalettes, style, paints))
    }
  }

  if (diagram.title) {
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: diagram.title.text,
        x: diagram.title.x,
        y: diagram.title.y,
        fontSize: TL.titleFontSize,
        anchor: 'middle',
        paint: paints.title,
      },
      renderMultilineText(
        diagram.title.text,
        diagram.title.x,
        diagram.title.y,
        TL.titleFontSize,
        `class="timeline-title" text-anchor="middle" font-size="${TL.titleFontSize}" font-weight="${TL.titleFontWeight}"`,
      ),
    ))
  }

  parts.push(marks.documentClose())

  return { family: 'timeline', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

/** Resolved per-role paints — mirrors the class rules in timelineStyles(), so
 *  styled backends see the same colors the crisp CSS classes resolve to.
 *  Keep in sync with timelineStyles(). */
function timelinePaints(style: ResolvedRenderStyle) {
  return {
    title: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
    rail: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) },
    sectionBg: {
      fill: style.groupFillColor ?? 'var(--tl-section-bg, color-mix(in srgb, var(--_node-fill) 88%, var(--bg)))',
      stroke: style.groupBorderColor ?? 'var(--tl-line, var(--_node-stroke))',
      strokeWidth: String(style.groupLineWidth),
    },
    sectionBand: {
      fill: style.groupHeaderFillColor ?? 'var(--tl-section-band, color-mix(in srgb, var(--_arrow) 8%, var(--bg)))',
      stroke: style.groupBorderColor ?? 'var(--tl-line, var(--_node-stroke))',
      strokeWidth: String(style.groupLineWidth),
    },
    sectionLabel: { fill: style.groupTextColor ?? 'var(--tl-label, var(--_text-sec))' },
    stem: {
      stroke: style.edgeStrokeColor ?? 'var(--tl-line, color-mix(in srgb, var(--_arrow) 32%, var(--_line)))',
      strokeWidth: String(Math.max(1, style.lineWidth * 0.75)),
      strokeDasharray: '3 4',
    },
    markerRing: {
      fill: 'var(--bg)',
      stroke: style.edgeStrokeColor ?? 'var(--tl-line, var(--_arrow))',
      strokeWidth: '1.5',
    },
    markerCore: { fill: style.edgeStrokeColor ?? 'var(--tl-accent, var(--_arrow))' },
    pill: {
      fill: style.nodeFillColor ?? 'var(--tl-pill-fill, color-mix(in srgb, var(--_arrow) 7%, var(--bg)))',
      stroke: style.nodeBorderColor ?? 'var(--tl-pill-stroke, color-mix(in srgb, var(--_arrow) 20%, var(--bg)))',
      strokeWidth: String(style.nodeLineWidth),
    },
    periodText: { fill: style.nodeTextColor ?? 'var(--tl-label, var(--_text))' },
    eventCard: {
      fill: style.nodeFillColor ?? 'var(--tl-event-fill, var(--_node-fill))',
      stroke: style.nodeBorderColor ?? 'var(--tl-line, var(--_node-stroke))',
      strokeWidth: String(style.nodeLineWidth),
    },
    eventText: { fill: style.nodeTextColor ?? 'var(--tl-label, var(--_text-muted))' },
  }
}

type TimelinePaints = ReturnType<typeof timelinePaints>

function timelineStyles(style: ResolvedRenderStyle): string {
  return `<style>
  .timeline-title { fill: ${style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
  .timeline-rail { stroke: ${style.edgeStrokeColor ?? 'var(--_line)'}; stroke-width: ${style.lineWidth}; stroke-linecap: round; }
  .timeline-section-bg { fill: ${style.groupFillColor ?? 'var(--tl-section-bg, color-mix(in srgb, var(--_node-fill) 88%, var(--bg)))'}; stroke: ${style.groupBorderColor ?? 'var(--tl-line, var(--_node-stroke))'}; stroke-width: ${style.groupLineWidth}; }
  .timeline-section-band { fill: ${style.groupHeaderFillColor ?? 'var(--tl-section-band, color-mix(in srgb, var(--_arrow) 8%, var(--bg)))'}; stroke: ${style.groupBorderColor ?? 'var(--tl-line, var(--_node-stroke))'}; stroke-width: ${style.groupLineWidth}; }
  .timeline-section-label { fill: ${style.groupTextColor ?? 'var(--tl-label, var(--_text-sec))'}; }
  .timeline-stem { stroke: ${style.edgeStrokeColor ?? 'var(--tl-line, color-mix(in srgb, var(--_arrow) 32%, var(--_line)))'}; stroke-width: ${Math.max(1, style.lineWidth * 0.75)}; stroke-dasharray: 3 4; }
  .timeline-marker-ring { fill: var(--bg); stroke: ${style.edgeStrokeColor ?? 'var(--tl-line, var(--_arrow))'}; stroke-width: 1.5; }
  .timeline-marker-core { fill: ${style.edgeStrokeColor ?? 'var(--tl-accent, var(--_arrow))'}; }
  .timeline-period-pill { fill: ${style.nodeFillColor ?? 'var(--tl-pill-fill, color-mix(in srgb, var(--_arrow) 7%, var(--bg)))'}; stroke: ${style.nodeBorderColor ?? 'var(--tl-pill-stroke, color-mix(in srgb, var(--_arrow) 20%, var(--bg)))'}; stroke-width: ${style.nodeLineWidth}; }
  .timeline-period-text { fill: ${style.nodeTextColor ?? 'var(--tl-label, var(--_text))'}; }
  .timeline-event-card { fill: ${style.nodeFillColor ?? 'var(--tl-event-fill, var(--_node-fill))'}; stroke: ${style.nodeBorderColor ?? 'var(--tl-line, var(--_node-stroke))'}; stroke-width: ${style.nodeLineWidth}; }
  .timeline-event-text { fill: ${style.nodeTextColor ?? 'var(--tl-label, var(--_text-muted))'}; }
</style>`
}

function lowerSectionFrame(
  section: PositionedTimelineSection,
  familyIndex: number,
  familyPalettes: readonly TimelineFamilyPalette[],
  style: ResolvedRenderStyle,
  paints: TimelinePaints,
): SceneNode {
  const sectionName = section.label ?? section.id
  const labelAttr = section.label ? ` data-label="${escapeAttr(section.label)}"` : ''
  const familyAttr = renderFamilyAttr(familyIndex, familyPalettes)
  const children: Array<{ node: SceneNode; indent: number }> = []

  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `section-bg:${sectionName}`,
        role: 'section',
        geometry: { kind: 'rect', x: section.x, y: section.y, width: section.width, height: section.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
        paint: paints.sectionBg,
      },
      `<rect class="timeline-section-bg" x="${section.x}" y="${section.y}" width="${section.width}" height="${section.height}" rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" />`,
    ),
  })

  if (section.headerHeight > 0) {
    const bandPath = topRoundedRectPath(section.x, section.y, section.width, section.headerHeight, style.groupCornerRadius)
    children.push({
      indent: 2,
      node: marks.shape(
        {
          id: `section-band:${sectionName}`,
          role: 'group-header',
          geometry: { kind: 'path', d: bandPath },
          paint: paints.sectionBand,
        },
        `<path class="timeline-section-band" d="${bandPath}" />`,
      ),
    })
    if (section.label) {
      children.push({
        indent: 2,
        node: marks.text(
          {
            id: `section-label:${sectionName}`,
            role: 'group-header',
            text: section.label,
            x: section.x + style.groupLabelPaddingX,
            y: section.y + section.headerHeight / 2,
            fontSize: style.groupHeaderFontSize,
            anchor: 'start',
            paint: paints.sectionLabel,
          },
          renderMultilineText(
            section.label,
            section.x + style.groupLabelPaddingX,
            section.y + section.headerHeight / 2,
            style.groupHeaderFontSize,
            `class="timeline-section-label" text-anchor="start" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)}`,
          ),
        ),
      })
    }
  }

  // The section <g> carries the per-family palette as inline --tl-* custom
  // properties (via renderFamilyAttr) — that exact style="" string is part of
  // the wrapper semantics and must survive restyling byte-for-byte.
  return marks.group({
    id: `section:${sectionName}`,
    role: 'section',
    open: `<g class="timeline-section" data-id="${escapeAttr(section.id)}"${labelAttr}${familyAttr}>`,
    close: '</g>',
    children,
    channels: { category: sectionName },
  })
}

function lowerPeriod(
  period: PositionedTimelinePeriod,
  sectionLabel: string | undefined,
  familyIndex: number,
  familyPalettes: readonly TimelineFamilyPalette[],
  style: ResolvedRenderStyle,
  paints: TimelinePaints,
): SceneNode {
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const familyAttr = renderFamilyAttr(familyIndex, familyPalettes)
  const children: Array<{ node: SceneNode; indent: number }> = []

  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `period-stem:${period.id}`,
        role: 'period',
        geometry: { kind: 'line', x1: period.stem.x1, y1: period.stem.y1, x2: period.stem.x2, y2: period.stem.y2 },
        paint: paints.stem,
      },
      `<line class="timeline-stem" x1="${period.stem.x1}" y1="${period.stem.y1}" x2="${period.stem.x2}" y2="${period.stem.y2}" />`,
    ),
  })
  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `period-pill:${period.id}`,
        role: 'period',
        geometry: { kind: 'rect', x: period.pillX, y: period.pillY, width: period.pillWidth, height: period.pillHeight, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
        paint: paints.pill,
      },
      `<rect class="timeline-period-pill" x="${period.pillX}" y="${period.pillY}" width="${period.pillWidth}" height="${period.pillHeight}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" />`,
    ),
  })
  children.push({
    indent: 2,
    node: marks.text(
      {
        id: `period-label:${period.id}`,
        role: 'label',
        text: period.label,
        x: period.centerX,
        y: period.pillY + period.pillHeight / 2,
        fontSize: style.edgeLabelFontSize,
        anchor: 'middle',
        paint: paints.periodText,
      },
      renderMultilineText(
        period.label,
        period.centerX,
        period.pillY + period.pillHeight / 2,
        style.edgeLabelFontSize,
        `class="timeline-period-text" text-anchor="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}`,
      ),
    ),
  })
  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `period-marker-ring:${period.id}`,
        role: 'period',
        geometry: { kind: 'circle', cx: period.markerX, cy: period.markerY, r: TL.markerOuterRadius },
        paint: paints.markerRing,
      },
      `<circle class="timeline-marker-ring" cx="${period.markerX}" cy="${period.markerY}" r="${TL.markerOuterRadius}" />`,
    ),
  })
  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `period-marker-core:${period.id}`,
        role: 'period',
        geometry: { kind: 'circle', cx: period.markerX, cy: period.markerY, r: TL.markerInnerRadius },
        paint: paints.markerCore,
      },
      `<circle class="timeline-marker-core" cx="${period.markerX}" cy="${period.markerY}" r="${TL.markerInnerRadius}" />`,
    ),
  })

  // Event cards are nested inside the period <g> without extra indentation
  // (the string renderer pushed them unindented) — hence indent 0.
  for (let k = 0; k < period.events.length; k++) {
    children.push({
      indent: 0,
      node: lowerEvent(period.events[k]!, sectionLabel, familyIndex, familyPalettes, style, paints),
    })
  }

  return marks.group({
    id: `period:${period.id}`,
    role: 'period',
    open: `<g class="timeline-period" data-id="${escapeAttr(period.id)}" data-label="${escapeAttr(period.label)}"${sectionAttr}${familyAttr}>`,
    close: '</g>',
    children,
  })
}

function lowerEvent(
  event: PositionedTimelineEvent,
  sectionLabel: string | undefined,
  familyIndex: number,
  familyPalettes: readonly TimelineFamilyPalette[],
  style: ResolvedRenderStyle,
  paints: TimelinePaints,
): SceneNode {
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const familyAttr = ` data-family="${familyIndex % familyPalettes.length}"`
  const idBase = `event:${event.id}`

  const card = marks.shape(
    {
      id: idBase,
      role: 'event',
      geometry: { kind: 'rect', x: event.x, y: event.y, width: event.width, height: event.height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
      paint: paints.eventCard,
    },
    `<rect class="timeline-event-card" x="${event.x}" y="${event.y}" width="${event.width}" height="${event.height}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" />`,
  )

  const label = marks.text(
    {
      id: `${idBase}:label`,
      role: 'label',
      text: event.text,
      x: event.x + style.nodePaddingX,
      y: event.y + event.height / 2,
      fontSize: style.nodeLabelFontSize,
      anchor: 'start',
      paint: paints.eventText,
    },
    renderMultilineText(
      event.text,
      event.x + style.nodePaddingX,
      event.y + event.height / 2,
      style.nodeLabelFontSize,
      `class="timeline-event-text" text-anchor="start" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
    ),
  )

  return marks.group({
    id: `${idBase}:group`,
    role: 'event',
    open: `<g class="timeline-event" data-id="${escapeAttr(event.id)}" data-period="${escapeAttr(event.periodLabel)}"${sectionAttr}${familyAttr}>`,
    close: '</g>',
    children: [
      { indent: 2, node: card },
      { indent: 2, node: label },
    ],
  })
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}

function renderFamilyAttr(familyIndex: number, familyPalettes: readonly TimelineFamilyPalette[]): string {
  const family = familyIndex % familyPalettes.length
  const palette = familyPalettes[family]!
  const style = [
    `--tl-accent:${palette.accent}`,
    `--tl-fill:${palette.fill}`,
    `--tl-label:${palette.label}`,
    `--tl-line:${palette.line}`,
    `--tl-section-bg:${mix(palette.fill, 'var(--bg)', 6)}`,
    `--tl-section-band:${mix(palette.fill, 'var(--bg)', 12)}`,
    `--tl-pill-fill:${mix(palette.fill, 'var(--bg)', 11)}`,
    `--tl-pill-stroke:${mix(palette.fill, palette.line, 36)}`,
    `--tl-event-fill:${mix(palette.fill, 'var(--_node-fill)', 16)}`,
  ].join(';')

  return ` data-family="${family}" style="${escapeAttr(style)}"`
}

export function resolveTimelineRequestAppearance(options: RenderOptions = {}): TimelineRequestAppearance {
  const timelineConfig = options.mermaidConfig?.timeline ?? {}
  return {
    timelineConfig,
    familyPalettes: getTimelineFamilyPalettes(timelineConfig, options.mermaidConfig?.themeVariables),
  }
}

function getTimelineFamilyPalettes(
  timelineConfig: TimelineRuntimeConfig,
  themeVariables?: MermaidThemeVariables,
): readonly TimelineFamilyPalette[] {
  const customFills = timelineConfig.sectionFills ?? []
  const customLabels = timelineConfig.sectionColours ?? []

  return Array.from({ length: 12 }, (_, index) => {
    const explicitFill = customFills[index % Math.max(customFills.length, 1)]
      ?? readTimelineScale(themeVariables, 'cScale', index)
    const fill = explicitFill ?? 'var(--_node-fill)'
    const label = customLabels[index % Math.max(customLabels.length, 1)]
      ?? readTimelineScale(themeVariables, 'cScaleLabel', index)
      ?? 'var(--_text)'
    const line = readTimelineScale(themeVariables, 'cScaleInv', index)
      ?? (explicitFill ? mix(fill, 'var(--_line)', 48) : 'var(--_line)')
    const accent = explicitFill ?? 'var(--_arrow)'

    return { accent, fill, label, line }
  })
}

function mix(primary: string, secondary: string, amount: number): string {
  return `color-mix(in srgb, ${primary} ${amount}%, ${secondary})`
}

function readTimelineScale(
  themeVariables: MermaidThemeVariables | undefined,
  prefix: 'cScale' | 'cScaleLabel' | 'cScaleInv',
  index: number,
): string | undefined {
  if (!themeVariables) return undefined
  const value = themeVariables[`${prefix}${index}`]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
