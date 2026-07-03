import type { PositionedJourneyDiagram, PositionedJourneySection, PositionedJourneyTask, PositionedJourneyActorPill } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { JOURNEY_STYLE_DEFAULTS } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { topRoundedRectPath } from '../svg-paths.ts'
import type { SceneDoc, SceneNode, SemanticChannels } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'

// ============================================================================
// Journey diagram SVG renderer
//
// Visual language:
//   - crisp section frames consistent with timeline / class / ER styling
//   - stacked task cards
//   - compact score meters and actor pills for readable metadata
//   - root SVG accessibility metadata sourced from Mermaid accTitle/accDescr
//
// The positioned diagram is lowered to the SceneGraph IR (SPEC §3.1): every
// visual mark carries semantic fields (role, geometry, paint, channels — the
// task score normalized to [0,1] is journey's key channel) plus its exact
// crisp serialization. renderJourneySvg() is DefaultBackend serialization of
// that scene, byte-identical to the historical string renderer
// (corpus-gated by svg-equivalence.test.ts).
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
} as const

/** Journey scores are on a 1..5 scale; channels carry them normalized. */
const JOURNEY_MAX_SCORE = 5

/**
 * Render a positioned journey diagram as an SVG string.
 */
export function renderJourneySvg(
  ctx: RenderContext<PositionedJourneyDiagram>,
): string {
  return DefaultBackend.render(lowerJourneyScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned journey diagram to the SceneGraph IR. Mark order matches
 * the historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerJourneyScene(
  ctx: RenderContext<PositionedJourneyDiagram>,
): SceneDoc {
  const { positioned: diagram, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, JOURNEY_STYLE_DEFAULTS)

  const accessibility = buildJourneyAccessibility(diagram)
  const uid = `journey-${hashJourney(diagram)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const journeyCss = journeyStyles(style)

  // SVG root with CSS variables. The accessibility <title>/<desc> sit between
  // the open tag and the shared style block in the historical byte stream, so
  // the prelude mark carries the open tag alone; extraCss records the journey
  // CSS so styled backends can re-derive their own document shell without
  // parsing the raw style marks that follow.
  parts.push(marks.prelude(
    {
      id: 'prelude',
      width: diagram.width,
      height: diagram.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      extraCss: journeyCss,
    },
    openJourneySvgTag(diagram, colors, transparent, accessibility, titleId, descId),
  ))
  if (accessibility.title) {
    parts.push(marks.raw({ id: 'a11y-title', role: 'chrome' },
      `<title id="${titleId}">${escapeXml(accessibility.title)}</title>`))
  }
  if (accessibility.description) {
    parts.push(marks.raw({ id: 'a11y-desc', role: 'chrome' },
      `<desc id="${descId}">${escapeXml(accessibility.description)}</desc>`))
  }
  parts.push(marks.raw({ id: 'style', role: 'chrome' },
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport)))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(marks.raw({ id: 'defs', role: 'defs' }, `<defs>${shadowDefs}</defs>`))
  parts.push(marks.raw({ id: 'journey-style', role: 'chrome' }, journeyCss))

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
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: diagram.title.text,
        x: diagram.title.x,
        y: diagram.title.y,
        fontSize: JY.titleFontSize,
        anchor: 'middle',
        // Mirrors the .journey-title rule in journeyStyles().
        paint: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
      },
      renderMultilineText(
        diagram.title.text,
        diagram.title.x,
        diagram.title.y,
        JY.titleFontSize,
        `class="journey-title" text-anchor="middle" font-size="${JY.titleFontSize}" font-weight="${JY.titleFontWeight}"`,
      ),
    ))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'journey', width: diagram.width, height: diagram.height, colors, parts }
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
  return svgOpenTag(diagram.width, diagram.height, colors, transparent, {
    attrs: buildAccessibilityAttrs(accessibility.title, accessibility.description, titleId, descId, 'user journey'),
  })
}

function journeyStyles(style: ResolvedRenderStyle): string {
  return `<style>
  .journey-title { fill: ${style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
  .journey-section-bg { fill: ${style.groupFillColor ?? 'color-mix(in srgb, var(--_node-fill) 88%, var(--bg))'}; stroke: ${style.groupBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.groupLineWidth}; }
  .journey-section-band { fill: ${style.groupHeaderFillColor ?? 'color-mix(in srgb, var(--_arrow) 8%, var(--bg))'}; stroke: ${style.groupBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.groupLineWidth}; }
  .journey-section-label { fill: ${style.groupTextColor ?? 'var(--_text-sec)'}; }
  .journey-task-card { fill: ${style.nodeFillColor ?? 'var(--_node-fill)'}; stroke: ${style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.nodeLineWidth}; }
  .journey-task-text { fill: ${style.nodeTextColor ?? 'var(--_text)'}; }
  .journey-score-cell-filled { fill: ${style.edgeStrokeColor ?? 'var(--_arrow)'}; stroke: ${style.edgeStrokeColor ?? 'var(--_arrow)'}; stroke-width: 1; }
  .journey-score-cell-empty { fill: color-mix(in srgb, var(--bg) 55%, ${style.nodeFillColor ?? 'var(--_node-fill)'}); stroke: color-mix(in srgb, ${style.nodeBorderColor ?? 'var(--_node-stroke)'} 82%, var(--bg)); stroke-width: 1; }
  .journey-actor-pill { fill: color-mix(in srgb, ${style.edgeStrokeColor ?? 'var(--_arrow)'} 8%, var(--bg)); stroke: color-mix(in srgb, ${style.edgeStrokeColor ?? 'var(--_arrow)'} 22%, var(--bg)); stroke-width: 1; }
  .journey-actor-text { fill: ${style.groupTextColor ?? 'var(--_text-sec)'}; }
</style>`
}

function renderSectionFrame(section: PositionedJourneySection, style: ResolvedRenderStyle): SceneNode {
  // Stable id keyed on the section's display name (falls back to parser id
  // for implicit sections); section identity flows through the category channel.
  const name = section.label ?? section.id
  const labelAttr = section.label ? ` data-label="${escapeAttr(section.label)}"` : ''
  const children: Array<{ node: SceneNode; indent: number }> = []

  // Paint mirrors the .journey-section-bg / -band / -label rules in journeyStyles().
  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `section-bg:${name}`,
        role: 'section',
        geometry: { kind: 'rect', x: section.x, y: section.y, width: section.width, height: section.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
        paint: {
          fill: style.groupFillColor ?? 'color-mix(in srgb, var(--_node-fill) 88%, var(--bg))',
          stroke: style.groupBorderColor ?? 'var(--_node-stroke)',
          strokeWidth: String(style.groupLineWidth),
        },
      },
      `<rect class="journey-section-bg" x="${section.x}" y="${section.y}" width="${section.width}" height="${section.height}" rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" />`,
    ),
  })

  if (section.headerHeight > 0) {
    const bandPath = topRoundedRectPath(section.x, section.y, section.width, section.headerHeight, style.groupCornerRadius)
    children.push({
      indent: 2,
      node: marks.shape(
        {
          id: `section-band:${name}`,
          role: 'group-header',
          geometry: { kind: 'path', d: bandPath },
          paint: {
            fill: style.groupHeaderFillColor ?? 'color-mix(in srgb, var(--_arrow) 8%, var(--bg))',
            stroke: style.groupBorderColor ?? 'var(--_node-stroke)',
            strokeWidth: String(style.groupLineWidth),
          },
        },
        `<path class="journey-section-band" d="${bandPath}" />`,
      ),
    })

    if (section.label) {
      children.push({
        indent: 2,
        node: marks.text(
          {
            id: `section-label:${name}`,
            role: 'group-header',
            text: section.label,
            x: section.x + style.groupLabelPaddingX,
            y: section.y + section.headerHeight / 2,
            fontSize: style.groupHeaderFontSize,
            anchor: 'start',
            paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
          },
          renderMultilineText(
            section.label,
            section.x + style.groupLabelPaddingX,
            section.y + section.headerHeight / 2,
            style.groupHeaderFontSize,
            `class="journey-section-label" text-anchor="start" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)}`,
          ),
        ),
      })
    }
  }

  return marks.group({
    id: `section:${name}`,
    role: 'section',
    open: `<g class="journey-section" data-id="${escapeAttr(section.id)}"${labelAttr}>`,
    close: '</g>',
    children,
    channels: { category: name },
  })
}

function renderTask(task: PositionedJourneyTask, sectionLabel: string | undefined, style: ResolvedRenderStyle): SceneNode {
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const actorAttr = task.actors.length > 0 ? ` data-actors="${escapeAttr(task.actors.join(', '))}"` : ''
  // The normalized score is journey's key semantic channel — styled backends
  // must never be blind to satisfaction when redrawing cards and meters.
  const value = task.score / JOURNEY_MAX_SCORE
  const channels: SemanticChannels = sectionLabel ? { value, category: sectionLabel } : { value }
  const children: Array<{ node: SceneNode; indent: number }> = []

  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `task-card:${task.text}`,
        role: 'task',
        geometry: { kind: 'rect', x: task.x, y: task.y, width: task.width, height: task.height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
        // Mirrors the .journey-task-card rule in journeyStyles().
        paint: {
          fill: style.nodeFillColor ?? 'var(--_node-fill)',
          stroke: style.nodeBorderColor ?? 'var(--_node-stroke)',
          strokeWidth: String(style.nodeLineWidth),
        },
        channels,
      },
      `<rect class="journey-task-card" x="${task.x}" y="${task.y}" width="${task.width}" height="${task.height}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" />`,
    ),
  })

  children.push({
    indent: 2,
    node: marks.text(
      {
        id: `task-label:${task.text}`,
        role: 'label',
        text: task.text,
        x: task.textX,
        y: task.textY,
        fontSize: style.nodeLabelFontSize,
        anchor: 'start',
        paint: { fill: style.nodeTextColor ?? 'var(--_text)' },
      },
      renderMultilineText(
        task.text,
        task.textX,
        task.textY,
        style.nodeLabelFontSize,
        `class="journey-task-text" text-anchor="start" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
      ),
    ),
  })

  task.scoreCells.forEach((cell, index) => {
    children.push({
      indent: 2,
      node: marks.shape(
        {
          id: `score:${task.text}:${index}`,
          role: 'score',
          geometry: { kind: 'rect', x: cell.x, y: cell.y, width: cell.size, height: cell.size, rx: 2, ry: 2 },
          // Mirrors .journey-score-cell-filled / -empty in journeyStyles().
          paint: cell.filled
            ? {
                fill: style.edgeStrokeColor ?? 'var(--_arrow)',
                stroke: style.edgeStrokeColor ?? 'var(--_arrow)',
                strokeWidth: '1',
              }
            : {
                fill: `color-mix(in srgb, var(--bg) 55%, ${style.nodeFillColor ?? 'var(--_node-fill)'})`,
                stroke: `color-mix(in srgb, ${style.nodeBorderColor ?? 'var(--_node-stroke)'} 82%, var(--bg))`,
                strokeWidth: '1',
              },
          channels: cell.filled ? { value } : undefined,
        },
        `<rect class="${cell.filled ? 'journey-score-cell-filled' : 'journey-score-cell-empty'}" x="${cell.x}" y="${cell.y}" width="${cell.size}" height="${cell.size}" rx="2" ry="2" />`,
      ),
    })
  })

  for (const pill of task.actorPills) {
    children.push({ indent: 2, node: renderActorPill(pill, style) })
  }

  return marks.group({
    id: `task:${task.text}`,
    role: 'task',
    open: `<g class="journey-task" data-id="${escapeAttr(task.id)}" data-score="${task.score}"${sectionAttr}${actorAttr}>`,
    close: '</g>',
    children,
    channels,
  })
}

function renderActorPill(pill: PositionedJourneyActorPill, style: ResolvedRenderStyle): SceneNode {
  return marks.group({
    id: `actor:${pill.label}`,
    role: 'actor-pill',
    open: `<g class="journey-actor" data-actor="${escapeAttr(pill.label)}">`,
    close: '</g>',
    children: [
      {
        indent: 2,
        node: marks.shape(
          {
            id: `actor-pill:${pill.label}`,
            role: 'actor-pill',
            geometry: { kind: 'rect', x: pill.x, y: pill.y, width: pill.width, height: pill.height, rx: pill.height / 2, ry: pill.height / 2 },
            // Mirrors the .journey-actor-pill rule in journeyStyles().
            paint: {
              fill: `color-mix(in srgb, ${style.edgeStrokeColor ?? 'var(--_arrow)'} 8%, var(--bg))`,
              stroke: `color-mix(in srgb, ${style.edgeStrokeColor ?? 'var(--_arrow)'} 22%, var(--bg))`,
              strokeWidth: '1',
            },
          },
          `<rect class="journey-actor-pill" x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" ry="${pill.height / 2}" />`,
        ),
      },
      {
        indent: 2,
        node: marks.text(
          {
            id: `actor-label:${pill.label}`,
            role: 'actor-pill',
            text: pill.label,
            x: pill.x + pill.width / 2,
            y: pill.y + pill.height / 2,
            fontSize: style.edgeLabelFontSize,
            anchor: 'middle',
            paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
          },
          renderMultilineText(
            pill.label,
            pill.x + pill.width / 2,
            pill.y + pill.height / 2,
            style.edgeLabelFontSize,
            `class="journey-actor-text" text-anchor="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}`,
          ),
        ),
      },
    ],
  })
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
