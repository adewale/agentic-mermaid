// ============================================================================
// Gantt SVG renderer (docs/design/families/gantt.md §4).
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
import type { RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { escapeXml } from '../multiline-utils.ts'
import { estimateTextWidth, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'

const GS = {
  titleFontSize: 17,
  sectionFontSize: 13,
  labelFontSize: 13,
  axisFontSize: 11,
  barRadius: 3,
} as const

const GANTT_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: GS.labelFontSize,
  edgeLabelFontSize: GS.axisFontSize,
  groupHeaderFontSize: GS.sectionFontSize,
  nodeLabelFontWeight: 500,
  edgeLabelFontWeight: 500,
  groupHeaderFontWeight: 600,
  nodePaddingX: 0,
  nodePaddingY: 0,
  nodeLineWidth: STROKE_WIDTHS.innerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: 0,
  groupPaddingY: 0,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

function ganttStyles(style: ResolvedRenderStyle): string {
  const groupFill = style.groupFillColor ?? 'var(--surface, var(--fg))'
  const groupOpacity = style.groupFillColor ? '1' : '0.07'
  const edgeStroke = style.edgeStrokeColor ?? 'var(--line, var(--border, var(--fg)))'
  const nodeFill = style.nodeFillColor ?? 'var(--accent, var(--fg))'
  const nodeBorder = style.nodeBorderColor ?? 'var(--fg)'
  const doneFill = style.nodeFillColor ?? 'var(--muted, var(--line, var(--fg)))'
  const criticalFill = style.nodeFillColor ?? 'var(--fg)'
  const criticalStroke = style.nodeBorderColor ?? style.edgeStrokeColor ?? 'var(--accent, var(--fg))'
  const titleFill = style.groupTextColor ?? style.nodeTextColor ?? 'var(--fg)'
  const groupText = style.groupTextColor ?? style.nodeTextColor ?? 'var(--fg)'
  const taskText = style.nodeTextColor ?? 'var(--fg)'
  const axisText = style.edgeTextColor ?? style.groupTextColor ?? 'var(--muted, var(--fg))'

  return `<style>
  .gantt-section-band { fill: ${groupFill}; opacity: ${groupOpacity}; }
  .gantt-grid-line { stroke: ${edgeStroke}; stroke-width: ${style.lineWidth}; opacity: ${style.edgeStrokeColor ? '0.6' : '0.45'}; }
  .gantt-bar { fill: ${nodeFill}; stroke: ${style.nodeBorderColor ? nodeBorder : 'none'};${style.nodeBorderColor ? ` stroke-width: ${style.nodeLineWidth};` : ''} opacity: 0.92; }
  .gantt-bar-active { fill: ${nodeFill}; stroke: ${nodeBorder}; stroke-width: ${Math.max(1.5, style.nodeLineWidth)}; opacity: 1; }
  .gantt-bar-done { fill: ${doneFill}; opacity: ${style.nodeFillColor ? '0.72' : '0.55'}; }
  .gantt-bar-crit { fill: ${criticalFill}; stroke: ${criticalStroke}; stroke-width: ${Math.max(1.5, style.nodeLineWidth)}; opacity: 0.95; }
  .gantt-milestone { fill: ${nodeFill}; stroke: ${nodeBorder}; stroke-width: ${Math.max(1, style.nodeLineWidth)}; }
  .gantt-milestone-crit { fill: ${criticalFill}; stroke: ${criticalStroke}; stroke-width: ${Math.max(1.5, style.nodeLineWidth)}; }
  .gantt-vert-marker { stroke: ${edgeStroke}; stroke-width: ${Math.max(2, style.lineWidth)}; stroke-dasharray: 6 3; }
  .gantt-today-marker { stroke: ${style.edgeStrokeColor ?? 'var(--accent, var(--fg))'}; stroke-width: ${Math.max(2, style.lineWidth)}; stroke-dasharray: 4 3; }
  .gantt-title { fill: ${titleFill}; }
  .gantt-section-label { fill: ${groupText}; }
  .gantt-task-label { fill: ${taskText}; }
  .gantt-axis-label { fill: ${axisText}; }
</style>`
}

function statusClass(tags: readonly string[]): string {
  if (tags.includes('crit')) return 'gantt-bar gantt-bar-crit'
  if (tags.includes('active')) return 'gantt-bar gantt-bar-active'
  if (tags.includes('done')) return 'gantt-bar gantt-bar-done'
  return 'gantt-bar'
}

function text(
  x: number,
  y: number,
  content: string,
  cls: string,
  size: number,
  weight: number,
  anchor = 'start',
  letterSpacing = 0,
): string {
  const letter = letterSpacing !== 0 ? ` letter-spacing="${letterSpacing}"` : ''
  return `<text class="${cls}" x="${r(x)}" y="${r(y)}" text-anchor="${anchor}" dominant-baseline="middle" ` +
    `font-size="${size}" font-weight="${weight}"${letter}>${escapeXml(content)}</text>`
}

function r(n: number): number { return Math.round(n * 100) / 100 }

export function renderGanttSvg(
  ctx: RenderContext<GanttLayoutResult>,
): string {
  const { positioned: layout, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, GANTT_STYLE_DEFAULTS)
  const parts: string[] = []
  parts.push(svgOpenTag(layout.width, layout.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  parts.push(ganttStyles(style))

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
    parts.push(text(tick.x, plotBottom + 12, tick.label, 'gantt-axis-label', style.edgeLabelFontSize, style.edgeLabelFontWeight, 'middle', style.edgeLetterSpacing))
    if (layout.topAxis) {
      parts.push(text(tick.x, plot.y - 10, tick.label, 'gantt-axis-label', style.edgeLabelFontSize, style.edgeLabelFontWeight, 'middle', style.edgeLetterSpacing))
    }
  }

  // Section + task labels in the left column (role: text).
  for (const s of layout.sections) {
    if (s.label !== undefined) {
      parts.push(text(8, s.y + layout.barHeight / 2 + 4, s.label, 'gantt-section-label', style.groupHeaderFontSize, style.groupHeaderFontWeight, 'start', style.groupLetterSpacing))
    }
  }
  // Compact mode packs several tasks into one lane, so the fixed left-column
  // slot would print their labels on top of each other (2026-07 overlap
  // audit). Place each compact label beside its own bar instead: left of the
  // bar when the gap to the previous bar in the lane fits, else right of the
  // bar when the gap to the next allows; the first bar of a lane keeps the
  // left-column look because its left gap starts at the plot edge.
  if (!layout.compact) {
    for (const bar of layout.bars) {
      parts.push(text(16, bar.y + bar.h / 2, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, 'start', style.nodeLetterSpacing))
    }
  } else {
    const byRow = new Map<number, typeof layout.bars>()
    for (const bar of layout.bars) {
      const row = byRow.get(bar.y) ?? []
      row.push(bar)
      byRow.set(bar.y, row)
    }
    for (const row of byRow.values()) {
      row.sort((a, b) => a.x - b.x)
      row.forEach((bar, i) => {
        const w = estimateTextWidth(bar.label, style.nodeLabelFontSize, style.nodeLabelFontWeight)
        const cy = bar.y + bar.h / 2
        const leftLimit = i > 0 ? row[i - 1]!.x + row[i - 1]!.w + 4 : 2
        const rightLimit = i + 1 < row.length ? row[i + 1]!.x - 4 : layout.width - 2
        if (bar.x - 6 - w >= leftLimit) {
          parts.push(text(bar.x - 6, cy, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, 'end', style.nodeLetterSpacing))
        } else if (bar.x + bar.w + 6 + w <= rightLimit) {
          parts.push(text(bar.x + bar.w + 6, cy, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, 'start', style.nodeLetterSpacing))
        } else {
          // No clear slot beside the bar — keep the legacy column (surfaced by
          // eval/overlap-audit rather than hidden).
          parts.push(text(16, cy, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, 'start', style.nodeLetterSpacing))
        }
      })
    }
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
    parts.push(text(v.x, plot.y - (layout.topAxis ? 24 : 8), v.label, 'gantt-axis-label', style.edgeLabelFontSize, Math.max(style.edgeLabelFontWeight, 600), 'middle', style.edgeLetterSpacing))
  }

  // Today marker — only with a supplied clock.
  if (layout.todayX !== undefined) {
    parts.push(`<line class="gantt-today-marker" x1="${r(layout.todayX)}" y1="${r(plot.y)}" x2="${r(layout.todayX)}" y2="${r(plotBottom)}" />`)
  }

  if (layout.title) {
    parts.push(text(layout.width / 2, 18, layout.title, 'gantt-title', GS.titleFontSize, Math.max(style.groupHeaderFontWeight, 600), 'middle', style.groupLetterSpacing))
  }

  parts.push('</svg>')
  return parts.join('\n')
}
