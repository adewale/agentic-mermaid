// Gantt layout tests (docs/design/families/gantt.md §Test tiers, layout row):
// bars stay in the plot area; labels stay in the label column; compact rows
// do not overlap; `vert` consumes no task row; topAxis geometry; bounded
// tick generation with a too-fine explicit tickInterval.

import { describe, test, expect } from 'bun:test'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { layoutGantt, resolveTicks, GANTT_MAX_TICKS } from '../gantt/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

function layoutOf(src: string, options: Parameters<typeof layoutGantt>[2] = {}) {
  const n = normalizeMermaidSource(src)
  const model = applyGanttFrontmatterConfig(parseGanttModel(n.lines), n.frontmatter)
  const schedule = resolveGanttSchedule(model)
  return { model, schedule, layout: layoutGantt(model, schedule, options) }
}

const BASIC = `gantt
  title Plan
  dateFormat YYYY-MM-DD
  section Alpha
    First :a1, 2024-01-01, 10d
    Second :a2, after a1, 5d
  section Beta
    Third :b1, 2024-01-04, 8d
`

describe('gantt layout — plot geometry', () => {
  test('bars stay inside the plot area; label column owns the left band', () => {
    const { layout } = layoutOf(BASIC)
    expect(layout.plot.x).toBeGreaterThanOrEqual(layout.labelColumnWidth)
    for (const bar of layout.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(layout.plot.x)
      expect(bar.x + bar.w).toBeLessThanOrEqual(layout.plot.x + layout.plot.w + 0.01)
    }
  })

  test('section bands tile the plot vertically and own their rows', () => {
    const { layout } = layoutOf(BASIC)
    expect(layout.sections).toHaveLength(2)
    const [alpha, beta] = layout.sections
    expect(alpha!.label).toBe('Alpha')
    expect(beta!.label).toBe('Beta')
    expect(alpha!.y + alpha!.h).toBeLessThanOrEqual(beta!.y + 0.01)
    // Every bar lies inside its section band (the GROUP_BREACH analogue).
    for (const bar of layout.bars) {
      const band = layout.sections[bar.sectionIndex]!
      expect(bar.y).toBeGreaterThanOrEqual(band.y - 0.01)
      expect(bar.y + bar.h).toBeLessThanOrEqual(band.y + band.h + 0.01)
    }
  })

  test('rows never overlap in standard mode', () => {
    const { layout } = layoutOf(BASIC)
    const sorted = [...layout.rows].sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.h)
    }
  })
})

describe('gantt layout — vert markers consume no row (mermaid PR #7284)', () => {
  test('a vert task produces a marker, not a row', () => {
    const withVert = layoutOf(`gantt
      dateFormat YYYY-MM-DD
      A :a, 2024-01-01, 5d
      Go live :vert, v1, 2024-01-03, 0d
      B :b, after a, 5d
    `)
    const without = layoutOf(`gantt
      dateFormat YYYY-MM-DD
      A :a, 2024-01-01, 5d
      B :b, after a, 5d
    `)
    expect(withVert.layout.rows).toHaveLength(without.layout.rows.length)
    expect(withVert.layout.bars).toHaveLength(2)
    expect(withVert.layout.verts).toHaveLength(1)
    expect(withVert.layout.verts[0]!.label).toBe('Go live')
    const v = withVert.layout.verts[0]!
    expect(v.x).toBeGreaterThanOrEqual(withVert.layout.plot.x)
    expect(v.x).toBeLessThanOrEqual(withVert.layout.plot.x + withVert.layout.plot.w)
  })
})

describe('gantt layout — compact mode (mermaid #7603)', () => {
  // Three tasks where 1 and 3 do not overlap (sharable lane) but 2 overlaps
  // both — naive single-row packing would overlap bars.
  const DENSE = `---
displayMode: compact
---
gantt
  dateFormat YYYY-MM-DD
  section S
    One :a, 2024-01-01, 5d
    Two :b, 2024-01-03, 6d
    Three :c, 2024-01-08, 4d
`

  test('compact packs non-overlapping tasks into shared rows without overlap', () => {
    const { layout } = layoutOf(DENSE)
    expect(layout.compact).toBe(true)
    // One+Three share a lane; Two gets its own → 2 rows, not 3.
    expect(layout.rows).toHaveLength(2)
    for (const row of layout.rows) {
      const bars = row.barIndexes.map(i => layout.bars[i]!).sort((x, y) => x.x - y.x)
      for (let i = 1; i < bars.length; i++) {
        expect(bars[i]!.x).toBeGreaterThanOrEqual(bars[i - 1]!.x + bars[i - 1]!.w - 0.01)
      }
    }
  })

  test('standard mode keeps one row per task for the same source', () => {
    const { layout } = layoutOf(DENSE.replace('displayMode: compact', 'displayMode: normal'))
    expect(layout.compact).toBe(false)
    expect(layout.rows).toHaveLength(3)
  })
})

describe('gantt layout — axes and markers', () => {
  test('topAxis raises the plot to leave room for the top tick labels', () => {
    const base = layoutOf(BASIC)
    const top = layoutOf(BASIC.replace('dateFormat YYYY-MM-DD', 'dateFormat YYYY-MM-DD\n  topAxis'))
    expect(top.layout.topAxis).toBe(true)
    expect(top.layout.plot.y).toBeGreaterThan(base.layout.plot.y)
  })

  // upstream: mermaid-js/mermaid#1301 — gantt axis/bar overlap on long date ranges
  test('long-range axis labels stay clear of task bars (#1301)', () => {
    const { layout } = layoutOf(`gantt
      title Multi-year roadmap
      dateFormat YYYY-MM-DD
      axisFormat %Y
      topAxis
      section Delivery
        Discover :a, 2016-01-01, 400d
        Build :b, after a, 520d
        Launch :c, after b, 180d
    `)
    const axisLabelHalfHeight = 6
    const topAxisLabelBottom = layout.plot.y - 10 + axisLabelHalfHeight
    const bottomAxisLabelTop = layout.plot.y + layout.plot.h + 12 - axisLabelHalfHeight
    const firstBarTop = Math.min(...layout.bars.map(b => b.y))
    const lastBarBottom = Math.max(...layout.bars.map(b => b.y + b.h))

    expect(layout.topAxis).toBe(true)
    expect(layout.ticks.length).toBeGreaterThan(1)
    expect(topAxisLabelBottom).toBeLessThanOrEqual(firstBarTop)
    expect(bottomAxisLabelTop).toBeGreaterThanOrEqual(lastBarBottom)
  })

  test('ticks are bounded even with a 1minute interval over months (mermaid PR #7197)', () => {
    const { model, schedule } = layoutOf(`gantt
      dateFormat YYYY-MM-DD
      tickInterval 1minute
      A :a, 2024-01-01, 90d
    `)
    const ticks = resolveTicks(schedule, model)
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.length).toBeLessThanOrEqual(GANTT_MAX_TICKS + 1)
  })

  test('week ticks align to the configured weekday', () => {
    const { model, schedule } = layoutOf(`gantt
      dateFormat YYYY-MM-DD
      tickInterval 1week
      weekday monday
      A :a, 2024-01-03, 21d
    `)
    const ticks = resolveTicks(schedule, model)
    for (const t of ticks) {
      const dow = new Date(t.time).getUTCDay()
      expect(dow).toBe(1) // Monday
    }
  })

  test('today marker maps into plot coordinates only when supplied and in range', () => {
    const n = normalizeMermaidSource(BASIC)
    const model = parseGanttModel(n.lines)
    const schedule = resolveGanttSchedule(model, { today: '2024-01-05' })
    const layout = layoutGantt(model, schedule, { today: schedule.today })
    expect(layout.todayX).toBeDefined()
    expect(layout.todayX!).toBeGreaterThanOrEqual(layout.plot.x)
    expect(layout.todayX!).toBeLessThanOrEqual(layout.plot.x + layout.plot.w)
    const without = layoutGantt(model, resolveGanttSchedule(model))
    expect(without.todayX).toBeUndefined()
    const outOfRange = resolveGanttSchedule(model, { today: '2030-01-01' })
    expect(layoutGantt(model, outOfRange, { today: outOfRange.today }).todayX).toBeUndefined()
  })
})
