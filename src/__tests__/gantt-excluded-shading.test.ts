// Excluded-days plot shading (family-elevation-plan §Gantt item 2; upstream
// #6421/#7062/#314). Upstream shades excluded days by default (its renderer
// draws `exclude-range` rects unconditionally), so shading here is DEFAULT-ON
// for parity — no option gates it. Correctness by construction: the bands
// derive from the SAME schedule/exclusion model the bars use (one calendar,
// two consumers: schedule.isExcludedDay drives both the duration walk and the
// shading), never a second calendar implementation.
//
// Invariant gates (the mission's hard gates):
//   1. every shaded band lies within the plot;
//   2. every band aligns to excluded calendar days (each covered day is
//      excluded, and bands are maximal — the day before/after is working);
//   3. bands sit BEHIND bars in z-order (SVG paint order);
//   4. a chart with no excludes emits no band rects and no band CSS —
//      byte-inert for the non-excluded majority.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidSVG } from '../index.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule, DAY_MS, startOfDay } from '../gantt/schedule.ts'
import { layoutGantt } from '../gantt/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

function layoutOf(src: string) {
  const n = normalizeMermaidSource(src)
  const model = applyGanttFrontmatterConfig(parseGanttModel(n.lines), n.frontmatter)
  const schedule = resolveGanttSchedule(model)
  return { model, schedule, layout: layoutGantt(model, schedule) }
}

const WEEKENDS = `gantt
  title Sprint
  dateFormat YYYY-MM-DD
  excludes weekends
  section Build
    Core :core, 2024-01-01, 10d
    Polish :pol, after core, 5d
`

const NO_EXCLUDES = `gantt
  dateFormat YYYY-MM-DD
  A :a, 2024-01-01, 10d
`

describe('gantt excluded-day shading — layout bands', () => {
  test('bands cover exactly the excluded days inside the schedule range, maximally merged', () => {
    const { schedule, layout } = layoutOf(WEEKENDS)
    expect(layout.excludedBands.length).toBeGreaterThan(0)
    for (const band of layout.excludedBands) {
      // (1) inside the plot
      expect(band.x).toBeGreaterThanOrEqual(layout.plot.x - 0.01)
      expect(band.x + band.w).toBeLessThanOrEqual(layout.plot.x + layout.plot.w + 0.01)
      expect(band.w).toBeGreaterThan(0)
      // (2) every covered day is excluded …
      for (let day = startOfDay(band.start); day < band.end; day += DAY_MS) {
        expect({ day: new Date(day).toISOString(), excluded: schedule.isExcludedDay(day) })
          .toEqual({ day: new Date(day).toISOString(), excluded: true })
      }
      // … and bands are maximal: the neighbor days (when in range) are working.
      const before = startOfDay(band.start) - DAY_MS
      const after = startOfDay(band.end)
      if (before >= schedule.timeMin) expect(schedule.isExcludedDay(before)).toBe(false)
      if (after < schedule.timeMax) expect(schedule.isExcludedDay(after)).toBe(false)
    }
    // No two bands touch or overlap (merged by construction).
    const sorted = [...layout.excludedBands].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.x).toBeGreaterThan(sorted[i - 1]!.x + sorted[i - 1]!.w)
    }
  })

  test('no excludes → no bands; time-bearing charts (no calendar days) → no bands', () => {
    expect(layoutOf(NO_EXCLUDES).layout.excludedBands).toEqual([])
    // dateFormat HH:mm is not date-only; day shading has no meaning there.
    expect(layoutOf('gantt\n  dateFormat HH:mm\n  excludes weekends\n  A :a, 17:00, 30m').layout.excludedBands).toEqual([])
  })

  test('property: generated weekend schedules keep every band inside the plot on excluded days', () => {
    const arb = fc.array(fc.record({
      startDay: fc.integer({ min: 1, max: 25 }),
      dur: fc.integer({ min: 1, max: 12 }),
    }), { minLength: 1, maxLength: 8 }).map(rows => {
      const lines = ['gantt', '  dateFormat YYYY-MM-DD', '  excludes weekends']
      rows.forEach((r, i) => lines.push(`  Task ${i} :t${i}, 2024-01-${String(r.startDay).padStart(2, '0')}, ${r.dur}d`))
      return lines.join('\n')
    })
    fc.assert(fc.property(arb, src => {
      const { schedule, layout } = layoutOf(src)
      for (const band of layout.excludedBands) {
        expect(band.x).toBeGreaterThanOrEqual(layout.plot.x - 0.01)
        expect(band.x + band.w).toBeLessThanOrEqual(layout.plot.x + layout.plot.w + 0.01)
        for (let day = startOfDay(band.start); day < band.end; day += DAY_MS) {
          expect(schedule.isExcludedDay(day)).toBe(true)
        }
      }
    }), { numRuns: 40 })
  })
})

describe('gantt excluded-day shading — SVG', () => {
  test('shaded bands render by default (upstream parity), behind every bar', () => {
    const svg = renderMermaidSVG(WEEKENDS)
    const bands = [...svg.matchAll(/<rect class="gantt-excluded-band"/g)]
    expect(bands.length).toBeGreaterThan(0)
    expect(svg).toContain('.gantt-excluded-band {')
    // (3) z-order: the LAST band precedes the FIRST bar in paint order.
    const lastBand = svg.lastIndexOf('<rect class="gantt-excluded-band"')
    const firstBar = svg.indexOf('<rect class="gantt-bar')
    expect(firstBar).toBeGreaterThan(lastBand)
    // …and behind the grid lines too (grid stays legible over the tint).
    const firstGrid = svg.indexOf('<line class="gantt-grid-line"')
    expect(firstGrid).toBeGreaterThan(lastBand)
  })

  test('charts without excludes carry no band markup and no band CSS', () => {
    const svg = renderMermaidSVG(NO_EXCLUDES)
    expect(svg).not.toContain('gantt-excluded-band')
  })

  test('shading is independent of the dependency/critical-path overlay options', () => {
    const plain = renderMermaidSVG(WEEKENDS)
    expect(renderMermaidSVG(WEEKENDS, { gantt: {} })).toBe(plain)
    expect(renderMermaidSVG(WEEKENDS, { gantt: { dependencyArrows: false, criticalPath: false } })).toBe(plain)
  })

  test('rendering with shading is deterministic', () => {
    expect(renderMermaidSVG(WEEKENDS)).toBe(renderMermaidSVG(WEEKENDS))
  })
})
