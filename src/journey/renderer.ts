import type { PositionedJourneyDiagram, PositionedJourneySection, PositionedJourneyTask, PositionedJourneyActorPill } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'

// ============================================================================
// Journey diagram SVG renderer
//
// Visual language:
//   - crisp section frames consistent with timeline / class / ER styling
//   - stacked task cards with an accent rail
//   - compact score meters and actor pills for readable metadata
//   - root SVG accessibility metadata sourced from Mermaid accTitle/accDescr
// ============================================================================

const JY = {
  titleFontSize: 18,
  titleFontWeight: 600,
  sectionFontSize: 12,
  sectionFontWeight: 600,
  taskFontSize: 13,
  taskFontWeight: 500,
  taskPadX: 14,
  taskPadY: 12,
  actorFontSize: 11,
  actorFontWeight: 600,
  taskAccentWidth: 4,
} as const

const JOURNEY_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: JY.taskFontSize,
  edgeLabelFontSize: JY.actorFontSize,
  groupHeaderFontSize: JY.sectionFontSize,
  nodeLabelFontWeight: JY.taskFontWeight,
  edgeLabelFontWeight: JY.actorFontWeight,
  groupHeaderFontWeight: JY.sectionFontWeight,
  nodePaddingX: JY.taskPadX,
  nodePaddingY: JY.taskPadY,
  nodeCornerRadius: 0,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: 18,
  groupPaddingY: 18,
  groupLabelPaddingX: 12,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

/**
 * Render a positioned journey diagram as an SVG string.
 */
export function renderJourneySvg(
  diagram: PositionedJourneyDiagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  options: RenderOptions = {},
): string {
  const parts: string[] = []
  const style = resolveRenderStyle(options, JOURNEY_STYLE_DEFAULTS)

  const accessibility = buildJourneyAccessibility(diagram)
  const uid = `journey-${hashJourney(diagram)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`

  parts.push(openJourneySvgTag(diagram, colors, transparent, accessibility, titleId, descId))
  if (accessibility.title) {
    parts.push(`<title id="${titleId}">${escapeXml(accessibility.title)}</title>`)
  }
  if (accessibility.description) {
    parts.push(`<desc id="${descId}">${escapeXml(accessibility.description)}</desc>`)
  }
  parts.push(buildStyleBlock(font, false, colors.shadow))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(`<defs>${shadowDefs}</defs>`)
  parts.push(journeyStyles(style))

  for (const section of diagram.sections) {
    if (section.framed) {
      parts.push(renderSectionFrame(section, style))
    }
  }

  for (const section of diagram.sections) {
    for (const task of section.tasks) {
      parts.push(renderTask(task, section.label, style))
    }
  }

  if (diagram.title) {
    parts.push(
      renderMultilineText(
        diagram.title.text,
        diagram.title.x,
        diagram.title.y,
        JY.titleFontSize,
        `class="journey-title" text-anchor="middle" font-size="${JY.titleFontSize}" font-weight="${JY.titleFontWeight}"`,
      )
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function buildJourneyAccessibility(diagram: PositionedJourneyDiagram): {
  title?: string
  description?: string
} {
  return {
    title: diagram.accessibilityTitle ?? diagram.title?.text,
    description: diagram.accessibilityDescription,
  }
}

function openJourneySvgTag(
  diagram: PositionedJourneyDiagram,
  colors: DiagramColors,
  transparent: boolean,
  accessibility: { title?: string; description?: string },
  titleId: string,
  descId: string,
): string {
  const attrs = ['role="img"', 'aria-roledescription="user journey"']
  if (accessibility.title) attrs.push(`aria-labelledby="${titleId}"`)
  if (accessibility.description) attrs.push(`aria-describedby="${descId}"`)

  return svgOpenTag(diagram.width, diagram.height, colors, transparent)
    .replace('>', ` ${attrs.join(' ')}>`)
}

function journeyStyles(style: ResolvedRenderStyle): string {
  return `<style>
  .journey-title { fill: var(--_text); }
  .journey-section-bg { fill: color-mix(in srgb, var(--_node-fill) 88%, var(--bg)); stroke: ${style.groupBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.groupLineWidth}; }
  .journey-section-band { fill: color-mix(in srgb, var(--_arrow) 8%, var(--bg)); stroke: ${style.groupBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.groupLineWidth}; }
  .journey-section-label { fill: var(--_text-sec); }
  .journey-task-card { fill: var(--_node-fill); stroke: var(--_node-stroke); stroke-width: ${style.nodeLineWidth}; }
  .journey-task-accent { fill: color-mix(in srgb, var(--_arrow) 18%, var(--bg)); }
  .journey-task-text { fill: var(--_text); }
  .journey-score-cell-filled { fill: var(--_arrow); stroke: var(--_arrow); stroke-width: 1; }
  .journey-score-cell-empty { fill: color-mix(in srgb, var(--bg) 55%, var(--_node-fill)); stroke: color-mix(in srgb, var(--_node-stroke) 82%, var(--bg)); stroke-width: 1; }
  .journey-actor-pill { fill: color-mix(in srgb, var(--_arrow) 8%, var(--bg)); stroke: color-mix(in srgb, var(--_arrow) 22%, var(--bg)); stroke-width: 1; }
  .journey-actor-text { fill: var(--_text-sec); }
</style>`
}

function renderSectionFrame(section: PositionedJourneySection, style: ResolvedRenderStyle): string {
  const parts: string[] = []
  const labelAttr = section.label ? ` data-label="${escapeAttr(section.label)}"` : ''

  parts.push(`<g class="journey-section" data-id="${escapeAttr(section.id)}"${labelAttr}>`)
  parts.push(
    `  <rect class="journey-section-bg" x="${section.x}" y="${section.y}" width="${section.width}" height="${section.height}" rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" />`
  )

  if (section.headerHeight > 0) {
    parts.push(
      `  <rect class="journey-section-band" x="${section.x}" y="${section.y}" width="${section.width}" height="${section.headerHeight}" rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" />`
    )

    if (section.label) {
      parts.push(
        '  ' + renderMultilineText(
          section.label,
          section.x + style.groupLabelPaddingX,
          section.y + section.headerHeight / 2,
          style.groupHeaderFontSize,
          `class="journey-section-label" text-anchor="start" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)}`,
        )
      )
    }
  }

  parts.push('</g>')
  return parts.join('\n')
}

function renderTask(task: PositionedJourneyTask, sectionLabel: string | undefined, style: ResolvedRenderStyle): string {
  const parts: string[] = []
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const actorAttr = task.actors.length > 0 ? ` data-actors="${escapeAttr(task.actors.join(', '))}"` : ''

  parts.push(
    `<g class="journey-task" data-id="${escapeAttr(task.id)}" data-score="${task.score}"${sectionAttr}${actorAttr}>`
  )
  parts.push(
    `  <rect class="journey-task-card" x="${task.x}" y="${task.y}" width="${task.width}" height="${task.height}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" />`
  )
  parts.push(
    `  <rect class="journey-task-accent" x="${task.x}" y="${task.y}" width="${JY.taskAccentWidth}" height="${task.height}" rx="0" ry="0" />`
  )
  parts.push(
    '  ' + renderMultilineText(
      task.text,
      task.textX,
      task.textY,
      style.nodeLabelFontSize,
      `class="journey-task-text" text-anchor="start" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
    )
  )

  for (const cell of task.scoreCells) {
    parts.push(
      `  <rect class="${cell.filled ? 'journey-score-cell-filled' : 'journey-score-cell-empty'}" x="${cell.x}" y="${cell.y}" width="${cell.size}" height="${cell.size}" rx="2" ry="2" />`
    )
  }

  for (const pill of task.actorPills) {
    parts.push(renderActorPill(pill, style))
  }

  parts.push('</g>')
  return parts.join('\n')
}

function renderActorPill(pill: PositionedJourneyActorPill, style: ResolvedRenderStyle): string {
  return [
    `  <g class="journey-actor" data-actor="${escapeAttr(pill.label)}">`,
    `    <rect class="journey-actor-pill" x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" ry="${pill.height / 2}" />`,
    '    ' + renderMultilineText(
      pill.label,
      pill.x + pill.width / 2,
      pill.y + pill.height / 2,
      style.edgeLabelFontSize,
      `class="journey-actor-text" text-anchor="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}`,
    ),
    '  </g>',
  ].join('\n')
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}

function hashJourney(diagram: PositionedJourneyDiagram): string {
  let h = 0x811c9dc5
  const s = `${diagram.width}|${diagram.height}|${diagram.sections.map(s => s.tasks.length).join(',')}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function escapeAttr(text: string): string {
  return escapeXml(text)
}
