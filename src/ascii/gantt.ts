// ============================================================================
// ASCII renderer — Gantt diagrams (docs/design/families/gantt.md §5).
//
// Terminal shape (the pgavlin / kais-radwan convergence the spec records):
// a left label column, section rows, a fixed-width timeline plot, and a date
// gutter — labels stay OUTSIDE bars so terminal bars never hide task names.
//
//                     Project Plan
//   Planning
//     Requirements  ███████─────────────  01-01 → 01-14
//     Design        ───────████████─────  01-15 → 02-04
//                   ─────────────────────
//                   01-01     01-15
//
// Status glyphs (degrade to 7-bit ASCII under `useAscii`):
//   normal █ / '#'   done ░ / '.'   active ▓ / '='   crit ▒ / '!'
//   milestone ◆ / '*'   vert marker ┊ / ':'
//
// Dates are resolved by src/gantt/schedule.ts; tick instants come from the
// same resolveTicks model the SVG renderer uses. Honors `maxWidth` by
// shrinking the plot before truncating labels, and CJK/emoji display width
// via the shared visualWidth helpers.
// ============================================================================

import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule, formatGanttInstant } from '../gantt/schedule.ts'
import { resolveTicks, packCompactLanes } from '../gantt/layout.ts'
import type { GanttModel, GanttSchedule, ScheduledGanttTask, EpochMs } from '../gantt/types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { colorizeLine, DEFAULT_ASCII_THEME } from './ansi.ts'
import { padEndToVisualWidth, truncateToVisualWidth, visualWidth } from './width.ts'
import type { AsciiConfig, AsciiTheme, CharRole, ColorMode } from './types.ts'

interface StyledSegment { text: string; role: CharRole | null }

const DEFAULT_PLOT_WIDTH = 40
const MIN_PLOT_WIDTH = 12
const SECTION_INDENT = '  '
const TASK_INDENT = '    '

interface GanttGlyphs {
  bar: string; done: string; active: string; crit: string
  milestone: string; vert: string; track: string; axis: string
}

function glyphsFor(useAscii: boolean): GanttGlyphs {
  return useAscii
    ? { bar: '#', done: '.', active: '=', crit: '!', milestone: '*', vert: ':', track: '-', axis: '-' }
    : { bar: '█', done: '░', active: '▓', crit: '▒', milestone: '◆', vert: '┊', track: '─', axis: '─' }
}

function fillGlyph(tags: readonly string[], g: GanttGlyphs): string {
  if (tags.includes('crit')) return g.crit
  if (tags.includes('done')) return g.done
  if (tags.includes('active')) return g.active
  return g.bar
}

function truncateToWidth(text: string, width: number): string {
  if (visualWidth(text) <= width) return text
  return truncateToVisualWidth(text, Math.max(1, width - 1)) + '…'
}

function dateGutter(task: ScheduledGanttTask, schedule: GanttSchedule): string {
  const fmt = schedule.dateOnly ? '%m-%d' : '%m-%d %H:%M'
  if (task.tags.includes('milestone')) {
    return formatGanttInstant(task.start + (task.renderEnd - task.start) / 2, fmt)
  }
  // The gutter names the DRAWN extent (renderEnd) so the dates always match
  // the bar; chain ends past trailing excluded days live in describe/analyze.
  return `${formatGanttInstant(task.start, fmt)} → ${formatGanttInstant(task.renderEnd, fmt)}`
}

/**
 * Render a Mermaid gantt diagram to ASCII/Unicode text. `lines` are the
 * normalized source lines (header first); frontmatter carries displayMode.
 */
export function renderGanttAscii(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  frontmatter?: MermaidFrontmatterMap,
  options: { maxWidth?: number; today?: string } = {},
): string {
  const model = applyGanttFrontmatterConfig(parseGanttModel(lines), frontmatter)
  const schedule = resolveGanttSchedule(model, { today: options.today })
  const g = glyphsFor(config.useAscii)
  const arrow = config.useAscii ? '->' : '→'

  const rowTasks = schedule.tasks.filter(t => !t.tags.includes('vert'))
  const vertTasks = schedule.tasks.filter(t => t.tags.includes('vert'))
  const compact = model.displayMode === 'compact'

  // Compact lanes are computed up front so the label column is sized for the
  // joined lane labels ("One / Three"), not the individual task labels.
  const lanesBySection = new Map<number, number[]>()
  if (compact) {
    for (let si = 0; si < model.sections.length; si++) {
      const sectionTasks = rowTasks.filter(t => t.sectionIndex === si)
      if (sectionTasks.length > 0) lanesBySection.set(si, packCompactLanes(sectionTasks))
    }
  }
  // Lane labels join with ", " — the ascii.test.ts diagonal guard forbids
  // "/" anywhere in ASCII output (it signals broken edge routing).
  const laneLabels = (si: number, sectionTasks: ScheduledGanttTask[]): string[] => {
    const lanes = lanesBySection.get(si) ?? sectionTasks.map((_, i) => i)
    const count = sectionTasks.length === 0 ? 0 : Math.max(...lanes) + 1
    return Array.from({ length: count }, (_, li) =>
      sectionTasks.filter((_, i) => lanes[i] === li).map(t => t.label).join(', '))
  }

  // ---- column sizing: shrink the plot before truncating labels --------------
  let labelWidth = 0
  for (let si = 0; si < model.sections.length; si++) {
    const sectionTasks = rowTasks.filter(t => t.sectionIndex === si)
    if (compact) {
      for (const label of laneLabels(si, sectionTasks)) {
        labelWidth = Math.max(labelWidth, visualWidth(TASK_INDENT + label))
      }
    } else {
      for (const t of sectionTasks) labelWidth = Math.max(labelWidth, visualWidth(TASK_INDENT + t.label))
    }
  }
  for (const t of vertTasks) labelWidth = Math.max(labelWidth, visualWidth(TASK_INDENT + t.label))
  for (const s of model.sections) {
    if (s.label !== undefined) labelWidth = Math.max(labelWidth, visualWidth(SECTION_INDENT + s.label))
  }
  const gutters = rowTasks.map(t => dateGutter(t, schedule).replace('→', arrow))
  const gutterWidth = Math.max(0, ...gutters.map(visualWidth))

  let plotWidth = DEFAULT_PLOT_WIDTH
  if (options.maxWidth !== undefined) {
    const fixed = labelWidth + 2 + 2 + gutterWidth
    plotWidth = Math.max(MIN_PLOT_WIDTH, Math.min(DEFAULT_PLOT_WIDTH, options.maxWidth - fixed))
    const total = fixed + plotWidth
    if (total > options.maxWidth) {
      // Plot is already at minimum: truncate the label column to fit.
      labelWidth = Math.max(8, labelWidth - (total - options.maxWidth))
    }
  }

  const span = schedule.timeMax - schedule.timeMin
  const colOf = (t: EpochMs): number => {
    const c = Math.round(((t - schedule.timeMin) / span) * plotWidth)
    return Math.max(0, Math.min(plotWidth, c))
  }

  const vertCols = new Set(vertTasks.map(v => Math.min(plotWidth - 1, colOf(v.start + (v.renderEnd - v.start) / 2))))
  const todayCol = schedule.today !== undefined && schedule.today >= schedule.timeMin && schedule.today <= schedule.timeMax
    ? Math.min(plotWidth - 1, colOf(schedule.today))
    : undefined

  const out: string[] = []
  const pushLine = (segments: StyledSegment[] = []): void => {
    if (segments.length === 0) { out.push(''); return }
    const chars: string[] = []
    const roles: (CharRole | null)[] = []
    for (const seg of segments) {
      for (const ch of seg.text) { chars.push(ch); roles.push(seg.role) }
    }
    out.push(colorizeLine(chars, roles, theme, colorMode).replace(/\s+$/, ''))
  }

  // ---- title ------------------------------------------------------------------
  if (model.title) {
    const totalWidth = labelWidth + 2 + plotWidth
    const pad = Math.max(0, Math.floor((totalWidth - visualWidth(model.title)) / 2))
    pushLine([{ text: ' '.repeat(pad) + model.title, role: 'text' }])
    pushLine()
  }

  // ---- track builder ------------------------------------------------------------
  const buildTrack = (task: ScheduledGanttTask): string => {
    const cells = new Array<string>(plotWidth).fill(g.track)
    if (task.tags.includes('milestone')) {
      const c = Math.min(plotWidth - 1, colOf(task.start + (task.renderEnd - task.start) / 2))
      cells[c] = g.milestone
    } else {
      // Bars draw to renderEnd — the same drawn extent the SVG bars use.
      const from = colOf(task.start)
      const to = Math.max(from + 1, colOf(task.renderEnd))
      const fill = fillGlyph(task.tags, g)
      for (let c = from; c < to && c < plotWidth; c++) cells[c] = fill
    }
    for (const vc of vertCols) if (cells[vc] === g.track) cells[vc] = g.vert
    if (todayCol !== undefined && cells[todayCol] === g.track) cells[todayCol] = config.useAscii ? '|' : '╎'
    return cells.join('')
  }

  // ---- rows -----------------------------------------------------------------------
  for (let si = 0; si < model.sections.length; si++) {
    const section = model.sections[si]!
    const sectionTasks = rowTasks.filter(t => t.sectionIndex === si)
    if (sectionTasks.length === 0 && section.label === undefined) continue
    if (section.label !== undefined) {
      pushLine([{ text: SECTION_INDENT + truncateToWidth(section.label, labelWidth - 2), role: 'border' }])
    }
    if (compact && sectionTasks.length > 0) {
      // Compact mode: tasks pack into shared lanes; each lane renders the
      // overlay of its tasks' bars (deterministic first-fit, source order).
      const lanes = lanesBySection.get(si)!
      const labels = laneLabels(si, sectionTasks)
      for (let li = 0; li < labels.length; li++) {
        const laneTasks = sectionTasks.filter((_, i) => lanes[i] === li)
        const cells = new Array<string>(plotWidth).fill(g.track)
        for (const t of laneTasks) {
          const track = buildTrack(t)
          for (let c = 0; c < plotWidth; c++) if (track[c] !== g.track) cells[c] = track[c]!
        }
        pushLine([
          { text: padEndToVisualWidth(TASK_INDENT + truncateToWidth(labels[li]!, labelWidth - 4), labelWidth), role: 'text' },
          { text: '  ', role: null },
          { text: cells.join(''), role: 'line' },
        ])
      }
    } else {
      for (const t of sectionTasks) {
        pushLine([
          { text: padEndToVisualWidth(TASK_INDENT + truncateToWidth(t.label, labelWidth - 4), labelWidth), role: 'text' },
          { text: '  ', role: null },
          { text: buildTrack(t), role: 'line' },
          { text: '  ', role: null },
          { text: dateGutter(t, schedule).replace('→', arrow), role: 'text' },
        ])
      }
    }
  }

  // ---- vert marker legend ------------------------------------------------------
  for (const v of vertTasks) {
    pushLine([
      { text: padEndToVisualWidth(TASK_INDENT + truncateToWidth(v.label, labelWidth - 4), labelWidth), role: 'text' },
      { text: '  ', role: null },
      { text: padForCol(Math.min(plotWidth - 1, colOf(v.start + (v.renderEnd - v.start) / 2)), g.vert), role: 'line' },
      { text: '  ', role: null },
      { text: formatGanttInstant(v.start, schedule.dateOnly ? '%m-%d' : '%m-%d %H:%M'), role: 'text' },
    ])
  }

  // ---- axis ----------------------------------------------------------------------
  pushLine([
    { text: ' '.repeat(labelWidth + 2), role: null },
    { text: g.axis.repeat(plotWidth), role: 'line' },
  ])
  const ticks = resolveTicks(schedule, model, Math.max(2, Math.floor(plotWidth / 12)))
  const axisCells = new Array<string>(plotWidth + 16).fill(' ')
  for (const tick of ticks) {
    const col = colOf(tick.time)
    if (col >= plotWidth) continue
    for (let i = 0; i < tick.label.length; i++) {
      const at = col + i
      if (at >= axisCells.length) break
      // Keep one space between consecutive tick labels.
      if (i === 0 && col > 0 && axisCells[col - 1] !== ' ') break
      axisCells[at] = tick.label[i]!
    }
  }
  pushLine([
    { text: ' '.repeat(labelWidth + 2), role: null },
    { text: axisCells.join(''), role: 'text' },
  ])

  return out.join('\n').replace(/\s+$/, '')
}

function padForCol(col: number, glyph: string): string {
  return ' '.repeat(col) + glyph
}
