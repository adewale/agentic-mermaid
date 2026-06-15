// ============================================================================
// Cross-family characterisation of the universal invariants.
//
// characterization-layout.test.ts pins the grid + A* flowchart/state engine in
// depth. THIS file extends the *universal* invariants (Tier A) across every
// other renderer family, asserting only what actually holds for each:
//
//   - Totality + determinism: every family (the bedrock contract). These are
//     also pinned across the 243-entry docs corpus by ascii-determinism.test.ts;
//     here they are checked generatively per family with varied inputs.
//   - No diagonals: every family (even xychart plots with block glyphs).
//   - Rectangularity (all rows one width): only the box families
//     (sequence / class / er). Chart and list families emit ragged rows by
//     design — asserting rectangularity there would be false, so we don't.
//
// See docs/layout-characterization/contact-sheet-families.md for the coverage
// matrix and per-family layout strategies. Changes no implementation code.
// ============================================================================

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidASCII } from '../ascii/index.ts'
import { hasDiagonalLines } from '../ascii/validate.ts'

const RUNS = 60
const U = { colorMode: 'none', useAscii: false } as const

// ---------------------------------------------------------------------------
// Per-family generators (bounded, always valid)
// ---------------------------------------------------------------------------

const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,5}$/)

const sequenceArb = fc
  .record({
    participants: fc.integer({ min: 2, max: 4 }),
    messages: fc.array(
      fc.record({ a: fc.nat(), b: fc.nat(), dashed: fc.boolean(), text: word }),
      { minLength: 1, maxLength: 6 },
    ),
  })
  .map(({ participants, messages }) => {
    const ps = Array.from({ length: participants }, (_, i) => `P${i}`)
    const lines = ['sequenceDiagram', ...ps.map((p) => `  participant ${p}`)]
    for (const m of messages) {
      const a = ps[m.a % participants]!
      const b = ps[m.b % participants]!
      lines.push(`  ${a}${m.dashed ? '-->>' : '->>'}${b}: ${m.text}`)
    }
    return lines.join('\n')
  })

const classArb = fc
  .record({ n: fc.integer({ min: 1, max: 4 }), members: fc.array(word, { maxLength: 3 }) })
  .map(({ n, members }) => {
    const cs = Array.from({ length: n }, (_, i) => `C${i}`)
    const lines = ['classDiagram']
    for (const c of cs) {
      if (members.length > 0) {
        lines.push(`  class ${c} {`, ...members.map((m) => `    +${m} x`), '  }')
      } else {
        lines.push(`  class ${c}`)
      }
    }
    for (let i = 1; i < n; i++) lines.push(`  C${i - 1} <|-- C${i}`)
    return lines.join('\n')
  })

const CARD = ['||--o{', '||--|{', '}o--o{', '||--||']
const erArb = fc
  .record({ rels: fc.array(fc.record({ a: word, b: word, c: fc.nat(), label: word }), { minLength: 1, maxLength: 4 }) })
  .map(({ rels }) => {
    const lines = ['erDiagram']
    for (const r of rels) lines.push(`  ${r.a.toUpperCase()} ${CARD[r.c % CARD.length]} ${r.b.toUpperCase()} : ${r.label}`)
    return lines.join('\n')
  })

const pieArb = fc
  .array(fc.record({ label: word, value: fc.integer({ min: 1, max: 100 }) }), { minLength: 1, maxLength: 6 })
  .map((slices) => ['pie title P', ...slices.map((s, i) => `  "${s.label}${i}" : ${s.value}`)].join('\n'))

const xychartArb = fc
  .record({ points: fc.integer({ min: 2, max: 6 }), kind: fc.constantFrom('line', 'bar') })
  .map(({ points, kind }) => {
    const xs = Array.from({ length: points }, (_, i) => `x${i}`)
    const ys = Array.from({ length: points }, (_, i) => (i * 17 + 5) % 100)
    return ['xychart-beta', '  title "T"', `  x-axis [${xs.join(', ')}]`, '  y-axis "y" 0 --> 100', `  ${kind} [${ys.join(', ')}]`].join('\n')
  })

const quadrantArb = fc
  .array(fc.record({ label: word, x: fc.integer({ min: 0, max: 100 }), y: fc.integer({ min: 0, max: 100 }) }), { minLength: 1, maxLength: 6 })
  .map((pts) =>
    ['quadrantChart', '  title Q', '  x-axis Low --> High', '  y-axis Low --> High',
      ...pts.map((p, i) => `  "${p.label}${i}": [${(p.x / 100).toFixed(2)}, ${(p.y / 100).toFixed(2)}]`)].join('\n'),
  )

const timelineArb = fc
  .array(fc.record({ period: word, event: word }), { minLength: 1, maxLength: 6 })
  .map((rows) => ['timeline', '  title T', ...rows.map((r) => `  ${r.period} : ${r.event}`)].join('\n'))

const journeyArb = fc
  .array(fc.record({ task: word, score: fc.integer({ min: 1, max: 5 }) }), { minLength: 1, maxLength: 6 })
  .map((tasks) => ['journey', '  title J', '  section S', ...tasks.map((t, i) => `    ${t.task}${i}: ${t.score}: Me`)].join('\n'))

// ---------------------------------------------------------------------------
// Invariant assertions
// ---------------------------------------------------------------------------

function assertTotalDeterministicNoDiagonals(src: string): string {
  const out = renderMermaidASCII(src, U)
  expect(out.length).toBeGreaterThan(0) // totality
  expect(renderMermaidASCII(src, U)).toBe(out) // determinism
  expect(hasDiagonalLines(out)).toBe(false) // orthogonality / block-only glyphs
  return out
}

const ALL_FAMILIES: Array<[string, fc.Arbitrary<string>]> = [
  ['sequence', sequenceArb],
  ['class', classArb],
  ['er', erArb],
  ['pie', pieArb],
  ['xychart', xychartArb],
  ['quadrant', quadrantArb],
  ['timeline', timelineArb],
  ['journey', journeyArb],
]

const BOX_FAMILIES: Array<[string, fc.Arbitrary<string>]> = [
  ['sequence', sequenceArb],
  ['class', classArb],
  ['er', erArb],
]

// ===========================================================================
// Tier A extended across families
// ===========================================================================

describe('characterisation · families · universal invariants', () => {
  for (const [name, arb] of ALL_FAMILIES) {
    it(`${name}: total, deterministic, no diagonals`, () => {
      fc.assert(
        fc.property(arb, (src) => {
          assertTotalDeterministicNoDiagonals(src)
        }),
        { numRuns: RUNS },
      )
    })
  }

  for (const [name, arb] of BOX_FAMILIES) {
    it(`${name}: rectangular canvas (all rows one width)`, () => {
      fc.assert(
        fc.property(arb, (src) => {
          const out = renderMermaidASCII(src, U)
          expect(new Set(out.split('\n').map((l) => l.length)).size).toBe(1)
        }),
        { numRuns: RUNS },
      )
    })
  }

  // Known boundary (a characterisation, not an aspiration): the chart and list
  // families do NOT produce rectangular canvases. Pinned so a future change to
  // uniform-width padding is a deliberate, visible decision.
  it('known boundary — pie is non-rectangular today', () => {
    const out = renderMermaidASCII('pie title P\n  "Dogs" : 45\n  "Cats" : 35\n  "Birds" : 20', U)
    expect(new Set(out.split('\n').map((l) => l.length)).size).toBeGreaterThan(1)
  })
})
