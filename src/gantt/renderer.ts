// ============================================================================
// Gantt SVG renderer (docs/design/families/gantt.md §4).
//
// Consumes the resolved GanttLayoutResult — never computes dates. The layout
// is first lowered to a SceneGraph (SPEC §3.1): every visual mark becomes a
// scene node carrying semantic fields (role, geometry, paint, channels,
// stable id) plus its exact crisp serialization, built here from the same
// inputs. renderGanttSvg() is DefaultBackend serialization of that scene, so
// the default path stays byte-identical to the historical string renderer
// (corpus-gated by svg-equivalence.test.ts); styled backends redraw the same
// scene — task bars carry status/progress channels so styled passes are never
// blind to done/active/crit semantics.
//
// Theme roles map to the shared CSS custom properties:
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
import type { MarkPaint, SceneDoc, SceneNode, SemanticChannels } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'

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

/** Resolved paint tokens shared by the CSS block and the scene-mark paints,
 *  so styled backends see exactly the colors the crisp classes apply. */
interface GanttPalette {
  groupFill: string
  groupOpacity: string
  edgeStroke: string
  nodeFill: string
  nodeBorder: string
  doneFill: string
  criticalFill: string
  criticalStroke: string
  titleFill: string
  groupText: string
  taskText: string
  axisText: string
}

function ganttPalette(style: ResolvedRenderStyle): GanttPalette {
  return {
    groupFill: style.groupFillColor ?? 'var(--surface, var(--fg))',
    groupOpacity: style.groupFillColor ? '1' : '0.07',
    edgeStroke: style.edgeStrokeColor ?? 'var(--line, var(--border, var(--fg)))',
    nodeFill: style.nodeFillColor ?? 'var(--accent, var(--fg))',
    nodeBorder: style.nodeBorderColor ?? 'var(--fg)',
    doneFill: style.nodeFillColor ?? 'var(--muted, var(--line, var(--fg)))',
    criticalFill: style.nodeFillColor ?? 'var(--fg)',
    criticalStroke: style.nodeBorderColor ?? style.edgeStrokeColor ?? 'var(--accent, var(--fg))',
    titleFill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--fg)',
    groupText: style.groupTextColor ?? style.nodeTextColor ?? 'var(--fg)',
    taskText: style.nodeTextColor ?? 'var(--fg)',
    axisText: style.edgeTextColor ?? style.groupTextColor ?? 'var(--muted, var(--fg))',
  }
}

function ganttStyles(style: ResolvedRenderStyle): string {
  const p = ganttPalette(style)

  return `<style>
  .gantt-section-band { fill: ${p.groupFill}; opacity: ${p.groupOpacity}; }
  .gantt-grid-line { stroke: ${p.edgeStroke}; stroke-width: ${style.lineWidth}; opacity: ${style.edgeStrokeColor ? '0.6' : '0.45'}; }
  .gantt-bar { fill: ${p.nodeFill}; stroke: ${style.nodeBorderColor ? p.nodeBorder : 'none'};${style.nodeBorderColor ? ` stroke-width: ${style.nodeLineWidth};` : ''} opacity: 0.92; }
  .gantt-bar-active { fill: ${p.nodeFill}; stroke: ${p.nodeBorder}; stroke-width: ${Math.max(1.5, style.nodeLineWidth)}; opacity: 1; }
  .gantt-bar-done { fill: ${p.doneFill}; opacity: ${style.nodeFillColor ? '0.72' : '0.55'}; }
  .gantt-bar-crit { fill: ${p.criticalFill}; stroke: ${p.criticalStroke}; stroke-width: ${Math.max(1.5, style.nodeLineWidth)}; opacity: 0.95; }
  .gantt-milestone { fill: ${p.nodeFill}; stroke: ${p.nodeBorder}; stroke-width: ${Math.max(1, style.nodeLineWidth)}; }
  .gantt-milestone-crit { fill: ${p.criticalFill}; stroke: ${p.criticalStroke}; stroke-width: ${Math.max(1.5, style.nodeLineWidth)}; }
  .gantt-vert-marker { stroke: ${p.edgeStroke}; stroke-width: ${Math.max(2, style.lineWidth)}; stroke-dasharray: 6 3; }
  .gantt-today-marker { stroke: ${style.edgeStrokeColor ?? 'var(--accent, var(--fg))'}; stroke-width: ${Math.max(2, style.lineWidth)}; stroke-dasharray: 4 3; }
  .gantt-title { fill: ${p.titleFill}; }
  .gantt-section-label { fill: ${p.groupText}; }
  .gantt-task-label { fill: ${p.taskText}; }
  .gantt-axis-label { fill: ${p.axisText}; }
</style>`
}

function statusClass(tags: readonly string[]): string {
  if (tags.includes('crit')) return 'gantt-bar gantt-bar-crit'
  if (tags.includes('active')) return 'gantt-bar gantt-bar-active'
  if (tags.includes('done')) return 'gantt-bar gantt-bar-done'
  return 'gantt-bar'
}

/** Semantic status channel — same precedence as statusClass(). */
function statusChannel(tags: readonly string[]): 'done' | 'active' | 'crit' | undefined {
  if (tags.includes('crit')) return 'crit'
  if (tags.includes('active')) return 'active'
  if (tags.includes('done')) return 'done'
  return undefined
}

/** Bar paint per status — mirrors the .gantt-bar* CSS rules exactly. */
function barPaint(status: 'done' | 'active' | 'crit' | undefined, p: GanttPalette, style: ResolvedRenderStyle): MarkPaint {
  switch (status) {
    case 'crit':
      return { fill: p.criticalFill, stroke: p.criticalStroke, strokeWidth: String(Math.max(1.5, style.nodeLineWidth)), opacity: '0.95' }
    case 'active':
      return { fill: p.nodeFill, stroke: p.nodeBorder, strokeWidth: String(Math.max(1.5, style.nodeLineWidth)), opacity: '1' }
    case 'done':
      return { fill: p.doneFill, opacity: style.nodeFillColor ? '0.72' : '0.55' }
    default:
      return {
        fill: p.nodeFill,
        stroke: style.nodeBorderColor ? p.nodeBorder : 'none',
        ...(style.nodeBorderColor ? { strokeWidth: String(style.nodeLineWidth) } : {}),
        opacity: '0.92',
      }
  }
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

/** Build a TextMark whose crisp is the shared text() template. */
function textMark(
  id: string,
  role: SceneNode['role'],
  x: number,
  y: number,
  content: string,
  cls: string,
  size: number,
  weight: number,
  fill: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  letterSpacing = 0,
  channels?: SemanticChannels,
): SceneNode {
  return marks.text({
    id,
    role,
    text: content,
    x: r(x),
    y: r(y),
    fontSize: size,
    anchor,
    paint: { fill },
    channels,
  }, text(x, y, content, cls, size, weight, anchor, letterSpacing))
}

function r(n: number): number { return Math.round(n * 100) / 100 }

export function renderGanttSvg(
  ctx: RenderContext<GanttLayoutResult>,
): string {
  return DefaultBackend.render(lowerGanttScene(ctx), { seed: 0 })
}

/**
 * Lower a gantt layout to the SceneGraph IR. Mark order matches the
 * historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerGanttScene(
  ctx: RenderContext<GanttLayoutResult>,
): SceneDoc {
  const { positioned: layout, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, GANTT_STYLE_DEFAULTS)
  const palette = ganttPalette(style)
  const parts: SceneNode[] = []

  // SVG root with CSS variables + shared style block + gantt CSS.
  const extraCss = ganttStyles(style)
  parts.push(marks.prelude(
    {
      id: 'prelude',
      width: layout.width,
      height: layout.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      extraCss,
    },
    svgOpenTag(layout.width, layout.height, colors, transparent) + '\n' +
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport) + '\n' +
    extraCss,
  ))

  const plot = layout.plot
  const plotBottom = plot.y + plot.h

  // Section bands (role: section) — alternating tint behind each section.
  const bandOccurrence = new Map<string, number>()
  layout.sections.forEach((s, i) => {
    if (i % 2 === 0) {
      const key = s.label ?? ''
      const k = bandOccurrence.get(key) ?? 0
      bandOccurrence.set(key, k + 1)
      parts.push(marks.shape({
        id: `section-band:${key}#${k}`,
        role: 'section',
        geometry: { kind: 'rect', x: r(plot.x), y: r(s.y), width: r(plot.w), height: r(s.h) },
        paint: { fill: palette.groupFill, opacity: palette.groupOpacity },
        channels: s.label !== undefined ? { category: s.label } : undefined,
      }, `<rect class="gantt-section-band" x="${r(plot.x)}" y="${r(s.y)}" width="${r(plot.w)}" height="${r(s.h)}" />`))
    }
  })

  // Grid lines at each tick (role: grid).
  const gridPaint: MarkPaint = {
    stroke: palette.edgeStroke,
    strokeWidth: String(style.lineWidth),
    opacity: style.edgeStrokeColor ? '0.6' : '0.45',
  }
  for (const tick of layout.ticks) {
    parts.push(marks.shape({
      id: `grid:${tick.time}`,
      role: 'grid',
      geometry: { kind: 'line', x1: r(tick.x), y1: r(plot.y), x2: r(tick.x), y2: r(plotBottom) },
      paint: gridPaint,
    }, `<line class="gantt-grid-line" x1="${r(tick.x)}" y1="${r(plot.y)}" x2="${r(tick.x)}" y2="${r(plotBottom)}" />`))
  }

  // Axis labels: bottom always; top additionally under `topAxis`.
  for (const tick of layout.ticks) {
    parts.push(textMark(`axis:${tick.time}:bottom`, 'axis', tick.x, plotBottom + 12, tick.label, 'gantt-axis-label', style.edgeLabelFontSize, style.edgeLabelFontWeight, palette.axisText, 'middle', style.edgeLetterSpacing))
    if (layout.topAxis) {
      parts.push(textMark(`axis:${tick.time}:top`, 'axis', tick.x, plot.y - 10, tick.label, 'gantt-axis-label', style.edgeLabelFontSize, style.edgeLabelFontWeight, palette.axisText, 'middle', style.edgeLetterSpacing))
    }
  }

  // Section + task labels in the left column (roles: section / label).
  const sectionLabelOccurrence = new Map<string, number>()
  for (const s of layout.sections) {
    if (s.label !== undefined) {
      const k = sectionLabelOccurrence.get(s.label) ?? 0
      sectionLabelOccurrence.set(s.label, k + 1)
      parts.push(textMark(`section-label:${s.label}#${k}`, 'section', 8, s.y + layout.barHeight / 2 + 4, s.label, 'gantt-section-label', style.groupHeaderFontSize, style.groupHeaderFontWeight, palette.groupText, 'start', style.groupLetterSpacing, { category: s.label }))
    }
  }
  // Compact mode packs several tasks into one lane, so the fixed left-column
  // slot would print their labels on top of each other (2026-07 overlap
  // audit). Place each compact label beside its own bar instead: left of the
  // bar when the gap to the previous bar in the lane fits, else right of the
  // bar when the gap to the next allows; the first bar of a lane keeps the
  // left-column look because its left gap starts at the plot edge.
  const labelIdOccurrence = new Map<string, number>()
  const taskLabelId = (key: string) => {
    const k = labelIdOccurrence.get(key) ?? 0
    labelIdOccurrence.set(key, k + 1)
    return k === 0 ? `task-label:${key}` : `task-label:${key}#${k}`
  }
  if (!layout.compact) {
    for (const bar of layout.bars) {
      parts.push(textMark(taskLabelId(bar.id ?? bar.label), 'label', 16, bar.y + bar.h / 2, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'start', style.nodeLetterSpacing))
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
          parts.push(textMark(taskLabelId(bar.id ?? bar.label), 'label', bar.x - 6, cy, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'end', style.nodeLetterSpacing))
        } else if (bar.x + bar.w + 6 + w <= rightLimit) {
          parts.push(textMark(taskLabelId(bar.id ?? bar.label), 'label', bar.x + bar.w + 6, cy, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'start', style.nodeLetterSpacing))
        } else {
          // No clear slot beside the bar — keep the legacy column (surfaced by
          // eval/overlap-audit rather than hidden).
          parts.push(textMark(taskLabelId(bar.id ?? bar.label), 'label', 16, cy, bar.label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'start', style.nodeLetterSpacing))
        }
      })
    }
  }

  // Bars + milestones (roles: task / milestone). Status/progress channels are
  // the key semantic payload — styled backends must never be blind to
  // done/active/crit when redrawing bars.
  const taskIdOccurrence = new Map<string, number>()
  const taskSceneId = (key: string) => {
    const k = taskIdOccurrence.get(key) ?? 0
    taskIdOccurrence.set(key, k + 1)
    return k === 0 ? `task:${key}` : `task:${key}#${k}`
  }
  for (const bar of layout.bars) {
    const section = layout.sections[bar.sectionIndex]?.label
    if (bar.milestoneX !== undefined) {
      const cx = bar.milestoneX
      const cy = bar.y + bar.h / 2
      const radius = bar.h / 2
      const crit = bar.tags.includes('crit')
      const cls = crit ? 'gantt-milestone gantt-milestone-crit' : 'gantt-milestone'
      const d = `M ${r(cx)} ${r(cy - radius)} L ${r(cx + radius)} ${r(cy)} L ${r(cx)} ${r(cy + radius)} L ${r(cx - radius)} ${r(cy)} Z`
      const milestonePaint: MarkPaint = crit
        ? { fill: palette.criticalFill, stroke: palette.criticalStroke, strokeWidth: String(Math.max(1.5, style.nodeLineWidth)) }
        : { fill: palette.nodeFill, stroke: palette.nodeBorder, strokeWidth: String(Math.max(1, style.nodeLineWidth)) }
      parts.push(marks.shape({
        id: taskSceneId(bar.id ?? bar.label),
        role: 'milestone',
        geometry: { kind: 'path', d },
        paint: milestonePaint,
        channels: {
          ...(crit ? { status: 'crit' } : {}),
          ...(section !== undefined ? { category: section } : {}),
        },
      }, `<path class="${cls}" d="${d}" data-task="${escapeXml(bar.id ?? bar.label)}" />`))
      continue
    }
    const status = statusChannel(bar.tags)
    parts.push(marks.shape({
      id: taskSceneId(bar.id ?? bar.label),
      role: 'task',
      geometry: { kind: 'rect', x: r(bar.x), y: r(bar.y), width: r(Math.max(2, bar.w)), height: r(bar.h), rx: GS.barRadius, ry: GS.barRadius },
      paint: barPaint(status, palette, style),
      channels: {
        ...(status !== undefined ? { status } : {}),
        // The layout carries no per-task completion fraction; 'done' is the
        // only completion signal, and it lands on the status channel.
        ...(status === 'done' ? { progress: 1 } : {}),
        ...(section !== undefined ? { category: section } : {}),
      },
    },
      `<rect class="${statusClass(bar.tags)}" x="${r(bar.x)}" y="${r(bar.y)}" width="${r(Math.max(2, bar.w))}" height="${r(bar.h)}" ` +
        `rx="${GS.barRadius}" ry="${GS.barRadius}" data-task="${escapeXml(bar.id ?? bar.label)}" />`,
    ))
  }

  // Vert markers (role: marker-line): full-height line + label at the top.
  const vertPaint: MarkPaint = {
    stroke: palette.edgeStroke,
    strokeWidth: String(Math.max(2, style.lineWidth)),
    strokeDasharray: '6 3',
  }
  const vertOccurrence = new Map<string, number>()
  for (const v of layout.verts) {
    const k = vertOccurrence.get(v.label) ?? 0
    vertOccurrence.set(v.label, k + 1)
    parts.push(marks.shape({
      id: `vert:${v.label}#${k}`,
      role: 'marker-line',
      geometry: { kind: 'line', x1: r(v.x), y1: r(plot.y), x2: r(v.x), y2: r(plotBottom) },
      paint: vertPaint,
    }, `<line class="gantt-vert-marker" x1="${r(v.x)}" y1="${r(plot.y)}" x2="${r(v.x)}" y2="${r(plotBottom)}" />`))
    parts.push(textMark(`vert-label:${v.label}#${k}`, 'axis', v.x, plot.y - (layout.topAxis ? 24 : 8), v.label, 'gantt-axis-label', style.edgeLabelFontSize, Math.max(style.edgeLabelFontWeight, 600), palette.axisText, 'middle', style.edgeLetterSpacing))
  }

  // Today marker — only with a supplied clock.
  if (layout.todayX !== undefined) {
    parts.push(marks.shape({
      id: 'today-marker',
      role: 'marker-line',
      geometry: { kind: 'line', x1: r(layout.todayX), y1: r(plot.y), x2: r(layout.todayX), y2: r(plotBottom) },
      paint: {
        stroke: style.edgeStrokeColor ?? 'var(--accent, var(--fg))',
        strokeWidth: String(Math.max(2, style.lineWidth)),
        strokeDasharray: '4 3',
      },
    }, `<line class="gantt-today-marker" x1="${r(layout.todayX)}" y1="${r(plot.y)}" x2="${r(layout.todayX)}" y2="${r(plotBottom)}" />`))
  }

  if (layout.title) {
    parts.push(textMark('title', 'title', layout.width / 2, 18, layout.title, 'gantt-title', GS.titleFontSize, Math.max(style.groupHeaderFontWeight, 600), palette.titleFill, 'middle', style.groupLetterSpacing))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'gantt', width: layout.width, height: layout.height, colors, parts }
}
