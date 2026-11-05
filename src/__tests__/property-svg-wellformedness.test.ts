// SVG output must be well-formed XML even when labels are full of XML
// metacharacters. The oracle is a real XML parser: resvg (usvg on roxmltree)
// refuses an unescaped `&` or `<`, a broken attribute, or misnested tags, so a
// label that leaks unescaped into the markup fails here. The finite-number and
// `undefined` checks are the same leak guards property-all-families-fuzz runs
// with plain labels; this file's job is escaping.
import { beforeAll, describe, expect, it } from 'bun:test'
import { strict as assert } from 'node:assert'
import fc from 'fast-check'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import type { DiagramKind } from '../agent/types.ts'
import { renderMermaidSVG } from '../index.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { expectWellFormedXml, svgXmlReady } from './helpers/svg-xml.ts'

const PROPERTY_RUNS = 100

// Label pieces that exercise XML escaping without tripping Mermaid syntax:
// `&`, `<`, `>`, `'`, an already-escaped entity, and non-ASCII. Bare `<` and
// `>` join neighbouring pieces into tag-like text (`a<c>d`), and the tag
// pieces add formatting tags, unknown tags and line breaks; which of them a
// family draws as styling or as text must not decide whether it renders.
// A `#` can start a comment (Sequence), leaving an empty label.
const LABEL_PIECES = ['a', 'Zed', '&', ' < ', ' > ', '<', '>', "'", 'ü', '😀', '👩‍💻', 'é', 'שלום', 'مرحبا', '東京', '&amp;', '&lt;', '42', 'c', '<b>', '</b>', '<c>', '<br/>', '#', ']]>', '</text><script>inert</script>']

// Construct XML-valid non-ASCII scalars, not fast-check's default ASCII-only
// strings. Line separators cannot be inserted into unquoted family statements.
// Family grammar delimiters are exercised by LABEL_PIECES separately.
const unicodeArb = fc.oneof(fc.integer({ min: 0xa0, max: 0xd7ff }), fc.integer({ min: 0xe000, max: 0xfffd }), fc.integer({ min: 0x10000, max: 0x10ffff })).filter(code => code !== 0x2028 && code !== 0x2029).map(code => String.fromCodePoint(code))
const labelArb = fc
  .array(fc.oneof(fc.constantFrom(...LABEL_PIECES), unicodeArb), { maxLength: 6 })
  // Every family's label context requires some content. Keep empty generated
  // suffixes instead of discarding them (and losing their shrinking path).
  .map(pieces => `label ${pieces.join('')}`.trimEnd())
const optionsArb = fc.record({
  compact: fc.boolean(),
  transparent: fc.boolean(),
  style: fc.constantFrom('crisp', 'hand-drawn', 'dracula'),
  seed: fc.integer(),
  embedFontImport: fc.constant(false),
})

const FAMILY_SOURCES: Record<DiagramKind, (label: string) => string> = {
  zenuml: label => `zenuml\nA->B: ${label.replace(/[\r\n]/g, ' ')}`,
  eventmodeling: label => `eventmodeling\ntf 01 ui CartUI {${label.replace(/[\r\n]/g, ' ')}}`,
  packet: label => `packet\n+16: ${JSON.stringify(label)}`,
  kanban: label => `kanban\nTodo\n  task["${label}"]`,
  requirement: label => `requirementDiagram\nrequirement r {\ntext: "${label}"\n}`,
  treemap: label => `treemap\n"${label}": 10`,
  ishikawa: label => `ishikawa\n  ${label}\n  Process\n    Cause`,
  block: label => `block\nA["${label}"]`,
  c4: label => `C4Context\n  System(A, "${label}", "${label}")`,
  flowchart: label => `graph TD\n  A["${label}"] -->|${label}| B["${label}"]`,
  state: label => `stateDiagram-v2\n  state "${label}" as A\n  A --> B : ${label}`,
  sequence: label => `sequenceDiagram\n  participant A as ${label}\n  A->>B: ${label}\n  B-->>A: ${label}`,
  class: label => `classDiagram\n  class A {\n    +f(${label}) int\n  }\n  A <|-- B : ${label}`,
  er: label => `erDiagram\n  CUSTOMER ||--o{ ORDER : "${label}"`,
  timeline: label => `timeline\n  title ${label}\n  2024 : ${label}`,
  journey: label => `journey\n  title ${label}\n  section ${label}\n  ${label}: 5: me`,
  // Mermaid reads architecture titles other than words and spaces only quoted.
  architecture: label => `architecture-beta\n  service api(server)["${label}"]`,
  xychart: label => `xychart\n  title "${label}"\n  x-axis ["${label}", "b"]\n  bar [1, 2]`,
  pie: label => `pie\n  "${label}" : 1`,
  quadrant: label => `quadrantChart\n  title ${label}\n  ${label}: [0.3, 0.7]`,
  gantt: label => `gantt\n  dateFormat YYYY-MM-DD\n  section ${label}\n  ${label} :a, 2026-01-01, 1d`,
  // A Mindmap shape ends at its first `]` outside quotes (`]]>`).
  mindmap: label => `mindmap\n  root["${label}"]\n    child["${label}"]`,
  gitgraph: label => `gitGraph\n  commit id:"a" msg:"${label}"`,
  radar: label => `radar-beta\n  axis a["${label}"], b, c\n  curve now["${label}"]{1,2,3}\n  max 5`,
  sankey: label => `sankey-beta\n  "${label}",sink,1`,
}

beforeAll(svgXmlReady)

describe('SVG is well-formed XML for labels full of XML metacharacters', () => {
  it.each(BUILTIN_FAMILY_METADATA.map(({ id }) => [id] as const))('%s', family => {
    const result = fc.check(
      fc.property(labelArb, optionsArb, (label, options) => {
        const [header, ...body] = FAMILY_SOURCES[family](label).split('\n')
        const source = [header, `accTitle: ${label}`, `accDescr: ${label}`, ...body].join('\n')
        expectWellFormedXml(renderMermaidSVG(source, options), source)
      }),
      fcParameters({
        numRuns: PROPERTY_RUNS,
        includeErrorInReport: true,
        examples: family === 'pie'
          ? [['label \u2028a', { compact: false, transparent: false, style: 'crisp', seed: 0, embedFontImport: false }],
            ['label <br/>', { compact: false, transparent: false, style: 'hand-drawn', seed: 0, embedFontImport: false }]]
          : [['label <br/>', { compact: false, transparent: false, style: 'hand-drawn', seed: 0, embedFontImport: false }]],
      }),
    )
    // Keep fast-check's shrunk replay details while exposing an assertion to
    // Bun's JUnit report, which the optional base-production diagnostic reads.
    assert.equal(result.failed, false, fc.defaultReportMessage(result))
  })

  it('refuses entities that would introduce terminal controls or non-XML scalars', () => {
    const forbiddenCodePoint = fc.oneof(fc.integer({ min: 1, max: 31 }), fc.constantFrom(0xfffe, 0xffff))
    fc.assert(
      fc.property(forbiddenCodePoint, code => {
        const source = `flowchart TD\n  A["#${code};"]`
        expect(() => renderMermaidSVG(source)).toThrow(/terminal control|invalid SVG document envelope/)
      }),
      fcParameters({ numRuns: 1000 }),
    )
  })

  it('flowchart: a label with an unknown inline tag renders well-formed XML', () => {
    const source = 'graph TD\n  A[a<c>d] --> B'
    expectWellFormedXml(renderMermaidSVG(source), source)
  })

  it('journey: a label that is only a line break renders well-formed XML', () => {
    const source = 'journey\n  title t\n  section <br/>\n  task: 5: me'
    expectWellFormedXml(renderMermaidSVG(source), source)
  })
})
