// ============================================================================
// Cross-family characterisation of the universal invariants.
//
// characterization-layout.test.ts pins the grid + A* flowchart/state engine in
// depth. THIS file extends the *universal* invariants (Tier A) across every
// renderer family and public output surface, asserting only what actually
// holds for each:
//
//   - Dispatch totality: all 12 families render as text, SVG, and PNG.
//   - Label conservation + determinism: all 12 families on text renderers,
//     with PNG byte stability checked on the canonical matrix.
//   - No diagonals: every text family (even xychart plots with block glyphs).
//   - Rectangularity (all rows one width): only the box families
//     (sequence / class / er). Chart and list families emit ragged rows by
//     design — asserting rectangularity there would be false, so we don't.
//
// See docs/layout-characterization/contact-sheet-families.md for the coverage
// matrix and per-family layout strategies. Changes no implementation code.
// ============================================================================

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidSVG } from '../index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
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

const ganttArb = fc
  .array(fc.integer({ min: 1, max: 6 }), { minLength: 1, maxLength: 6 })
  .map((durations) => {
    const lines = [
      'gantt',
      '  title G',
      '  dateFormat YYYY-MM-DD',
      '  axisFormat %m-%d',
      '  excludes weekends',
      '  section Build',
      `    T0 :t0, 2024-01-01, ${durations[0]}d`,
    ]
    for (let i = 1; i < durations.length; i++) {
      lines.push(`    T${i} :t${i}, after t${i - 1}, ${durations[i]}d`)
    }
    return lines.join('\n')
  })

const journeyArb = fc
  .array(fc.record({ task: word, score: fc.integer({ min: 1, max: 5 }) }), { minLength: 1, maxLength: 6 })
  .map((tasks) => ['journey', '  title J', '  section S', ...tasks.map((t, i) => `    ${t.task}${i}: ${t.score}: Me`)].join('\n'))

const architectureArb = fc.constant(
  'architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  db:L -- R:server',
)

const RENDERER_CASES = [
  {
    family: 'flowchart',
    source: 'graph TD\n  Start[Start] --> Done[Done]',
    labels: ['Start', 'Done'],
  },
  {
    family: 'state',
    source: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> [*]',
    labels: ['Idle', 'Running'],
  },
  {
    family: 'sequence',
    source: 'sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hello Bob',
    labels: ['Alice', 'Bob', 'Hello Bob'],
  },
  {
    family: 'class',
    source: 'classDiagram\n  class Animal\n  class Dog\n  Animal <|-- Dog',
    labels: ['Animal', 'Dog'],
  },
  {
    family: 'er',
    source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
    labels: ['CUSTOMER', 'ORDER', 'places'],
  },
  {
    family: 'timeline',
    source: 'timeline\n  title Release Plan\n  2026 : Launch',
    labels: ['Release Plan', '2026', 'Launch'],
  },
  {
    family: 'gantt',
    source: 'gantt\n  title Launch plan\n  dateFormat YYYY-MM-DD\n  axisFormat %b %d\n  excludes weekends\n  section Build\n    Spec :done, spec, 2024-01-01, 2d\n    Implement :active, impl, after spec, 3d\n  section Ship\n    QA :crit, qa, after impl, 2d\n    Launch :milestone, launch, after qa, 0d\n    Release line :vert, release, 2024-01-10, 0d',
    labels: ['Launch plan', 'Build', 'Spec', 'Implement', 'Ship', 'QA', 'Launch', 'Release line'],
  },
  {
    family: 'journey',
    source: 'journey\n  title Checkout\n  section Cart\n  Pay: 5: Shopper',
    labels: ['Checkout', 'Cart', 'Pay', 'Shopper'],
  },
  {
    family: 'xychart',
    source: 'xychart\n  title Sales\n  x-axis [Jan, Feb]\n  y-axis Revenue 0 --> 10\n  bar [3, 7]',
    labels: ['Sales', 'Jan', 'Feb'],
  },
  {
    family: 'pie',
    source: 'pie title Pets\n  "Cats" : 4\n  "Dogs" : 6',
    labels: ['Pets', 'Cats', 'Dogs'],
  },
  {
    family: 'quadrant',
    source:
      'quadrantChart\n  title Priorities\n  x-axis Low --> High\n  y-axis Risk --> Reward\n  quadrant-1 Invest\n  A: [0.7, 0.8]',
    labels: ['Priorities', 'Low', 'High', 'Risk', 'Reward', 'Invest', 'A'],
  },
  {
    family: 'architecture',
    source: 'architecture-beta\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db',
    labels: ['API', 'DB'],
  },
] as const

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

function renderAll(src: string) {
  return {
    ascii: renderMermaidASCII(src, U),
    svg: renderMermaidSVG(src, { security: 'strict' }),
    png: renderMermaidPNG(src, { scale: 1 }),
  }
}

function assertPngSignature(bytes: Uint8Array) {
  expect(bytes.length).toBeGreaterThan(8)
  expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

const ALL_FAMILIES: Array<[string, fc.Arbitrary<string>]> = [
  ['sequence', sequenceArb],
  ['class', classArb],
  ['er', erArb],
  ['pie', pieArb],
  ['xychart', xychartArb],
  ['quadrant', quadrantArb],
  ['timeline', timelineArb],
  ['gantt', ganttArb],
  ['journey', journeyArb],
  ['architecture', architectureArb],
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
  it('all 12 families render through ASCII, SVG, and PNG surfaces', () => {
    for (const { source } of RENDERER_CASES) {
      const { ascii, svg, png } = renderAll(source)
      expect(ascii.length).toBeGreaterThan(0)
      expect(svg).toContain('<svg')
      expect(svg).toContain('</svg>')
      assertPngSignature(png)
    }
  })

  it('all 12 families preserve sentinel labels on text renderers', () => {
    for (const { source, labels } of RENDERER_CASES) {
      const { ascii, svg } = renderAll(source)
      for (const label of labels) {
        expect(ascii).toContain(label)
        expect(svg).toContain(label)
      }
    }
  })

  it('all 12 families are byte-stable across repeated renders', () => {
    for (const { source } of RENDERER_CASES) {
      const first = renderAll(source)
      const second = renderAll(source)
      expect(second.ascii).toBe(first.ascii)
      expect(second.svg).toBe(first.svg)
      expect(second.png).toEqual(first.png)
    }
  })

  it('all 12 families emit clean SVG and plain ASCII', () => {
    for (const { source } of RENDERER_CASES) {
      const { ascii, svg } = renderAll(source)
      expect(ascii).not.toMatch(/\x1b\[[0-9;]*m/)
      expect(ascii).not.toMatch(/\b(?:NaN|Infinity|undefined)\b/)
      expect(svg).not.toMatch(/="[^"]*\b(?:NaN|Infinity|undefined)\b[^"]*"/)
    }
  })

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
