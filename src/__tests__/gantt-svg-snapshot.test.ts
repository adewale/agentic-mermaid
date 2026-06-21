// Gantt SVG integration tests (docs/design/families/gantt.md §Test tiers, SVG row):
// deterministic output, a committed representative golden, status classes,
// strict-security guarantees, accessibility injection, theme contrast for
// status bars in light/dark themes, and the supplied-clock today marker.
// No fixture in this file may contain a wall-clock date.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'

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
    expect(svg).toContain('aria-labelledby="svg-title svg-desc"')
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
