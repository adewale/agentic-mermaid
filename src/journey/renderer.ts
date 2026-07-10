import type {
  PositionedJourneyActor,
  PositionedJourneyActorDot,
  PositionedJourneyDiagram,
  PositionedJourneyScoreGuide,
  PositionedJourneyScoreMarker,
  PositionedJourneySection,
  PositionedJourneyTask,
  PositionedJourneyTrack,
} from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs, resolveColors } from '../theme.ts'
import { resolveJourneyStyle, resolveJourneyVisualConfig } from './layout.ts'
import type { JourneyVisualConfig } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { JOURNEY_ACTOR_COLOR_LIMIT } from './parse-core.ts'
import { escapeAttr, renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { applyTextTransform } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { SceneDoc, SceneNode, SemanticChannels } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { getSeriesColor, hexToHsl, hslToHex, isDarkBackground } from '../xychart/colors.ts'
import { isHexColor, wcagCssContrastRatio } from '../shared/color-math.ts'

// ============================================================================
// Journey diagram SVG renderer
//
// Visual language:
//   - Mermaid-style left-to-right experience curve
//   - horizontal section spans over task columns
//   - actor legend plus compact per-task participation dots
//   - score-positioned sentiment marks on a progression baseline
//   - root SVG accessibility metadata sourced from Mermaid accTitle/accDescr
// ============================================================================

const JY = {
  titleFontSize: 18,
  titleFontWeight: 600,
  sectionFontSize: 12,
  sectionFontWeight: 600,
  taskFontSize: 13,
  taskFontWeight: 500,
  actorFontSize: 11,
  actorFontWeight: 600,
  legendDotRadius: 5,
  legendLabelGap: 12,
  legendTitleGap: 26,
} as const

/** Journey scores are on a 1..5 scale; channels carry them normalized. */
const JOURNEY_MAX_SCORE = 5

interface JourneyPaints {
  arrow: string
  nodeFill: string
  nodeStroke: string
  groupFill: string
  groupStroke: string
  groupText: string
  titleColor: string
  sectionFills: string[]
  sectionBands: string[]
  sectionStrokes: string[]
  sectionTextColors: string[]
  actorColors: string[]
  scoreFaceFill: string
  scoreFaceStroke: string
  scoreFaceInk: string
}

/**
 * Render a positioned journey diagram as an SVG string.
 */
export function renderJourneySvg(
  ctx: RenderContext<PositionedJourneyDiagram>,
): string {
  return DefaultBackend.render(lowerJourneyScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned journey diagram to the SceneGraph IR.
 */
export function lowerJourneyScene(
  ctx: RenderContext<PositionedJourneyDiagram>,
): SceneDoc {
  const { positioned: diagram, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: SceneNode[] = []
  const style = resolveJourneyStyle(options)
  const visual = resolveJourneyVisualConfig(options)
  const paints = journeyPaints(style, visual, colors, {
    sectionCount: diagram.sections.length,
    actorCount: diagram.actors.length,
  })

  const accessibility = buildJourneyAccessibility(diagram)
  const uid = journeyNamespace(diagram)
  const arrowMarkerId = `${uid}-arrowhead`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const curveMarkers = options.journey?.experienceCurve !== false
    ? diagram.sections.flatMap(section => section.tasks.map(task => task.marker))
    : []
  const drawCurve = curveMarkers.length >= 2
  const journeyCss = journeyStyles(style, visual, paints, drawCurve)

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
    openJourneySvgTag(diagram, colors, transparent, accessibility, titleId, descId, options.mermaidConfig?.journey?.useMaxWidth === true),
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
  parts.push(marks.raw({ id: 'defs', role: 'defs' }, buildJourneyDefs(colors, paints, arrowMarkerId)))
  parts.push(marks.raw({ id: 'journey-style', role: 'chrome' }, journeyCss))

  parts.push(renderScoreGuide(diagram.scoreGuide, style, arrowMarkerId))

  if (diagram.actors.length > 0) {
    parts.push(renderActorLegend(diagram.actors, style, paints))
  }

  diagram.sections.forEach((section, index) => {
    if (section.framed) {
      parts.push(renderSectionFrame(section, style, paints, index))
    }
  })

  // The experience curve is the journey's trajectory made visible: a smooth
  // line through the score markers in task order, beneath the faces. Upstream
  // Mermaid positions faces but never connects them; render(source,
  // { journey: { experienceCurve: false } }) restores that classic look.
  if (drawCurve) {
    parts.push(renderExperienceCurve(curveMarkers, style, paints))
  }

  for (const section of diagram.sections) {
    for (const task of section.tasks) {
      parts.push(renderTask(task, section.label, style, paints))
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
        fontSize: visual.titleFontSize,
        anchor: 'middle',
        paint: { fill: paints.titleColor },
      },
      renderMultilineText(
        diagram.title.text,
        diagram.title.x,
        diagram.title.y,
        visual.titleFontSize,
        `class="journey-title" text-anchor="middle" font-size="${escapeAttr(visual.titleFontSizeCss)}" font-weight="${JY.titleFontWeight}"${visual.titleFontFamily ? ` font-family="${escapeAttr(visual.titleFontFamily)}"` : ''}`,
      ),
    ))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'journey', width: diagram.width, height: diagram.height, colors, parts }
}

function journeyNamespace(diagram: PositionedJourneyDiagram): string {
  const semanticParts = diagram.sections.flatMap(section => [
    section.id,
    section.label ?? '',
    ...section.tasks.flatMap(task => [
      task.id,
      task.text,
      String(task.score),
      ...task.actors,
    ]),
  ])
  return `journey-${hashId(
    diagram.width,
    diagram.height,
    diagram.title?.text ?? '',
    diagram.accessibilityTitle ?? '',
    diagram.accessibilityDescription ?? '',
    ...semanticParts,
  )}`
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
  useMaxWidth: boolean,
): string {
  // Mermaid's useMaxWidth contract (same shape as the xychart renderer):
  // a responsive width capped at the natural size, viewBox preserving aspect.
  return svgOpenTag(diagram.width, diagram.height, colors, transparent, {
    ...(useMaxWidth ? { width: '100%', height: '100%', style: `max-width:${diagram.width}px` } : {}),
    attrs: buildAccessibilityAttrs(accessibility.title, accessibility.description, titleId, descId, 'user journey'),
  })
}

function buildJourneyDefs(colors: DiagramColors, paints: JourneyPaints, arrowMarkerId: string): string {
  const defs = [
    buildShadowDefs(colors),
    `  <marker id="${escapeAttr(arrowMarkerId)}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
    <path d="M0,0 L10,4 L0,8 Z" fill="${paints.arrow}" />
  </marker>`,
  ].filter(Boolean)

  return `<defs>\n${defs.join('\n')}\n</defs>`
}

function journeyStyles(style: ResolvedRenderStyle, visual: JourneyVisualConfig, paints: JourneyPaints, drawCurve: boolean): string {
  const sectionPalette = sectionPaletteCss(paints)
  const sectionBandPalette = sectionBandPaletteCss(paints)
  const sectionLabelPalette = sectionLabelPaletteCss(paints)
  const actorPalette = actorPaletteCss(paints)

  return `<style>
  .journey-title { fill: ${paints.titleColor}; }
  .journey-section-bg { fill: ${paints.groupFill}; stroke: ${paints.groupStroke}; stroke-width: ${style.groupLineWidth}; }
${sectionPalette}
  .journey-section-label-band { fill: ${paints.sectionBands[0]}; stroke: none; }
${sectionBandPalette}
  .journey-section-label { fill: ${paints.sectionTextColors[0] ?? 'var(--_text)'}; }
${sectionLabelPalette}
  .journey-task-box { fill: ${paints.nodeFill}; stroke: ${paints.nodeStroke}; stroke-width: ${style.nodeLineWidth}; }
  .journey-task-text { fill: ${style.nodeTextColor ?? 'var(--_text)'};${visual.taskFontFamily ? ` font-family: ${visual.taskFontFamily};` : ''} }
  .journey-track { stroke: color-mix(in srgb, ${paints.nodeStroke} 78%, var(--bg)); stroke-width: ${style.lineWidth}; stroke-dasharray: 4 7; }${drawCurve ? `
  .journey-curve { fill: none; stroke: color-mix(in srgb, ${paints.arrow} 55%, var(--bg)); stroke-width: ${Math.max(2, style.lineWidth * 2)}; stroke-linecap: round; }` : ''}
  .journey-guide { stroke: color-mix(in srgb, ${paints.nodeStroke} 62%, var(--bg)); stroke-width: 1; }
  .journey-score-label { fill: ${style.edgeTextColor ?? 'var(--_text-sec)'}; }
  .journey-baseline { stroke: ${paints.arrow}; stroke-width: ${Math.max(2, style.lineWidth * 2)}; }
  .journey-score-face { fill: ${paints.scoreFaceFill}; stroke: ${paints.scoreFaceStroke}; stroke-width: 1.2; }
  .journey-face-eye { fill: ${paints.scoreFaceInk}; }
  .journey-face-mouth { fill: none; stroke: ${paints.scoreFaceInk}; stroke-width: 1.6; stroke-linecap: round; }
  .journey-actor-legend-title { fill: ${paints.groupText}; }
  .journey-actor-legend-text { fill: ${paints.groupText}; }
  .journey-actor-dot { stroke: var(--bg); stroke-width: 1; }
${actorPalette}
</style>`
}

function renderExperienceCurve(
  markers: PositionedJourneyScoreMarker[],
  style: ResolvedRenderStyle,
  paints: JourneyPaints,
): SceneNode {
  const points = markers.map(marker => ({ x: marker.cx, y: marker.cy }))
  const d = smoothCurvePath(points)
  return marks.connector(
    {
      id: 'experience-curve',
      role: 'series',
      geometry: { kind: 'path', d, points },
      lineStyle: 'solid',
      paint: {
        stroke: `color-mix(in srgb, ${paints.arrow} 55%, var(--bg))`,
        strokeWidth: String(Math.max(2, style.lineWidth * 2)),
      },
    },
    `<path class="journey-curve" d="${d}" />`,
  )
}

/** Cubic segments with horizontal tangents at each marker: smooth, monotone
 * between neighbors (no overshoot past a score line), and deterministic. */
function smoothCurvePath(points: Array<{ x: number; y: number }>): string {
  const first = points[0]!
  let d = `M${first.x},${first.y}`
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!
    const to = points[i]!
    const dx = (to.x - from.x) / 3
    d += ` C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`
  }
  return d
}

function renderScoreGuide(guide: PositionedJourneyScoreGuide, style: ResolvedRenderStyle, arrowMarkerId: string): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []

  for (const tick of guide.ticks) {
    children.push({
      indent: 2,
      node: marks.connector(
        {
          id: `score-guide:${tick.score}`,
          role: 'grid',
          geometry: { kind: 'line', x1: tick.x1, y1: tick.y, x2: tick.x2, y2: tick.y },
          lineStyle: 'solid',
          paint: {
            stroke: `color-mix(in srgb, ${style.nodeBorderColor ?? 'var(--_node-stroke)'} 62%, var(--bg))`,
            strokeWidth: '1',
          },
          channels: { value: tick.score / JOURNEY_MAX_SCORE },
        },
        `<line class="journey-guide" x1="${tick.x1}" y1="${tick.y}" x2="${tick.x2}" y2="${tick.y}" />`,
      ),
    })

    children.push({
      indent: 2,
      node: marks.text(
        {
          id: `score-label:${tick.score}`,
          role: 'axis',
          text: String(tick.score),
          x: tick.labelX,
          y: tick.labelY,
          fontSize: style.edgeLabelFontSize,
          anchor: 'end',
          paint: { fill: style.edgeTextColor ?? 'var(--_text-sec)' },
          channels: { value: tick.score / JOURNEY_MAX_SCORE },
        },
        renderMultilineText(
          String(tick.score),
          tick.labelX,
          tick.labelY,
          style.edgeLabelFontSize,
          `class="journey-score-label" text-anchor="end" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}`,
        ),
      ),
    })
  }

  const baseline = guide.baseline
  children.push({
    indent: 2,
    node: marks.connector(
      {
        id: 'journey-baseline',
        role: 'rail',
        geometry: { kind: 'line', x1: baseline.x1, y1: baseline.y1, x2: baseline.x2, y2: baseline.y2 },
        lineStyle: 'solid',
        paint: {
          stroke: style.edgeStrokeColor ?? 'var(--_arrow)',
          strokeWidth: String(Math.max(2, style.lineWidth * 2)),
        },
        endMarker: { id: arrowMarkerId, shape: 'arrow' },
      },
      `<line class="journey-baseline" x1="${baseline.x1}" y1="${baseline.y1}" x2="${baseline.x2}" y2="${baseline.y2}" marker-end="url(#${escapeAttr(arrowMarkerId)})" />`,
    ),
  })

  return marks.group({
    id: 'score-guide',
    role: 'grid',
    open: `<g class="journey-score-guide" data-score-min="1" data-score-max="5">`,
    close: '</g>',
    children,
  })
}

function renderActorLegend(actors: PositionedJourneyActor[], style: ResolvedRenderStyle, paints: JourneyPaints): SceneNode {
  const first = actors[0]!
  const titleX = first.x - JY.legendDotRadius
  const titleY = first.y - JY.legendTitleGap
  const title = applyTextTransform('Actors', style.groupTextTransform)
  const children: Array<{ node: SceneNode; indent: number }> = [
    {
      indent: 2,
      node: marks.text(
        {
          id: 'actor-legend-title',
          role: 'legend',
          text: title,
          x: titleX,
          y: titleY,
          fontSize: style.groupHeaderFontSize,
          anchor: 'start',
          paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
        },
        renderMultilineText(
          title,
          titleX,
          titleY,
          style.groupHeaderFontSize,
          `class="journey-actor-legend-title" text-anchor="start" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)}`,
        ),
      ),
    },
  ]

  for (const actor of actors) {
    children.push({
      indent: 2,
      node: marks.shape(
        {
          id: `actor-legend-dot:${actor.label}`,
          role: 'actor',
          geometry: { kind: 'circle', cx: actor.x, cy: actor.y, r: JY.legendDotRadius },
          paint: { fill: actorFill(actor.colorIndex, paints), stroke: 'var(--bg)', strokeWidth: '1' },
          channels: { category: actor.label },
        },
        `<circle class="journey-actor-dot ${actorClass(actor.colorIndex, paints)}" data-actor="${escapeAttr(actor.label)}" cx="${actor.x}" cy="${actor.y}" r="${JY.legendDotRadius}" />`,
      ),
    })

    children.push({
      indent: 2,
      node: marks.text(
        {
          id: `actor-legend-label:${actor.label}`,
          role: 'legend',
          text: actor.label,
          x: actor.x + JY.legendDotRadius + JY.legendLabelGap,
          y: actor.y,
          fontSize: style.edgeLabelFontSize,
          anchor: 'start',
          paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
          channels: { category: actor.label },
        },
        renderMultilineText(
          actor.label,
          actor.x + JY.legendDotRadius + JY.legendLabelGap,
          actor.y,
          style.edgeLabelFontSize,
          `class="journey-actor-legend-text" text-anchor="start" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}`,
        ),
      ),
    })
  }

  return marks.group({
    id: 'actor-legend',
    role: 'legend',
    open: `<g class="journey-actor-legend">`,
    close: '</g>',
    children,
  })
}

function renderSectionFrame(section: PositionedJourneySection, style: ResolvedRenderStyle, paints: JourneyPaints, sectionIndex: number): SceneNode {
  const name = section.label ?? section.id
  const labelAttr = section.label ? ` data-label="${escapeAttr(section.label)}"` : ''
  const children: Array<{ node: SceneNode; indent: number }> = []

  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `section-bg:${name}`,
        role: 'section',
        geometry: { kind: 'rect', x: section.x, y: section.y, width: section.width, height: section.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
        paint: {
          fill: sectionFill(sectionIndex, paints),
          stroke: sectionStroke(sectionIndex, paints),
          strokeWidth: String(style.groupLineWidth),
        },
      },
      `<rect class="journey-section-bg journey-section-${sectionIndex % paints.sectionFills.length}" x="${section.x}" y="${section.y}" width="${section.width}" height="${section.height}" rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" />`,
    ),
  })

  if (section.label) {
    children.push({
      indent: 2,
      node: renderSectionLabelBand(section, style, paints, sectionIndex),
    })
    children.push({
      indent: 2,
      node: marks.text(
        {
          id: `section-label:${name}`,
          role: 'group-header',
          text: section.label,
          x: section.labelX,
          y: section.labelY,
          fontSize: style.groupHeaderFontSize,
          anchor: 'middle',
          paint: { fill: sectionTextColor(sectionIndex, paints) },
        },
        renderMultilineText(
          section.label,
          section.labelX,
          section.labelY,
          style.groupHeaderFontSize,
          `class="journey-section-label journey-section-label-${sectionIndex % paints.sectionTextColors.length}" text-anchor="middle" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)}`,
        ),
      ),
    })
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

function renderSectionLabelBand(section: PositionedJourneySection, style: ResolvedRenderStyle, paints: JourneyPaints, sectionIndex: number): SceneNode {
  const bandInset = Math.min(6, Math.max(3, section.height / 6))
  const bandHeight = Math.max(18, Math.min(section.height - bandInset * 2, style.groupHeaderFontSize + style.groupPaddingY))
  const bandX = section.x + bandInset
  const bandY = section.labelY - bandHeight / 2
  const bandWidth = Math.max(0, section.width - bandInset * 2)
  const radius = Math.min(style.groupCornerRadius, bandHeight / 2)

  return marks.shape(
    {
      id: `section-band:${section.label ?? section.id}`,
      role: 'group-header',
      geometry: { kind: 'rect', x: bandX, y: bandY, width: bandWidth, height: bandHeight, rx: radius, ry: radius },
      paint: { fill: sectionHeaderFill(sectionIndex, paints), stroke: 'none' },
      channels: { category: section.label ?? section.id },
    },
    `<rect class="journey-section-label-band journey-section-band-${sectionIndex % paints.sectionBands.length}" x="${bandX}" y="${bandY}" width="${bandWidth}" height="${bandHeight}" rx="${radius}" ry="${radius}" />`,
  )
}

function renderTask(task: PositionedJourneyTask, sectionLabel: string | undefined, style: ResolvedRenderStyle, paints: JourneyPaints): SceneNode {
  const sectionAttr = sectionLabel ? ` data-section="${escapeAttr(sectionLabel)}"` : ''
  const actorAttr = task.actors.length > 0 ? ` data-actors="${escapeAttr(task.actors.join(', '))}"` : ''
  const value = task.score / JOURNEY_MAX_SCORE
  const channels: SemanticChannels = sectionLabel ? { value, category: sectionLabel } : { value }
  const children: Array<{ node: SceneNode; indent: number }> = [
    { indent: 2, node: renderTrack(task.track, task, style, paints) },
    { indent: 2, node: renderTaskBox(task, style, paints, channels) },
    { indent: 2, node: renderTaskLabel(task, style, channels) },
  ]

  for (const dot of task.actorDots) {
    children.push({ indent: 2, node: renderActorDot(dot, task.text, paints) })
  }

  children.push({ indent: 2, node: renderScoreMarker(task.marker, task.text, paints, channels) })

  return marks.group({
    id: `task:${task.text}`,
    role: 'task',
    open: `<g class="journey-task" data-id="${escapeAttr(task.id)}" data-score="${task.score}"${sectionAttr}${actorAttr}>`,
    close: '</g>',
    children,
    channels,
  })
}

function renderTrack(track: PositionedJourneyTrack, task: PositionedJourneyTask, style: ResolvedRenderStyle, paints: JourneyPaints): SceneNode {
  return marks.connector(
    {
      id: `track:${task.text}`,
      role: 'marker-line',
      geometry: { kind: 'line', x1: track.x, y1: track.y1, x2: track.x, y2: track.y2 },
      lineStyle: 'dashed',
      paint: {
        stroke: `color-mix(in srgb, ${paints.nodeStroke} 78%, var(--bg))`,
        strokeWidth: String(style.lineWidth),
        strokeDasharray: '4 7',
      },
      channels: { value: task.score / JOURNEY_MAX_SCORE },
    },
    `<line class="journey-track" x1="${track.x}" y1="${track.y1}" x2="${track.x}" y2="${track.y2}" />`,
  )
}

function renderTaskBox(task: PositionedJourneyTask, style: ResolvedRenderStyle, paints: JourneyPaints, channels: SemanticChannels): SceneNode {
  return marks.shape(
    {
      id: `task-box:${task.text}`,
      role: 'task',
      geometry: { kind: 'rect', x: task.x, y: task.y, width: task.width, height: task.height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
      paint: {
        fill: paints.nodeFill,
        stroke: paints.nodeStroke,
        strokeWidth: String(style.nodeLineWidth),
      },
      channels,
    },
    `<rect class="journey-task-box" x="${task.x}" y="${task.y}" width="${task.width}" height="${task.height}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" />`,
  )
}

function renderTaskLabel(task: PositionedJourneyTask, style: ResolvedRenderStyle, channels: SemanticChannels): SceneNode {
  return marks.text(
    {
      id: `task-label:${task.text}`,
      role: 'label',
      text: task.text,
      x: task.textX,
      y: task.textY,
      fontSize: style.nodeLabelFontSize,
      anchor: 'middle',
      paint: { fill: style.nodeTextColor ?? 'var(--_text)' },
      channels,
    },
    renderMultilineText(
      task.text,
      task.textX,
      task.textY,
      style.nodeLabelFontSize,
      `class="journey-task-text" text-anchor="middle" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
    ),
  )
}

function renderActorDot(dot: PositionedJourneyActorDot, taskText: string, paints: JourneyPaints): SceneNode {
  return marks.shape(
    {
      id: `actor-dot:${taskText}:${dot.label}`,
      role: 'actor',
      geometry: { kind: 'circle', cx: dot.x, cy: dot.y, r: dot.r },
      paint: { fill: actorFill(dot.colorIndex, paints), stroke: 'var(--bg)', strokeWidth: '1' },
      channels: { category: dot.label },
    },
    `<circle class="journey-actor-dot ${actorClass(dot.colorIndex, paints)}" data-actor="${escapeAttr(dot.label)}" cx="${dot.x}" cy="${dot.y}" r="${dot.r}" />`,
  )
}

function renderScoreMarker(marker: PositionedJourneyScoreMarker, taskText: string, paints: JourneyPaints, channels: SemanticChannels): SceneNode {
  const eyeY = marker.cy - 4.5
  const leftEyeX = marker.cx - 5.5
  const rightEyeX = marker.cx + 5.5
  const mouth = mouthPath(marker)

  return marks.group({
    id: `score-marker:${taskText}`,
    role: 'score',
    open: `<g class="journey-score-marker" data-score="${marker.score}">`,
    close: '</g>',
    children: [
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-face:${taskText}`,
            role: 'score',
            geometry: { kind: 'circle', cx: marker.cx, cy: marker.cy, r: marker.r },
            paint: { fill: paints.scoreFaceFill, stroke: paints.scoreFaceStroke, strokeWidth: '1.2' },
            channels,
          },
          `<circle class="journey-score-face" cx="${marker.cx}" cy="${marker.cy}" r="${marker.r}" />`,
        ),
      },
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-eye-left:${taskText}`,
            role: 'score',
            geometry: { kind: 'circle', cx: leftEyeX, cy: eyeY, r: 2 },
            paint: { fill: paints.scoreFaceInk },
            channels,
          },
          `<circle class="journey-face-eye" cx="${leftEyeX}" cy="${eyeY}" r="2" />`,
        ),
      },
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-eye-right:${taskText}`,
            role: 'score',
            geometry: { kind: 'circle', cx: rightEyeX, cy: eyeY, r: 2 },
            paint: { fill: paints.scoreFaceInk },
            channels,
          },
          `<circle class="journey-face-eye" cx="${rightEyeX}" cy="${eyeY}" r="2" />`,
        ),
      },
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-mouth:${taskText}`,
            role: 'score',
            geometry: { kind: 'path', d: mouth },
            paint: { fill: 'none', stroke: paints.scoreFaceInk, strokeWidth: '1.6' },
            channels,
          },
          `<path class="journey-face-mouth" d="${mouth}" />`,
        ),
      },
    ],
    channels,
  })
}

function mouthPath(marker: PositionedJourneyScoreMarker): string {
  const cx = marker.cx
  const cy = marker.cy

  if (marker.score >= 5) return `M${cx - 8},${cy + 4} Q${cx},${cy + 13} ${cx + 8},${cy + 4}`
  if (marker.score >= 4) return `M${cx - 8},${cy + 5} Q${cx},${cy + 11} ${cx + 8},${cy + 5}`
  if (marker.score === 3) return `M${cx - 8},${cy + 6} L${cx + 8},${cy + 6}`
  if (marker.score === 2) return `M${cx - 8},${cy + 10} Q${cx},${cy + 2} ${cx + 8},${cy + 10}`
  return `M${cx - 9},${cy + 11} Q${cx},${cy} ${cx + 9},${cy + 11}`
}

interface JourneyPaintCounts {
  sectionCount: number
  actorCount: number
}

function journeyPaints(
  style: ResolvedRenderStyle,
  visual: JourneyVisualConfig,
  colors: DiagramColors,
  counts: JourneyPaintCounts,
): JourneyPaints {
  const arrow = style.edgeStrokeColor ?? 'var(--_arrow)'
  const nodeFill = style.nodeFillColor ?? 'var(--_node-fill)'
  const nodeStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const groupFill = style.groupFillColor ?? `color-mix(in srgb, ${arrow} 8%, var(--bg))`
  const groupStroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const groupText = style.groupTextColor ?? 'var(--_text-sec)'
  const sectionBases = paletteBases(arrow, colors, style, counts.sectionCount)
  const configuredSectionCount = Math.max(
    visual.sectionFills.length,
    visual.sectionColours.length,
    Math.min(sectionBases.length, Math.max(counts.sectionCount, 1)),
  )
  const sectionFills = Array.from({ length: configuredSectionCount }, (_unused, index) => {
    const explicitFill = visual.sectionFills[index % visual.sectionFills.length]
    return explicitFill ?? style.groupFillColor ?? `color-mix(in srgb, ${sectionBases[index % sectionBases.length]} ${index === 0 ? 8 : 9}%, var(--bg))`
  })
  // An explicit Mermaid sectionFill is used as-authored for the label band
  // (Mermaid semantics: the header band IS the section color), so Mermaid's
  // stock sectionColours stay readable on it.
  const sectionBands = Array.from({ length: configuredSectionCount }, (_unused, index) => {
    const explicitFill = visual.sectionFills[index % visual.sectionFills.length]
    return explicitFill
      ?? style.groupHeaderFillColor
      ?? `color-mix(in srgb, ${sectionBases[index % sectionBases.length]} ${index === 0 ? 14 : 16}%, var(--bg))`
  })
  const sectionStrokes = Array.from({ length: configuredSectionCount }, (_unused, index) => {
    const explicitFill = visual.sectionFills[index % visual.sectionFills.length]
    return explicitFill
      ? `color-mix(in srgb, ${explicitFill} ${index === 0 ? 42 : 38}%, var(--bg))`
      : style.groupBorderColor ?? `color-mix(in srgb, ${sectionBases[index % sectionBases.length]} ${index === 0 ? 42 : 38}%, var(--bg))`
  })
  const sectionTextColors = Array.from({ length: configuredSectionCount }, (_unused, index) =>
    contrastGuardedLabelColor(
      visual.sectionColours.length > 0 ? visual.sectionColours[index % visual.sectionColours.length] : undefined,
      sectionBands[index]!,
      style.groupTextColor ?? 'var(--_text)',
      colors.bg,
    ),
  )
  const actorColors = visual.actorColours.length > 0
    ? visual.actorColours
    : actorPalette(arrow, colors, style, counts.actorCount)

  return {
    arrow,
    nodeFill,
    nodeStroke,
    groupFill,
    groupStroke,
    groupText,
    titleColor: visual.titleColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)',
    sectionFills,
    sectionBands,
    sectionStrokes,
    sectionTextColors,
    actorColors,
    scoreFaceFill: `color-mix(in srgb, ${arrow} 22%, var(--bg))`,
    scoreFaceStroke: arrow,
    scoreFaceInk: style.edgeTextColor ?? style.nodeTextColor ?? 'var(--_text)',
  }
}

function paletteBases(arrow: string, colors: DiagramColors, style: ResolvedRenderStyle, sectionCount: number): string[] {
  const series = concreteSeriesColors(colors, style, Math.max(6, sectionCount))
  if (series) return series
  return [
    arrow,
    'var(--line, var(--_line))',
    'var(--accent, var(--_arrow))',
    'var(--muted, var(--_text-sec))',
    'var(--border, var(--_node-stroke))',
    'var(--fg)',
  ]
}

/** Explicit label color wins only when concrete composited paints clear
 * WCAG AA (4.5:1). A null ratio is uncertainty, never proof. */
function contrastGuardedLabelColor(
  explicit: string | undefined,
  band: string,
  fallback: string,
  canvas: string,
): string {
  if (explicit) {
    const ratio = wcagCssContrastRatio(explicit, band, canvas)
    if (ratio !== null && ratio >= 4.5) return explicit
  }
  const black = wcagCssContrastRatio('#000000', band, canvas)
  const white = wcagCssContrastRatio('#ffffff', band, canvas)
  if (black !== null && white !== null) return black >= white ? '#000000' : '#ffffff'
  // Dynamic CSS variables/color-mix paints cannot be certified here. Keep the
  // themed fallback without claiming a measured guarantee.
  return fallback
}

/** Actor identity is carried by 4px dots, where only hue differences read.
 * Derived actor colors therefore rotate hue (golden-angle steps from the
 * accent) at fixed saturation/lightness, sized to the actual actor count —
 * two actors can never share a color because the palette ran out. */
function actorPalette(arrow: string, colors: DiagramColors, style: ResolvedRenderStyle, actorCount: number): string[] {
  const count = Math.max(actorCount, 1)
  if (isHexColor(colors.bg) && isHexColor(colors.fg)) {
    const resolved = resolveColors(colors)
    const accent = firstHexColor(style.edgeStrokeColor, colors.accent, resolved.arrow)
    if (accent) {
      const [accentHue, accentSat] = hexToHsl(accent)
      const dark = isDarkBackground(colors.bg)
      // Neutral accents (the default gray theme) have no meaningful hue, so
      // anchor the wheel on the indigo family the derived palettes lean on.
      const baseHue = accentSat < 20 ? 230 : accentHue
      const saturation = Math.min(72, Math.max(42, accentSat < 20 ? 46 : accentSat))
      const lightness = dark ? 64 : 38
      const unique: string[] = []
      const seen = new Set<string>()
      const bounded = Math.min(count, JOURNEY_ACTOR_COLOR_LIMIT)
      for (let attempt = 0; unique.length < bounded && attempt < JOURNEY_ACTOR_COLOR_LIMIT * 16; attempt++) {
        const band = Math.floor(attempt / 360)
        const hue = (baseHue + (attempt % 360) * 137.508) % 360
        const candidate = hslToHex(
          hue,
          Math.max(34, saturation - (band % 4) * 7),
          Math.max(dark ? 46 : 24, Math.min(dark ? 78 : 58, lightness + (band % 2 === 0 ? -band * 2 : band * 2))),
        )
        if (!seen.has(candidate)) { seen.add(candidate); unique.push(candidate) }
      }
      // Above the documented bound, repeat the guaranteed lattice rather than
      // pretending unbounded 8-bit categorical uniqueness is possible.
      return Array.from({ length: count }, (_unused, index) => unique[index % unique.length]!)
    }
  }
  const fallback = [
    arrow,
    'var(--line, var(--_line))',
    'var(--accent, var(--_arrow))',
    'var(--muted, var(--_text-sec))',
    'var(--border, var(--_node-stroke))',
    'var(--fg)',
    'color-mix(in srgb, var(--accent, var(--_arrow)) 62%, var(--bg))',
    'color-mix(in srgb, var(--line, var(--_line)) 72%, var(--bg))',
  ]
  return fallback.slice(0, Math.max(count <= fallback.length ? count : fallback.length, 1))
}

function concreteSeriesColors(colors: DiagramColors, style: ResolvedRenderStyle, count: number): string[] | undefined {
  if (!isHexColor(colors.bg) || !isHexColor(colors.fg)) return undefined
  const resolved = resolveColors(colors)
  const accent = firstHexColor(style.edgeStrokeColor, colors.accent, resolved.arrow)
  if (!accent) return undefined
  return Array.from({ length: count }, (_unused, index) => getSeriesColor(index, accent, colors.bg))
}

function firstHexColor(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => value !== undefined && isHexColor(value))
}

function actorClass(index: number, paints: JourneyPaints): string {
  return `journey-actor-${index % paints.actorColors.length}`
}

function actorFill(index: number, paints: JourneyPaints): string {
  return paints.actorColors[index % paints.actorColors.length]!
}

function sectionFill(index: number, paints: JourneyPaints): string {
  return paints.sectionFills[index % paints.sectionFills.length]!
}

function sectionHeaderFill(index: number, paints: JourneyPaints): string {
  return paints.sectionBands[index % paints.sectionBands.length]!
}

function sectionStroke(index: number, paints: JourneyPaints): string {
  return paints.sectionStrokes[index % paints.sectionStrokes.length]!
}

function sectionTextColor(index: number, paints: JourneyPaints): string {
  return paints.sectionTextColors[index % paints.sectionTextColors.length]!
}

function sectionPaletteCss(paints: JourneyPaints): string {
  return paints.sectionFills.map((f, index) =>
    `  .journey-section-${index} { fill: ${f}; stroke: ${paints.sectionStrokes[index]!}; }`,
  ).join('\n')
}

function sectionBandPaletteCss(paints: JourneyPaints): string {
  return paints.sectionBands.map((f, index) => `  .journey-section-band-${index} { fill: ${f}; }`).join('\n')
}

function sectionLabelPaletteCss(paints: JourneyPaints): string {
  return paints.sectionTextColors.map((fill, index) => `  .journey-section-label-${index} { fill: ${fill}; }`).join('\n')
}

function actorPaletteCss(paints: JourneyPaints): string {
  return paints.actorColors.map((fill, index) => `  .journey-actor-${index} { fill: ${fill}; }`).join('\n')
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}
