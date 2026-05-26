import type {
  JourneyDiagram,
  PositionedJourneyDiagram,
  PositionedJourneySection,
  PositionedJourneyTask,
  PositionedJourneyActorPill,
  PositionedJourneyScoreCell,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { measureMultilineText, measureTextWidth } from '../text-metrics.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { stripFormattingTags } from '../multiline-utils.ts'

// ============================================================================
// Journey diagram layout engine
//
// Computes direct coordinates for horizontally arranged sections with stacked
// task cards, score meters, and actor pills.
// ============================================================================

const JY = {
  paddingX: 32,
  paddingY: 28,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleGap: 24,
  sectionFontSize: 12,
  sectionFontWeight: 600,
  sectionHeaderMinHeight: 24,
  sectionHeaderPadX: 12,
  sectionHeaderPadY: 6,
  sectionHeaderGap: 14,
  sectionPadX: 18,
  sectionPadY: 18,
  sectionGap: 28,
  taskGap: 14,
  taskMinWidth: 220,
  taskFontSize: 13,
  taskFontWeight: 500,
  taskPadX: 14,
  taskPadY: 12,
  taskToScoreGap: 18,
  scoreCellSize: 10,
  scoreCellGap: 5,
  actorGapTop: 12,
  actorFontSize: 11,
  actorFontWeight: 600,
  actorPadX: 8,
  actorPadY: 6,
  actorGapX: 6,
  actorMinWidth: 44,
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
  groupPaddingX: JY.sectionPadX,
  groupPaddingY: JY.sectionPadY,
  groupLabelPaddingX: JY.sectionHeaderPadX,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

interface ActorPillMetric {
  label: string
  width: number
  height: number
}

interface TaskMetric {
  textWidth: number
  textHeight: number
  topAreaHeight: number
  actorPills: ActorPillMetric[]
  actorRowWidth: number
  actorRowHeight: number
  minWidth: number
  height: number
}

interface SectionMetric {
  headerWidth: number
  tasks: TaskMetric[]
  innerWidth: number
  height: number
}

const SCORE_TRACK_WIDTH = JY.scoreCellSize * 5 + JY.scoreCellGap * 4

/**
 * Lay out a parsed journey diagram.
 */
export function layoutJourneyDiagram(
  diagram: JourneyDiagram,
  options: RenderOptions = {}
): PositionedJourneyDiagram {
  const style = resolveRenderStyle(options, JOURNEY_STYLE_DEFAULTS)
  const hasNamedSections = diagram.sections.some(section => !!section.label)
  const showSectionFrames = diagram.sections.length > 1 || hasNamedSections

  const titleMetrics = diagram.title
    ? measureMultilineText(diagram.title, JY.titleFontSize, JY.titleFontWeight)
    : undefined

  const headerHeights = diagram.sections
    .map(section => section.label
      ? measureMultilineText(section.label, style.groupHeaderFontSize, style.groupHeaderFontWeight).height + Math.max(0, style.groupPaddingY / 3) * 2
      : 0)
  const sectionHeaderHeight = hasNamedSections
    ? Math.max(JY.sectionHeaderMinHeight, ...headerHeights)
    : 0

  const sectionMetrics: SectionMetric[] = diagram.sections.map(section => {
    const headerWidth = section.label
      ? measureMultilineText(section.label, style.groupHeaderFontSize, style.groupHeaderFontWeight).width + style.groupLabelPaddingX * 2
      : 0

    const taskMetrics: TaskMetric[] = section.tasks.map(task => {
      const text = measureMultilineText(task.text, style.nodeLabelFontSize, style.nodeLabelFontWeight)
      const topAreaHeight = Math.max(text.height, JY.scoreCellSize)

      const actorPills: ActorPillMetric[] = task.actors.map(actor => {
        const plain = stripFormattingTags(actor)
        const width = Math.max(
          JY.actorMinWidth,
          measureTextWidth(plain, style.edgeLabelFontSize, style.edgeLabelFontWeight) + JY.actorPadX * 2,
        )
        const height = measureMultilineText(actor, style.edgeLabelFontSize, style.edgeLabelFontWeight).height + JY.actorPadY * 2
        return { label: actor, width, height }
      })

      const actorRowWidth = actorPills.reduce((sum, pill, index) => {
        const gap = index === 0 ? 0 : JY.actorGapX
        return sum + gap + pill.width
      }, 0)
      const actorRowHeight = actorPills.length > 0 ? Math.max(...actorPills.map(pill => pill.height)) : 0

      const minWidth = Math.max(
        JY.taskMinWidth,
        text.width + JY.taskToScoreGap + SCORE_TRACK_WIDTH + style.nodePaddingX * 2,
        actorRowWidth > 0 ? actorRowWidth + style.nodePaddingX * 2 : 0,
      )

      const height = style.nodePaddingY * 2
        + topAreaHeight
        + (actorRowHeight > 0 ? JY.actorGapTop + actorRowHeight : 0)

      return {
        textWidth: text.width,
        textHeight: text.height,
        topAreaHeight,
        actorPills,
        actorRowWidth,
        actorRowHeight,
        minWidth,
        height,
      }
    })

    const innerWidth = Math.max(
      headerWidth,
      ...taskMetrics.map(task => task.minWidth),
    )

    const taskStackHeight = taskMetrics.reduce((sum, task, index) => {
      const gap = index === 0 ? 0 : JY.taskGap
      return sum + gap + task.height
    }, 0)

    const height = sectionHeaderHeight
      + (hasNamedSections ? JY.sectionHeaderGap : 0)
      + (showSectionFrames ? style.groupPaddingY * 2 : 0)
      + taskStackHeight

    return { headerWidth, tasks: taskMetrics, innerWidth, height }
  })

  let contentTop = JY.paddingY
  if (titleMetrics) {
    contentTop += titleMetrics.height
    contentTop += JY.titleGap
  }

  let cursorX = JY.paddingX
  let maxBottom = contentTop
  const sections: PositionedJourneySection[] = []

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const metric = sectionMetrics[sectionIndex]!
    const sectionWidth = metric.innerWidth + (showSectionFrames ? style.groupPaddingX * 2 : 0)
    const sectionInnerX = cursorX + (showSectionFrames ? style.groupPaddingX : 0)
    const taskStartY = contentTop
      + sectionHeaderHeight
      + (hasNamedSections ? JY.sectionHeaderGap : 0)
      + (showSectionFrames ? style.groupPaddingY : 0)

    let taskCursorY = taskStartY
    const tasks: PositionedJourneyTask[] = []

    for (let taskIndex = 0; taskIndex < section.tasks.length; taskIndex++) {
      const task = section.tasks[taskIndex]!
      const taskMetric = metric.tasks[taskIndex]!
      const topAreaY = taskCursorY + style.nodePaddingY
      const meterY = topAreaY + (taskMetric.topAreaHeight - JY.scoreCellSize) / 2
      const meterStartX = sectionInnerX + metric.innerWidth - style.nodePaddingX - SCORE_TRACK_WIDTH

      const scoreCells: PositionedJourneyScoreCell[] = Array.from({ length: 5 }, (_, scoreIndex) => ({
        x: meterStartX + scoreIndex * (JY.scoreCellSize + JY.scoreCellGap),
        y: meterY,
        size: JY.scoreCellSize,
        filled: scoreIndex < task.score,
      }))

      let pillCursorX = sectionInnerX + style.nodePaddingX
      const pillY = topAreaY + taskMetric.topAreaHeight + JY.actorGapTop
      const actorPills: PositionedJourneyActorPill[] = taskMetric.actorPills.map(pill => {
        const positioned = {
          label: pill.label,
          x: pillCursorX,
          y: pillY,
          width: pill.width,
          height: pill.height,
        }
        pillCursorX += pill.width + JY.actorGapX
        return positioned
      })

      tasks.push({
        id: task.id,
        sectionId: section.id,
        text: task.text,
        score: task.score,
        actors: task.actors,
        x: sectionInnerX,
        y: taskCursorY,
        width: metric.innerWidth,
        height: taskMetric.height,
        textX: sectionInnerX + style.nodePaddingX,
        textY: topAreaY + taskMetric.topAreaHeight / 2,
        scoreCells,
        actorPills,
      })

      taskCursorY += taskMetric.height + JY.taskGap
    }

    sections.push({
      id: section.id,
      label: section.label,
      x: cursorX,
      y: contentTop,
      width: sectionWidth,
      height: metric.height,
      framed: showSectionFrames,
      headerHeight: sectionHeaderHeight,
      tasks,
    })

    maxBottom = Math.max(maxBottom, contentTop + metric.height)
    cursorX += sectionWidth
    if (sectionIndex < diagram.sections.length - 1) cursorX += JY.sectionGap
  }

  const width = cursorX + JY.paddingX
  const height = maxBottom + JY.paddingY

  return {
    width,
    height,
    title: diagram.title
      ? {
          text: diagram.title,
          x: width / 2,
          y: JY.paddingY + titleMetrics!.height / 2,
        }
      : undefined,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    sections,
  }
}
