import type { PositionedTimelineDiagram, PositionedTimelineSection, PositionedTimelinePeriod, PositionedTimelineEvent } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { MermaidThemeVariables, TimelineRuntimeConfig } from '../mermaid-source.ts'
import { topRoundedRectPath } from '../svg-paths.ts'

// ============================================================================
// Timeline diagram SVG renderer
//
// Visual language:
//   - crisp section frames aligned with the rest of beautiful-mermaid
//   - a single horizontal rail
//   - period pills above the rail
//   - stacked event cards below the rail
//   - color families only when explicitly configured by Mermaid/theme variables
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

const TIMELINE_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: TL.eventFontSize,
  edgeLabelFontSize: TL.pillFontSize,
  groupHeaderFontSize: TL.sectionFontSize,
  nodeLabelFontWeight: TL.eventFontWeight,
  edgeLabelFontWeight: TL.pillFontWeight,
  groupHeaderFontWeight: TL.sectionFontWeight,
  nodePaddingX: 14,
  nodePaddingY: 10,
  nodeCornerRadius: 0,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: 1.5,
  groupCornerRadius: 0,
  groupPaddingX: 18,
  groupPaddingY: 18,
  groupLabelPaddingX: 12,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

interface TimelineFamilyPalette {
  accent: string
  fill: string
  label: string
  line: string
}

/**
 * Render a positioned timeline diagram as an SVG string.
 */
export function renderTimelineSvg(
  diagram: PositionedTimelineDiagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  timelineConfig: TimelineRuntimeConfig = {},
  themeVariables?: MermaidThemeVariables,
  options: RenderOptions = {},
): string {
  const parts: string[] = []
  const style = resolveRenderStyle(options, TIMELINE_STYLE_DEFAULTS)
  const useSectionFamilies = diagram.sections.some(section => Boolean(section.label))
  const accessibleTitle = diagram.accessibilityTitle ?? diagram.title?.text.replace(/\n+/g, ' ')
  const accessibleDescription = diagram.accessibilityDescription
  const familyPalettes = getTimelineFamilyPalettes(timelineConfig, themeVariables)
  const allowMulticolor = !(timelineConfig.disableMulticolor && !useSectionFamilies)
  const uid = `tl-${hashTimeline(diagram)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const rootAttrs = buildAccessibilityAttrs(accessibleTitle, accessibleDescription, titleId, descId)

  parts.push(svgOpenTag(diagram.width, diagram.height, colors, transparent, rootAttrs))
  parts.push(buildStyleBlock(font, false, colors.shadow))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(`<defs>${shadowDefs}</defs>`)
  parts.push(timelineStyles(style))

  if (accessibleTitle) {
    parts.push(`<title id="${titleId}">${escapeXml(accessibleTitle)}</title>`)
  }
  if (accessibleDescription) {
    parts.push(`<desc id="${descId}">${escapeXml(accessibleDescription)}</desc>`)
  }

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const familyIndex = useSectionFamilies ? sectionIndex : 0
    if (section.framed) {
      parts.push(renderSectionFrame(section, familyIndex, familyPalettes, style))
    }
  }

  parts.push(
    `<line class="timeline-rail" x1="${diagram.rail.x1}" y1="${diagram.rail.y}" x2="${diagram.rail.x2}" y2="${diagram.rail.y}" />`
  )

  let periodFamilyIndex = 0
  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const sectionFamilyIndex = useSectionFamilies ? sectionIndex : undefined
    for (const period of section.periods) {
      const familyIndex = sectionFamilyIndex ?? (allowMulticolor ? periodFamilyIndex++ : 0)
      parts.push(renderPeriod(period, section.label, familyIndex, familyPalettes, style))
    }
  }

  if (diagram.title) {
    parts.push(
      renderMultilineText(
        diagram.title.text,
        diagram.title.x,
        diagram.title.y,
        TL.titleFontSize,
        `class="timeline-title" text-anchor="middle" font-size="${TL.titleFontSize}" font-weight="${TL.titleFontWeight}"`,
      )
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function timelineStyles(style: ResolvedRenderStyle): string {
  return `<style>
  .timeline-title { fill: var(--_text); }
  .timeline-rail { stroke: var(--_line); stroke-width: ${style.lineWidth}; stroke-linecap: round; }
  .timeline-section-bg { fill: var(--tl-section-bg, color-mix(in srgb, var(--_node-fill) 88%, var(--bg))); stroke: var(--tl-line, ${style.groupBorderColor ?? 'var(--_node-stroke)'}); stroke-width: ${style.groupLineWidth}; }
  .timeline-section-band { fill: var(--tl-section-band, color-mix(in srgb, var(--_arrow) 8%, var(--bg))); stroke: var(--tl-line, ${style.groupBorderColor ?? 'var(--_node-stroke)'}); stroke-width: ${style.groupLineWidth}; }
  .timeline-section-label { fill: var(--tl-label, var(--_text-sec)); }
  .timeline-stem { stroke: var(--tl-line, color-mix(in srgb, var(--_arrow) 32%, var(--_line))); stroke-width: ${Math.max(1, style.lineWidth * 0.75)}; stroke-dasharray: 3 4; }
  .timeline-marker-ring { fill: var(--bg); stroke: var(--tl-line, var(--_arrow)); stroke-width: 1.5; }
  .timeline-marker-core { fill: var(--tl-accent, var(--_arrow)); }
  .timeline-period-pill { fill: var(--tl-pill-fill, color-mix(in srgb, var(--_arrow) 7%, var(--bg))); stroke: var(--tl-pill-stroke, color-mix(in srgb, var(--_arrow) 20%, var(--bg))); stroke-width: ${style.nodeLineWidth}; }
  .timeline-period-text { fill: var(--tl-label, var(--_text)); }
  .timeline-event-card { fill: var(--tl-event-fill, var(--_node-fill)); stroke: var(--tl-line, var(--_node-stroke)); stroke-width: ${style.nodeLineWidth}; }
  .timeline-event-text { fill: var(--tl-label, var(--_text-muted)); }
</style>`
}

function renderSectionFrame(
  section: PositionedTimelineSection,
  familyIndex: number,
  familyPalettes: readonly TimelineFamilyPalette[],
  style: ResolvedRenderStyle,
): string {
  const parts: string[] = []
  const labelAttr = section.label ? ` data-label="${escapeAttr(section.label)}"` : ''
  const familyAttr = renderFamilyAttr(familyIndex, familyPalettes)
  parts.push(`<g class="timeline-section" data-id="${escapeAttr(section.id)}"${labelAttr}${familyAttr}>`)
  parts.push(
    `  <rect class="timeline-section-bg" x="${section.x}" y="${section.y}" width="${section.width}" height="${section.height}" rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" />`
  )

  if (section.headerHeight > 0) {
    parts.push(
      `  <path class="timeline-section-band" d="${topRoundedRectPath(section.x, section.y, section.width, section.headerHeight, style.groupCornerRadius)}" />`
    )
    if (section.label) {
      parts.push(
        '  ' + renderMultilineText(
          section.label,
          section.x + style.groupLabelPaddingX,
          section.y + section.headerHeight / 2,
          style.groupHeaderFontSize,
          `class="timeline-section-label" text-anchor="start" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)}`,
        )
      )
    }
  }

  parts.push('</g>')
  return parts.join('\n')
}

function renderPeriod(
  period: PositionedTimelinePeriod,
  sectionLabel: string | undefined,
  familyIndex: number,
  familyPalettes: readonly TimelineFamilyPalette[],
  style: ResolvedRenderStyle,
): string {
  const parts: string[] = []
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const familyAttr = renderFamilyAttr(familyIndex, familyPalettes)

  parts.push(
    `<g class="timeline-period" data-id="${escapeAttr(period.id)}" data-label="${escapeAttr(period.label)}"${sectionAttr}${familyAttr}>`
  )
  parts.push(
    `  <line class="timeline-stem" x1="${period.centerX}" y1="${period.stemTopY}" x2="${period.centerX}" y2="${period.stemBottomY}" />`
  )
  parts.push(
    `  <rect class="timeline-period-pill" x="${period.pillX}" y="${period.pillY}" width="${period.pillWidth}" height="${period.pillHeight}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" />`
  )
  parts.push(
    '  ' + renderMultilineText(
      period.label,
      period.centerX,
      period.pillY + period.pillHeight / 2,
      style.edgeLabelFontSize,
      `class="timeline-period-text" text-anchor="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}`,
    )
  )
  parts.push(
    `  <circle class="timeline-marker-ring" cx="${period.centerX}" cy="${period.markerY}" r="${TL.markerOuterRadius}" />`
  )
  parts.push(
    `  <circle class="timeline-marker-core" cx="${period.centerX}" cy="${period.markerY}" r="${TL.markerInnerRadius}" />`
  )

  for (const event of period.events) {
    parts.push(renderEvent(event, sectionLabel, familyIndex, familyPalettes, style))
  }

  parts.push('</g>')
  return parts.join('\n')
}

function renderEvent(
  event: PositionedTimelineEvent,
  sectionLabel: string | undefined,
  familyIndex: number,
  familyPalettes: readonly TimelineFamilyPalette[],
  style: ResolvedRenderStyle,
): string {
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const familyAttr = ` data-family="${familyIndex % familyPalettes.length}"`

  return [
    `<g class="timeline-event" data-id="${escapeAttr(event.id)}" data-period="${escapeAttr(event.periodLabel)}"${sectionAttr}${familyAttr}>`,
    `  <rect class="timeline-event-card" x="${event.x}" y="${event.y}" width="${event.width}" height="${event.height}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" />`,
    '  ' + renderMultilineText(
      event.text,
      event.x + style.nodePaddingX,
      event.y + event.height / 2,
      style.nodeLabelFontSize,
      `class="timeline-event-text" text-anchor="start" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
    ),
    '</g>',
].join('\n')
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

function buildAccessibilityAttrs(
  title: string | undefined,
  description: string | undefined,
  titleId: string,
  descId: string,
): Record<string, string> {
  if (!title && !description) return {}

  const attrs: Record<string, string> = { role: 'img' }
  if (title) attrs['aria-labelledby'] = titleId
  if (description) attrs['aria-describedby'] = descId
  return attrs
}

function hashTimeline(diagram: { width: number; height: number; sections: Array<{ periods: unknown[] }> }): string {
  let h = 0x811c9dc5
  const s = `${diagram.width}|${diagram.height}|${diagram.sections.map(s => s.periods.length).join(',')}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function escapeAttr(text: string): string {
  return escapeXml(text)
}
