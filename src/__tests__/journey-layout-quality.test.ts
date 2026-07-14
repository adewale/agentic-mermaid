// Journey layout/renderer quality gates. These encode the Mermaid-classic
// acceptance criteria from docs/design/families/journey-migration-parity.md as
// executable geometry checks (the criteria used to live only in prose):
//   - section spans tile without overlap, tasks sit inside their span,
//   - long task/section labels wrap instead of blowing out the plot,
//   - the viewBox stays tight below the baseline,
//   - the experience-curve line connects score markers in task order,
//   - derived actor colors stay distinguishable at any actor count,
//   - explicit Mermaid section colors keep readable label contrast.

import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import type { RenderOptions } from '../types.ts'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { wcagContrastRatio, wcagCssContrastRatio } from '../shared/color-math.ts'
import { verifyMermaid } from '../agent/verify.ts'

function layout(text: string, options: RenderOptions = {}) {
  return layoutJourneyDiagram(
    parseJourneyDiagram(preprocessMermaidLines(text)),
    resolveJourneyRequestAppearance(options),
    options,
  )
}

const WIDE_LABEL_SOURCE = `journey
  title T
  section A very long section label that is much wider than its tasks
    Short: 3: Me
  section Next
    Task: 4: Me
  section Third
    Last: 2: Me`

describe('section tiling', () => {
  it('section spans never overlap, even when a label is wider than its tasks', () => {
    const positioned = layout(WIDE_LABEL_SOURCE)
    const framed = positioned.sections.filter(s => s.framed)
    expect(framed.length).toBe(3)
    for (let i = 1; i < framed.length; i++) {
      expect(framed[i - 1]!.x + framed[i - 1]!.width).toBeLessThanOrEqual(framed[i]!.x + 0.01)
    }
  })

  it('every task sits horizontally inside its own section span', () => {
    const positioned = layout(WIDE_LABEL_SOURCE)
    for (const section of positioned.sections) {
      if (!section.framed) continue
      for (const task of section.tasks) {
        expect(task.x).toBeGreaterThanOrEqual(section.x - 0.01)
        expect(task.x + task.width).toBeLessThanOrEqual(section.x + section.width + 0.01)
      }
    }
  })
})

describe('label wrapping', () => {
  it('never splits or hyphenates emoji grapheme clusters', () => {
    const original = '👩‍🔬'.repeat(24)
    const positioned = layout(`journey\n  ${original}: 3: Me`)
    const wrapped = positioned.sections[0]!.tasks[0]!.text
    expect(wrapped.replace(/\n/g, '')).toBe(original)
    expect(wrapped).not.toContain('-')
    for (const line of wrapped.split('\n')) {
      expect(line.startsWith('\u200d')).toBe(false)
      expect(line.endsWith('\u200d')).toBe(false)
    }
  })
  it('wraps long task labels instead of growing the column unboundedly', () => {
    const positioned = layout(`journey
      Draft the quarterly report for the steering committee across four time zones with appendices: 3: Me`)
    const task = positioned.sections[0]!.tasks[0]!
    expect(task.text).toContain('\n')
    // maxLabelWidth default (360) plus task padding bounds the box.
    expect(task.width).toBeLessThanOrEqual(360 + 2 * 14 + 1)
  })

  it('wraps long section labels instead of inflating the span', () => {
    const positioned = layout(`journey
      section Understanding the customer onboarding experience from first contact to habitual usage
        Short: 3: Me`)
    const section = positioned.sections[0]!
    expect(section.label).toContain('\n')
    expect(section.width).toBeLessThanOrEqual(360 + 2 * 16 + 2 * 10 + 1)
  })
})

describe('viewBox tightness', () => {
  it('reserves only arrow clearance below the baseline', () => {
    const positioned = layout(WIDE_LABEL_SOURCE)
    const baselineY = positioned.scoreGuide.baseline.y1
    expect(positioned.height - baselineY).toBeLessThanOrEqual(28 + 8)
  })

  it('keeps the gap between the score-1 gridline and the baseline modest', () => {
    const positioned = layout(WIDE_LABEL_SOURCE)
    const guideBottom = positioned.scoreGuide.y + positioned.scoreGuide.height
    expect(positioned.scoreGuide.baseline.y1 - guideBottom).toBeLessThanOrEqual(40)
  })

  it('does not strand a single task in a huge empty plot', () => {
    const positioned = layout('journey\n  Only task: 3: Me')
    const task = positioned.sections[0]!.tasks[0]!
    expect(positioned.scoreGuide.baseline.x2 - (task.x + task.width)).toBeLessThanOrEqual(100)
  })
})

describe('experience-curve line', () => {
  const SOURCE = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 3: Me`

  it('draws a smooth path through the score markers, beneath the faces', () => {
    const svg = renderMermaidSVG(SOURCE)
    expect(svg).toContain('journey-curve')
    const path = svg.match(/<path class="journey-curve"[^>]*\sd="([^"]+)"/)
    expect(path).not.toBeNull()
    // One M plus a C segment per marker-to-marker hop (5 tasks → 4 hops).
    expect(path![1]!.match(/C/g)?.length).toBe(4)
    // The curve renders before (beneath) the first score face.
    expect(svg.indexOf('journey-curve')).toBeLessThan(svg.indexOf('journey-score-face'))
  })

  it('is skippable via the journey render option', () => {
    const svg = renderMermaidSVG(SOURCE, { journey: { experienceCurve: false } })
    expect(svg).not.toContain('journey-curve')
  })

  it('is omitted for single-task journeys', () => {
    const svg = renderMermaidSVG('journey\n  Only: 3: Me')
    expect(svg).not.toContain('journey-curve')
  })
})

describe('useMaxWidth config', () => {
  it('renders a responsive SVG capped at the natural width when enabled', () => {
    const src = 'journey\n  section S\n    Pay: 3: Shopper'
    const svg = renderMermaidSVG(`%%{init: {"journey": {"useMaxWidth": true}}}%%\n${src}`)
    expect(svg).toContain('width="100%"')
    expect(svg).toMatch(/max-width:\d+(\.\d+)?px/)
    const fixed = renderMermaidSVG(src)
    expect(fixed).not.toContain('width="100%"')
  })
})

describe('actor palette', () => {
  it('guarantees unique derived colors through the documented finite bound', () => {
    const actors = Array.from({ length: 256 }, (_unused, index) => `Actor${index}`)
    const svg = renderMermaidSVG(`journey\n  Task: 3: ${actors.join(', ')}`)
    const colors = [...svg.matchAll(/\.journey-actor-\d+ \{ fill: ([^;]+);/g)].map(match => match[1])
    expect(colors).toHaveLength(256)
    expect(new Set(colors).size).toBe(256)
    const warning = verifyMermaid(`journey\n  Task: 3: ${[...actors, 'Over'].join(', ')}`).warnings
      .find(item => item.code === 'UNSUPPORTED_SYNTAX' && item.syntax === 'journey_actor_palette_limit')
    expect(warning).toBeDefined()
  })

  it('gives nine actors nine distinct derived colors', () => {
    const tasks = Array.from({ length: 9 }, (_v, i) => `    T${i}: 3: Actor${i}`).join('\n')
    const svg = renderMermaidSVG(`journey\n  section S\n${tasks}`)
    const fills = new Set<string>()
    for (const match of svg.matchAll(/\.journey-actor-(\d+) \{ fill: ([^;]+);/g)) {
      fills.add(match[2]!.trim())
    }
    expect(fills.size).toBeGreaterThanOrEqual(9)
  })
})

describe('section label contrast (WCAG AA)', () => {
  const sectionPair = (svg: string, index: number): [string, string] => {
    const band = svg.match(new RegExp(`\\.journey-section-band-${index} \\{ fill: ([^;]+);`))
    const label = svg.match(new RegExp(`\\.journey-section-label-${index} \\{ fill: ([^;]+);`))
    expect(band).not.toBeNull()
    expect(label).not.toBeNull()
    return [label![1]!.trim(), band![1]!.trim()]
  }

  it('honors Mermaid stock section fills with readable label text', () => {
    // Upstream Mermaid's default journey palette head + white section text.
    const svg = renderMermaidSVG(`%%{init: {"journey": {"sectionFills": ["#191970", "#8FBC8F", "#7CFC00"], "sectionColours": ["#ffffff"]}}}%%
journey
  section Checkout
    Pay: 3: Shopper
  section Fulfil
    Pack: 4: Clerk
  section Deliver
    Ship: 5: Courier`)
    for (const index of [0, 1, 2]) {
      const [label, band] = sectionPair(svg, index)
      expect(wcagContrastRatio(label, band)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('guards named, rgb, and saturated concrete pairs with composited WCAG math', () => {
    const cases: Array<[string, string]> = [['#00a000', '#ffffff'], ['#f0f0f0', 'white'], ['rgb(240,240,240)', 'white']]
    for (const [band, requested] of cases) {
      const svg = renderMermaidSVG(`%%{init: ${JSON.stringify({ journey: { sectionFills: [band], sectionColours: [requested] } })}}%%\njourney\n  section S\n    Task: 3: Me`)
      const emittedBand = /\.journey-section-band-0 \{ fill: ([^;]+);/.exec(svg)?.[1] ?? band
      const emittedText = /\.journey-section-label-0 \{ fill: ([^;]+);/.exec(svg)?.[1]
      expect(emittedText).toBeDefined()
      expect(wcagCssContrastRatio(emittedText!, emittedBand, '#ffffff')!).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('overrides an unreadable explicit label color instead of rendering invisible text', () => {
    const svg = renderMermaidSVG(`%%{init: {"journey": {"sectionFills": ["#f0f0f0"], "sectionColours": ["#ffffff"]}}}%%
journey
  section Checkout
    Pay: 3: Shopper`)
    const [label, band] = sectionPair(svg, 0)
    expect(wcagContrastRatio(label, band)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps explicit fills readable on a dark theme too', () => {
    const svg = renderMermaidSVG(`%%{init: {"journey": {"sectionFills": ["#191970"], "sectionColours": ["#ffffff"]}}}%%
journey
  section Checkout
    Pay: 3: Shopper`, { bg: '#1e1e2e', fg: '#cdd6f4' })
    const [label, band] = sectionPair(svg, 0)
    expect(wcagContrastRatio(label, band)).toBeGreaterThanOrEqual(4.5)
  })
})
