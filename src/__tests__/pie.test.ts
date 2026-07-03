// ============================================================================
// Pie chart tests — parser unit, SVG integration, and property tests.
//
// The pie family (BUILD-5 first slice) models Mermaid pie syntax:
//   pie [showData] [title T]
//   [title T]
//   "label" : positiveNumber
//
// Faithfulness contract: malformed entries ERROR LOUDLY, never silently drop.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import { parsePieChart } from '../pie/parser.ts'
import { layoutPieChart, slicePath } from '../pie/layout.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { toMermaidLines } from '../mermaid-source.ts'

function parse(src: string) {
  return parsePieChart(toMermaidLines(src))
}

// ---------------------------------------------------------------------------
// Parser — happy paths (table-driven)
// ---------------------------------------------------------------------------

describe('pie parser — happy paths', () => {
  const cases: Array<{
    name: string
    src: string
    title?: string
    showData: boolean
    entries: Array<[string, number]>
  }> = [
    {
      name: 'basic with inline title',
      src: 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85',
      title: 'Pets',
      showData: false,
      entries: [['Dogs', 386], ['Cats', 85]],
    },
    {
      name: 'showData on header + title on its own line',
      src: 'pie showData\n  title Elements\n  "Calcium" : 42.96\n  "Iron" : 5',
      title: 'Elements',
      showData: true,
      entries: [['Calcium', 42.96], ['Iron', 5]],
    },
    {
      name: 'showData and inline title together',
      src: 'pie showData title Reach\n  "A" : 1\n  "B" : 2',
      title: 'Reach',
      showData: true,
      entries: [['A', 1], ['B', 2]],
    },
    {
      name: 'no title, decimal values',
      src: 'pie\n  "X" : 0.5\n  "Y" : 1.25',
      title: undefined,
      showData: false,
      entries: [['X', 0.5], ['Y', 1.25]],
    },
    {
      name: 'quoted label with spaces and punctuation',
      src: 'pie\n  "Some, Long: Label" : 10',
      title: undefined,
      showData: false,
      entries: [['Some, Long: Label', 10]],
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const chart = parse(c.src)
      expect(chart.title).toBe(c.title as never)
      expect(chart.showData).toBe(c.showData)
      expect(chart.entries.map(e => [e.label, e.value])).toEqual(c.entries)
    })
  }

  it('preserves source order of slices', () => {
    const chart = parse('pie\n  "First" : 1\n  "Second" : 2\n  "Third" : 3')
    expect(chart.entries.map(e => e.label)).toEqual(['First', 'Second', 'Third'])
  })
})

// ---------------------------------------------------------------------------
// Parser — sad paths (loud errors, never silent drops)
// ---------------------------------------------------------------------------

describe('pie parser — sad paths error loudly', () => {
  const bad: Array<{ name: string; src: string; match: RegExp }> = [
    { name: 'negative value', src: 'pie\n  "A" : -5', match: /non-negative numbers/i },
    { name: 'non-numeric value', src: 'pie\n  "A" : five', match: /invalid value/i },
    { name: 'missing colon', src: 'pie\n  "A" 5', match: /Unrecognized pie chart line/i },
    { name: 'unquoted label', src: 'pie\n  A : 5', match: /Invalid pie entry/i },
    { name: 'no entries', src: 'pie', match: /at least one/i },
    { name: 'wrong header', src: 'notpie\n  "A" : 5', match: /must start with "pie"/i },
  ]

  for (const b of bad) {
    it(b.name, () => {
      expect(() => parse(b.src)).toThrow(b.match)
    })
  }

  it('a malformed entry in the middle is not silently dropped', () => {
    // The bad middle line must abort the whole parse, not yield 2 good slices.
    expect(() => parse('pie\n  "A" : 1\n  "B" : -2\n  "C" : 3')).toThrow(/non-negative numbers/i)
  })

  it('a zero-value slice is legal (upstream parity): zero-width wedge, label kept', () => {
    const chart = parse('pie\n  "A" : 60\n  "B" : 0')
    expect(chart.entries.map(e => [e.label, e.value])).toEqual([['A', 60], ['B', 0]])
  })
})

// ---------------------------------------------------------------------------
// Layout geometry
// ---------------------------------------------------------------------------

describe('pie layout', () => {
  it('computes fractions that sum to ~1 and slice count == entry count', () => {
    const chart = parse('pie\n  "A" : 1\n  "B" : 1\n  "C" : 2')
    const positioned = layoutPieChart(chart)
    expect(positioned.slices).toHaveLength(3)
    const sum = positioned.slices.reduce((s, sl) => s + sl.fraction, 0)
    expect(sum).toBeCloseTo(1, 6)
    expect(positioned.slices[2]!.fraction).toBeCloseTo(0.5, 6)
  })

  it('emits a legend item per slice', () => {
    const positioned = layoutPieChart(parse('pie\n  "A" : 1\n  "B" : 3'))
    expect(positioned.legend).toHaveLength(2)
    expect(positioned.legend.map(l => l.label)).toEqual(['A', 'B'])
  })

  it('slicePath of a full circle is a closed two-arc path', () => {
    const d = slicePath(50, 50, 40, 0, Math.PI * 2)
    expect(d).toContain('A 40 40')
    expect(d.trim().endsWith('Z')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SVG integration
// ---------------------------------------------------------------------------

describe('pie SVG integration', () => {
  const src = 'pie title Pets adopted by volunteers\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15'

  it('renders an <svg> with one <path> per slice and all labels', () => {
    const svg = renderMermaidSVG(src)
    expect(svg).toContain('<svg')
    const pathCount = (svg.match(/<path/g) ?? []).length
    expect(pathCount).toBe(3)
    for (const label of ['Dogs', 'Cats', 'Rats']) {
      expect(svg).toContain(label)
    }
  })

  it('is deterministic — two renders are byte-identical', () => {
    expect(renderMermaidSVG(src)).toBe(renderMermaidSVG(src))
  })

  it('includes percentages and omits raw values without showData', () => {
    const svg = renderMermaidSVG(src)
    expect(svg).toContain('79.4%')
    expect(svg).not.toContain('[386]')
  })

  it('shows raw values in the legend with showData', () => {
    const svg = renderMermaidSVG('pie showData\n  "Dogs" : 386\n  "Cats" : 85')
    expect(svg).toContain('[386]')
    expect(svg).toContain('Dogs')
  })

  it('has no Math.random/Date.now nondeterminism across many renders', () => {
    const first = renderMermaidSVG(src)
    for (let i = 0; i < 5; i++) expect(renderMermaidSVG(src)).toBe(first)
  })
})

// ---------------------------------------------------------------------------
// ASCII integration
// ---------------------------------------------------------------------------

describe('pie ASCII integration', () => {
  it('renders a proportional bar per entry with a percentage', () => {
    const out = renderMermaidASCII('pie\n  "A" : 10\n  "B" : 30', { useAscii: true, colorMode: 'none' })
    const lines = out.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('#')
    expect(lines[0]).toContain('25.0%')
    expect(lines[1]).toContain('75.0%')
  })
})

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('pie property tests', () => {
  // Labels from an alphanumeric + space alphabet, so they survive XML escaping
  // unchanged and the "label present in SVG" assertion stays clean and meaningful.
  const labelArb = fc.stringMatching(/^[A-Za-z0-9 ]{1,12}$/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
  const valueArb = fc.integer({ min: 1, max: 1000 })
  const entryArb = fc.tuple(labelArb, valueArb)
  const entriesArb = fc.array(entryArb, { minLength: 1, maxLength: 6 })

  it('total percentage is ~100% and every label is present in SVG output', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        // De-duplicate labels so each maps to a stable slice.
        const seen = new Set<string>()
        const unique = entries.filter(([l]) => (seen.has(l) ? false : (seen.add(l), true)))
        const src = 'pie\n' + unique.map(([l, v]) => `  "${l}" : ${v}`).join('\n')
        const chart = parsePieChart(toMermaidLines(src))
        const positioned = layoutPieChart(chart)

        const sum = positioned.slices.reduce((s, sl) => s + sl.fraction, 0)
        expect(sum).toBeCloseTo(1, 6)

        const svg = renderMermaidSVG(src)
        for (const [label] of unique) {
          // Alphanumeric labels pass through XML escaping unchanged.
          expect(svg).toContain(label)
        }
      }),
      { numRuns: 60 },
    )
  })

  it('parser round-trips entry count and values stably', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const seen = new Set<string>()
        const unique = entries.filter(([l]) => (seen.has(l) ? false : (seen.add(l), true)))
        const src = 'pie\n' + unique.map(([l, v]) => `  "${l}" : ${v}`).join('\n')
        const a = parsePieChart(toMermaidLines(src))
        const b = parsePieChart(toMermaidLines(src))
        expect(a.entries).toEqual(b.entries)
        expect(a.entries).toHaveLength(unique.length)
      }),
      { numRuns: 60 },
    )
  })
})
