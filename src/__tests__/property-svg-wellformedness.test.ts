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
// `&`, `<`, `>`, `'`, an already-escaped entity, and non-ASCII. Bare `<` and
// `>` join neighbouring pieces into tag-like text (`a<c>d`), and the tag
// pieces add formatting tags, unknown tags and line breaks; which of them a
// family draws as styling or as text must not decide whether it renders.
// A `#` can start a comment (Sequence), leaving an empty label.
const LABEL_PIECES = ['a', 'Zed', '&', ' < ', ' > ', '<', '>', "'", 'ü', '😀', '&amp;', '&lt;', '42', 'c', '<b>', '</b>', '<c>', '<br/>', '#']

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
  // Mermaid reads architecture titles other than words and spaces only quoted.
  ['architecture', label => `architecture-beta\n  service api(server)["${label}"]`],
  ['xychart', label => `xychart\n  title "${label}"\n  x-axis ["${label}", "b"]\n  bar [1, 2]`],
]

// Known product bug (found by this generator, reported with the BUG-41 fix):
// Journey rejects a title, section or task that is only a line break
// ("Invalid user journey line"), where upstream draws the text `<br/>`. The
// Journey property skips that one label shape; the pin below fails until the
// parser accepts it.
const onlyLineBreaks = (label: string): boolean => label.replace(/<br\/>/g, '').trim() === ''

describe('SVG is well-formed XML for labels full of XML metacharacters', () => {
  it.each(FAMILY_SOURCES)('%s', (family, sourceFor) => {
    fc.assert(
      fc.property(labelArb, label => {
        fc.pre(family !== 'journey' || !onlyLineBreaks(label))
        const source = sourceFor(label)
        expectWellFormedXml(renderMermaidSVG(source), source)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('flowchart: a label with an unknown inline tag renders well-formed XML', () => {
    const source = 'graph TD\n  A[a<c>d] --> B'
    expectWellFormedXml(renderMermaidSVG(source), source)
  })

  it.failing('journey: a label that is only a line break renders well-formed XML', () => {
    const source = 'journey\n  title t\n  section <br/>\n  task: 5: me'
    expectWellFormedXml(renderMermaidSVG(source), source)
  })
})
