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
import { ganttAxisLabelOffset, ganttMeasureTextWidth, ganttTitleFontSize, ganttTitleY, resolveGanttRenderStyle } from './layout.ts'
import { parseTodayMarkerStyle, todayMarkerStyleAttr } from './today-marker.ts'
import type { RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { hashId } from '../scene/seed.ts'
import { applyTextTransform } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { MarkPaint, SceneDoc, SceneNode, SemanticChannels } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'

const GS = {
  barRadius: 3,
} as const

/** Resolved paint tokens shared by the CSS block and the scene-mark paints,
 *  so styled backends see exactly the colors the crisp classes apply. */
interface GanttPalette {
  groupFill: string
  groupOpacity: string
  excludedFill: string
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
    excludedFill: style.edgeStrokeColor ?? 'var(--muted, var(--line, var(--fg)))',
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

/** Opt-in overlay flags (RenderOptions.gantt), pre-gated on the layout
 *  actually having something to draw so the CSS never carries dead rules. */
interface GanttOverlayFlags {
  dependencyArrows: boolean
  criticalBars: boolean
  criticalArrows: boolean
}

const OVERLAY_OFF: GanttOverlayFlags = { dependencyArrows: false, criticalBars: false, criticalArrows: false }

/** Content-conditional rules (not option-gated): emitted only when the layout
 *  actually draws the mark, so charts without it stay byte-identical. */
interface GanttConditionalCss {
  excludedBands: boolean
  milestoneDone: boolean
  milestoneActive: boolean
}

const CONDITIONAL_OFF: GanttConditionalCss = { excludedBands: false, milestoneDone: false, milestoneActive: false }

function ganttStyles(
  style: ResolvedRenderStyle,
  overlay: GanttOverlayFlags = OVERLAY_OFF,
  conditional: GanttConditionalCss = CONDITIONAL_OFF,
): string {
  const p = ganttPalette(style)

  // Overlay/conditional rules append after the base rules (equal specificity —
  // later wins) and only when their option/content draws something, so the
  // default CSS block stays byte-identical otherwise. The connector is
  // deliberately quieter than the bars (the journey curve's restraint);
  // critical-path emphasis is the stronger stroke, never a hard-coded red
  // (Google-Charts lesson from the research doc: opt-in and theme-aware).
  const extra: string[] = []
  if (conditional.excludedBands) {
    // Excluded-day shading (item 2, default-on upstream parity): a quiet tint
    // slightly stronger than the section band so weekends read as "off" days.
    extra.push(`  .gantt-excluded-band { fill: ${p.excludedFill}; opacity: 0.1; }`)
  }
  if (conditional.milestoneDone) {
    extra.push(`  .gantt-milestone-done { fill: ${p.doneFill}; opacity: ${style.nodeFillColor ? '0.72' : '0.55'}; }`)
  }
  if (conditional.milestoneActive) {
    extra.push(`  .gantt-milestone-active { fill: ${p.nodeFill}; stroke: ${p.nodeBorder}; stroke-width: ${Math.max(1.5, style.nodeLineWidth)}; opacity: 1; }`)
  }
  if (overlay.dependencyArrows) {
    extra.push(`  .gantt-dep-arrow { fill: none; stroke: ${p.edgeStroke}; stroke-width: ${Math.max(1.2, style.lineWidth)}; opacity: 0.6; }`)
  }
  if (overlay.criticalArrows) {
    extra.push(`  .gantt-dep-arrow-crit { stroke: ${p.criticalStroke}; stroke-width: ${Math.max(1.8, style.lineWidth * 1.5)}; opacity: 0.95; }`)
  }
  if (overlay.criticalBars) {
    extra.push(`  .gantt-bar-critical-path { stroke: ${p.criticalStroke}; stroke-width: ${Math.max(2, style.nodeLineWidth * 1.5)}; }`)
  }
  const overlayCss = extra.length > 0 ? `${extra.join('\n')}\n` : ''

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
${overlayCss}</style>`
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
  const style = resolveGanttRenderStyle(options)
  const palette = ganttPalette(style)
  const parts: SceneNode[] = []

  // Opt-in dependency/critical-path overlay (RenderOptions.gantt) — both
  // default OFF, and every overlay branch below is byte-inert when off.
  const ganttOptions = options.gantt ?? {}
  const overlay: GanttOverlayFlags = {
    dependencyArrows: ganttOptions.dependencyArrows === true && layout.dependencies.length > 0,
    criticalBars: ganttOptions.criticalPath === true && layout.criticalTaskIndexes.length > 0,
    criticalArrows: ganttOptions.dependencyArrows === true && ganttOptions.criticalPath === true
      && layout.dependencies.some(d => d.critical),
  }
  const criticalPathSet = new Set(overlay.criticalBars ? layout.criticalTaskIndexes : [])

  // Content-conditional CSS: excluded-day bands and status-milestone rules
  // exist only when the chart draws them (byte-inert otherwise).
  const conditional: GanttConditionalCss = {
    excludedBands: layout.excludedBands.length > 0,
    milestoneDone: layout.bars.some(b => b.milestoneX !== undefined && statusChannel(b.tags) === 'done'),
    milestoneActive: layout.bars.some(b => b.milestoneX !== undefined && statusChannel(b.tags) === 'active'),
  }

  // SVG root with CSS variables + shared style block + gantt CSS.
  const extraCss = ganttStyles(style, overlay, conditional)
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

  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(marks.raw({ id: 'shadow-defs', role: 'defs' }, `<defs>${shadowDefs}</defs>`))

  // Dependency arrowhead defs — content-hashed ids (the journey id-namespacing
  // pattern) so two different gantt SVGs inlined into one page cannot collide.
  const depMarkerId = `${ganttNamespace(layout)}-dep-arrow`
  const depMarkerCritId = `${depMarkerId}-crit`
  if (overlay.dependencyArrows) {
    const markers = [
      `  <marker id="${escapeAttr(depMarkerId)}" markerWidth="8" markerHeight="7" refX="8" refY="3.5" orient="auto">
    <path d="M0,0 L8,3.5 L0,7 Z" fill="${palette.edgeStroke}" />
  </marker>`,
    ]
    if (overlay.criticalArrows) {
      markers.push(`  <marker id="${escapeAttr(depMarkerCritId)}" markerWidth="8" markerHeight="7" refX="8" refY="3.5" orient="auto">
    <path d="M0,0 L8,3.5 L0,7 Z" fill="${palette.criticalStroke}" />
  </marker>`)
    }
    parts.push(marks.raw({ id: 'defs', role: 'defs' }, `<defs>\n${markers.join('\n')}\n</defs>`))
  }

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

  // Excluded-day shading bands (role: grid) — default-on upstream parity,
  // drawn AFTER the section tint and BEFORE grid lines and bars, so bands sit
  // behind every bar by paint order (the z-order invariant gate).
  const excludedPaint: MarkPaint = { fill: palette.excludedFill, opacity: '0.1' }
  for (const band of layout.excludedBands) {
    parts.push(marks.shape({
      id: `excluded:${band.start}`,
      role: 'grid',
      geometry: { kind: 'rect', x: r(band.x), y: r(plot.y), width: r(band.w), height: r(plot.h) },
      paint: excludedPaint,
    }, `<rect class="gantt-excluded-band" x="${r(band.x)}" y="${r(plot.y)}" width="${r(band.w)}" height="${r(plot.h)}" />`))
  }

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
  const axisOffset = ganttAxisLabelOffset(style)
  const bottomAxisOffset = axisOffset === 10 && style.edgeLabelFontSize === 11 ? 12 : Math.max(12, axisOffset)
  for (const tick of layout.ticks) {
    const label = applyTextTransform(tick.label, style.edgeTextTransform)
    parts.push(textMark(`axis:${tick.time}:bottom`, 'axis', tick.x, plotBottom + bottomAxisOffset, label, 'gantt-axis-label', style.edgeLabelFontSize, style.edgeLabelFontWeight, palette.axisText, 'middle', style.edgeLetterSpacing))
    if (layout.topAxis) {
      parts.push(textMark(`axis:${tick.time}:top`, 'axis', tick.x, plot.y - axisOffset, label, 'gantt-axis-label', style.edgeLabelFontSize, style.edgeLabelFontWeight, palette.axisText, 'middle', style.edgeLetterSpacing))
    }
  }

  // Section + task labels in the left column (roles: section / label).
  // layout.labelLines (when present) are pre-wrapped AND pre-transformed —
  // drawn verbatim, one text element per line; single-line labels keep the
  // exact historical mark (byte-identical below the wrap budget).
  const sectionLineHeight = style.groupHeaderFontSize * 1.3
  const taskLineHeight = style.nodeLabelFontSize * 1.3
  const sectionLabelOccurrence = new Map<string, number>()
  for (const s of layout.sections) {
    if (s.label !== undefined) {
      const k = sectionLabelOccurrence.get(s.label) ?? 0
      sectionLabelOccurrence.set(s.label, k + 1)
      const lines = s.labelLines ?? [applyTextTransform(s.label, style.groupTextTransform)]
      lines.forEach((line, li) => {
        const id = li === 0 ? `section-label:${s.label}#${k}` : `section-label:${s.label}#${k}/${li}`
        parts.push(textMark(id, 'section', 8, s.y + layout.barHeight / 2 + 4 + li * sectionLineHeight, line, 'gantt-section-label', style.groupHeaderFontSize, style.groupHeaderFontWeight, palette.groupText, 'start', style.groupLetterSpacing, { category: s.label }))
      })
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
      const lines = bar.labelLines ?? [applyTextTransform(bar.label, style.nodeTextTransform)]
      const baseId = taskLabelId(bar.id ?? bar.label)
      lines.forEach((line, li) => {
        const id = li === 0 ? baseId : `${baseId}/${li}`
        parts.push(textMark(id, 'label', 16, bar.y + bar.h / 2 + li * taskLineHeight, line, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'start', style.nodeLetterSpacing))
      })
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
        const label = applyTextTransform(bar.label, style.nodeTextTransform)
        const w = ganttMeasureTextWidth(label, style.nodeLabelFontSize, style.nodeLabelFontWeight, style.nodeLetterSpacing)
        const cy = bar.y + bar.h / 2
        const leftLimit = i > 0 ? row[i - 1]!.x + row[i - 1]!.w + 4 : 2
        const rightLimit = i + 1 < row.length ? row[i + 1]!.x - 4 : layout.width - 2
        if (bar.x - 6 - w >= leftLimit) {
          parts.push(textMark(taskLabelId(bar.id ?? bar.label), 'label', bar.x - 6, cy, label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'end', style.nodeLetterSpacing))
        } else if (bar.x + bar.w + 6 + w <= rightLimit) {
          parts.push(textMark(taskLabelId(bar.id ?? bar.label), 'label', bar.x + bar.w + 6, cy, label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'start', style.nodeLetterSpacing))
        } else {
          // No clear slot beside the bar — keep the legacy column (surfaced by
          // eval/overlap-audit rather than hidden).
          parts.push(textMark(taskLabelId(bar.id ?? bar.label), 'label', 16, cy, label, 'gantt-task-label', style.nodeLabelFontSize, style.nodeLabelFontWeight, palette.taskText, 'start', style.nodeLetterSpacing))
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
    // Critical-path emphasis (opt-in): the analysis-backed stronger stroke.
    const onCriticalPath = criticalPathSet.has(bar.taskIndex)
    const criticalPathCls = onCriticalPath ? ' gantt-bar-critical-path' : ''
    const criticalPathPaint: Partial<MarkPaint> = onCriticalPath
      ? { stroke: palette.criticalStroke, strokeWidth: String(Math.max(2, style.nodeLineWidth * 1.5)) }
      : {}
    if (bar.milestoneX !== undefined) {
      const cx = bar.milestoneX
      const cy = bar.y + bar.h / 2
      const radius = bar.h / 2
      // Status classes mirror the bar convention (item 6): done/active/crit
      // milestones differentiate exactly like done/active/crit bars do.
      const status = statusChannel(bar.tags)
      const cls = ('gantt-milestone' + (status !== undefined ? ` gantt-milestone-${status}` : '')) + criticalPathCls
      const d = `M ${r(cx)} ${r(cy - radius)} L ${r(cx + radius)} ${r(cy)} L ${r(cx)} ${r(cy + radius)} L ${r(cx - radius)} ${r(cy)} Z`
      const statusPaint: MarkPaint =
        status === 'crit'
          ? { fill: palette.criticalFill, stroke: palette.criticalStroke, strokeWidth: String(Math.max(1.5, style.nodeLineWidth)) }
          : status === 'active'
            ? { fill: palette.nodeFill, stroke: palette.nodeBorder, strokeWidth: String(Math.max(1.5, style.nodeLineWidth)), opacity: '1' }
            : status === 'done'
              ? { fill: palette.doneFill, stroke: palette.nodeBorder, strokeWidth: String(Math.max(1, style.nodeLineWidth)), opacity: style.nodeFillColor ? '0.72' : '0.55' }
              : { fill: palette.nodeFill, stroke: palette.nodeBorder, strokeWidth: String(Math.max(1, style.nodeLineWidth)) }
      const milestonePaint: MarkPaint = { ...statusPaint, ...criticalPathPaint }
      parts.push(marks.shape({
        id: taskSceneId(bar.id ?? bar.label),
        role: 'milestone',
        geometry: { kind: 'path', d },
        paint: milestonePaint,
        channels: {
          ...(status !== undefined ? { status } : {}),
          ...(status === 'done' ? { progress: 1 } : {}),
          ...(onCriticalPath ? { emphasis: true } : {}),
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
      paint: { ...barPaint(status, palette, style), ...criticalPathPaint },
      channels: {
        ...(status !== undefined ? { status } : {}),
        // The layout carries no per-task completion fraction; 'done' is the
        // only completion signal, and it lands on the status channel.
        ...(status === 'done' ? { progress: 1 } : {}),
        ...(onCriticalPath ? { emphasis: true } : {}),
        ...(section !== undefined ? { category: section } : {}),
      },
    },
      `<rect class="${statusClass(bar.tags)}${criticalPathCls}" x="${r(bar.x)}" y="${r(bar.y)}" width="${r(Math.max(2, bar.w))}" height="${r(bar.h)}" ` +
        `rx="${GS.barRadius}" ry="${GS.barRadius}" data-task="${escapeXml(bar.id ?? bar.label)}" />`,
    ))
  }

  // Dependency connectors (opt-in): quiet elbow arrows from predecessor end to
  // successor start, drawn over the bars they anchor to but crossing no bar's
  // interior (the routing invariant lives in layout.ts, not here).
  if (overlay.dependencyArrows) {
    const barByTask = new Map(layout.bars.map(b => [b.taskIndex, b]))
    const depOccurrence = new Map<string, number>()
    for (const dep of layout.dependencies) {
      const fromKey = depTaskKey(barByTask.get(dep.fromTaskIndex))
      const toKey = depTaskKey(barByTask.get(dep.toTaskIndex))
      const key = `${fromKey}->${toKey}:${dep.kind}`
      const k = depOccurrence.get(key) ?? 0
      depOccurrence.set(key, k + 1)
      const critical = overlay.criticalArrows && dep.critical
      const cls = critical ? 'gantt-dep-arrow gantt-dep-arrow-crit' : 'gantt-dep-arrow'
      const markerId = critical ? depMarkerCritId : depMarkerId
      const points = dep.points.map(p => ({ x: r(p.x), y: r(p.y) }))
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      parts.push(marks.connector({
        id: k === 0 ? `dep:${key}` : `dep:${key}#${k}`,
        role: 'edge',
        geometry: { kind: 'path', d, points },
        lineStyle: 'solid',
        paint: critical
          ? { stroke: palette.criticalStroke, strokeWidth: String(Math.max(1.8, style.lineWidth * 1.5)), opacity: '0.95' }
          : { stroke: palette.edgeStroke, strokeWidth: String(Math.max(1.2, style.lineWidth)), opacity: '0.6' },
        endMarker: { id: markerId, shape: 'arrow' },
        channels: critical ? { status: 'crit', emphasis: true } : undefined,
      }, `<path class="${cls}" d="${d}" marker-end="url(#${escapeAttr(markerId)})" ` +
        `data-from="${escapeAttr(fromKey)}" data-to="${escapeAttr(toKey)}" />`))
    }
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
    const label = applyTextTransform(v.label, style.edgeTextTransform)
    const vertOffset = layout.topAxis
      ? Math.max(24, axisOffset + style.edgeLabelFontSize * 1.25)
      : (axisOffset === 10 && style.edgeLabelFontSize === 11 ? 8 : axisOffset)
    parts.push(textMark(`vert-label:${v.label}#${k}`, 'axis', v.x, plot.y - vertOffset, label, 'gantt-axis-label', style.edgeLabelFontSize, Math.max(style.edgeLabelFontWeight, 600), palette.axisText, 'middle', style.edgeLetterSpacing))
  }

  // Today marker — only with a supplied clock. The todayMarker directive's
  // sanitized style payload (item 3) rides as an inline style attribute
  // (overriding the class rule) and mirrors into the scene paint so styled
  // backends honor it too. No payload → the historical byte-exact mark.
  if (layout.todayX !== undefined) {
    const todayStyle = layout.todayMarkerStyle !== undefined ? parseTodayMarkerStyle(layout.todayMarkerStyle) : undefined
    const styleAttr = todayStyle !== undefined ? todayMarkerStyleAttr(todayStyle) : ''
    const overrides: Record<string, string> = Object.fromEntries(todayStyle?.applied ?? [])
    parts.push(marks.shape({
      id: 'today-marker',
      role: 'marker-line',
      geometry: { kind: 'line', x1: r(layout.todayX), y1: r(plot.y), x2: r(layout.todayX), y2: r(plotBottom) },
      paint: {
        stroke: overrides['stroke'] ?? style.edgeStrokeColor ?? 'var(--accent, var(--fg))',
        strokeWidth: overrides['stroke-width'] ?? String(Math.max(2, style.lineWidth)),
        strokeDasharray: overrides['stroke-dasharray'] ?? '4 3',
        ...(overrides['opacity'] !== undefined ? { opacity: overrides['opacity'] } : {}),
      },
    }, `<line class="gantt-today-marker"${styleAttr ? ` style="${escapeAttr(styleAttr)}"` : ''} x1="${r(layout.todayX)}" y1="${r(plot.y)}" x2="${r(layout.todayX)}" y2="${r(plotBottom)}" />`))
  }

  if (layout.title) {
    const title = applyTextTransform(layout.title, style.groupTextTransform)
    parts.push(textMark('title', 'title', layout.width / 2, ganttTitleY(style), title, 'gantt-title', ganttTitleFontSize(style), Math.max(style.groupHeaderFontWeight, 600), palette.titleFill, 'middle', style.groupLetterSpacing))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'gantt', width: layout.width, height: layout.height, colors, parts }
}

/** Content-hashed def-id namespace (the journey pattern, X5 id hygiene):
 *  derived from semantic layout content, never from render order or RNG. */
function ganttNamespace(layout: GanttLayoutResult): string {
  return `gantt-${hashId(
    layout.width,
    layout.height,
    ...layout.bars.map(b => `${b.taskIndex}:${b.id ?? b.label}`),
    ...layout.dependencies.map(d => `${d.fromTaskIndex}>${d.toTaskIndex}:${d.kind}`),
  )}`
}

/** Stable task key for connector data attributes: the Mermaid task id when
 *  present (dependencies always reference ids), else the label. */
function depTaskKey(bar: { id?: string; label: string } | undefined): string {
  return bar === undefined ? '' : bar.id ?? bar.label
}
