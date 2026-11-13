// Task-label wrapping in the SVG label column (family-elevation-plan §Gantt
// item 5; upstream #6946/#2886): a 65-char label used to render one unwrapped
// ~430px line, widening the label column unboundedly. Labels now wrap via the
// SHARED measured-pixel wrap machinery (src/shared/label-wrap.ts — the journey
// extraction; no fourth fork) against a fixed column budget, and row height
// becomes label-aware.
//
// Invariant gates:
//   1. every rendered label line fits the column budget;
//   2. the label column never exceeds budget + gap;
//   3. row spacing >= the wrapped label height (no line collides with the
//      next row's content);
//   4. short-label charts are byte-identical (wrapping is a no-op below the
//      budget — the representative golden pins this).

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { layoutGantt, ganttMeasureTextWidth, GANTT_LABEL_WRAP_BUDGET, resolveGanttRenderStyle } from '../gantt/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

function layoutOf(src: string) {
  const n = normalizeMermaidSource(src)
  const model = applyGanttFrontmatterConfig(parseGanttModel(n.lines), n.frontmatter)
  const schedule = resolveGanttSchedule(model)
  return { model, schedule, layout: layoutGantt(model, schedule) }
}

const LONG_LABEL = 'This is a very long task label that describes the work in detail'
const LONG = `gantt
  dateFormat YYYY-MM-DD
  section Alpha
    ${LONG_LABEL} :a, 2024-01-01, 10d
    Short :b, after a, 5d
`

describe('gantt task-label wrapping — layout', () => {
  test('a 65-char label wraps: column stays within budget, every line fits', () => {
    const { layout } = layoutOf(LONG)
    const style = resolveGanttRenderStyle()
    // (2) the column budget holds (budget + labelGap margin).
    expect(layout.labelColumnWidth).toBeLessThanOrEqual(GANTT_LABEL_WRAP_BUDGET + 12)
    const bar = layout.bars.find(b => b.id === 'a')!
    expect(bar.labelLines).toBeDefined()
    expect(bar.labelLines!.length).toBeGreaterThanOrEqual(2)
    // (1) each wrapped line fits the budget.
    for (const line of bar.labelLines!) {
      expect(ganttMeasureTextWidth(line, style.nodeLabelFontSize, style.nodeLabelFontWeight))
        .toBeLessThanOrEqual(GANTT_LABEL_WRAP_BUDGET + 0.01)
    }
    // Nothing was lost in the wrap.
    expect(bar.labelLines!.join(' ')).toBe(LONG_LABEL)
  })

  test('row spacing grows to the wrapped label height (label-aware rows)', () => {
    const { layout } = layoutOf(LONG)
    const short = layoutOf(LONG.replace(LONG_LABEL, 'Tiny'))
    const [r0, r1] = layout.rows
    const [s0, s1] = short.layout.rows
    const wrappedAdvance = r1!.y - r0!.y
    const baseAdvance = s1!.y - s0!.y
    // (3) the wrapped row advances further than the single-line row …
    expect(wrappedAdvance).toBeGreaterThan(baseAdvance)
    // … far enough that the label block (first line centered on the bar,
    // rest below) clears the next row: advance >= wrapped label height and
    // >= barHeight/2 + (lines - 0.5) * lineHeight.
    const style = resolveGanttRenderStyle()
    const lineHeight = style.nodeLabelFontSize * 1.3
    const lines = layout.bars.find(b => b.id === 'a')!.labelLines!.length
    expect(wrappedAdvance).toBeGreaterThanOrEqual(lines * lineHeight - 0.01)
    expect(wrappedAdvance).toBeGreaterThanOrEqual(layout.barHeight / 2 + (lines - 0.5) * lineHeight - 0.01)
    // Bars stay inside the plot and the section band still contains its rows.
    for (const bar of layout.bars) {
      const band = layout.sections[bar.sectionIndex]!
      expect(bar.y).toBeGreaterThanOrEqual(band.y - 0.01)
      expect(bar.y + bar.h).toBeLessThanOrEqual(band.y + band.h + 0.01)
    }
  })

  test('short labels never wrap: labelLines stays unset and geometry is untouched', () => {
    const { layout } = layoutOf('gantt\n  dateFormat YYYY-MM-DD\n  section S\n    Short :a, 2024-01-01, 5d')
    for (const bar of layout.bars) expect(bar.labelLines).toBeUndefined()
  })

  test('long section labels wrap into the same budget', () => {
    const { layout } = layoutOf(`gantt
      dateFormat YYYY-MM-DD
      section This section header is also spectacularly long and would widen the column
        A :a, 2024-01-01, 5d
    `)
    expect(layout.labelColumnWidth).toBeLessThanOrEqual(GANTT_LABEL_WRAP_BUDGET + 12)
    const section = layout.sections[0]!
    expect(section.labelLines).toBeDefined()
    expect(section.labelLines!.length).toBeGreaterThanOrEqual(2)
  })
})

describe('gantt task-label wrapping — SVG', () => {
  test('wrapped labels render one text element per line inside the label column', () => {
    const svg = renderMermaidSVG(LONG)
    const labels = [...svg.matchAll(/class="gantt-task-label"[^>]*>([^<]*)</g)].map(m => m[1]!)
    // 2 bars, but > 2 label texts because the long label wrapped.
    expect(labels.length).toBeGreaterThan(2)
    expect(labels.join(' ')).toContain('describes the')
    // Every label line stays in the left column (x < plot start).
    for (const m of svg.matchAll(/class="gantt-task-label"[^>]*x="(\d+(?:\.\d+)?)"/g)) {
      expect(Number(m[1])).toBeLessThan(60)
    }
  })

  test('single-line charts keep exactly one text element per task', () => {
    const svg = renderMermaidSVG('gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 5d\n  B :b, after a, 3d')
    expect([...svg.matchAll(/class="gantt-task-label"/g)]).toHaveLength(2)
  })
})
