// Gantt SVG integration tests (docs/design/families/gantt.md §Test tiers, SVG row):
// deterministic output, a committed representative golden, status classes,
// strict-security guarantees, accessibility injection, theme contrast for
// status bars in light/dark themes, and the supplied-clock today marker.
// No fixture in this file may contain a wall-clock date.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { knownStyleDescriptors, renderMermaidSVG, renderResolvedScene, verifyNoExternalRefs } from '../index.ts'
import { verifyMermaid } from '../agent/verify.ts'
import type { ResolvedPart } from '../scene/resolved-types.ts'
import { contrastRatio } from '../shared/color-math.ts'
import { deltaEOK } from '../shared/perceptual-color.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'

const snapshotDir = join(import.meta.dir, 'testdata', 'svg')

const REPRESENTATIVE = `gantt
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

describe('renderMermaidSVG — gantt', () => {
  it('matches the representative gantt golden SVG', () => {
    const actual = renderMermaidSVG(REPRESENTATIVE)
    const expected = readFileSync(join(snapshotDir, 'gantt-representative.svg'), 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })

  it('is byte-deterministic for the same source and options', () => {
    const a = renderMermaidSVG(REPRESENTATIVE, { bg: '#101014', fg: '#fafafa' })
    const b = renderMermaidSVG(REPRESENTATIVE, { bg: '#101014', fg: '#fafafa' })
    expect(a).toBe(b)
  })

  it('emits every status class the spec names on real elements', () => {
    const svg = renderMermaidSVG(REPRESENTATIVE)
    expect(svg).toContain('<rect class="gantt-bar"')
    for (const cls of ['gantt-bar-done', 'gantt-bar-active', 'gantt-bar-crit']) {
      expect(svg).toContain(`<rect class="gantt-bar ${cls}"`)
    }
    expect(svg).toContain('<path class="gantt-milestone"')
    const vertSvg = renderMermaidSVG('gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 5d\n  Cutover :vert, v, 2024-01-03, 0d')
    expect(vertSvg).toContain('<line class="gantt-vert-marker"')
  })

  it('keeps task labels in the left column with fg fill (light/dark contrast)', () => {
    // Labels are never drawn ON bars: every task/section label resolves to the
    // theme's fg color, so contrast against bg holds in light AND dark themes.
    for (const fg of ['#27272A', '#FAFAFA'] as const) {
      const bg = fg === '#FAFAFA' ? '#18181B' : '#FFFFFF'
      const svg = renderMermaidSVG(REPRESENTATIVE, { bg, fg })
      const labels = [...svg.matchAll(/<text\b[^>]*\bclass="gantt-(?:task|section)-label"[^>]*>/g)].map(([tag]) => tag)
      expect(labels).toHaveLength(7)
      for (const label of labels) {
        expect(Number(/ x="([^"]*)"/.exec(label)![1])).toBeLessThan(60) // label column, not plot area
        expect(label).toContain(` fill="${fg}"`)
      }
    }
  })

  it('draws the today marker only with a supplied clock; todayMarker off wins', () => {
    const MARKER = '<line class="gantt-today-marker"'
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 10d'
    expect(renderMermaidSVG(src)).not.toContain(MARKER)
    expect(renderMermaidSVG(src, { ganttToday: '2024-01-05' })).toContain(MARKER)
    const off = 'gantt\n  dateFormat YYYY-MM-DD\n  todayMarker off\n  A :a, 2024-01-01, 10d'
    expect(renderMermaidSVG(off, { ganttToday: '2024-01-05' })).not.toContain(MARKER)
  })

  // family-elevation-plan §Gantt item 3: the todayMarker directive's style
  // payload was accepted-but-ignored. Wired properties (stroke, stroke-width,
  // opacity, stroke-dasharray) now apply, sanitized against style-attr
  // injection; unwired properties surface via verify's INEFFECTIVE_CONFIG.
  it('applies the sanitized todayMarker style payload to the today line', () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  todayMarker stroke-width:5px,stroke:#0f0,opacity:0.5\n  A :a, 2024-01-01, 10d'
    const svg = renderMermaidSVG(src, { ganttToday: '2024-01-05' })
    const line = svg.match(/<line class="gantt-today-marker"[^>]*>/)![0]
    for (const paint of ['stroke="#0f0"', 'stroke-width="5px"', 'opacity="0.5"']) expect(line).toContain(paint)
    // Without a clock the marker (and its style) never draws.
    expect(renderMermaidSVG(src)).not.toContain('<line class="gantt-today-marker"')
  })

  it('rejects style-attr injection in the todayMarker payload', () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  todayMarker stroke:#0f0"onload="alert(1),opacity:0.5\n  A :a, 2024-01-01, 10d'
    expect(() => renderMermaidSVG(src, { ganttToday: '2024-01-05' }))
      .toThrow('todayMarker: stroke "#0f0\\"onload=\\"alert(1)" is not a CSS color')
  })

  it('a plain todayMarker line stays byte-identical (no style attr)', () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 10d'
    const line = renderMermaidSVG(src, { ganttToday: '2024-01-05' }).match(/<line class="gantt-today-marker"[^>]*>/)![0]
    expect(line).not.toContain('style=')
  })

  it('unwired todayMarker payload properties surface via INEFFECTIVE_CONFIG', () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  todayMarker fill:red,stroke:#0f0\n  A :a, 2024-01-01, 10d'
    const v = verifyMermaid(src)
    const fields = v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields).toContain('todayMarker.fill')
    expect(fields).not.toContain('todayMarker.stroke') // wired, applied
    // Wired-only payloads stay lint-free.
    const clean = verifyMermaid('gantt\n  dateFormat YYYY-MM-DD\n  todayMarker stroke:#0f0\n  A :a, 2024-01-01, 10d')
    expect(clean.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })

  // family-elevation-plan §Gantt item 6: done/active milestones rendered
  // identical bare diamonds while bars differentiated. Status classes now
  // mirror the bar convention (gantt-milestone-done / -active / -crit).
  it('status-styled milestones carry status classes mirroring the bar convention', () => {
    const src = `gantt
      dateFormat YYYY-MM-DD
      Span :s, 2024-01-01, 10d
      Done milestone :milestone, done, m1, 2024-01-02, 0d
      Active milestone :milestone, active, m2, 2024-01-04, 0d
      Crit milestone :milestone, crit, m3, 2024-01-06, 0d
      Bare milestone :milestone, m4, 2024-01-08, 0d
    `
    const svg = renderMermaidSVG(src)
    expect(svg).toContain('<path class="gantt-milestone gantt-milestone-done"')
    expect(svg).toContain('<path class="gantt-milestone gantt-milestone-active"')
    expect(svg).toContain('<path class="gantt-milestone gantt-milestone-crit"')
    expect(svg).toContain('<path class="gantt-milestone" data-task="m4"')
    // Charts without done/active milestones carry no dead CSS for them.
    const bare = renderMermaidSVG('gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 5d\n  M :milestone, m, 2024-01-03, 0d')
    expect(bare).not.toContain('gantt-milestone-done')
    expect(bare).not.toContain('gantt-milestone-active')
  })

  // The terminal tells the four statuses apart (█ plain, ▓ active, ▒ crit,
  // ░ done); SVG/PNG must too, in every look and palette, by the ink a task
  // actually owns — never by opacity alone. Opacity is ignored here on
  // purpose: two tasks whose owned fills and outlines read alike differ only
  // in how translucent they are.
  describe('task status ink', () => {
    const STATUSES = `gantt
      dateFormat YYYY-MM-DD
      Plain bar :p, 2024-01-01, 4d
      Active bar :active, a, 2024-01-02, 4d
      Crit bar :crit, c, 2024-01-03, 4d
      Done bar :done, d, 2024-01-01, 3d
      Plain milestone :milestone, pm, 2024-01-05, 0d
      Active milestone :milestone, active, am, 2024-01-06, 0d
      Crit milestone :milestone, crit, cm, 2024-01-07, 0d
      Done milestone :milestone, done, dm, 2024-01-08, 0d
    `
    const STATUS_TASKS = { plain: ['p', 'pm'], active: ['a', 'am'], crit: ['c', 'cm'], done: ['d', 'dm'] } as const
    /** Colors closer than this (OKLab ΔE) read as one ink beside each other:
     *  the separation categorical palettes guarantee between their slices. */
    const SAME_COLOR = 0.1
    /** A line this much heavier than another reads as a different line. */
    const HEAVIER = 1.5
    /** A fill has no line weight; a line is drawn at its stroke width. */
    type Ink = { color: string; dashed: boolean; width?: number }

    /** Every fill and outline ink a task part paints, opacity ignored. */
    function ownedInks(part: ResolvedPart): Ink[] {
      const inks: Ink[] = []
      for (const primitive of part.primitives) {
        if (primitive.kind !== 'path') continue
        const { fill, stroke, strokeWidth, dashArray } = primitive.paint
        if (fill !== 'none') inks.push({ color: fill, dashed: false })
        if (stroke !== 'none' && strokeWidth > 0) inks.push({ color: stroke, dashed: (dashArray?.length ?? 0) > 0, width: strokeWidth })
      }
      return inks
    }

    const alike = (a: Ink, b: Ink) => a.dashed === b.dashed
      && (deltaEOK(a.color, b.color) ?? 0) < SAME_COLOR
      && (a.width === undefined || b.width === undefined || Math.max(a.width, b.width) / Math.min(a.width, b.width) < HEAVIER)
    const covers = (inks: readonly Ink[], ink: Ink) => inks.some(other => alike(other, ink))
    /** Two tasks read apart when one paints an ink the other has nothing like. */
    const readApart = (a: readonly Ink[], b: readonly Ink[]) => a.some(ink => !covers(b, ink)) || b.some(ink => !covers(a, ink))

    const LOOKS = ['default', ...knownStyleDescriptors().filter(d => d.kind === 'look' && !d.isDefault).map(d => d.inputName)]
    const PALETTES = [{}, { accent: '#d00000' }, { bg: '#18181B', fg: '#FAFAFA' }] as const

    for (const look of LOOKS) {
      it(`${look}: every status reads apart from every other, bar and milestone alike`, () => {
        for (const palette of PALETTES) {
          const scene = renderResolvedScene(STATUSES, { ...(look === 'default' ? {} : { style: look }), ...palette })
          const inksOf = (task: string) => {
            const part = scene.parts.find(candidate => candidate.node.kind === 'shape' && (candidate.node.attributes?.data as Record<string, string> | undefined)?.task === task)
            expect(part, `${look} ${JSON.stringify(palette)}: task ${task}`).toBeDefined()
            return ownedInks(part!)
          }
          const statuses = Object.keys(STATUS_TASKS) as (keyof typeof STATUS_TASKS)[]
          for (const [i, a] of statuses.entries()) {
            for (const b of statuses.slice(i + 1)) {
              for (const k of [0, 1]) {
                expect(readApart(inksOf(STATUS_TASKS[a][k]!), inksOf(STATUS_TASKS[b][k]!)), `${look} ${JSON.stringify(palette)}: ${a} vs ${b} ${k ? 'milestone' : 'bar'}`).toBe(true)
              }
            }
            // A milestone carries its status the way a bar of that status does.
            expect(readApart(inksOf(STATUS_TASKS[a][0]), inksOf(STATUS_TASKS[a][1])), `${look} ${JSON.stringify(palette)}: ${a} milestone vs bar`).toBe(false)
          }
        }
      })
    }

    it('draws theme line and accent ink through the legibility repair', () => {
      // A line and an accent that vanish on their own page: the grid, the bars
      // and the critical outline still read at the 3:1 of non-text contrast.
      const bg = '#FFFFFF'
      const scene = renderResolvedScene(STATUSES, { bg, fg: '#27272A', line: '#FAFAFA', accent: '#F4F4F5' })
      const grid = scene.parts.filter(part => part.id.startsWith('grid:') && part.node.kind === 'shape' && part.node.geometry.kind === 'line')
      expect(grid.length).toBeGreaterThan(0)
      const strokes = (part: ResolvedPart) => part.primitives.flatMap(p => p.kind === 'path' && p.paint.stroke !== 'none' ? [p.paint.stroke] : [])
      const fills = (part: ResolvedPart) => part.primitives.flatMap(p => p.kind === 'path' && p.paint.fill !== 'none' ? [p.paint.fill] : [])
      const task = (id: string) => scene.parts.find(part => (part.node.attributes?.data as Record<string, string> | undefined)?.task === id)!
      for (const ink of [...grid.flatMap(strokes), ...fills(task('p')), ...strokes(task('c'))]) {
        expect(contrastRatio(ink, bg)!, ink).toBeGreaterThanOrEqual(3)
      }
    })
  })

  it('strict security: no external refs, click hrefs never become fetchable output', () => {
    const src = `gantt
      dateFormat YYYY-MM-DD
      Task :t1, 2024-01-01, 5d
      click t1 href "https://example.com/evil"
      click t1 call alert(document.cookie)
    `
    const svg = renderMermaidSVG(src, { security: 'strict' })
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
    expect(svg).not.toContain('example.com')
    expect(svg).not.toContain('alert(')
    expect(svg).not.toContain('<script')
  })

  it('injects accTitle/accDescr as SVG title/desc with ARIA wiring', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      accTitle: Q1 plan
      accDescr: Two-task schedule
      A :a, 2024-01-01, 5d
    `)
    expect(svg).toContain('<title id="svg-title">Q1 plan</title>')
    expect(svg).toContain('<desc id="svg-desc">Two-task schedule</desc>')
    expect(svg).toContain('aria-labelledby="svg-title"')
    expect(svg).toContain('aria-describedby="svg-desc"')
    expect(svg).toContain('role="img"')
  })

  it('renders topAxis labels above and below the plot', () => {
    const svg = renderMermaidSVG('gantt\n  dateFormat YYYY-MM-DD\n  topAxis\n  A :a, 2024-01-01, 14d')
    const labels = [...svg.matchAll(/<text\b([^>]*class="gantt-axis-label"[^>]*)>/g)].map(m => Number(m[1]!.match(/(?:^|\s)y="([\d.]+)"/)![1]))
    const plotTop = Math.min(...labels)
    const plotBottom = Math.max(...labels)
    expect(plotTop).toBeLessThan(60)
    expect(plotBottom).toBeGreaterThan(60)
  })

  it('applies named-style text transforms to axis and vert marker labels', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      axisFormat %b
      topAxis
      A :a, 2024-01-01, 40d
      cut over :vert, v, 2024-01-15, 0d
    `, {
      style: 'ops-schematic',
    })

    expect(svg).toContain('>JAN</text>')
    expect(svg).toContain('>CUT OVER</text>')
  })

  it('compact frontmatter packs rows (shorter SVG than standard)', () => {
    const body = 'gantt\n  dateFormat YYYY-MM-DD\n  section S\n    One :a, 2024-01-01, 5d\n    Two :b, 2024-01-03, 6d\n    Three :c, 2024-01-08, 4d'
    const compact = renderMermaidSVG(`---\ndisplayMode: compact\n---\n${body}`)
    const standard = renderMermaidSVG(body)
    const h = (svg: string) => Number(svg.match(/height="(\d+(?:\.\d+)?)"/)![1])
    expect(h(compact)).toBeLessThan(h(standard))
  })

  it('fails with a named structured error on invalid gantt source', () => {
    expect(() => renderMermaidSVG('gantt\n  A :a, after ghost, 3d')).toThrow(/GANTT_UNKNOWN_TASK_REF/)
    expect(() => renderMermaidSVG('gantt\n  A :x, 2024-01-01, 1d\n  B :x, 2024-01-01, 1d')).toThrow(/GANTT_DUPLICATE_TASK_ID/)
  })
})
