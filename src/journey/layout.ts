import type {
  JourneyDiagram,
  PositionedJourneyActor,
  PositionedJourneyActorDot,
  PositionedJourneyDiagram,
  PositionedJourneySection,
  PositionedJourneyTask,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { measureMultilineText, measureTextWidth } from '../text-metrics.ts'
import { STROKE_WIDTHS, applyTextTransform, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { stripFormattingTags } from '../multiline-utils.ts'
import type { JourneyRuntimeConfig } from '../mermaid-source.ts'

// ============================================================================
// Journey diagram layout engine
//
// Mermaid-style visual metaphor:
//   - tasks are laid out left-to-right in source order
//   - sections span the horizontal range of their tasks
//   - actors live in a left legend and are referenced by per-task dots
//   - scores map to vertical positions on an experience curve
// ============================================================================

const JY = {
  paddingX: 32,
  paddingY: 28,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleGap: 22,
  sectionFontSize: 12,
  sectionFontWeight: 600,
  sectionHeaderMinHeight: 36,
  sectionHeaderPadX: 16,
  sectionTaskGap: 30,
  sectionSpanPadX: 10,
  legendGap: 26,
  legendMinWidth: 96,
  legendTitleGap: 26,
  legendRowGap: 22,
  legendDotRadius: 5,
  legendDotLabelGap: 12,
  scoreLabelGutter: 22,
  scoreLabelGap: 12,
  taskGap: 26,
  taskMinWidth: 124,
  taskMinHeight: 58,
  taskFontSize: 13,
  taskFontWeight: 500,
  taskPadX: 14,
  taskPadY: 12,
  actorDotRadius: 4,
  actorDotGap: 8,
  taskToGuideGap: 56,
  scoreStep: 40,
  markerRadius: 16,
  baselineGap: 58,
  minPlotWidth: 320,
} as const

export interface JourneyVisualConfig {
  paddingX: number
  paddingY: number
  legendMinWidth: number
  maxLabelWidth: number
  taskGap: number
  taskMinWidth: number
  taskMinHeight: number
  titleFontSize: number
  titleFontSizeCss: string
  titleFontFamily?: string
  titleColor?: string
  taskFontFamily?: string
  actorColours: string[]
  sectionFills: string[]
  sectionColours: string[]
}

/** Shared by layout (sizing) and renderer (drawing) — keep it single-sourced. */
export const JOURNEY_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: JY.taskFontSize,
  edgeLabelFontSize: 11,
  groupHeaderFontSize: JY.sectionFontSize,
  nodeLabelFontWeight: JY.taskFontWeight,
  edgeLabelFontWeight: 600,
  groupHeaderFontWeight: JY.sectionFontWeight,
  nodePaddingX: JY.taskPadX,
  nodePaddingY: JY.taskPadY,
  nodeCornerRadius: 5,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 6,
  groupPaddingX: JY.sectionHeaderPadX,
  groupPaddingY: 10,
  groupLabelPaddingX: JY.sectionHeaderPadX,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

export function resolveJourneyVisualConfig(options: RenderOptions = {}): JourneyVisualConfig {
  const config = options.mermaidConfig?.journey
  const titleFontSize = cssFontSizeToPx(config?.titleFontSize, JY.titleFontSize)

  return {
    paddingX: positiveConfigNumber(config?.diagramMarginX, JY.paddingX),
    paddingY: positiveConfigNumber(config?.diagramMarginY, JY.paddingY),
    legendMinWidth: positiveConfigNumber(config?.leftMargin, JY.legendMinWidth),
    maxLabelWidth: positiveConfigNumber(config?.maxLabelWidth, 360),
    taskGap: positiveConfigNumber(config?.taskMargin, JY.taskGap),
    taskMinWidth: positiveConfigNumber(config?.width, JY.taskMinWidth),
    taskMinHeight: positiveConfigNumber(config?.height, JY.taskMinHeight),
    titleFontSize,
    titleFontSizeCss: String(config?.titleFontSize ?? titleFontSize),
    titleFontFamily: nonEmptyConfigString(config?.titleFontFamily),
    titleColor: nonEmptyConfigString(config?.titleColor),
    taskFontFamily: nonEmptyConfigString(config?.taskFontFamily),
    actorColours: config?.actorColours ?? [],
    sectionFills: config?.sectionFills ?? [],
    sectionColours: config?.sectionColours ?? [],
  }
}

export function resolveJourneyStyle(options: RenderOptions = {}): ResolvedRenderStyle {
  return resolveRenderStyle(options, journeyStyleDefaults(options.mermaidConfig?.journey))
}

function journeyStyleDefaults(config: JourneyRuntimeConfig | undefined): RenderStyleDefaults {
  return {
    ...JOURNEY_STYLE_DEFAULTS,
    nodeLabelFontSize: cssFontSizeToPx(config?.taskFontSize, JOURNEY_STYLE_DEFAULTS.nodeLabelFontSize),
  }
}

interface TaskMetric {
  text: string
  textWidth: number
  textHeight: number
  actorDotsWidth: number
  width: number
  height: number
}

interface SectionMetric {
  label?: string
  labelWidth: number
  tasks: TaskMetric[]
  emptyWidth: number
}

/**
 * Lay out a parsed journey diagram.
 */
export function layoutJourneyDiagram(
  diagram: JourneyDiagram,
  options: RenderOptions = {},
): PositionedJourneyDiagram {
  const visual = resolveJourneyVisualConfig(options)
  const style = resolveJourneyStyle(options)
  const hasNamedSections = diagram.sections.some(section => !!section.label)

  const titleText = diagram.title
    ? applyTextTransform(diagram.title, style.groupTextTransform)
    : undefined
  const titleMetrics = titleText
    ? measureMultilineText(titleText, visual.titleFontSize, JY.titleFontWeight)
    : undefined

  const actorLabels = collectActors(diagram).map(actor => {
    const label = applyTextTransform(actor, style.edgeTextTransform)
    return {
      raw: actor,
      label: wrapLabelToWidth(label, visual.maxLabelWidth, style.edgeLabelFontSize, style.edgeLabelFontWeight),
    }
  })
  const actorIndex = new Map(actorLabels.map((actor, index) => [actor.raw, index]))

  const legendLabelMetrics = actorLabels.map(actor =>
    measureMultilineText(stripFormattingTags(actor.label), style.edgeLabelFontSize, style.edgeLabelFontWeight),
  )
  const legendWidth = actorLabels.length > 0
    ? Math.max(
        visual.legendMinWidth,
        JY.legendDotRadius * 2
          + JY.legendDotLabelGap
          + Math.max(
            measureTextWidth('Actors', style.groupHeaderFontSize, style.groupHeaderFontWeight),
            ...legendLabelMetrics.map(metric => metric.width),
          ),
      )
    : 0

  const sectionMetrics: SectionMetric[] = diagram.sections.map(section => {
    const label = section.label ? applyTextTransform(section.label, style.groupTextTransform) : undefined
    const labelWidth = label
      ? measureMultilineText(label, style.groupHeaderFontSize, style.groupHeaderFontWeight).width
      : 0
    const tasks = section.tasks.map(task => measureTask(task.text, task.actors.length, style, visual))
    const emptyWidth = Math.max(visual.taskMinWidth, labelWidth + JY.sectionHeaderPadX * 2)

    return { label, labelWidth, tasks, emptyWidth }
  })

  const maxTaskHeight = Math.max(
    visual.taskMinHeight,
    ...sectionMetrics.flatMap(section => section.tasks.map(task => task.height)),
  )

  let contentTop = visual.paddingY
  if (titleMetrics) contentTop += titleMetrics.height + JY.titleGap

  const sectionHeaderHeight = hasNamedSections
    ? Math.max(
        JY.sectionHeaderMinHeight,
        ...sectionMetrics.map(section => section.label
          ? measureMultilineText(section.label, style.groupHeaderFontSize, style.groupHeaderFontWeight).height + style.groupPaddingY * 2
          : 0),
      )
    : 0

  const sectionY = contentTop
  const taskY = sectionY + (hasNamedSections ? sectionHeaderHeight + JY.sectionTaskGap : 0)
  const guideTop = taskY + maxTaskHeight + JY.taskToGuideGap
  const guideHeight = JY.scoreStep * 4
  const guideBottom = guideTop + guideHeight
  const baselineY = guideBottom + JY.baselineGap
  const plotLeft = visual.paddingX
    + legendWidth
    + (legendWidth > 0 ? JY.legendGap : 0)
    + JY.scoreLabelGutter

  let cursorX = plotLeft
  const sections: PositionedJourneySection[] = []

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const metric = sectionMetrics[sectionIndex]!
    const tasks: PositionedJourneyTask[] = []
    let sectionStartX = cursorX
    let sectionEndX = cursorX

    if (section.tasks.length === 0) {
      if (cursorX > plotLeft) cursorX += visual.taskGap
      sectionStartX = cursorX
      cursorX += metric.emptyWidth
      sectionEndX = cursorX
    } else {
      for (let taskIndex = 0; taskIndex < section.tasks.length; taskIndex++) {
        const task = section.tasks[taskIndex]!
        const taskMetric = metric.tasks[taskIndex]!
        if (cursorX > plotLeft) cursorX += visual.taskGap
        if (tasks.length === 0) sectionStartX = cursorX

        const x = cursorX
        const centerX = x + taskMetric.width / 2
        const markerY = scoreToY(task.score, guideTop)
        const actorDots = positionActorDots(task, actorIndex, centerX, taskY + taskMetric.height - style.nodePaddingY - JY.actorDotRadius)

        tasks.push({
          id: task.id,
          sectionId: section.id,
          text: taskMetric.text,
          score: task.score,
          actors: task.actors,
          x,
          y: taskY,
          width: taskMetric.width,
          height: taskMetric.height,
          textX: centerX,
          textY: taskY + style.nodePaddingY + taskMetric.textHeight / 2,
          centerX,
          track: {
            x: centerX,
            y1: taskY + taskMetric.height,
            y2: baselineY,
          },
          marker: {
            cx: centerX,
            cy: markerY,
            r: JY.markerRadius,
            score: task.score,
          },
          actorDots,
        })

        cursorX += taskMetric.width
        sectionEndX = cursorX
      }
    }

    const framed = !!metric.label
    const spanX = framed ? sectionStartX - JY.sectionSpanPadX : sectionStartX
    const spanWidth = framed
      ? Math.max(metric.labelWidth + JY.sectionHeaderPadX * 2, sectionEndX - sectionStartX + JY.sectionSpanPadX * 2)
      : Math.max(0, sectionEndX - sectionStartX)

    sections.push({
      id: section.id,
      label: metric.label,
      x: spanX,
      y: sectionY,
      width: spanWidth,
      height: framed ? sectionHeaderHeight : 0,
      labelX: spanX + spanWidth / 2,
      labelY: sectionY + sectionHeaderHeight / 2,
      framed,
      headerHeight: framed ? sectionHeaderHeight : 0,
      tasks,
    })
  }

  const naturalPlotRight = cursorX
  const plotRight = Math.max(naturalPlotRight, plotLeft + JY.minPlotWidth)
  const maxSectionRight = Math.max(plotRight, ...sections.map(section => section.x + section.width))
  const width = maxSectionRight + visual.paddingX

  let actorY = taskY + JY.legendDotRadius
  const actors: PositionedJourneyActor[] = actorLabels.map((actor, index) => {
    const metric = legendLabelMetrics[index]!
    const positioned = {
      label: actor.label,
      x: visual.paddingX + JY.legendDotRadius,
      y: actorY,
      colorIndex: index,
    }
    const isMultiline = actor.label.includes('\n')
    actorY += isMultiline ? Math.max(JY.legendRowGap, metric.height + 8) : JY.legendRowGap
    return positioned
  })

  const legendBottom = actors.length > 0
    ? actors[actors.length - 1]!.y + JY.legendDotRadius
    : 0
  const height = Math.max(
    baselineY + JY.markerRadius + visual.paddingY,
    legendBottom + visual.paddingY,
  )

  return {
    width,
    height,
    title: titleText
      ? {
          text: titleText,
          x: width / 2,
          y: visual.paddingY + titleMetrics!.height / 2,
        }
      : undefined,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    actors,
    scoreGuide: {
      x: plotLeft,
      y: guideTop,
      width: plotRight - plotLeft,
      height: guideHeight,
      ticks: [5, 4, 3, 2, 1].map(score => {
        const y = scoreToY(score, guideTop)
        return {
          score,
          x1: plotLeft,
          x2: plotRight,
          y,
          labelX: plotLeft - JY.scoreLabelGap,
          labelY: y,
        }
      }),
      baseline: {
        x1: plotLeft,
        y1: baselineY,
        x2: plotRight,
        y2: baselineY,
      },
    },
    sections,
  }
}

function measureTask(
  text: string,
  actorCount: number,
  style: ResolvedRenderStyle,
  visual: JourneyVisualConfig,
): TaskMetric {
  const taskText = applyTextTransform(text, style.nodeTextTransform)
  const textMetrics = measureMultilineText(taskText, style.nodeLabelFontSize, style.nodeLabelFontWeight)
  const actorDotsWidth = actorCount > 0
    ? actorCount * JY.actorDotRadius * 2 + (actorCount - 1) * JY.actorDotGap
    : 0
  const width = Math.max(
    visual.taskMinWidth,
    textMetrics.width + style.nodePaddingX * 2,
    actorDotsWidth + style.nodePaddingX * 2,
  )
  const actorRowHeight = actorCount > 0 ? JY.actorDotRadius * 2 : 0
  const height = Math.max(
    visual.taskMinHeight,
    style.nodePaddingY * 2 + textMetrics.height + (actorRowHeight > 0 ? 12 + actorRowHeight : 0),
  )

  return {
    text: taskText,
    textWidth: textMetrics.width,
    textHeight: textMetrics.height,
    actorDotsWidth,
    width,
    height,
  }
}

function collectActors(diagram: JourneyDiagram): string[] {
  const labels: string[] = []
  const seen = new Set<string>()

  for (const section of diagram.sections) {
    for (const task of section.tasks) {
      for (const actor of task.actors) {
        if (seen.has(actor)) continue
        seen.add(actor)
        labels.push(actor)
      }
    }
  }

  return labels
}

function wrapLabelToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return text
  if (measureTextWidth(stripFormattingTags(text), fontSize, fontWeight) <= maxWidth) return text

  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (measureTextWidth(stripFormattingTags(candidate), fontSize, fontWeight) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      current = breakWordToWidth(word, maxWidth, fontSize, fontWeight)
    }
    if (current) lines.push(current)
  }
  return lines.join('\n')
}

function breakWordToWidth(word: string, maxWidth: number, fontSize: number, fontWeight: number): string {
  if (measureTextWidth(stripFormattingTags(word), fontSize, fontWeight) <= maxWidth) return word
  const lines: string[] = []
  let current = ''
  for (const char of [...word]) {
    const candidate = current + char
    if (current && measureTextWidth(stripFormattingTags(candidate), fontSize, fontWeight) > maxWidth) {
      lines.push(`${current}-`)
      current = char
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.join('\n')
}

function cssFontSizeToPx(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  if (/^[0-9.]+(?:px)?$/i.test(trimmed)) return parsed
  if (/^[0-9.]+ex$/i.test(trimmed)) return parsed * 8
  if (/^[0-9.]+em$/i.test(trimmed)) return parsed * fallback
  return fallback
}

function positiveConfigNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonEmptyConfigString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function positionActorDots(
  task: { actors: string[] },
  actorIndex: Map<string, number>,
  centerX: number,
  y: number,
): PositionedJourneyActorDot[] {
  const count = task.actors.length
  if (count === 0) return []

  const totalWidth = count * JY.actorDotRadius * 2 + (count - 1) * JY.actorDotGap
  let cursorX = centerX - totalWidth / 2 + JY.actorDotRadius

  return task.actors.map(actor => {
    const dot = {
      label: actor,
      colorIndex: actorIndex.get(actor) ?? 0,
      x: cursorX,
      y,
      r: JY.actorDotRadius,
    }
    cursorX += JY.actorDotRadius * 2 + JY.actorDotGap
    return dot
  })
}

function scoreToY(score: number, guideTop: number): number {
  return guideTop + (JOURNEY_MAX_SCORE - score) * JY.scoreStep
}

const JOURNEY_MAX_SCORE = 5
