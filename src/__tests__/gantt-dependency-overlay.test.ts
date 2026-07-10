// Gantt dependency arrows + critical-path overlay (family-elevation-plan
// §Gantt item 1; gantt-research.md's binding caveat: dependency visuals ship
// only with overlap gates). Three hard gates:
//   (a) connector endpoints touch exactly their two bars,
//   (b) connectors never overlap any bar's interior rect,
//   (c) with the options off, SVG output is byte-identical to today.
// The overlay is an opt-in RENDER OPTION (never new syntax):
//   render(source, { gantt: { dependencyArrows: true, criticalPath: true } })

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { layoutGantt, GANTT_DEP_STUB } from '../gantt/layout.ts'
import type { GanttBarLayout, GanttDependencyLayout, GanttLayoutResult } from '../gantt/types.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { parseMermaid } from '../agent/parse.ts'
import { analyzeMermaid } from '../agent/analyze.ts'

function layoutOf(src: string) {
  const n = normalizeMermaidSource(src)
  const model = applyGanttFrontmatterConfig(parseGanttModel(n.lines), n.frontmatter)
  const schedule = resolveGanttSchedule(model)
  return { model, schedule, layout: layoutGantt(model, schedule) }
}

// ---- geometric oracles (independent re-implementation, not the router's) ----

interface Rect { x: number; y: number; w: number; h: number }
const EPS = 0.01

function rectOf(bar: GanttBarLayout): Rect {
  if (bar.milestoneX !== undefined) return { x: bar.milestoneX - bar.h / 2, y: bar.y, w: bar.h, h: bar.h }
  return { x: bar.x, y: bar.y, w: bar.w, h: bar.h }
}

function pointStrictlyInside(p: { x: number; y: number }, r: Rect): boolean {
  return p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS
}

function pointOnBoundary(p: { x: number; y: number }, r: Rect): boolean {
  const withinX = p.x >= r.x - EPS && p.x <= r.x + r.w + EPS
  const withinY = p.y >= r.y - EPS && p.y <= r.y + r.h + EPS
  if (!withinX || !withinY) return false
  return Math.abs(p.x - r.x) <= EPS || Math.abs(p.x - (r.x + r.w)) <= EPS
    || Math.abs(p.y - r.y) <= EPS || Math.abs(p.y - (r.y + r.h)) <= EPS
}

/** Axis-aligned segment crosses the OPEN interior of r. */
function segmentCrossesInterior(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): boolean {
  if (Math.abs(a.x - b.x) <= EPS) {
    const [y1, y2] = a.y <= b.y ? [a.y, b.y] : [b.y, a.y]
    return a.x > r.x + EPS && a.x < r.x + r.w - EPS && y2 > r.y + EPS && y1 < r.y + r.h - EPS
  }
  const [x1, x2] = a.x <= b.x ? [a.x, b.x] : [b.x, a.x]
  return a.y > r.y + EPS && a.y < r.y + r.h - EPS && x2 > r.x + EPS && x1 < r.x + r.w - EPS
}

function assertConnectorInvariants(layout: GanttLayoutResult): void {
  const rects = layout.bars.map(rectOf)
  const barByTask = new Map(layout.bars.map((b, i) => [b.taskIndex, i]))
  for (const dep of layout.dependencies) {
    const fromRect = rects[barByTask.get(dep.fromTaskIndex)!]!
    const toRect = rects[barByTask.get(dep.toTaskIndex)!]!
    const pts = dep.points
    expect(pts.length).toBeGreaterThanOrEqual(2)

    // (a) endpoints touch exactly their two bars: on their own bar's boundary,
    // strictly inside no bar at all.
    expect(pointOnBoundary(pts[0]!, fromRect)).toBe(true)
    expect(pointOnBoundary(pts[pts.length - 1]!, toRect)).toBe(true)
    for (const r of rects) {
      expect(pointStrictlyInside(pts[0]!, r)).toBe(false)
      expect(pointStrictlyInside(pts[pts.length - 1]!, r)).toBe(false)
    }

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      // Elbow connectors are orthogonal by construction.
      expect(Math.abs(a.x - b.x) <= EPS || Math.abs(a.y - b.y) <= EPS).toBe(true)
      // (b) no segment crosses ANY bar's interior — including bars the
      // connector does not connect (the research doc's binding overlap gate).
      for (const r of rects) {
        expect({ dep: `${dep.fromTaskIndex}->${dep.toTaskIndex}`, seg: i, crossed: segmentCrossesInterior(a, b, r) })
          .toEqual({ dep: `${dep.fromTaskIndex}->${dep.toTaskIndex}`, seg: i, crossed: false })
      }
    }

    // Connectors stay clear of the label column (standard mode draws labels
    // left of plot.x - labelGap; the router's escape corridor is plot.x - stub)
    // and inside the plot band vertically.
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(layout.plot.x - GANTT_DEP_STUB - EPS)
      expect(p.x).toBeLessThanOrEqual(layout.plot.x + layout.plot.w + GANTT_DEP_STUB + EPS)
      expect(p.y).toBeGreaterThanOrEqual(layout.plot.y - EPS)
      expect(p.y).toBeLessThanOrEqual(layout.plot.y + layout.plot.h + EPS)
    }
  }
}

// ---- fixtures ---------------------------------------------------------------

const DEPS = `gantt
  dateFormat YYYY-MM-DD
  section Build
    Core :core, 2024-01-01, 10d
    API :api, after core, 5d
    Docs :docs, after core api, 3d
  section Ship
    Freeze :freeze, 2024-01-20, 2d
    Prep :prep, 2024-01-10, until freeze
`

const CRIT = `gantt
  dateFormat YYYY-MM-DD
  section Chain
    Core :core, 2024-01-01, 10d
    Polish :pol, after core, 5d
    Ship :ship, after pol, 2d
  section Side
    Side quest :side, after core, 1d
`

// A full-width bar sits between the linked bars: a straight drop would cross
// it, so the router must jog through the escape corridor.
const BLOCKER = `gantt
  dateFormat YYYY-MM-DD
  section S
    A :a, 2024-01-01, 5d
    Blocker :bl, 2024-01-01, 20d
    B :b, after a, 5d
`

// `after` referencing a task defined LATER in source: the connector runs upward.
const UPWARD = `gantt
  dateFormat YYYY-MM-DD
  Late :late, after early, 3d
  Early :early, 2024-01-01, 4d
`

// Compact mode can pack predecessor and successor into the SAME row.
const COMPACT_SAME_ROW = `---
displayMode: compact
---
gantt
  dateFormat YYYY-MM-DD
  section S
    One :a, 2024-01-01, 5d
    Two :b, 2024-01-03, 6d
    Three :c, after a, 4d
`

const MILESTONE = `gantt
  title Adding GANTT diagram functionality to mermaid
  dateFormat YYYY-MM-DD
  excludes weekends
  section A section
    Completed task :done, des1, 2014-01-06, 2014-01-08
    Active task :active, des2, 2014-01-09, 3d
    Future task :des3, after des2, 5d
  section Critical tasks
    Crit task :crit, c1, 2014-01-06, 4d
    Release :milestone, m1, after des3, 0d
`

describe('gantt dependency routing — layout invariants', () => {
  test('one connector per after/until reference, endpoints anchored to the linked bars', () => {
    const { layout } = layoutOf(DEPS)
    // after: core->api, core->docs, api->docs; until: prep->freeze.
    expect(layout.dependencies).toHaveLength(4)
    const keys = layout.dependencies.map(d => `${d.fromTaskIndex}->${d.toTaskIndex}:${d.kind}`)
    expect(keys.sort()).toEqual(['0->1:after', '0->2:after', '1->2:after', '4->3:until'].sort())
    assertConnectorInvariants(layout)
  })

  test('a full-width blocking bar forces a jog, never a crossing', () => {
    const { layout } = layoutOf(BLOCKER)
    expect(layout.dependencies).toHaveLength(1)
    assertConnectorInvariants(layout)
  })

  test('upward edges (after a later-defined task) route cleanly', () => {
    const { layout } = layoutOf(UPWARD)
    expect(layout.dependencies).toHaveLength(1)
    const dep = layout.dependencies[0]!
    expect(dep.points[0]!.y).toBeGreaterThan(dep.points[dep.points.length - 1]!.y)
    assertConnectorInvariants(layout)
  })

  test('compact mode: same-row chains route through the gutter, not through bars', () => {
    const { layout } = layoutOf(COMPACT_SAME_ROW)
    expect(layout.compact).toBe(true)
    expect(layout.dependencies).toHaveLength(1)
    assertConnectorInvariants(layout)
  })

  test('milestone endpoints anchor to the diamond bounding box', () => {
    const { layout } = layoutOf(MILESTONE)
    expect(layout.dependencies.length).toBeGreaterThanOrEqual(2)
    assertConnectorInvariants(layout)
  })

  test('routing is deterministic', () => {
    const a = layoutOf(DEPS).layout.dependencies
    const b = layoutOf(DEPS).layout.dependencies
    expect(b).toEqual(a)
  })

  test('property: generated after-chains always satisfy the anchoring and no-crossing gates', () => {
    const taskCount = fc.integer({ min: 3, max: 9 })
    const arb = taskCount.chain(n => fc.record({
      starts: fc.array(fc.integer({ min: 1, max: 25 }), { minLength: n, maxLength: n }),
      durs: fc.array(fc.integer({ min: 1, max: 12 }), { minLength: n, maxLength: n }),
      // For each task i>0: undefined = explicit start; otherwise `after t<j>`.
      afters: fc.array(fc.option(fc.nat(), { nil: undefined }), { minLength: n, maxLength: n }),
      milestones: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      sectionBreaks: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    }).map(({ starts, durs, afters, milestones, sectionBreaks }) => {
      const lines = ['gantt', '  dateFormat YYYY-MM-DD']
      for (let i = 0; i < starts.length; i++) {
        if (sectionBreaks[i] || i === 0) lines.push(`  section S${i}`)
        const tag = milestones[i] && i > 0 ? 'milestone, ' : ''
        const start = i > 0 && afters[i] !== undefined
          ? `after t${afters[i]! % i}`
          : `2024-01-${String(starts[i]).padStart(2, '0')}`
        lines.push(`  Task ${i} :${tag}t${i}, ${start}, ${durs[i]}d`)
      }
      return lines.join('\n') + '\n'
    }))
    fc.assert(fc.property(arb, src => {
      const { layout } = layoutOf(src)
      assertConnectorInvariants(layout)
    }), { numRuns: 50 })
  })
})

describe('gantt dependency overlay — SVG render option', () => {
  test('(c) options off (default, {}, or explicit false) is byte-identical', () => {
    for (const src of [DEPS, CRIT, MILESTONE, COMPACT_SAME_ROW]) {
      const plain = renderMermaidSVG(src)
      expect(renderMermaidSVG(src, { gantt: {} })).toBe(plain)
      expect(renderMermaidSVG(src, { gantt: { dependencyArrows: false, criticalPath: false } })).toBe(plain)
      expect(plain).not.toContain('gantt-dep-arrow')
      expect(plain).not.toContain('<marker')
      expect(plain).not.toContain('gantt-bar-critical-path')
    }
  })

  test('dependencyArrows draws one marker-terminated connector per dependency', () => {
    const svg = renderMermaidSVG(DEPS, { gantt: { dependencyArrows: true } })
    const paths = [...svg.matchAll(/<path class="gantt-dep-arrow[^"]*"/g)]
    expect(paths).toHaveLength(4)
    const markerIds = [...svg.matchAll(/<marker id="([^"]+)"/g)].map(m => m[1]!)
    expect(markerIds.length).toBeGreaterThanOrEqual(1)
    expect(markerIds[0]).toMatch(/^gantt-[a-z0-9]+-dep-arrow$/)
    for (const m of svg.matchAll(/marker-end="url\(#([^)]+)\)"/g)) {
      expect(markerIds).toContain(m[1]!)
    }
    // Element-identity contract: connectors carry data-from/data-to.
    expect(svg).toContain('data-from="core" data-to="api"')
    expect(svg).toContain('data-from="prep" data-to="freeze"')
    // Rendering is deterministic.
    expect(renderMermaidSVG(DEPS, { gantt: { dependencyArrows: true } })).toBe(svg)
  })

  test('critical-path emphasis matches analyze()\'s criticalPathTaskIds exactly', () => {
    const parsed = parseMermaid(CRIT)
    if (!parsed.ok) throw new Error('parse failed')
    const crit = new Set(analyzeMermaid(parsed.value).gantt!.criticalPathTaskIds)
    expect(crit).toEqual(new Set(['core', 'pol', 'ship']))

    const svg = renderMermaidSVG(CRIT, { gantt: { dependencyArrows: true, criticalPath: true } })
    for (const m of svg.matchAll(/<rect class="(gantt-bar[^"]*)"[^>]*data-task="([^"]+)"/g)) {
      const emphasized = m[1]!.includes('gantt-bar-critical-path')
      expect({ task: m[2], emphasized }).toEqual({ task: m[2], emphasized: crit.has(m[2]!) })
    }
    // Connectors along the critical path carry the crit class; others do not.
    const critConnectors = [...svg.matchAll(/<path class="gantt-dep-arrow gantt-dep-arrow-crit"[^>]*data-from="([^"]+)" data-to="([^"]+)"/g)]
      .map(m => `${m[1]}->${m[2]}`)
    expect(critConnectors.sort()).toEqual(['core->pol', 'pol->ship'].sort())
  })

  test('criticalPath alone emphasizes bars without drawing connectors', () => {
    const svg = renderMermaidSVG(CRIT, { gantt: { criticalPath: true } })
    expect(svg).not.toContain('gantt-dep-arrow')
    expect(svg).toContain('gantt-bar-critical-path')
  })

  test('no critical-path emphasis when the schedule has no after-dependency analysis', () => {
    const svg = renderMermaidSVG('gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 5d\n  B :b, 2024-01-03, 5d', {
      gantt: { dependencyArrows: true, criticalPath: true },
    })
    expect(svg).not.toContain('gantt-bar-critical-path')
    expect(svg).not.toContain('gantt-dep-arrow')
  })

  test('idPrefix namespaces the dependency marker ids (multi-diagram hygiene)', () => {
    const svg = renderMermaidSVG(DEPS, { gantt: { dependencyArrows: true }, idPrefix: 'd7-' })
    const markerId = svg.match(/<marker id="([^"]+)"/)![1]!
    expect(markerId.startsWith('d7-')).toBe(true)
    expect(svg).toContain(`marker-end="url(#${markerId})"`)
  })

  test('strict security holds with the overlay enabled', () => {
    const svg = renderMermaidSVG(DEPS, { gantt: { dependencyArrows: true, criticalPath: true }, security: 'strict' })
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
  })
})
