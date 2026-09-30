// SVG output must be well-formed XML even when labels are full of XML
// metacharacters. The oracle is a real XML parser: resvg (usvg on roxmltree)
// refuses an unescaped `&` or `<`, a broken attribute, or misnested tags, so a
// label that leaks unescaped into the markup fails here. The finite-number and
// `undefined` checks are the same leak guards property-all-families-fuzz runs
// with plain labels; this file's job is escaping.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { Resvg } from '@resvg/resvg-js'

import { renderMermaidSVG } from '../index.ts'

const PROPERTY_RUNS = 100

// Label pieces that exercise XML escaping without tripping Mermaid syntax:
// `&`, `<`, `>`, `'`, an already-escaped entity, and non-ASCII. `<`/`>` stay
// space-separated so they never form a tag-like `<word>` (see the pinned
// BUG below), and `#` is left out because Sequence reads `#…#` as an entity
// boundary (a diagnosed limitation, not an escaping question).
const LABEL_PIECES = ['a', 'Zed', '&', ' < ', ' > ', "'", 'ü', '😀', '&amp;', '&lt;', '42']

const labelArb = fc
  .array(fc.constantFrom(...LABEL_PIECES), { minLength: 1, maxLength: 6 })
  .map(pieces => pieces.join('').trim())
  .filter(label => label.length > 0)

/** Parse the SVG as XML and fail with the parser's reason and the source. */
function expectWellFormedXml(svg: string, source: string): void {
  let parseError: string | undefined
  try {
    new Resvg(svg, { font: { loadSystemFonts: false } })
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }
  expect({ source, parseError }).toEqual({ source, parseError: undefined })
  expect(svg).not.toMatch(/="[^"]*\b(?:NaN|Infinity|undefined)\b[^"]*"/)
}

const FAMILY_SOURCES: ReadonlyArray<readonly [string, (label: string) => string]> = [
  ['flowchart', label => `graph TD\n  A[${label}] -->|${label}| B[${label}]`],
  ['sequence', label => `sequenceDiagram\n  A->>B: ${label}\n  B-->>A: ${label}`],
  ['class', label => `classDiagram\n  class A {\n    +f(${label}) int\n  }\n  A <|-- B : ${label}`],
  ['er', label => `erDiagram\n  CUSTOMER ||--o{ ORDER : "${label}"`],
  ['timeline', label => `timeline\n  title ${label}\n  2024 : ${label}`],
  ['journey', label => `journey\n  title ${label}\n  section ${label}\n  ${label}: 5: me`],
  ['architecture', label => `architecture-beta\n  service api(server)[${label}]`],
  ['xychart', label => `xychart\n  title "${label}"\n  x-axis ["${label}", "b"]\n  bar [1, 2]`],
]

describe('SVG is well-formed XML for labels full of XML metacharacters', () => {
  it.each(FAMILY_SOURCES)('%s', (_family, sourceFor) => {
    fc.assert(
      fc.property(labelArb, label => {
        const source = sourceFor(label)
        expectWellFormedXml(renderMermaidSVG(source), source)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  // Known product bug BUG-41 (TODO.md): an unknown inline tag between
  // label text (`a<c>d`, `x<y>z`) makes SVG rendering throw "Scene validation
  // failed: text … not found in crisp" (CLI: RENDER_FAILED) instead of
  // rendering; ASCII renders it literally. When fixed, this starts passing:
  // drop `.failing` and let the generator emit tag-like sequences.
  it.failing('flowchart: a label with an unknown inline tag renders well-formed XML', () => {
    const source = 'graph TD\n  A[a<c>d] --> B'
    expectWellFormedXml(renderMermaidSVG(source), source)
  })
})
