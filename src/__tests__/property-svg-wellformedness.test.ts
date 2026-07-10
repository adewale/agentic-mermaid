import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidSVG } from '../index.ts'

const PROPERTY_RUNS = 100
const WORD_CHARS = [...'abcdefghijklmnopqrstuvwxyz']
const ACCENT_COLOR = '#7A0000'

const wordArb = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

const shortLabelArb = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 20 })
  .map(chars => chars.join(''))

const idArb = fc
  .tuple(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { maxLength: 5 }),
  )
  .map(([head, tail]) => `${head}${tail.join('')}`)

function assertSvgWellFormed(svg: string): void {
  // 1. Contains <svg and </svg>
  expect(svg).toContain('<svg')
  expect(svg).toContain('</svg>')

  // 2. No NaN or Infinity in numeric attribute positions
  // Match any attribute value that is literally NaN or Infinity
  expect(svg).not.toMatch(/="[^"]*\bNaN\b[^"]*"/)
  expect(svg).not.toMatch(/="[^"]*\bInfinity\b[^"]*"/)

  // 3. No undefined as literal string in attributes
  expect(svg).not.toMatch(/="[^"]*\bundefined\b[^"]*"/)
}

function assertAccentColor(svg: string): void {
  // 4. When rendered with accent #7A0000, inline style contains --accent:#7A0000
  expect(svg).toContain(`--accent:${ACCENT_COLOR}`)
}

// ============================================================================
// Flowchart
// ============================================================================

describe('SVG well-formedness: flowchart', () => {
  it('produces well-formed SVG for random flowcharts', () => {
    const flowchartArb = fc.record({
      labelA: shortLabelArb,
      labelB: shortLabelArb,
      edgeLabel: fc.option(shortLabelArb, { nil: undefined }),
    })

    fc.assert(
      fc.property(flowchartArb, ({ labelA, labelB, edgeLabel }) => {
        const edgePart = edgeLabel ? `|${edgeLabel}|` : ''
        const source = `graph TD\n  A[${labelA}] -->${edgePart} B[${labelB}]`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Sequence Diagram
// ============================================================================

describe('SVG well-formedness: sequenceDiagram', () => {
  it('produces well-formed SVG for random sequence diagrams', () => {
    const seqArb = fc.record({
      actorA: idArb,
      actorB: idArb,
      message: shortLabelArb,
    }).filter(({ actorA, actorB }) => actorA !== actorB)

    fc.assert(
      fc.property(seqArb, ({ actorA, actorB, message }) => {
        const source = `sequenceDiagram\n  ${actorA}->>${actorB}: ${message}`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Class Diagram
// ============================================================================

describe('SVG well-formedness: classDiagram', () => {
  it('produces well-formed SVG for random class diagrams', () => {
    const classArb = fc.record({
      classA: idArb,
      classB: idArb,
    }).filter(({ classA, classB }) => classA !== classB)

    fc.assert(
      fc.property(classArb, ({ classA, classB }) => {
        const source = `classDiagram\n  ${classA} <|-- ${classB}`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// ER Diagram
// ============================================================================

describe('SVG well-formedness: erDiagram', () => {
  it('produces well-formed SVG for random ER diagrams', () => {
    const erArb = fc.record({
      entityA: idArb,
      entityB: idArb,
      rel: wordArb,
    }).filter(({ entityA, entityB }) => entityA !== entityB)

    fc.assert(
      fc.property(erArb, ({ entityA, entityB, rel }) => {
        const source = `erDiagram\n  ${entityA} ||--o{ ${entityB} : ${rel}`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Timeline
// ============================================================================

describe('SVG well-formedness: timeline', () => {
  it('produces well-formed SVG for random timeline diagrams', () => {
    const timelineArb = fc.record({
      title: shortLabelArb,
      year: fc.integer({ min: 1900, max: 2100 }),
      event: shortLabelArb,
    })

    fc.assert(
      fc.property(timelineArb, ({ title, year, event }) => {
        const source = `timeline\n  title ${title}\n  ${year} : ${event}`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Journey
// ============================================================================

describe('SVG well-formedness: journey', () => {
  it('produces well-formed SVG for random journey diagrams', () => {
    // Multi-section, multi-task shapes: the single-section/single-task arb
    // this replaces could not reach section tiling, the experience curve, or
    // multi-actor dot rows.
    const journeyArb = fc.record({
      title: shortLabelArb,
      sections: fc.array(fc.record({
        label: shortLabelArb,
        tasks: fc.array(fc.record({
          task: shortLabelArb,
          score: fc.integer({ min: 1, max: 5 }),
          actors: fc.array(wordArb, { minLength: 0, maxLength: 3 }),
        }), { minLength: 1, maxLength: 4 }),
      }), { minLength: 1, maxLength: 4 }),
    })

    fc.assert(
      fc.property(journeyArb, ({ title, sections }) => {
        const body = sections.flatMap(s => [
          `  section ${s.label}`,
          ...s.tasks.map(t => `  ${t.task}: ${t.score}${t.actors.length ? `: ${t.actors.join(', ')}` : ''}`),
        ])
        const source = `journey\n  title ${title}\n${body.join('\n')}`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Architecture
// ============================================================================

describe('SVG well-formedness: architecture', () => {
  it('produces well-formed SVG for random architecture diagrams', () => {
    const archArb = fc.record({
      serviceId: wordArb,
      label: shortLabelArb,
    })

    fc.assert(
      fc.property(archArb, ({ serviceId, label }) => {
        const source = `architecture-beta\n  service ${serviceId}(server)[${label}]`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// XY Chart
// ============================================================================

describe('SVG well-formedness: xychart', () => {
  it('produces well-formed SVG for random xy charts', () => {
    const xyArb = fc.record({
      labels: fc.array(wordArb, { minLength: 2, maxLength: 5 }),
      values: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 5 }),
    }).map(({ labels, values }) => {
      // Align lengths
      const len = Math.min(labels.length, values.length)
      return { labels: labels.slice(0, len), values: values.slice(0, len) }
    })

    fc.assert(
      fc.property(xyArb, ({ labels, values }) => {
        const source = `xychart\n  x-axis [${labels.join(', ')}]\n  bar [${values.join(', ')}]`
        const svg = renderMermaidSVG(source, { accent: ACCENT_COLOR })

        assertSvgWellFormed(svg)
        assertAccentColor(svg)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})
