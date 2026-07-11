// Gantt SVG integration tests (docs/design/families/gantt.md §Test tiers, SVG row):
// deterministic output, a committed representative golden, status classes,
// strict-security guarantees, accessibility injection, theme contrast for
// status bars in light/dark themes, and the supplied-clock today marker.
// No fixture in this file may contain a wall-clock date.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { verifyMermaid } from '../agent/verify.ts'

const snapshotDir = join(import.meta.dir, 'testdata', 'svg')

function normalizeSvg(svg: string): string {
  return svg
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

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
      for (const m of svg.matchAll(/class="gantt-(?:task|section)-label"[^>]*x="(\d+(?:\.\d+)?)"/g)) {
        expect(Number(m[1])).toBeLessThan(60) // label column, not plot area
      }
      expect(svg).toContain(`.gantt-task-label { fill: ${fg}; }`)
      expect(svg).toContain(`.gantt-section-label { fill: ${fg}; }`)
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
    expect(line).toContain('style="stroke-width:5px;stroke:#0f0;opacity:0.5"')
    // Without a clock the marker (and its style) never draws.
    expect(renderMermaidSVG(src)).not.toContain('<line class="gantt-today-marker"')
  })

  it('rejects style-attr injection in the todayMarker payload', () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  todayMarker stroke:#0f0"onload="alert(1),opacity:0.5\n  A :a, 2024-01-01, 10d'
    const svg = renderMermaidSVG(src, { ganttToday: '2024-01-05' })
    expect(svg).not.toContain('onload')
    expect(svg).not.toContain('alert(')
    // The safe property still applies; the poisoned one is dropped whole.
    const line = svg.match(/<line class="gantt-today-marker"[^>]*>/)![0]
    expect(line).toContain('opacity:0.5')
    expect(line).not.toContain('#0f0')
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
    expect(svg).toContain('<path class="gantt-milestone" d=')
    expect(svg).toContain('.gantt-milestone-done {')
    expect(svg).toContain('.gantt-milestone-active {')
    // Charts without done/active milestones carry no dead CSS for them.
    const bare = renderMermaidSVG('gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2024-01-01, 5d\n  M :milestone, m, 2024-01-03, 0d')
    expect(bare).not.toContain('gantt-milestone-done')
    expect(bare).not.toContain('gantt-milestone-active')
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
    const labels = [...svg.matchAll(/class="gantt-axis-label"[^>]*y="(\d+(?:\.\d+)?)"/g)].map(m => Number(m[1]))
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
