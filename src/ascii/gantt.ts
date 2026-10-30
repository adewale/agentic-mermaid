import { serializeTerminalArtifact, type TerminalArtifact, terminalArtifact } from './terminal-artifact.ts'

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

import { packCompactLanes, resolveTicks } from '../gantt/layout.ts'
import { groupGanttTasksBySection } from '../gantt/task-groups.ts'
import { applyResolvedGanttFrontmatterConfig, parseGanttModel, type ResolvedGanttFrontmatterConfig, resolveGanttFrontmatterConfig } from '../gantt/parser.ts'
import { formatGanttInstant, resolveGanttSchedule } from '../gantt/schedule.ts'
import { parseTodayMarkerStyle } from '../gantt/today-marker.ts'
import type { EpochMs, GanttSchedule, ScheduledGanttTask } from '../gantt/types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { breakLineTags, displayText } from '../multiline-utils.ts'
import { type InternalStyleFace, resolveRoleStyle } from '../scene/style-registry.ts'
import { DEFAULT_ASCII_THEME } from './ansi.ts'
import { terminalIds } from './identity.ts'
import { TerminalDocument, type TerminalOwner, type TerminalRun } from './terminal-document.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'

type StyledSegment = TerminalRun

const DEFAULT_PLOT_WIDTH = 40
const MIN_PLOT_WIDTH = 12
const SECTION_INDENT = '  '
const TASK_INDENT = '    '

interface GanttGlyphs {
  bar: string
  done: string
  active: string
  crit: string
  milestone: string
  vert: string
  track: string
  axis: string
}

function glyphsFor(useAscii: boolean): GanttGlyphs {
  return useAscii ? { bar: '#', done: '.', active: '=', crit: '!', milestone: '*', vert: ':', track: '-', axis: '-' } : { bar: '█', done: '░', active: '▓', crit: '▒', milestone: '◆', vert: '┊', track: '─', axis: '─' }
}

function fillGlyph(tags: readonly string[], g: GanttGlyphs): string {
  if (tags.includes('crit')) return g.crit
  if (tags.includes('done')) return g.done
  if (tags.includes('active')) return g.active
  return g.bar
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
export function renderGanttTerminal(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  frontmatter?: MermaidFrontmatterMap,
  options: { maxWidth?: number; today?: string; resolvedConfig?: ResolvedGanttFrontmatterConfig; styleFace?: InternalStyleFace } = {},
): TerminalArtifact {
  const widthBudget = options.maxWidth ?? config.maxWidth
  const model = applyResolvedGanttFrontmatterConfig(parseGanttModel(lines), options.resolvedConfig ?? resolveGanttFrontmatterConfig(frontmatter))
  model.title ??= config.title
  const schedule = resolveGanttSchedule(model, { today: options.today })
  if (schedule.tasks.length === 0) {
    const document = new TerminalDocument()
    document.titleHandled = true
    for (const label of [model.title, ...model.sections.map(section => section.label), 'No tasks scheduled']) {
      if (label) for (const line of wrapText(label, widthBudget)) document.line([{ text: line, role: 'text' }])
    }
    return terminalArtifact(document, { colorMode, theme, trimEnd: true })
  }
  const g = glyphsFor(config.useAscii)
  const arrow = config.useAscii ? '->' : '→'

  const rowTasks = schedule.tasks.filter(t => !t.tags.includes('vert'))
  const vertTasks = schedule.tasks.filter(t => t.tags.includes('vert'))
  const rowTasksBySection = groupGanttTasksBySection(rowTasks)
  const vertTasksBySection = groupGanttTasksBySection(vertTasks)
  const compact = model.displayMode === 'compact'

  // Compact lanes are computed up front so the label column is sized for the
  // joined lane labels ("One / Three"), not the individual task labels.
  const lanesBySection = new Map<number, ScheduledGanttTask[][]>()
  if (compact) {
    for (let si = 0; si < model.sections.length; si++) {
      const sectionTasks = rowTasksBySection.get(si) ?? []
      if (sectionTasks.length > 0) {
        const lanes: ScheduledGanttTask[][] = []
        packCompactLanes(sectionTasks).forEach((lane, index) => (lanes[lane] ??= []).push(sectionTasks[index]!))
        lanesBySection.set(si, lanes)
      }
    }
  }
  // Lane labels join with ", " — the ascii.test.ts diagonal guard forbids
  // "/" anywhere in ASCII output (it signals broken edge routing).
  const laneLabels = (si: number): string[] => (lanesBySection.get(si) ?? []).map(tasks => tasks.map(task => task.label).join(', '))
  const generated = terminalIds(schedule.tasks.flatMap(task => (task.id === undefined ? [] : [task.id])))
  const taskOwner = (task: Pick<ScheduledGanttTask, 'id' | 'index'>): TerminalOwner => ({ id: task.id ?? generated(`task-${task.index}`), kind: 'node' })
  const labelRows = (tasks: ScheduledGanttTask[], width: number): TerminalRun[][] => {
    const rows: TerminalRun[][] = [[]]
    let used = 0
    tasks.forEach((task, index) => {
      const chunks = wrapText(task.label, Math.max(1, width))
      chunks.forEach((text, lineIndex) => {
        const gap = index > 0 && lineIndex === 0 ? ', ' : ''
        if (used > 0 && (lineIndex > 0 || used + visualWidth(gap + text) > width)) {
          rows.push([])
          used = 0
        }
        if (used > 0 && gap) {
          rows.at(-1)!.push({ text: gap })
          used += visualWidth(gap)
        }
        rows.at(-1)!.push({ text, role: 'text', owner: taskOwner(task) })
        used += visualWidth(text)
      })
    })
    return rows
  }

  // ---- column sizing: shrink the plot before wrapping labels ----------------
  let labelWidth = 0
  for (let si = 0; si < model.sections.length; si++) {
    const sectionTasks = rowTasksBySection.get(si) ?? []
    if (compact) {
      for (const label of laneLabels(si)) {
        labelWidth = Math.max(labelWidth, visualWidth(TASK_INDENT + label))
      }
    } else {
      for (const t of sectionTasks) labelWidth = Math.max(labelWidth, visualWidth(TASK_INDENT + t.label))
    }
  }
  for (const t of vertTasks) labelWidth = Math.max(labelWidth, visualWidth(TASK_INDENT + t.label))
  // Upstream breaks a section title at `<br>` (its task text stays literal).
  const sectionLines = (label: string): string[] => breakLineTags(label).split('\n')
  for (const s of model.sections) {
    if (s.label !== undefined) {
      for (const line of sectionLines(s.label)) labelWidth = Math.max(labelWidth, visualWidth(SECTION_INDENT + line))
    }
  }
  const gutters = rowTasks.map(t => dateGutter(t, schedule).replace('→', arrow))
  const gutterWidth = Math.max(0, ...gutters.map(visualWidth))

  let plotWidth = DEFAULT_PLOT_WIDTH
  if (widthBudget !== undefined) {
    const fixed = labelWidth + 2 + 2 + gutterWidth
    plotWidth = Math.max(MIN_PLOT_WIDTH, Math.min(DEFAULT_PLOT_WIDTH, widthBudget - fixed))
    const total = fixed + plotWidth
    if (total > widthBudget) {
      // Plot is already at minimum: truncate the label column to fit.
      labelWidth = Math.max(8, labelWidth - (total - widthBudget))
    }
  }

  const span = schedule.timeMax - schedule.timeMin
  const colOf = (t: EpochMs): number => {
    const c = Math.round(((t - schedule.timeMin) / span) * plotWidth)
    return Math.max(0, Math.min(plotWidth, c))
  }

  const vertCols = new Set(vertTasks.map(v => Math.min(plotWidth - 1, colOf(v.start + (v.renderEnd - v.start) / 2))))
  const todayCol = schedule.today !== undefined && schedule.today >= schedule.timeMin && schedule.today <= schedule.timeMax ? Math.min(plotWidth - 1, colOf(schedule.today)) : undefined
  const todayStyle = model.todayMarker?.style === undefined ? undefined : parseTodayMarkerStyle(model.todayMarker.style)
  const todayPaint = todayStyle?.applied.find(([property]) => property === 'stroke')?.[1]
  const todayOwner: TerminalOwner = { id: generated('today-marker'), kind: 'plot' }
  const todayGlyph = config.useAscii ? '|' : '╎'

  const document = new TerminalDocument()
  document.titleHandled = true
  if (model.barHeight !== undefined && rowTasks.length > 0)
    document.report({
      code: 'TERMINAL_FAMILY_PROJECTION',
      feature: 'gantt.barHeight',
      message: `gantt.barHeight=${model.barHeight}px is represented by one terminal bar row per task or compact lane; task labels, dates and interval ownership are retained.`,
    })
  if (todayCol !== undefined && todayStyle !== undefined) {
    for (const [property, value] of todayStyle.applied) {
      if (property === 'stroke' || (property === 'opacity' && Number(value) === 1)) continue
      document.report({
        code: 'TERMINAL_FAMILY_PROJECTION',
        feature: `gantt.todayMarker.${property}`,
        message: `todayMarker ${property}=${JSON.stringify(value)} is represented by ${todayGlyph} at the resolved clock column; CSS opacity, dash lengths and pixel stroke widths are unavailable. The resolved stroke color is retained.`,
      })
    }
  }
  let owner: TerminalOwner | undefined
  const pushLine = (segments: StyledSegment[] = []): void => {
    document.line(segments, { owner })
  }

  // ---- title ------------------------------------------------------------------
  if (model.title) {
    owner = { id: generated('title'), kind: 'label' }
    const totalWidth = labelWidth + 2 + plotWidth
    document.scope(owner, () => {
      for (const text of wrapText(model.title!, widthBudget)) {
        const pad = Math.max(0, Math.floor((totalWidth - visualWidth(text)) / 2))
        pushLine([
          { text: ' '.repeat(pad), kind: 'surface' },
          { text, role: 'text' },
        ])
      }
    })
    pushLine()
  }

  // ---- track builder ------------------------------------------------------------
  const buildTrack = (task: ScheduledGanttTask): TerminalRun[] => {
    const cells: TerminalRun[] = Array.from({ length: plotWidth }, () => ({ text: g.track, role: 'line', kind: 'stroke' }))
    const status = task.tags.includes('crit') ? 'crit' : task.tags.includes('active') ? 'active' : task.tags.includes('done') ? 'done' : undefined
    const category = model.sections[task.sectionIndex]?.label
    const role = task.tags.includes('milestone') ? 'milestone' : 'task'
    const roleStyle = resolveRoleStyle(
      options.styleFace,
      role,
      {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
      },
      { includeFallback: false },
    )
    const cueFill = roleStyle?.cue === 'outline' ? (config.useAscii ? '+' : '◇') : roleStyle?.cue === 'double-line' ? '=' : roleStyle?.cue === 'pattern' ? (config.useAscii ? '%' : '░') : undefined
    if (task.tags.includes('milestone')) {
      const c = Math.min(plotWidth - 1, colOf(task.start + (task.renderEnd - task.start) / 2))
      const milestoneCue = roleStyle?.cue === 'outline' ? (config.useAscii ? '+' : '◇') : roleStyle?.cue === 'double-line' ? (config.useAscii ? '#' : '◈') : roleStyle?.cue === 'pattern' ? (config.useAscii ? '%' : '▣') : undefined
      cells[c] = { text: milestoneCue ?? g.milestone, role: 'line', kind: 'marker' }
    } else {
      // Bars draw to renderEnd — the same drawn extent the SVG bars use.
      const from = colOf(task.start)
      const to = Math.max(from + 1, colOf(task.renderEnd))
      // Critical emphasis remains family-owned; otherwise the semantic cue
      // receives a deterministic no-color glyph projection.
      const fill = task.tags.includes('crit') ? g.crit : (cueFill ?? fillGlyph(task.tags, g))
      for (let c = from; c < to && c < plotWidth; c++) cells[c] = { text: fill, role: 'line', kind: 'mark' }
    }
    for (const vc of vertCols) if (cells[vc]!.text === g.track) cells[vc] = { text: g.vert, role: 'line', kind: 'stroke' }
    if (todayCol !== undefined && cells[todayCol]!.text === g.track) cells[todayCol] = { text: todayGlyph, role: 'line', kind: 'marker', owner: todayOwner, color: todayPaint }
    return cells
  }

  const emitAxis = (): void => {
    owner = { id: generated('time-axis'), kind: 'label' }
    const axisRow = document.height
    pushLine([
      { text: ' '.repeat(labelWidth + 2), role: null },
      { text: g.axis.repeat(plotWidth), role: 'line' },
    ])
    // Keep the clock position visible even when task bars cover every track.
    if (todayCol !== undefined) document.put(labelWidth + 2 + todayCol, axisRow, todayGlyph, { role: 'line', kind: 'marker', owner: todayOwner, color: todayPaint })
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
      { text: axisCells.join('').trimEnd(), role: 'text' },
    ])
  }

  if (model.topAxis) emitAxis()

  const emitVertical = (v: ScheduledGanttTask): void => {
    owner = taskOwner(v)
    document.scope(owner, () => {
      labelRows([v], Math.max(1, labelWidth - 4)).forEach((runs, index) => {
        const width = runs.reduce((sum, run) => sum + visualWidth(run.text), 0)
        pushLine([
          { text: TASK_INDENT, kind: 'surface' },
          ...runs,
          ...(index === 0
            ? [
                { text: ' '.repeat(Math.max(0, labelWidth - 4 - width) + 2) },
                { text: padForCol(Math.min(plotWidth - 1, colOf(v.start + (v.renderEnd - v.start) / 2)), g.vert), role: 'line' as const, kind: 'stroke' as const },
                { text: '  ' },
                { text: formatGanttInstant(v.start, schedule.dateOnly ? '%m-%d' : '%m-%d %H:%M'), role: 'text' as const, owner: { id: generated(`${taskOwner(v).id}:dates`), kind: 'label' as const, parent: { id: taskOwner(v).id, kind: 'node' as const } } },
              ]
            : []),
        ])
      })
    })
  }

  // ---- rows -----------------------------------------------------------------------
  let sectionIndex = 0
  for (let si = 0; si < model.sections.length; si++) {
    const section = model.sections[si]!
    const sectionStart = document.height
    const sectionTasks = rowTasksBySection.get(si) ?? []
    const sectionVertical = vertTasksBySection.get(si) ?? []
    if (sectionTasks.length === 0 && sectionVertical.length === 0 && section.label === undefined) continue
    if (sectionTasks.length === 0 && section.label === undefined) {
      sectionVertical.forEach(emitVertical)
      continue
    }
    const visibleSectionIndex = sectionIndex++
    owner = { id: generated(`section-label#${visibleSectionIndex}`), kind: 'label' }
    if (section.label !== undefined) {
      for (const line of sectionLines(section.label)) {
        document.scope(owner, () => {
          for (const text of wrapText(line, Math.max(1, labelWidth - 2)))
            pushLine([
              { text: SECTION_INDENT, kind: 'surface' },
              { text, role: 'border', kind: 'text' },
            ])
        })
      }
    }
    if (compact && sectionTasks.length > 0) {
      // Compact mode: tasks pack into shared lanes; each lane renders the
      // overlay of its tasks' bars (deterministic first-fit, source order).
      const lanes = lanesBySection.get(si)!
      for (let li = 0; li < lanes.length; li++) {
        const laneTasks = lanes[li]!
        const cells: TerminalRun[] = Array.from({ length: plotWidth }, () => ({ text: g.track, role: 'line', kind: 'stroke' }))
        for (const t of laneTasks) {
          const track = buildTrack(t)
          for (let c = 0; c < plotWidth; c++) if (track[c]!.text !== g.track) cells[c] = { ...track[c]!, owner: track[c]!.owner ?? taskOwner(t) }
        }
        // Registered once: every track cell of the lane names this owner.
        owner = document.element({ id: generated(`lane:${si}:${li}`), kind: 'lane', members: laneTasks.map(task => taskOwner(task).id) })
        const labels = labelRows(laneTasks, Math.max(1, labelWidth - 4))
        labels.forEach((runs, index) => {
          const width = runs.reduce((sum, run) => sum + visualWidth(run.text), 0)
          pushLine([{ text: TASK_INDENT }, ...runs, ...(index === 0 ? [{ text: ' '.repeat(Math.max(0, labelWidth - 4 - width) + 2) }, ...cells.map(cell => ({ ...cell, owner: cell.owner ?? owner }))] : [])])
        })
      }
    } else {
      for (const t of sectionTasks) {
        const currentOwner = taskOwner(t)
        owner = currentOwner
        labelRows([t], Math.max(1, labelWidth - 4)).forEach((runs, index) => {
          const width = runs.reduce((sum, run) => sum + visualWidth(run.text), 0)
          pushLine([
            { text: TASK_INDENT },
            ...runs,
            ...(index === 0
              ? [
                  { text: ' '.repeat(Math.max(0, labelWidth - 4 - width) + 2) },
                  ...buildTrack(t),
                  { text: '  ' },
                  { text: dateGutter(t, schedule).replace('→', arrow), role: 'text' as const, owner: { id: generated(`${currentOwner.id}:dates`), kind: 'label' as const, parent: { id: currentOwner.id, kind: 'node' as const } } },
                ]
              : []),
          ])
        })
      }
    }
    sectionVertical.forEach(emitVertical)
    document.region(
      { id: generated(`section#${visibleSectionIndex}`), kind: 'band', members: [...sectionTasks, ...sectionVertical].map(task => taskOwner(task).id) },
      {
        x: 0,
        y: sectionStart,
        width: document.width,
        height: document.height - sectionStart,
      },
    )
  }

  if (!model.topAxis) emitAxis()

  // Dates retain the resolved schedule, but equal dates cannot recover the
  // authored dependency graph. Keep that graph as owned, width-aware text.
  for (const task of model.tasks) {
    const dependencies = [...(task.start?.kind === 'after' ? task.start.refs.map(ref => ({ ref, kind: 'after' as const })) : []), ...(task.end.kind === 'until' ? task.end.refs.map(ref => ({ ref, kind: 'until' as const })) : [])]
    for (const { ref, kind } of dependencies) {
      const ownId = taskOwner(task).id
      const relation = { id: generated(`dependency:${task.index}:${kind}:${ref}`), kind: 'edge' as const, from: kind === 'after' ? ref : ownId, to: kind === 'after' ? ownId : ref }
      for (const line of wrapText(`${displayText(task.id ?? task.label)} ${kind} ${displayText(ref)}`, widthBudget, { hyphenate: false })) document.line([{ text: line, role: 'text', kind: 'text', owner: relation }])
    }
    if (dependencies.length) document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `gantt.${task.index}.dependencies`, message: 'Gantt dependency endpoints are retained as owned after/until text rather than geometric arrows between bars.' })
  }

  return terminalArtifact(document, { colorMode, theme, trimEnd: true })
}

function padForCol(col: number, glyph: string): string {
  return ' '.repeat(col) + glyph
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderGanttAscii(...args: Parameters<typeof renderGanttTerminal>): string {
  return serializeTerminalArtifact(renderGanttTerminal(...args))
}
