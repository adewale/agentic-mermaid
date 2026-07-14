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
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { stripFormattingTags } from '../multiline-utils.ts'

// ============================================================================
// Timeline diagram layout engine
//
// Computes direct coordinates for a timeline with:
//   - optional section frames
//   - period pills beside the rail
//   - stacked event cards on the rail's far side
//
// ONE placement walk serves both orientations (upstream PR #7270): geometry is
// computed along a MAIN axis (the direction periods advance in) and a CROSS
// axis (pill band → rail → event stacks), then mapped to screen x/y at
// materialization time. LR maps main→x / cross→y (the historical layout,
// byte-identical by construction); TD maps main→y / cross→x, so periods flow
// downward with pills left of a vertical rail and events to its right. Boxes
// never rotate — text metrics are orientation-independent — only positions map
// through the axis frame. The two deliberate non-transform pieces are header
// furniture: the title always spans the top, and section header bands stay
// horizontal (they consume cross-axis space in LR, main-axis space in TD).
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

/** Width control never wraps below this (px): narrower than ~4 characters
 *  produces vertical letter soup instead of a narrower chart. */
const TIMELINE_MIN_WRAP = 36

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
  /** Main-axis extent of the period column/row: max of the pill and event
   *  main-axis sizes (width in LR, height in TD). */
  mainExtent: number
  events: Array<{ text: string; width: number; height: number }>
}

interface SectionMetric {
  label?: string
  headerWidth: number
  /** Main-axis extent of the period run (columns in LR, rows in TD). */
  runMain: number
  /** Run extent plus anything else the frame must span on the main axis —
   *  in LR the header text may be wider than the columns. */
  innerMain: number
  periods: PeriodMetric[]
}

/** Wrap caps + box minimums for the metric pass. Width control substitutes a
 *  compressed set; the default set reproduces the historical layout exactly. */
interface TimelineWrapCaps {
  pill: number
  event: number
  pillMinWidth: number
  eventMinWidth: number
}

const DEFAULT_WRAP_CAPS: TimelineWrapCaps = {
  pill: TL.pillWrapWidth,
  event: TL.eventWrapWidth,
  pillMinWidth: TL.pillMinWidth,
  eventMinWidth: TL.eventMinWidth,
}

/**
 * Lay out a parsed timeline diagram. `diagram.direction === 'TD'` flows
 * top-down; anything else (including the tolerated tb/bt/rl tokens) keeps the
 * historical horizontal layout byte-for-byte.
 */
export function layoutTimelineDiagram(
  diagram: TimelineDiagram,
  options: RenderOptions = {},
  styleFace?: Readonly<InternalStyleFace>,
): PositionedTimelineDiagram {
  const style = resolveRenderStyle(options, TIMELINE_STYLE_DEFAULTS, styleFace)
  const vertical = diagram.direction === 'TD'
  // Box main/cross extents: boxes keep their measured width/height in both
  // orientations; only which dimension advances each axis flips.
  const mainOf = (width: number, height: number): number => (vertical ? height : width)
  const crossOf = (width: number, height: number): number => (vertical ? width : height)

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

  let metrics = computeSectionMetrics(diagram, style, DEFAULT_WRAP_CAPS, vertical)

  // Width control (RenderOptions.timeline.maxWidth, horizontal only): when the
  // chart would exceed the budget, derive a per-column budget from the fixed
  // overhead (paddings, gaps, frame insets) and re-run the metric pass ONCE
  // with proportionally compressed wrap caps and box minimums. Deterministic
  // (a pure function of the same inputs), and a no-op when the chart already
  // fits, so the default path stays byte-identical. Best-effort: unbreakable
  // tokens and extra-wide section headers can still exceed the budget.
  const budget = options.timeline?.maxWidth
  if (!vertical && typeof budget === 'number' && Number.isFinite(budget) && budget > 0) {
    const projected = projectedMainEnd(metrics, sectionPadX, showSectionFrames)
    const periodCount = metrics.reduce((sum, section) => sum + section.periods.length, 0)
    if (projected > budget && periodCount > 0) {
      const columnsTotal = metrics.reduce(
        (sum, section) => sum + section.periods.reduce((s, period) => s + period.mainExtent, 0), 0)
      const perColumn = Math.max(TIMELINE_MIN_WRAP + style.nodePaddingX * 2, (budget - (projected - columnsTotal)) / periodCount)
      const cap = Math.max(TIMELINE_MIN_WRAP, perColumn - style.nodePaddingX * 2)
      metrics = computeSectionMetrics(diagram, style, {
        pill: Math.min(TL.pillWrapWidth, cap),
        event: Math.min(TL.eventWrapWidth, cap),
        pillMinWidth: Math.min(TL.pillMinWidth, perColumn),
        eventMinWidth: Math.min(TL.eventMinWidth, perColumn),
      }, vertical)
    }
  }

  const maxPillCross = Math.max(
    0,
    ...metrics.flatMap(section => section.periods.map(period => crossOf(period.pillWidth, period.pillHeight))),
  )

  let contentTop = TL.paddingY
  if (titleMetrics) {
    contentTop += titleMetrics.height
    contentTop += TL.titleGap
  }

  // Cross-axis anatomy: [header band (LR only)] pill band → rail → events.
  // TD moves the header band to the main axis (a horizontal band atop each
  // frame) and pads the pill column with the frame inset instead.
  const headerBlock = sectionHeaderHeight + (hasNamedSections ? TL.sectionHeaderGap : 0)
  const crossBase = vertical ? TL.paddingX : contentTop
  const pillBandCross = crossBase + (vertical ? (showSectionFrames ? sectionPadX : 0) : headerBlock)
  const railCross = pillBandCross + maxPillCross + TL.railToPillGap
  const eventsCross = railCross + TL.railToEventsGap
  const headerMain = vertical ? headerBlock : 0

  let mainCursor = vertical ? contentTop : TL.paddingX
  const sections: PositionedTimelineSection[] = []
  let maxCrossEnd = railCross + TL.markerRadius

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const metric = metrics[sectionIndex]!
    const sectionMainStart = mainCursor
    const sectionMainExtent = headerMain + metric.innerMain + sectionPadX * 2
    const runStart = mainCursor + headerMain + sectionPadX + (metric.innerMain - metric.runMain) / 2

    let periodCursor = runStart
    const periods: PositionedTimelinePeriod[] = []
    let sectionCrossEnd = railCross + TL.markerRadius

    for (let periodIndex = 0; periodIndex < section.periods.length; periodIndex++) {
      const period = section.periods[periodIndex]!
      const periodMetric = metric.periods[periodIndex]!
      const centerMain = periodCursor + periodMetric.mainExtent / 2

      let eventCross = eventsCross
      const events: PositionedTimelineEvent[] = period.events.map((event, eventIndex) => {
        const eventMetric = periodMetric.events[eventIndex]!
        const eventMain = centerMain - mainOf(eventMetric.width, eventMetric.height) / 2
        const positioned: PositionedTimelineEvent = {
          id: event.id,
          sectionId: section.id,
          periodId: period.id,
          periodLabel: periodMetric.label,
          text: eventMetric.text,
          x: vertical ? eventCross : eventMain,
          y: vertical ? eventMain : eventCross,
          width: eventMetric.width,
          height: eventMetric.height,
        }
        eventCross += crossOf(eventMetric.width, eventMetric.height) + TL.eventGap
        return positioned
      })

      const stemStartCross = railCross + TL.markerRadius
      const stemEndCross = events.length > 0 ? eventsCross - 10 : railCross + 16
      const pillMain = centerMain - mainOf(periodMetric.pillWidth, periodMetric.pillHeight) / 2

      periods.push({
        id: period.id,
        sectionId: section.id,
        label: periodMetric.label,
        centerX: vertical ? pillBandCross + periodMetric.pillWidth / 2 : centerMain,
        markerX: vertical ? railCross : centerMain,
        markerY: vertical ? centerMain : railCross,
        pillX: vertical ? pillBandCross : centerMain - periodMetric.pillWidth / 2,
        pillY: vertical ? pillMain : pillBandCross,
        pillWidth: periodMetric.pillWidth,
        pillHeight: periodMetric.pillHeight,
        stem: vertical
          ? { x1: stemStartCross, y1: centerMain, x2: stemEndCross, y2: centerMain }
          : { x1: centerMain, y1: stemStartCross, x2: centerMain, y2: stemEndCross },
        events,
      })

      if (events.length > 0) {
        const lastEvent = events[events.length - 1]!
        sectionCrossEnd = Math.max(sectionCrossEnd, vertical ? lastEvent.x + lastEvent.width : lastEvent.y + lastEvent.height)
      }

      periodCursor += periodMetric.mainExtent + TL.columnGap
    }

    sectionCrossEnd += style.groupPaddingY
    maxCrossEnd = Math.max(maxCrossEnd, sectionCrossEnd)

    sections.push({
      id: section.id,
      label: metric.label,
      x: vertical ? crossBase : sectionMainStart,
      y: vertical ? sectionMainStart : crossBase,
      width: vertical ? sectionCrossEnd - crossBase : sectionMainExtent,
      height: vertical ? sectionMainExtent : sectionCrossEnd - crossBase,
      framed: showSectionFrames,
      headerHeight: sectionHeaderHeight,
      periods,
    })

    mainCursor += sectionMainExtent
    if (sectionIndex < diagram.sections.length - 1) {
      mainCursor += showSectionFrames ? TL.sectionGap : TL.columnGap
    }
  }

  const mainEnd = mainCursor + (vertical ? TL.paddingY : TL.paddingX)
  const crossEnd = maxCrossEnd + (vertical ? TL.paddingX : TL.paddingY)
  const width = vertical ? crossEnd : mainEnd
  const height = vertical ? mainEnd : crossEnd

  const allPeriods = sections.flatMap(section => section.periods)
  const mainCenterOf = (period: PositionedTimelinePeriod): number => (vertical ? period.markerY : period.centerX)
  const firstCenter = allPeriods.length > 0 ? mainCenterOf(allPeriods[0]!) : (vertical ? contentTop : TL.paddingX)
  const lastCenter = allPeriods.length > 0
    ? mainCenterOf(allPeriods[allPeriods.length - 1]!)
    : mainEnd - (vertical ? TL.paddingY : TL.paddingX)
  const railMain1 = firstCenter === lastCenter ? firstCenter - 42 : firstCenter
  const railMain2 = firstCenter === lastCenter ? lastCenter + 42 : lastCenter

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
    rail: vertical
      ? { x1: railCross, y1: railMain1, x2: railCross, y2: railMain2 }
      : { x1: railMain1, y1: railCross, x2: railMain2, y2: railCross },
    sections,
  }
}

/** The metric pass: wrap + measure every label once. Orientation enters only
 *  through `mainOf` (which box dimension advances the main axis). */
function computeSectionMetrics(
  diagram: TimelineDiagram,
  style: ResolvedRenderStyle,
  caps: TimelineWrapCaps,
  vertical: boolean,
): SectionMetric[] {
  const mainOf = (width: number, height: number): number => (vertical ? height : width)
  return diagram.sections.map(section => {
    const wrappedSectionLabel = section.label
      ? wrapTimelineText(applyTextTransform(section.label, style.groupTextTransform), TL.sectionWrapWidth, style.groupHeaderFontSize, style.groupHeaderFontWeight)
      : undefined
    const periodMetrics: PeriodMetric[] = section.periods.map(period => {
      const wrappedPeriodLabel = wrapTimelineText(applyTextTransform(period.label, style.edgeTextTransform), caps.pill, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const pillText = measureMultilineText(wrappedPeriodLabel, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const pillWidth = Math.max(caps.pillMinWidth, pillText.width + style.nodePaddingX * 2)
      const pillHeight = pillText.height + style.nodePaddingY * 2

      const eventMetrics = period.events.map(event => {
        const wrappedEventText = wrapTimelineText(applyTextTransform(event.text, style.nodeTextTransform), caps.event, style.nodeLabelFontSize, style.nodeLabelFontWeight)
        const text = measureMultilineText(wrappedEventText, style.nodeLabelFontSize, style.nodeLabelFontWeight)
        return {
          text: wrappedEventText,
          width: Math.max(caps.eventMinWidth, text.width + style.nodePaddingX * 2),
          height: text.height + style.nodePaddingY * 2,
        }
      })

      const mainExtent = Math.max(
        mainOf(pillWidth, pillHeight),
        ...eventMetrics.map(event => mainOf(event.width, event.height)),
      )

      return {
        label: wrappedPeriodLabel,
        pillWidth,
        pillHeight,
        mainExtent,
        events: eventMetrics,
      }
    })

    const runMain = periodMetrics.reduce((sum, period, index) => {
      const gap = index === 0 ? 0 : TL.columnGap
      return sum + gap + period.mainExtent
    }, 0)

    const headerWidth = wrappedSectionLabel
      ? measureMultilineText(wrappedSectionLabel, style.groupHeaderFontSize, style.groupHeaderFontWeight).width + style.groupLabelPaddingX * 2
      : 0

    // In LR the header text rides the main axis, so it can widen the frame
    // beyond the period run; in TD it spans the (shared) cross axis instead.
    const innerMain = vertical ? runMain : Math.max(runMain, headerWidth)

    return {
      label: wrappedSectionLabel,
      headerWidth,
      runMain,
      innerMain,
      periods: periodMetrics,
    }
  })
}

/** Horizontal main-axis end (the final width) the placement walk would reach —
 *  used by width control to decide whether compression is needed at all. */
function projectedMainEnd(metrics: SectionMetric[], sectionPadX: number, showSectionFrames: boolean): number {
  let cursor = TL.paddingX
  for (let index = 0; index < metrics.length; index++) {
    cursor += metrics[index]!.innerMain + sectionPadX * 2
    if (index < metrics.length - 1) cursor += showSectionFrames ? TL.sectionGap : TL.columnGap
  }
  return cursor + TL.paddingX
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
