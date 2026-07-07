import type {
  TimelineDiagram,
  PositionedTimelineDiagram,
  PositionedTimelineSection,
  PositionedTimelinePeriod,
  PositionedTimelineEvent,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { measureMultilineText, measureTextWidth } from '../text-metrics.ts'
import { STROKE_WIDTHS, applyTextTransform, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { stripFormattingTags } from '../multiline-utils.ts'

// ============================================================================
// Timeline diagram layout engine
//
// Computes direct coordinates for a horizontal timeline with:
//   - optional section frames
//   - period pills above the rail
//   - stacked event cards below the rail
// ============================================================================

const TL = {
  paddingX: 32,
  paddingY: 28,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleGap: 24,
  titleWrapWidth: 420,
  sectionHeaderHeight: 24,
  sectionFontSize: 12,
  sectionFontWeight: 600,
  sectionHeaderPadX: 12,
  sectionHeaderGap: 14,
  sectionWrapWidth: 168,
  sectionPadX: 18,
  sectionPadBottom: 18,
  sectionGap: 28,
  columnGap: 24,
  pillFontSize: 12,
  pillFontWeight: 600,
  pillWrapWidth: 116,
  pillPadX: 12,
  pillPadY: 8,
  pillMinWidth: 72,
  railToPillGap: 22,
  railToEventsGap: 28,
  markerRadius: 8,
  eventFontSize: 12,
  eventFontWeight: 400,
  eventWrapWidth: 148,
  eventPadX: 14,
  eventPadY: 10,
  eventMinWidth: 128,
  eventGap: 10,
} as const

/** Shared by layout (sizing) and renderer (drawing) — keep it single-sourced. */
export const TIMELINE_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: TL.eventFontSize,
  edgeLabelFontSize: TL.pillFontSize,
  groupHeaderFontSize: TL.sectionFontSize,
  nodeLabelFontWeight: TL.eventFontWeight,
  edgeLabelFontWeight: TL.pillFontWeight,
  groupHeaderFontWeight: TL.sectionFontWeight,
  nodePaddingX: TL.eventPadX,
  nodePaddingY: TL.eventPadY,
  nodeCornerRadius: 0,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: 1.5,
  groupCornerRadius: 0,
  groupPaddingX: TL.sectionPadX,
  groupPaddingY: TL.sectionPadBottom,
  groupLabelPaddingX: TL.sectionHeaderPadX,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

interface PeriodMetric {
  label: string
  pillWidth: number
  pillHeight: number
  columnWidth: number
  stackHeight: number
  events: Array<{ text: string; width: number; height: number }>
}

interface SectionMetric {
  label?: string
  headerWidth: number
  innerWidth: number
  columnAreaWidth: number
  periods: PeriodMetric[]
  maxStackHeight: number
}

/**
 * Lay out a parsed timeline diagram.
 */
export function layoutTimelineDiagram(
  diagram: TimelineDiagram,
  options: RenderOptions = {}
): PositionedTimelineDiagram {
  const style = resolveRenderStyle(options, TIMELINE_STYLE_DEFAULTS)
  const hasNamedSections = diagram.sections.some(section => !!section.label)
  const showSectionFrames = diagram.sections.length > 1 || hasNamedSections
  const sectionHeaderHeight = hasNamedSections ? Math.max(TL.sectionHeaderHeight, style.groupHeaderFontSize + style.groupPaddingY) : 0
  const sectionPadX = showSectionFrames ? style.groupPaddingX : 0
  const titleText = diagram.title
    ? wrapTimelineText(applyTextTransform(diagram.title, style.groupTextTransform), TL.titleWrapWidth, TL.titleFontSize, TL.titleFontWeight)
    : undefined

  const titleMetrics = titleText
    ? measureMultilineText(titleText, TL.titleFontSize, TL.titleFontWeight)
    : undefined

  const metrics: SectionMetric[] = diagram.sections.map(section => {
    const wrappedSectionLabel = section.label
      ? wrapTimelineText(applyTextTransform(section.label, style.groupTextTransform), TL.sectionWrapWidth, style.groupHeaderFontSize, style.groupHeaderFontWeight)
      : undefined
    const periodMetrics: PeriodMetric[] = section.periods.map(period => {
      const wrappedPeriodLabel = wrapTimelineText(applyTextTransform(period.label, style.edgeTextTransform), TL.pillWrapWidth, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const pillText = measureMultilineText(wrappedPeriodLabel, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const pillWidth = Math.max(TL.pillMinWidth, pillText.width + style.nodePaddingX * 2)
      const pillHeight = pillText.height + style.nodePaddingY * 2

      const eventMetrics = period.events.map(event => {
        const wrappedEventText = wrapTimelineText(applyTextTransform(event.text, style.nodeTextTransform), TL.eventWrapWidth, style.nodeLabelFontSize, style.nodeLabelFontWeight)
        const text = measureMultilineText(wrappedEventText, style.nodeLabelFontSize, style.nodeLabelFontWeight)
        return {
          text: wrappedEventText,
          width: Math.max(TL.eventMinWidth, text.width + style.nodePaddingX * 2),
          height: text.height + style.nodePaddingY * 2,
        }
      })

      const columnWidth = Math.max(
        pillWidth,
        ...eventMetrics.map(event => event.width),
      )

      const stackHeight = eventMetrics.reduce((sum, event, index) => {
        const gap = index === 0 ? 0 : TL.eventGap
        return sum + gap + event.height
      }, 0)

      return {
        label: wrappedPeriodLabel,
        pillWidth,
        pillHeight,
        columnWidth,
        stackHeight,
        events: eventMetrics,
      }
    })

    const columnAreaWidth = periodMetrics.reduce((sum, period, index) => {
      const gap = index === 0 ? 0 : TL.columnGap
      return sum + gap + period.columnWidth
    }, 0)

    const headerWidth = wrappedSectionLabel
      ? measureMultilineText(wrappedSectionLabel, style.groupHeaderFontSize, style.groupHeaderFontWeight).width + style.groupLabelPaddingX * 2
      : 0

    const innerWidth = Math.max(columnAreaWidth, headerWidth)
    const maxStackHeight = Math.max(0, ...periodMetrics.map(period => period.stackHeight))

    return {
      label: wrappedSectionLabel,
      headerWidth,
      innerWidth,
      columnAreaWidth,
      periods: periodMetrics,
      maxStackHeight,
    }
  })

  const maxPillHeight = Math.max(
    0,
    ...metrics.flatMap(section => section.periods.map(period => period.pillHeight)),
  )

  let contentTop = TL.paddingY
  if (titleMetrics) {
    contentTop += titleMetrics.height
    contentTop += TL.titleGap
  }

  const pillY = contentTop + sectionHeaderHeight + (hasNamedSections ? TL.sectionHeaderGap : 0)
  const railY = pillY + maxPillHeight + TL.railToPillGap
  const eventsTop = railY + TL.railToEventsGap

  let cursorX = TL.paddingX
  const sections: PositionedTimelineSection[] = []
  let maxBottom = railY + TL.markerRadius

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const metric = metrics[sectionIndex]!
    const sectionWidth = metric.innerWidth + sectionPadX * 2
    const columnStartX = cursorX + sectionPadX + (metric.innerWidth - metric.columnAreaWidth) / 2

    let periodCursorX = columnStartX
    const periods: PositionedTimelinePeriod[] = []
    let sectionBottom = railY + TL.markerRadius

    for (let periodIndex = 0; periodIndex < section.periods.length; periodIndex++) {
      const period = section.periods[periodIndex]!
      const periodMetric = metric.periods[periodIndex]!
      const centerX = periodCursorX + periodMetric.columnWidth / 2

      let eventY = eventsTop
      const events: PositionedTimelineEvent[] = period.events.map((event, eventIndex) => {
        const eventMetric = periodMetric.events[eventIndex]!
        const positioned: PositionedTimelineEvent = {
          id: event.id,
          sectionId: section.id,
          periodId: period.id,
          periodLabel: periodMetric.label,
          text: eventMetric.text,
          x: centerX - eventMetric.width / 2,
          y: eventY,
          width: eventMetric.width,
          height: eventMetric.height,
        }
        eventY += eventMetric.height + TL.eventGap
        return positioned
      })

      const stemBottomY = events.length > 0 ? events[0]!.y - 10 : railY + 16

      periods.push({
        id: period.id,
        sectionId: section.id,
        label: periodMetric.label,
        centerX,
        markerY: railY,
        pillX: centerX - periodMetric.pillWidth / 2,
        pillY,
        pillWidth: periodMetric.pillWidth,
        pillHeight: periodMetric.pillHeight,
        stemTopY: railY + TL.markerRadius,
        stemBottomY,
        events,
      })

      if (events.length > 0) {
        const lastEvent = events[events.length - 1]!
        sectionBottom = Math.max(sectionBottom, lastEvent.y + lastEvent.height)
      }

      periodCursorX += periodMetric.columnWidth + TL.columnGap
    }

    sectionBottom += style.groupPaddingY
    maxBottom = Math.max(maxBottom, sectionBottom)

    sections.push({
      id: section.id,
      label: metric.label,
      x: cursorX,
      y: contentTop,
      width: sectionWidth,
      height: sectionBottom - contentTop,
      framed: showSectionFrames,
      headerHeight: sectionHeaderHeight,
      periods,
    })

    cursorX += sectionWidth
    if (sectionIndex < diagram.sections.length - 1) {
      cursorX += showSectionFrames ? TL.sectionGap : TL.columnGap
    }
  }

  const width = cursorX + TL.paddingX
  const height = maxBottom + TL.paddingY
  const allPeriods = sections.flatMap(section => section.periods)
  const firstCenter = allPeriods[0]?.centerX ?? TL.paddingX
  const lastCenter = allPeriods[allPeriods.length - 1]?.centerX ?? width - TL.paddingX

  return {
    width,
    height,
    title: titleText
      ? {
          text: titleText,
          x: width / 2,
          y: TL.paddingY + titleMetrics!.height / 2,
        }
      : undefined,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    rail: {
      x1: firstCenter === lastCenter ? firstCenter - 42 : firstCenter,
      x2: firstCenter === lastCenter ? lastCenter + 42 : lastCenter,
      y: railY,
    },
    sections,
  }
}

function wrapTimelineText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
): string {
  return text
    .split('\n')
    .flatMap(line => wrapTimelineLine(line, maxWidth, fontSize, fontWeight))
    .join('\n')
}

function wrapTimelineLine(
  line: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
): string[] {
  const plainLine = stripFormattingTags(line)
  if (measureTextWidth(plainLine, fontSize, fontWeight) <= maxWidth) {
    return [line]
  }

  const words = line.trim().split(/\s+/)
  if (words.length <= 1) {
    return breakLongToken(line, maxWidth, fontSize, fontWeight)
  }

  const wrapped: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    const candidateWidth = measureTextWidth(stripFormattingTags(candidate), fontSize, fontWeight)

    if (candidateWidth <= maxWidth) {
      current = candidate
      continue
    }

    if (current) {
      wrapped.push(current)
      current = ''
    }

    if (measureTextWidth(stripFormattingTags(word), fontSize, fontWeight) > maxWidth) {
      wrapped.push(...breakLongToken(word, maxWidth, fontSize, fontWeight))
    } else {
      current = word
    }
  }

  if (current) wrapped.push(current)
  return wrapped
}

function breakLongToken(
  token: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
): string[] {
  const chunks: string[] = []
  let current = ''

  for (const char of token) {
    const candidate = current + char
    if (current && measureTextWidth(stripFormattingTags(candidate), fontSize, fontWeight) > maxWidth) {
      chunks.push(current)
      current = char
      continue
    }

    current = candidate
  }

  if (current) chunks.push(current)
  return chunks
}
