// Vertical (`timeline TD`) layout + width control (family-elevation plan §Timeline 4).
//
// Upstream contract (PR #7270, docs/syntax/timeline.md): the direction token
// rides the header line — `timeline TD` flows top-down, `timeline LR` (and the
// bare header) stay horizontal. Both orientations come from ONE placement walk
// in main/cross-axis space, so these tests pin the orientation transform with
// invariants rather than snapshots:
//   - TD: periods advance monotonically in y, the rail is vertical, pills sit
//     left of the rail, events right of it, and everything stays on canvas.
//   - LR: explicit `timeline LR` is geometry-identical to the bare header
//     (the horizontal default is the byte-identity baseline the svg/layout
//     golden gates pin corpus-wide).
//   - width control: `RenderOptions.timeline.maxWidth` compresses the shared
//     wrap caps so a 13-period horizontal chart fits a stated budget.

import { describe, it, expect } from 'bun:test'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import type { RenderOptions } from '../types.ts'

function layout(source: string, options: RenderOptions = {}) {
  return layoutTimelineDiagram(parseTimelineDiagram(normalizeMermaidSource(source).lines), options)
}

const BASIC = `timeline
  title Product history
  section Foundation
  2020 : Prototype : Seed round
  2021 : Beta
  section Growth
  2022 : Launch
  2023 : Scale-out`

const BASIC_TD = BASIC.replace('timeline', 'timeline TD')
const BASIC_LR = BASIC.replace('timeline', 'timeline LR')

const STRESS = ['timeline', '  title Thirteen busy years'].concat(
  Array.from({ length: 13 }, (_, i) =>
    `  ${2012 + i} : Major platform milestone shipped this year : Follow-up integration work`),
).join('\n')

describe('vertical (TD) timeline layout invariants', () => {
  it('periods advance monotonically in y and the rail is vertical', () => {
    const d = layout(BASIC_TD)
    const periods = d.sections.flatMap(s => s.periods)
    expect(periods.length).toBe(4)
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i]!.markerY).toBeGreaterThan(periods[i - 1]!.markerY)
    }
    expect(d.rail.x1).toBe(d.rail.x2)
    expect(d.rail.y2).toBeGreaterThan(d.rail.y1)
  })

  it('pills sit left of the rail, events right of it, stems horizontal', () => {
    const d = layout(BASIC_TD)
    for (const section of d.sections) {
      for (const period of section.periods) {
        expect(period.pillX + period.pillWidth).toBeLessThanOrEqual(d.rail.x1)
        expect(period.stem.y1).toBe(period.stem.y2)
        for (const event of period.events) {
          expect(event.x).toBeGreaterThanOrEqual(d.rail.x1)
        }
      }
    }
  })

  it('every box stays inside the canvas and inside its section frame', () => {
    const d = layout(BASIC_TD)
    const inCanvas = (x: number, y: number, w: number, h: number) => {
      expect(x).toBeGreaterThanOrEqual(-0.5)
      expect(y).toBeGreaterThanOrEqual(-0.5)
      expect(x + w).toBeLessThanOrEqual(d.width + 0.5)
      expect(y + h).toBeLessThanOrEqual(d.height + 0.5)
    }
    for (const section of d.sections) {
      inCanvas(section.x, section.y, section.width, section.height)
      for (const period of section.periods) {
        inCanvas(period.pillX, period.pillY, period.pillWidth, period.pillHeight)
        expect(period.pillY).toBeGreaterThanOrEqual(section.y - 0.5)
        expect(period.pillY + period.pillHeight).toBeLessThanOrEqual(section.y + section.height + 0.5)
        for (const event of period.events) {
          inCanvas(event.x, event.y, event.width, event.height)
          expect(event.y).toBeGreaterThanOrEqual(section.y - 0.5)
          expect(event.y + event.height).toBeLessThanOrEqual(section.y + section.height + 0.5)
        }
      }
    }
  })

  it('section frames stack vertically without overlap in TD', () => {
    const d = layout(BASIC_TD)
    expect(d.sections.length).toBe(2)
    const [a, b] = d.sections
    expect(a!.y + a!.height).toBeLessThanOrEqual(b!.y)
  })

  it('a 13-period timeline flows downward instead of 2,000+px wide', () => {
    const td = layout(STRESS.replace('timeline', 'timeline TD'))
    const lr = layout(STRESS)
    expect(lr.width).toBeGreaterThan(2000)
    expect(td.width).toBeLessThan(lr.width / 2)
    expect(td.height).toBeGreaterThan(td.width)
  })

  it('renders TD to SVG with a vertical rail and intact labels', () => {
    const svg = renderMermaidSVG(BASIC_TD)
    const rail = svg.match(/<line class="timeline-rail" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/)
    expect(rail).not.toBeNull()
    expect(rail![1]).toBe(rail![3]) // x1 === x2: vertical
    expect(rail![2]).not.toBe(rail![4])
    for (const text of ['Prototype', 'Seed round', 'Launch', 'Scale-out', 'Foundation', 'Growth']) {
      expect(svg).toContain(text)
    }
  })

  it('TD handles section-only and title-only diagrams without crashing', () => {
    expect(layout('timeline TD\n  section Only').width).toBeGreaterThan(0)
    expect(layout('timeline TD\n  title Only').height).toBeGreaterThan(0)
  })
})

describe('horizontal default is unchanged', () => {
  it('explicit `timeline LR` is geometry-identical to the bare header', () => {
    const bare = layout(BASIC)
    const lr = layout(BASIC_LR)
    expect(JSON.stringify(lr)).toBe(JSON.stringify(bare))
  })

  it('horizontal rail stays horizontal (y1 === y2) with stems vertical', () => {
    const d = layout(BASIC)
    expect(d.rail.y1).toBe(d.rail.y2)
    for (const period of d.sections.flatMap(s => s.periods)) {
      expect(period.stem.x1).toBe(period.stem.x2)
    }
  })
})

describe('timeline width control (RenderOptions.timeline.maxWidth)', () => {
  it('caps a 13-period horizontal chart to the stated budget', () => {
    const unbounded = layout(STRESS)
    expect(unbounded.width).toBeGreaterThan(2400)
    const capped = layout(STRESS, { timeline: { maxWidth: 1600 } })
    expect(capped.width).toBeLessThanOrEqual(1600)
    // Compression must not push content off-canvas.
    for (const section of capped.sections) {
      for (const period of section.periods) {
        expect(period.pillX).toBeGreaterThanOrEqual(-0.5)
        expect(period.pillX + period.pillWidth).toBeLessThanOrEqual(capped.width + 0.5)
        for (const event of period.events) {
          expect(event.x).toBeGreaterThanOrEqual(-0.5)
          expect(event.x + event.width).toBeLessThanOrEqual(capped.width + 0.5)
        }
      }
    }
  })

  it('a budget the chart already fits changes nothing (zero drift)', () => {
    const unbounded = layout(STRESS)
    const roomy = layout(STRESS, { timeline: { maxWidth: 99999 } })
    expect(JSON.stringify(roomy)).toBe(JSON.stringify(unbounded))
  })

  it('threads through renderMermaidSVG', () => {
    const svg = renderMermaidSVG(STRESS, { timeline: { maxWidth: 1600 } })
    const width = Number(svg.match(/viewBox="0 0 ([\d.]+) /)![1])
    expect(width).toBeLessThanOrEqual(1600)
  })
})
