import type { PixelTextBlock } from '../shared/prepared-text.ts'
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
import { buildStyleText, resolveColors, resolvedColorValue } from '../theme.ts'
import { toneOnFill } from '../color-resolver.ts'
import type { JourneyRequestAppearance, JourneyVisualConfig } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { JOURNEY_ACTOR_COLOR_LIMIT } from './parse-core.ts'
import { applyTextTransform, resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { MarkerDescriptor, SceneDoc, SceneNode, SemanticChannels } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { hexToHsl, hslToHex, isDarkBackground } from '../xychart/colors.ts'
import { isHexColor, legibleInk, mixHex, tryParseCssColor, wcagCssContrastRatio } from '../shared/color-math.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgEmissionRecipe, type SvgGeometryField } from '../scene/svg-emission.ts'
import {
  projectConnectorPath,
  type ConnectorPathProjection,
  type ConnectorPathProjectionSegment,
} from '../scene/connector-geometry.ts'

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
  /** Task text, inked against the task box fill it sits on. */
  taskText: string
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

function primitive(className: string, geometry: readonly SvgGeometryField[], extra: readonly SvgAttribute[] = []): SvgEmissionRecipe {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
    { name: 'class', value: v.meta(className) }, ...geometry.map(name => ({ name, value: v.geometry(name) })), ...extra,
  ] })
}
const RECT_FIELDS = ['x', 'y', 'width', 'height', 'rx', 'ry'] as const
const LINE_FIELDS = ['x1', 'y1', 'x2', 'y2'] as const
const CIRCLE_FIELDS = ['cx', 'cy', 'r'] as const
const CURVE_EMISSION = primitive('journey-curve', ['d'])
const GUIDE_EMISSION = primitive('journey-guide', LINE_FIELDS)
const BASELINE_EMISSION = primitive('journey-baseline', LINE_FIELDS, [{ name: 'marker-end', value: { source: 'marker', position: 'end' } }])
const TRACK_EMISSION = primitive('journey-track', LINE_FIELDS)
const TASK_EMISSION = primitive('journey-task-box', RECT_FIELDS)
const FACE_EMISSION = primitive('journey-score-face', CIRCLE_FIELDS)
const EYE_EMISSION = primitive('journey-face-eye', CIRCLE_FIELDS)
const MOUTH_EMISSION = primitive('journey-face-mouth', ['d'])
const GUIDE_GROUP_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [
  { name: 'class', value: v.meta('journey-score-guide') },
  { name: 'data-score-min', value: v.meta(1) }, { name: 'data-score-max', value: v.meta(5) },
] })
const LEGEND_GROUP_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ name: 'class', value: v.meta('journey-actor-legend') }] })
function textAttributes(className: string): SvgAttribute[] {
  return [
    { name: 'class', value: v.meta(className) }, { name: 'text-anchor', value: v.text('anchor') },
    { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') },
    { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
  ]
}
const SCORE_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: textAttributes('journey-score-label') })
const LEGEND_TITLE_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: textAttributes('journey-actor-legend-title') })
const LEGEND_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: textAttributes('journey-actor-legend-text') })
const TASK_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: textAttributes('journey-task-text') })

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
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: SceneNode[] = []
  const appearance = resolved.familyAppearance as JourneyRequestAppearance | undefined
  if (!appearance) throw new Error('Journey rendering requires request-boundary family appearance resolution')
  const style = resolveRenderStyle(options, appearance.styleDefaults, resolved.styleFace)
  const visual = appearance.visual
  const paints = journeyPaints(style, visual, colors, {
    sectionCount: diagram.sections.length,
    actorCount: diagram.actors.length,
  })

  const accessibility = buildJourneyAccessibility(diagram)
  const uid = journeyNamespace(diagram)
  const arrowMarkerId = `${uid}-arrowhead`
  const arrowMarker = journeyArrowMarker(arrowMarkerId, paints.arrow)
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const curveMarkers = options.journey?.experienceCurve !== false
    ? diagram.sections.flatMap(section => section.tasks.map(task => task.marker))
    : []
  const drawCurve = curveMarkers.length >= 2
  const journeyCss = journeyStyles(style, visual, paints, drawCurve)

  parts.push(marks.documentOpen(
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
    { kind: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: false,
      ...(appearance.useMaxWidth ? { widthAttribute: '100%', heightAttribute: '100%', extraStyle: `max-width:${diagram.width}px` } : {}),
      attributes: Object.entries(buildAccessibilityAttrs(accessibility.title, accessibility.description, titleId, descId, 'user journey')).map(([name, value]) => ({ name: name as SvgAttribute['name'], value: v.meta(value) })),
      children: [],
    },
  ))
  if (accessibility.title) {
    parts.push(marks.documentContent({ id: 'a11y-title', role: 'chrome', nonPaint: 'accessibility' },
      { kind: 'documentText', element: 'title', domId: titleId, text: accessibility.title }))
  }
  if (accessibility.description) {
    parts.push(marks.documentContent({ id: 'a11y-desc', role: 'chrome', nonPaint: 'accessibility' },
      { kind: 'documentText', element: 'desc', domId: descId, text: accessibility.description }))
  }
  parts.push(marks.documentContent({ id: 'style', role: 'chrome', nonPaint: 'stylesheet' },
    { kind: 'stylesheet', css: `\n${buildStyleText(font, false, colors.shadow, colors.embedFontImport)}\n` }))
  parts.push(marks.definitions({ id: 'defs', markerResources: [arrowMarker] }, {
    kind: 'resources', resources: [...(colors.shadow ? [{ kind: 'shadow' as const, colors }] : []), 'markers'],
  }))
  parts.push(marks.documentContent({ id: 'journey-style', role: 'chrome', nonPaint: 'stylesheet' }, { kind: 'stylesheet', css: journeyCss }))

  parts.push(renderScoreGuide(diagram.scoreGuide, style, arrowMarker))

  if (diagram.actors.length > 0) {
    parts.push(renderActorLegend(diagram.actors, style, paints, diagram.actorLegendTitle))
  }

  const rawJourneyConfig = options.mermaidConfig?.journey as Record<string, unknown> | undefined
  const authoredSectionPaint = rawJourneyConfig?.sectionFills !== undefined || rawJourneyConfig?.sectionColours !== undefined
  diagram.sections.forEach((section, index) => {
    if (section.framed) {
      parts.push(renderSectionFrame(section, style, paints, index, resolved.styleFace, authoredSectionPaint))
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
          block: diagram.title.block,
        x: diagram.title.x,
        y: diagram.title.y,
        fontSize: visual.titleFontSize, fontWeight: JY.titleFontWeight, letterSpacing: style.groupLetterSpacing,
        anchor: 'middle',
        paint: { fill: paints.titleColor },
      },
      { kind: 'text', layout: 'multiline', attributes: [
        { name: 'class', value: v.meta('journey-title') }, { name: 'text-anchor', value: v.text('anchor') },
        { name: 'font-size', value: v.meta(visual.titleFontSizeCss) }, { name: 'font-weight', value: v.text('fontWeight') },
        ...(visual.titleFontFamily ? [{ name: 'font-family' as const, value: v.meta(visual.titleFontFamily) }] : []),
      ] },
    ))
  }

  parts.push(marks.documentClose())

  return { family: 'journey', width: diagram.width, height: diagram.height, colors, transparent, parts }
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

function journeyArrowMarker(id: string, color: string): MarkerDescriptor {
  return {
    id, shape: 'arrow', size: { width: 10, height: 8 }, ref: { x: 9, y: 4 }, orient: 'auto',
    geometry: { kind: 'path', d: 'M0,0 L10,4 L0,8 Z' }, paint: { fill: color },
  }
}

function journeyStyles(style: ResolvedRenderStyle, visual: JourneyVisualConfig, paints: JourneyPaints, drawCurve: boolean): string {
  const sectionPalette = sectionPaletteCss(paints)
  const sectionBandPalette = sectionBandPaletteCss(paints)
  const sectionLabelPalette = sectionLabelPaletteCss(paints)
  const actorPalette = actorPaletteCss(paints)

  return `
  .journey-title { fill: ${paints.titleColor}; }
  .journey-section-bg { fill: ${paints.groupFill}; stroke: ${paints.groupStroke}; stroke-width: ${style.groupLineWidth}; }
${sectionPalette}
  .journey-section-label-band { fill: ${paints.sectionBands[0]}; stroke: none; }
${sectionBandPalette}
  .journey-section-label { fill: ${paints.sectionTextColors[0] ?? 'var(--_text)'}; }
${sectionLabelPalette}
  .journey-task-box { fill: ${paints.nodeFill}; stroke: ${paints.nodeStroke}; stroke-width: ${style.nodeLineWidth}; }
  .journey-task-text { fill: ${paints.taskText};${visual.taskFontFamily ? ` font-family: ${visual.taskFontFamily};` : ''} }
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
`
}

function renderExperienceCurve(
  markers: PositionedJourneyScoreMarker[],
  style: ResolvedRenderStyle,
  paints: JourneyPaints,
): SceneNode {
  const points = markers.map(marker => ({ x: marker.cx, y: marker.cy }))
  const projection = smoothCurveProjection(points)
  return marks.connector(
    {
      id: 'experience-curve',
      role: 'series',
      geometry: projection.geometry,
      lineStyle: 'solid',
      paint: {
        stroke: `color-mix(in srgb, ${paints.arrow} 55%, var(--bg))`,
        strokeWidth: String(Math.max(2, style.lineWidth * 2)),
      },
      route: { ownership: 'family', contours: projection.contours },
    },
    CURVE_EMISSION,
  )
}

/** Cubic segments with horizontal tangents at each marker: smooth, monotone
 * between neighbors (no overshoot past a score line), and deterministic. */
function smoothCurveProjection(points: Array<{ x: number; y: number }>): ConnectorPathProjection {
  const first = points[0]!
  let d = `M${first.x},${first.y}`
  const segments: ConnectorPathProjectionSegment[] = []
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!
    const to = points[i]!
    const dx = (to.x - from.x) / 3
    const control1 = { x: from.x + dx, y: from.y }
    const control2 = { x: to.x - dx, y: to.y }
    d += ` C${control1.x},${control1.y} ${control2.x},${control2.y} ${to.x},${to.y}`
    segments.push({ kind: 'cubic', control1, control2, end: to })
  }
  return projectConnectorPath(d, first, segments)
}

function renderScoreGuide(guide: PositionedJourneyScoreGuide, style: ResolvedRenderStyle, arrowMarker: MarkerDescriptor): SceneNode {
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
        GUIDE_EMISSION,
      ),
    })

    children.push({
      indent: 2,
      node: marks.text(
        {
          id: `score-label:${tick.score}`,
          role: 'axis',
          text: tick.block?.text ?? String(tick.score),
          block: tick.block,
          x: tick.labelX,
          y: tick.labelY,
          fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing,
          anchor: 'end',
          paint: { fill: style.edgeTextColor ?? 'var(--_text-sec)' },
          channels: { value: tick.score / JOURNEY_MAX_SCORE },
        },
        SCORE_TEXT_EMISSION,
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
        markers: { mid: [], end: arrowMarker },
      },
      BASELINE_EMISSION,
    ),
  })

  return marks.group({
    id: 'score-guide',
    role: 'grid',
    emission: GUIDE_GROUP_EMISSION,
    children,
  })
}

function renderActorLegend(actors: PositionedJourneyActor[], style: ResolvedRenderStyle, paints: JourneyPaints, titleBlock?: PixelTextBlock): SceneNode {
  const first = actors[0]!
  const titleX = first.x - JY.legendDotRadius
  const titleY = first.y - JY.legendTitleGap
  const title = titleBlock?.text ?? applyTextTransform('Actors', style.groupTextTransform)
  const children: Array<{ node: SceneNode; indent: number }> = [
    {
      indent: 2,
      node: marks.text(
        {
          id: 'actor-legend-title',
          role: 'legend',
          text: title,
          block: titleBlock,
          x: titleX,
          y: titleY,
          fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing,
          anchor: 'start',
          paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
        },
        LEGEND_TITLE_EMISSION,
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
        { kind: 'primitive', attributes: [
          { name: 'class', value: v.meta(`journey-actor-dot ${actorClass(actor.colorIndex, paints)}`) },
          { name: 'data-actor', value: v.channel('category') }, ...CIRCLE_FIELDS.map(name => ({ name, value: v.geometry(name) })),
        ] },
      ),
    })

    children.push({
      indent: 2,
      node: marks.text(
        {
          id: `actor-legend-label:${actor.label}`,
          role: 'legend',
          text: actor.label,
          block: actor.block,
          x: actor.x + JY.legendDotRadius + JY.legendLabelGap,
          y: actor.y,
          fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing,
          anchor: 'start',
          paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
          channels: { category: actor.label },
        },
        LEGEND_TEXT_EMISSION,
      ),
    })
  }

  return marks.group({
    id: 'actor-legend',
    role: 'legend',
    emission: LEGEND_GROUP_EMISSION,
    children,
  })
}

function renderSectionFrame(
  section: PositionedJourneySection,
  style: ResolvedRenderStyle,
  paints: JourneyPaints,
  sectionIndex: number,
  face: Readonly<InternalStyleFace> | undefined,
  authoredSectionPaint: boolean,
): SceneNode {
  const name = section.category
  const children: Array<{ node: SceneNode; indent: number }> = []

  children.push({
    indent: 2,
    node: marks.shape(
      {
        id: `section-bg:${section.id}`,
        role: 'section',
        geometry: { kind: 'rect', x: section.x, y: section.y, width: section.width, height: section.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
        paint: {
          fill: sectionFill(sectionIndex, paints),
          stroke: sectionStroke(sectionIndex, paints),
          strokeWidth: String(style.groupLineWidth),
        },
      },
      primitive(`journey-section-bg journey-section-${sectionIndex % paints.sectionFills.length}`, RECT_FIELDS),
    ),
  })

  if (section.label) {
    const channels = { category: name }
    const semanticStyle = resolveRoleStyle(face, 'group-header', channels, { includeFallback: false })
    const labelText = section.block?.text ?? applyTextTransform(section.label, semanticStyle?.textTransform ?? style.groupTextTransform)
    const labelFontSize = semanticStyle?.fontSize ?? style.groupHeaderFontSize
    const labelFontWeight = semanticStyle?.fontWeight ?? style.groupHeaderFontWeight
    const labelFontFamily = semanticStyle?.fontFamily ?? style.groupFont
    const labelLetterSpacing = semanticStyle?.letterSpacing ?? style.groupLetterSpacing
    const labelColor = authoredSectionPaint ? sectionTextColor(sectionIndex, paints) : semanticStyle?.textColor ?? sectionTextColor(sectionIndex, paints)
    children.push({
      indent: 2,
      node: renderSectionLabelBand(section, style, paints, sectionIndex, face, authoredSectionPaint),
    })
    children.push({
      indent: 2,
      node: marks.text(
        {
          id: `section-label:${section.id}`,
          role: 'group-header',
          text: labelText,
          block: section.block,
          x: section.labelX,
          y: section.labelY,
          fontSize: labelFontSize, fontWeight: labelFontWeight, letterSpacing: labelLetterSpacing,
          anchor: 'middle',
          paint: { fill: labelColor },
        },
        { kind: 'text', layout: 'multiline', attributes: [
          ...textAttributes(`journey-section-label journey-section-label-${sectionIndex % paints.sectionTextColors.length}`).filter(attribute => attribute.name !== 'letter-spacing'),
          ...(labelFontFamily ? [{ name: 'font-family' as const, value: v.meta(labelFontFamily) }] : []),
          { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
          ...(semanticStyle?.textColor && !authoredSectionPaint ? [{ name: 'style' as const, value: { source: 'style' as const, declarations: [{ property: 'fill' as const, value: v.paint('fill') }] } }] : []),
        ] },
      ),
    })
  }

  return marks.group({
    id: `section:${section.id}`,
    role: 'section',
    emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta('journey-section') }, { name: 'data-id', value: v.meta(section.id) },
      ...(section.label ? [{ name: 'data-label' as const, value: v.meta(section.label), display: true }] : []),
    ] },
    children,
    channels: { category: name },
  })
}

function renderSectionLabelBand(
  section: PositionedJourneySection,
  style: ResolvedRenderStyle,
  paints: JourneyPaints,
  sectionIndex: number,
  face: Readonly<InternalStyleFace> | undefined,
  authoredSectionPaint: boolean,
): SceneNode {
  const channels = { category: section.category }
  const semanticStyle = resolveRoleStyle(face, 'group-header', channels, { includeFallback: false })
  const fill = authoredSectionPaint ? sectionHeaderFill(sectionIndex, paints) : semanticStyle?.fillColor ?? sectionHeaderFill(sectionIndex, paints)
  const cueValue = semanticStyle?.cue ?? 'none'
  const stroke = semanticStyle?.strokeColor ?? semanticStyle?.borderColor ?? (cueValue !== 'none' ? 'var(--fg)' : 'none')
  const baseStrokeWidth = semanticStyle?.lineWidth ?? (cueValue !== 'none' ? style.groupLineWidth : undefined)
  const strokeWidth = baseStrokeWidth === undefined
    ? undefined
    : cueValue === 'outline' ? baseStrokeWidth + 1
    : cueValue === 'double-line' ? baseStrokeWidth + 2
    : baseStrokeWidth
  const strokeDasharray = cueValue === 'pattern' ? '3 2' : cueValue === 'double-line' ? '8 2 2 2' : undefined
  const inline = semanticStyle && (semanticStyle.fillColor !== undefined || stroke !== 'none' || strokeWidth !== undefined || strokeDasharray !== undefined)
  const bandInset = Math.min(6, Math.max(3, section.height / 6))
  const bandHeight = Math.max(18, Math.min(section.height - bandInset * 2, style.groupHeaderFontSize + style.groupPaddingY))
  const bandX = section.x + bandInset
  const bandY = section.labelY - bandHeight / 2
  const bandWidth = Math.max(0, section.width - bandInset * 2)
  const radius = Math.min(style.groupCornerRadius, bandHeight / 2)

  return marks.shape(
    {
      id: `section-band:${section.id}`,
      role: 'group-header',
      geometry: { kind: 'rect', x: bandX, y: bandY, width: bandWidth, height: bandHeight, rx: radius, ry: radius },
      paint: {
        fill,
        stroke,
        ...(strokeWidth !== undefined ? { strokeWidth: String(strokeWidth) } : {}),
        ...(strokeDasharray ? { strokeDasharray } : {}),
      },
      channels,
    },
    { kind: 'primitive', attributes: [
      { name: 'class', value: v.meta(`journey-section-label-band journey-section-band-${sectionIndex % paints.sectionBands.length}`) },
      ...RECT_FIELDS.map(name => ({ name, value: v.geometry(name) })),
      ...(inline ? [{ name: 'style' as const, value: { source: 'style' as const, declarations: [
        { property: 'fill' as const, value: v.paint('fill') },
        ...(stroke !== 'none' ? [{ property: 'stroke' as const, value: v.paint('stroke') }] : []),
        ...(strokeWidth !== undefined ? [{ property: 'stroke-width' as const, value: v.paint('strokeWidth') }] : []),
        ...(strokeDasharray ? [{ property: 'stroke-dasharray' as const, value: v.paint('strokeDasharray') }] : []),
      ] } }] : []),
      ...(cueValue !== 'none' ? [{ name: 'data-brand-cue' as const, value: v.meta(cueValue) }] : []),
    ] },
  )
}

function renderTask(task: PositionedJourneyTask, sectionLabel: string | undefined, style: ResolvedRenderStyle, paints: JourneyPaints): SceneNode {
  const value = task.score / JOURNEY_MAX_SCORE
  const channels: SemanticChannels = sectionLabel ? { value, category: sectionLabel } : { value }
  const children: Array<{ node: SceneNode; indent: number }> = [
    { indent: 2, node: renderTrack(task.track, task, style, paints) },
    { indent: 2, node: renderTaskBox(task, style, paints, channels) },
    { indent: 2, node: renderTaskLabel(task, style, paints, channels) },
  ]

  for (const dot of task.actorDots) {
    children.push({ indent: 2, node: renderActorDot(dot, task.id, paints) })
  }

  children.push({ indent: 2, node: renderScoreMarker(task.marker, task.id, paints, channels) })

  return marks.group({
    id: `task:${task.id}`,
    role: 'task',
    emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta('journey-task') }, { name: 'data-id', value: v.meta(task.id) },
      { name: 'data-score', value: v.meta(task.score) },
      ...(sectionLabel ? [{ name: 'data-section' as const, value: v.channel('category') }] : []),
      ...(task.actors.length ? [{ name: 'data-actors' as const, value: v.meta(task.actors.join(', ')) }] : []),
    ] },
    children,
    channels,
  })
}

function renderTrack(track: PositionedJourneyTrack, task: PositionedJourneyTask, style: ResolvedRenderStyle, paints: JourneyPaints): SceneNode {
  return marks.connector(
    {
      id: `track:${task.id}`,
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
    TRACK_EMISSION,
  )
}

function renderTaskBox(task: PositionedJourneyTask, style: ResolvedRenderStyle, paints: JourneyPaints, channels: SemanticChannels): SceneNode {
  return marks.shape(
    {
      id: `task-box:${task.id}`,
      role: 'task',
      geometry: { kind: 'rect', x: task.x, y: task.y, width: task.width, height: task.height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
      paint: {
        fill: paints.nodeFill,
        stroke: paints.nodeStroke,
        strokeWidth: String(style.nodeLineWidth),
      },
      channels,
    },
    TASK_EMISSION,
  )
}

function renderTaskLabel(task: PositionedJourneyTask, style: ResolvedRenderStyle, paints: JourneyPaints, channels: SemanticChannels): SceneNode {
  return marks.text(
    {
      id: `task-label:${task.id}`,
      role: 'label',
      text: task.text,
          block: task.block,
      x: task.textX,
      y: task.textY,
      fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing,
      anchor: 'middle',
      paint: { fill: paints.taskText },
      channels,
    },
    TASK_TEXT_EMISSION,
  )
}

function renderActorDot(dot: PositionedJourneyActorDot, taskId: string, paints: JourneyPaints): SceneNode {
  return marks.shape(
    {
      id: `actor-dot:${taskId}:${dot.label}`,
      role: 'actor',
      geometry: { kind: 'circle', cx: dot.x, cy: dot.y, r: dot.r },
      paint: { fill: actorFill(dot.colorIndex, paints), stroke: 'var(--bg)', strokeWidth: '1' },
      channels: { category: dot.label },
    },
    { kind: 'primitive', attributes: [
      { name: 'class', value: v.meta(`journey-actor-dot ${actorClass(dot.colorIndex, paints)}`) },
      { name: 'data-actor', value: v.channel('category') }, ...CIRCLE_FIELDS.map(name => ({ name, value: v.geometry(name) })),
    ] },
  )
}

function renderScoreMarker(marker: PositionedJourneyScoreMarker, taskId: string, paints: JourneyPaints, channels: SemanticChannels): SceneNode {
  const eyeY = marker.cy - 4.5
  const leftEyeX = marker.cx - 5.5
  const rightEyeX = marker.cx + 5.5
  const mouth = mouthPath(marker)

  return marks.group({
    id: `score-marker:${taskId}`,
    role: 'score',
    emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta('journey-score-marker') }, { name: 'data-score', value: v.meta(marker.score) },
    ] },
    children: [
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-face:${taskId}`,
            role: 'score',
            geometry: { kind: 'circle', cx: marker.cx, cy: marker.cy, r: marker.r },
            paint: { fill: paints.scoreFaceFill, stroke: paints.scoreFaceStroke, strokeWidth: '1.2' },
            channels,
          },
          FACE_EMISSION,
        ),
      },
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-eye-left:${taskId}`,
            role: 'score',
            geometry: { kind: 'circle', cx: leftEyeX, cy: eyeY, r: 2 },
            paint: { fill: paints.scoreFaceInk },
            channels,
          },
          EYE_EMISSION,
        ),
      },
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-eye-right:${taskId}`,
            role: 'score',
            geometry: { kind: 'circle', cx: rightEyeX, cy: eyeY, r: 2 },
            paint: { fill: paints.scoreFaceInk },
            channels,
          },
          EYE_EMISSION,
        ),
      },
      {
        indent: 2,
        node: marks.shape(
          {
            id: `score-mouth:${taskId}`,
            role: 'score',
            geometry: { kind: 'path', d: mouth },
            paint: { fill: 'none', stroke: paints.scoreFaceInk, strokeWidth: '1.6' },
            channels,
          },
          MOUTH_EMISSION,
        ),
      },
    ],
    channels,
  })
}

function mouthPath(marker: PositionedJourneyScoreMarker): string {
  const cx = marker.cx
  const cy = marker.cy

  // Keep Mermaid's sentiment boundary at exactly 3 for fractional scores.
  // Marker position and data-score retain the exact value.
  if (marker.score >= 4.5) return `M${cx - 8},${cy + 4} Q${cx},${cy + 13} ${cx + 8},${cy + 4}`
  if (marker.score > 3) return `M${cx - 8},${cy + 5} Q${cx},${cy + 11} ${cx + 8},${cy + 5}`
  if (marker.score === 3) return `M${cx - 8},${cy + 6} L${cx + 8},${cy + 6}`
  if (marker.score >= 1.5) return `M${cx - 8},${cy + 10} Q${cx},${cy + 2} ${cx + 8},${cy + 10}`
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
  // The guard measures the band as drawn; a color-mix of concrete colors is
  // concrete too, so resolve it rather than leave the label unguarded.
  const measuredBands = sectionBands.map((band, index) => {
    const base = sectionBases[index % sectionBases.length]!
    const explicitFill = visual.sectionFills[index % visual.sectionFills.length]
    return explicitFill === undefined && style.groupHeaderFillColor === undefined && isHexColor(base) && isHexColor(colors.bg)
      ? mixHex(base, colors.bg, index === 0 ? 14 : 16)
      : band
  })
  const sectionTextColors = Array.from({ length: configuredSectionCount }, (_unused, index) =>
    contrastGuardedLabelColor(
      visual.sectionColours.length > 0 ? visual.sectionColours[index % visual.sectionColours.length] : undefined,
      measuredBands[index]!,
      style.groupTextColor ?? 'var(--_text)',
      colors,
    ),
  )
  const actorColors = visual.actorColours.length > 0
    ? visual.actorColours
    : actorPalette(arrow, colors, style, counts.actorCount)

  return {
    arrow,
    nodeFill,
    nodeStroke,
    // A custom surface can put the task box far from the page the theme tones
    // are repaired against.
    taskText: style.nodeTextColor ?? toneOnFill('var(--_text)', nodeFill, colors),
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
 * WCAG AA (4.5:1). A null ratio is uncertainty, never proof. Without an
 * explicit color the themed ink is kept where it reads on a measurable band
 * and moved toward black or white just far enough where it does not. */
function contrastGuardedLabelColor(
  explicit: string | undefined,
  band: string,
  fallback: string,
  colors: DiagramColors,
): string {
  const canvas = colors.bg
  if (explicit) {
    const ratio = wcagCssContrastRatio(explicit, band, canvas)
    if (ratio !== null && ratio >= 4.5) return explicit
  } else {
    const themed = resolvedColorValue(fallback, colors)
    if (themed !== undefined && isHexColor(band)) return legibleInk(themed, band)
  }
  const black = wcagCssContrastRatio('#000000', band, canvas)
  const white = wcagCssContrastRatio('#ffffff', band, canvas)
  if (black !== null && white !== null) return black >= white ? '#000000' : '#ffffff'
  // Dynamic CSS variables/color-mix paints cannot be certified here. Keep the
  // themed fallback without claiming a measured guarantee.
  return fallback
}

/** Actor identity is carried by small dots. Keep Journey's established colors
 * through six actors; above that compatibility boundary, use the shared
 * measured separation and visibility contract. Authored actorColours still
 * win in journeyPaints. */
function actorPalette(arrow: string, colors: DiagramColors, style: ResolvedRenderStyle, actorCount: number): string[] {
  const count = Math.max(actorCount, 1)
  if (count > 6 && isOpaqueConcreteCssColor(colors.bg)) {
    const accent = firstConcreteCssColor(style.edgeStrokeColor, colors.accent)
    if (accent) return categoricalPalette(count, { accent, bg: colors.bg })
  }
  if (isHexColor(colors.bg) && isHexColor(colors.fg)) {
    const resolved = resolveColors(colors)
    const accent = firstHexColor(style.edgeStrokeColor, colors.accent, resolved.arrow)
    if (accent) {
      if (count <= 6) return legacyActorPalette(accent, colors.bg, count)
      return categoricalPalette(count, { accent, bg: colors.bg })
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

/** Journey's pre-rollout golden-angle actor palette, retained verbatim for the
 * compatibility range. */
function legacyActorPalette(accent: string, bg: string, count: number): string[] {
  const [accentHue, accentSat] = hexToHsl(accent)
  const dark = isDarkBackground(bg)
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
  return Array.from({ length: count }, (_unused, index) => unique[index % unique.length]!)
}

function concreteSeriesColors(colors: DiagramColors, style: ResolvedRenderStyle, count: number): string[] | undefined {
  if (count > 6 && isOpaqueConcreteCssColor(colors.bg)) {
    const accent = firstConcreteCssColor(style.edgeStrokeColor, colors.accent)
    if (accent) return categoricalPalette(count, { accent, bg: colors.bg })
  }
  if (!isHexColor(colors.bg) || !isHexColor(colors.fg)) return undefined
  const resolved = resolveColors(colors)
  const accent = firstHexColor(style.edgeStrokeColor, colors.accent, resolved.arrow)
  if (!accent) return undefined
  return categoricalPalette(count, { accent, bg: colors.bg })
}

function firstHexColor(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => value !== undefined && isHexColor(value))
}

function firstConcreteCssColor(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => value !== undefined && tryParseCssColor(value) !== null)
}

function isOpaqueConcreteCssColor(value: string): boolean {
  return tryParseCssColor(value)?.[3] === 1
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
