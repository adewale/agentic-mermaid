// ============================================================================
// Gantt SVG renderer (docs/design/gantt.md §4).
//
// Consumes the resolved GanttLayoutResult — never computes dates. Theme roles
// map to the shared CSS custom properties:
//   text  → axis/task/date labels  (var(--fg) / var(--muted))
//   node  → bars + milestones      (var(--accent) / var(--surface))
//   edge  → grid lines, today/vert markers (var(--line))
//   group → section bands          (var(--surface))
//
// Status classes: gantt-bar, gantt-bar-done, gantt-bar-active, gantt-bar-crit,
// gantt-milestone, gantt-vert-marker. Task labels live in the left label
// column (fg-on-bg), never on the bars, so text contrast holds in light and
// dark themes by construction.
//
// Deterministic: no Math.random, no Date.now. The today marker draws only
// when the caller supplied a clock (options.ganttToday → schedule.today).
// ============================================================================

import type { GanttLayoutResult } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { escapeXml } from '../multiline-utils.ts'

const GS = {
  titleFontSize: 17,
  sectionFontSize: 13,
  labelFontSize: 13,
  axisFontSize: 11,
  barRadius: 3,
} as const

function ganttStyles(): string {
  return `<style>
  .gantt-section-band { fill: var(--surface, var(--fg)); opacity: 0.07; }
  .gantt-grid-line { stroke: var(--line, var(--border, var(--fg))); stroke-width: 1; opacity: 0.45; }
  .gantt-bar { fill: var(--accent, var(--fg)); stroke: none; opacity: 0.92; }
  .gantt-bar-active { fill: var(--accent, var(--fg)); stroke: var(--fg); stroke-width: 1.5; opacity: 1; }
  .gantt-bar-done { fill: var(--muted, var(--line, var(--fg))); opacity: 0.55; }
  .gantt-bar-crit { fill: var(--fg); stroke: var(--accent, var(--fg)); stroke-width: 1.5; opacity: 0.95; }
  .gantt-milestone { fill: var(--accent, var(--fg)); stroke: var(--fg); stroke-width: 1; }
  .gantt-milestone-crit { fill: var(--fg); stroke: var(--accent, var(--fg)); stroke-width: 1.5; }
  .gantt-vert-marker { stroke: var(--line, var(--fg)); stroke-width: 2; stroke-dasharray: 6 3; }
  .gantt-today-marker { stroke: var(--accent, var(--fg)); stroke-width: 2; stroke-dasharray: 4 3; }
  .gantt-title { fill: var(--fg); }
  .gantt-section-label { fill: var(--fg); }
  .gantt-task-label { fill: var(--fg); }
  .gantt-axis-label { fill: var(--muted, var(--fg)); }
</style>`
}

function statusClass(tags: readonly string[]): string {
  if (tags.includes('crit')) return 'gantt-bar gantt-bar-crit'
  if (tags.includes('active')) return 'gantt-bar gantt-bar-active'
  if (tags.includes('done')) return 'gantt-bar gantt-bar-done'
  return 'gantt-bar'
}

function text(x: number, y: number, content: string, cls: string, size: number, weight: number, anchor = 'start'): string {
  return `<text class="${cls}" x="${r(x)}" y="${r(y)}" text-anchor="${anchor}" dominant-baseline="middle" ` +
    `font-size="${size}" font-weight="${weight}">${escapeXml(content)}</text>`
}

function r(n: number): number { return Math.round(n * 100) / 100 }

export function renderGanttSvg(
  layout: GanttLayoutResult,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []
  parts.push(svgOpenTag(layout.width, layout.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  parts.push(ganttStyles())

  const plot = layout.plot
  const plotBottom = plot.y + plot.h

  // Section bands (role: group) — alternating tint behind each section.
  layout.sections.forEach((s, i) => {
    if (i % 2 === 0) {
      parts.push(`<rect class="gantt-section-band" x="${r(plot.x)}" y="${r(s.y)}" width="${r(plot.w)}" height="${r(s.h)}" />`)
    }
  })

  // Grid lines at each tick (role: edge).
  for (const tick of layout.ticks) {
    parts.push(`<line class="gantt-grid-line" x1="${r(tick.x)}" y1="${r(plot.y)}" x2="${r(tick.x)}" y2="${r(plotBottom)}" />`)
  }

  // Axis labels: bottom always; top additionally under `topAxis`.
  for (const tick of layout.ticks) {
    parts.push(text(tick.x, plotBottom + 12, tick.label, 'gantt-axis-label', GS.axisFontSize, 500, 'middle'))
    if (layout.topAxis) {
      parts.push(text(tick.x, plot.y - 10, tick.label, 'gantt-axis-label', GS.axisFontSize, 500, 'middle'))
    }
  }

  // Section + task labels in the left column (role: text).
  for (const s of layout.sections) {
    if (s.label !== undefined) {
      parts.push(text(8, s.y + layout.barHeight / 2 + 4, s.label, 'gantt-section-label', GS.sectionFontSize, 600))
    }
  }
  for (const bar of layout.bars) {
    parts.push(text(16, bar.y + bar.h / 2, bar.label, 'gantt-task-label', GS.labelFontSize, 500))
  }

  // Bars + milestones (role: node).
  for (const bar of layout.bars) {
    if (bar.milestoneX !== undefined) {
      const cx = bar.milestoneX
      const cy = bar.y + bar.h / 2
      const radius = bar.h / 2
      const cls = bar.tags.includes('crit') ? 'gantt-milestone gantt-milestone-crit' : 'gantt-milestone'
      const d = `M ${r(cx)} ${r(cy - radius)} L ${r(cx + radius)} ${r(cy)} L ${r(cx)} ${r(cy + radius)} L ${r(cx - radius)} ${r(cy)} Z`
      parts.push(`<path class="${cls}" d="${d}" data-task="${escapeXml(bar.id ?? bar.label)}" />`)
      continue
    }
    parts.push(
      `<rect class="${statusClass(bar.tags)}" x="${r(bar.x)}" y="${r(bar.y)}" width="${r(Math.max(2, bar.w))}" height="${r(bar.h)}" ` +
        `rx="${GS.barRadius}" ry="${GS.barRadius}" data-task="${escapeXml(bar.id ?? bar.label)}" />`,
    )
  }

  // Vert markers (role: edge): full-height line + label at the top.
  for (const v of layout.verts) {
    parts.push(`<line class="gantt-vert-marker" x1="${r(v.x)}" y1="${r(plot.y)}" x2="${r(v.x)}" y2="${r(plotBottom)}" />`)
    parts.push(text(v.x, plot.y - (layout.topAxis ? 24 : 8), v.label, 'gantt-axis-label', GS.axisFontSize, 600, 'middle'))
  }

  // Today marker — only with a supplied clock.
  if (layout.todayX !== undefined) {
    parts.push(`<line class="gantt-today-marker" x1="${r(layout.todayX)}" y1="${r(plot.y)}" x2="${r(layout.todayX)}" y2="${r(plotBottom)}" />`)
  }

  if (layout.title) {
    parts.push(text(layout.width / 2, 18, layout.title, 'gantt-title', GS.titleFontSize, 600, 'middle'))
  }

  parts.push('</svg>')
  return parts.join('\n')
}
