import type { PositionedTimelineDiagram, PositionedTimelineSection, PositionedTimelinePeriod, PositionedTimelineEvent } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { TIMELINE_STYLE_DEFAULTS } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { MermaidThemeVariables, TimelineRuntimeConfig } from '../mermaid-source.ts'
import { topRoundedRectPath } from '../svg-paths.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
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
// stable id) plus its exact crisp serialization, built here from the same
// inputs. renderTimelineSvg() is DefaultBackend serialization of that scene,
// so the default path stays byte-identical to the historical string renderer
// (corpus-gated by svg-equivalence.test.ts).
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
  ctx: RenderContext<PositionedTimelineDiagram>,
): string {
  return DefaultBackend.render(lowerTimelineScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned timeline diagram to the SceneGraph IR. Mark order matches
 * the historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerTimelineScene(
  ctx: RenderContext<PositionedTimelineDiagram>,
): SceneDoc {
  const { positioned: diagram, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const timelineConfig = options.mermaidConfig?.timeline ?? {}
  const themeVariables = options.mermaidConfig?.themeVariables
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, TIMELINE_STYLE_DEFAULTS)
  const paints = timelinePaints(style)
  const useSectionFamilies = diagram.sections.some(section => Boolean(section.label))
  const accessibleTitle = diagram.accessibilityTitle ?? diagram.title?.text.replace(/\n+/g, ' ')
  const accessibleDescription = diagram.accessibilityDescription
  const familyPalettes = getTimelineFamilyPalettes(timelineConfig, themeVariables)
  const allowMulticolor = !(timelineConfig.disableMulticolor && !useSectionFamilies)
  const uid = `tl-${hashTimeline(diagram)}`
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
  parts.push(marks.prelude(
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
    parts.push(marks.raw(
      { id: 'a11y-title', role: 'chrome' },
      `<title id="${titleId}">${escapeXml(accessibleTitle)}</title>`,
    ))
  }
  if (accessibleDescription) {
    parts.push(marks.raw(
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

  parts.push(marks.shape(
    {
      id: 'rail',
      role: 'rail',
      geometry: { kind: 'line', x1: diagram.rail.x1, y1: diagram.rail.y, x2: diagram.rail.x2, y2: diagram.rail.y },
      paint: paints.rail,
    },
    `<line class="timeline-rail" x1="${diagram.rail.x1}" y1="${diagram.rail.y}" x2="${diagram.rail.x2}" y2="${diagram.rail.y}" />`,
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

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'timeline', width: diagram.width, height: diagram.height, colors, parts }
}

/** Resolved per-role paints — mirrors the class rules in timelineStyles(), so
 *  styled backends see the same colors the crisp CSS classes resolve to.
 *  Keep in sync with timelineStyles(). */
function timelinePaints(style: ResolvedRenderStyle) {
  return {
    title: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
    rail: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) },
    sectionBg: {
      fill: `var(--tl-section-bg, ${style.groupFillColor ?? 'color-mix(in srgb, var(--_node-fill) 88%, var(--bg))'})`,
      stroke: `var(--tl-line, ${style.groupBorderColor ?? 'var(--_node-stroke)'})`,
      strokeWidth: String(style.groupLineWidth),
    },
    sectionBand: {
      fill: `var(--tl-section-band, ${style.groupHeaderFillColor ?? 'color-mix(in srgb, var(--_arrow) 8%, var(--bg))'})`,
      stroke: `var(--tl-line, ${style.groupBorderColor ?? 'var(--_node-stroke)'})`,
      strokeWidth: String(style.groupLineWidth),
    },
    sectionLabel: { fill: `var(--tl-label, ${style.groupTextColor ?? 'var(--_text-sec)'})` },
    stem: {
      stroke: `var(--tl-line, ${style.edgeStrokeColor ?? 'color-mix(in srgb, var(--_arrow) 32%, var(--_line))'})`,
      strokeWidth: String(Math.max(1, style.lineWidth * 0.75)),
      strokeDasharray: '3 4',
    },
    markerRing: {
      fill: 'var(--bg)',
      stroke: `var(--tl-line, ${style.edgeStrokeColor ?? 'var(--_arrow)'})`,
      strokeWidth: '1.5',
    },
    markerCore: { fill: `var(--tl-accent, ${style.edgeStrokeColor ?? 'var(--_arrow)'})` },
    pill: {
      fill: `var(--tl-pill-fill, ${style.nodeFillColor ?? 'color-mix(in srgb, var(--_arrow) 7%, var(--bg))'})`,
      stroke: `var(--tl-pill-stroke, ${style.nodeBorderColor ?? 'color-mix(in srgb, var(--_arrow) 20%, var(--bg))'})`,
      strokeWidth: String(style.nodeLineWidth),
    },
    periodText: { fill: `var(--tl-label, ${style.nodeTextColor ?? 'var(--_text)'})` },
    eventCard: {
      fill: `var(--tl-event-fill, ${style.nodeFillColor ?? 'var(--_node-fill)'})`,
      stroke: `var(--tl-line, ${style.nodeBorderColor ?? 'var(--_node-stroke)'})`,
      strokeWidth: String(style.nodeLineWidth),
    },
    eventText: { fill: `var(--tl-label, ${style.nodeTextColor ?? 'var(--_text-muted)'})` },
  }
}

type TimelinePaints = ReturnType<typeof timelinePaints>

function timelineStyles(style: ResolvedRenderStyle): string {
  return `<style>
  .timeline-title { fill: ${style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
  .timeline-rail { stroke: ${style.edgeStrokeColor ?? 'var(--_line)'}; stroke-width: ${style.lineWidth}; stroke-linecap: round; }
  .timeline-section-bg { fill: var(--tl-section-bg, ${style.groupFillColor ?? 'color-mix(in srgb, var(--_node-fill) 88%, var(--bg))'}); stroke: var(--tl-line, ${style.groupBorderColor ?? 'var(--_node-stroke)'}); stroke-width: ${style.groupLineWidth}; }
  .timeline-section-band { fill: var(--tl-section-band, ${style.groupHeaderFillColor ?? 'color-mix(in srgb, var(--_arrow) 8%, var(--bg))'}); stroke: var(--tl-line, ${style.groupBorderColor ?? 'var(--_node-stroke)'}); stroke-width: ${style.groupLineWidth}; }
  .timeline-section-label { fill: var(--tl-label, ${style.groupTextColor ?? 'var(--_text-sec)'}); }
  .timeline-stem { stroke: var(--tl-line, ${style.edgeStrokeColor ?? 'color-mix(in srgb, var(--_arrow) 32%, var(--_line))'}); stroke-width: ${Math.max(1, style.lineWidth * 0.75)}; stroke-dasharray: 3 4; }
  .timeline-marker-ring { fill: var(--bg); stroke: var(--tl-line, ${style.edgeStrokeColor ?? 'var(--_arrow)'}); stroke-width: 1.5; }
  .timeline-marker-core { fill: var(--tl-accent, ${style.edgeStrokeColor ?? 'var(--_arrow)'}); }
  .timeline-period-pill { fill: var(--tl-pill-fill, ${style.nodeFillColor ?? 'color-mix(in srgb, var(--_arrow) 7%, var(--bg))'}); stroke: var(--tl-pill-stroke, ${style.nodeBorderColor ?? 'color-mix(in srgb, var(--_arrow) 20%, var(--bg))'}); stroke-width: ${style.nodeLineWidth}; }
  .timeline-period-text { fill: var(--tl-label, ${style.nodeTextColor ?? 'var(--_text)'}); }
  .timeline-event-card { fill: var(--tl-event-fill, ${style.nodeFillColor ?? 'var(--_node-fill)'}); stroke: var(--tl-line, ${style.nodeBorderColor ?? 'var(--_node-stroke)'}); stroke-width: ${style.nodeLineWidth}; }
  .timeline-event-text { fill: var(--tl-label, ${style.nodeTextColor ?? 'var(--_text-muted)'}); }
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
        id: `period-stem:${period.label}`,
        role: 'period',
        geometry: { kind: 'line', x1: period.centerX, y1: period.stemTopY, x2: period.centerX, y2: period.stemBottomY },
        paint: paints.stem,
      },
      `<line class="timeline-stem" x1="${period.centerX}" y1="${period.stemTopY}" x2="${period.centerX}" y2="${period.stemBottomY}" />`,
    ),
  })
  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `period-pill:${period.label}`,
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
        id: `period-label:${period.label}`,
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
        id: `period-marker-ring:${period.label}`,
        role: 'period',
        geometry: { kind: 'circle', cx: period.centerX, cy: period.markerY, r: TL.markerOuterRadius },
        paint: paints.markerRing,
      },
      `<circle class="timeline-marker-ring" cx="${period.centerX}" cy="${period.markerY}" r="${TL.markerOuterRadius}" />`,
    ),
  })
  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `period-marker-core:${period.label}`,
        role: 'period',
        geometry: { kind: 'circle', cx: period.centerX, cy: period.markerY, r: TL.markerInnerRadius },
        paint: paints.markerCore,
      },
      `<circle class="timeline-marker-core" cx="${period.centerX}" cy="${period.markerY}" r="${TL.markerInnerRadius}" />`,
    ),
  })

  // Event cards are nested inside the period <g> without extra indentation
  // (the string renderer pushed them unindented) — hence indent 0.
  for (let k = 0; k < period.events.length; k++) {
    children.push({
      indent: 0,
      node: lowerEvent(period.events[k]!, k, sectionLabel, familyIndex, familyPalettes, style, paints),
    })
  }

  return marks.group({
    id: `period:${period.label}`,
    role: 'period',
    open: `<g class="timeline-period" data-id="${escapeAttr(period.id)}" data-label="${escapeAttr(period.label)}"${sectionAttr}${familyAttr}>`,
    close: '</g>',
    children,
  })
}

function lowerEvent(
  event: PositionedTimelineEvent,
  k: number,
  sectionLabel: string | undefined,
  familyIndex: number,
  familyPalettes: readonly TimelineFamilyPalette[],
  style: ResolvedRenderStyle,
  paints: TimelinePaints,
): SceneNode {
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const familyAttr = ` data-family="${familyIndex % familyPalettes.length}"`
  const idBase = `event:${event.periodLabel}:${k}`

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
