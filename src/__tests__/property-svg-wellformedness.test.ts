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
import { layoutMermaidWithReceipt, renderMermaidPNG } from '../agent/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { FAMILY_ID_SOURCES, FAMILY_LABEL_SOURCES, hostileTextArb } from './helpers/family-text-sources.ts'
import { expectWellFormedXml, svgXmlReady } from './helpers/svg-xml.ts'

const PROPERTY_RUNS = 100

// Label pieces that exercise XML escaping without tripping Mermaid syntax:
// `&`, `<`, `>`, `'`, an already-escaped entity, and non-ASCII. Bare `<` and
// `>` join neighbouring pieces into tag-like text (`a<c>d`), and the tag
// pieces add formatting tags, unknown tags and line breaks; which of them a
// family draws as styling or as text must not decide whether it renders.
// A `#` can start a comment (Sequence), leaving an empty label.
const LABEL_PIECES = ['a', 'Zed', '&', ' < ', ' > ', '<', '>', "'", 'ü', '😀', '👩‍💻', 'é', 'שלום', 'مرحبا', '東京', '&amp;', '&lt;', '42', 'c', '<b>', '</b>', '<c>', '<br/>', '#', ']]>', '</text><script>inert</script>']

// Every Unicode scalar, including controls, noncharacters (U+FFFE/U+FFFF are
// not XML characters) and bidi controls, plus lone surrogate code units — not
// fast-check's default ASCII-only strings. Line terminators would end the
// family statement, so they are left to the verdict property below. Family
// grammar delimiters are exercised by LABEL_PIECES separately.
const LINE_TERMINATORS = new Set([0x0a, 0x0d, 0x2028, 0x2029])
const unicodeArb = fc.oneof(
  fc.integer({ min: 0, max: 0x10ffff }).filter(code => !LINE_TERMINATORS.has(code)).map(code => String.fromCodePoint(code)),
  fc.integer({ min: 0xd800, max: 0xdfff }).map(code => String.fromCharCode(code)),
)
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

const FAMILY_SOURCES = FAMILY_LABEL_SOURCES

/** Refusals that are our own faults, not a named reason about the source. */
const INTERNAL_REFUSAL = /invalid SVG document envelope|Scene validation failed/

type SurfaceOutcome = { ok: true } | { ok: false; message: string }
function outcome(render: () => unknown): SurfaceOutcome {
  try {
    render()
    return { ok: true }
  } catch (error) {
    // Adapters name the family whose hook refused; the reason is the same.
    return { ok: false, message: (error instanceof Error ? error.message : String(error)).replace(/^Mermaid family "[^"]+" layout hook failed: /, '') }
  }
}

beforeAll(svgXmlReady)

describe('SVG is well-formed XML for labels full of XML metacharacters', () => {
  it.each(BUILTIN_FAMILY_METADATA.map(({ id }) => [id] as const))('%s', family => {
    const result = fc.check(
      fc.property(labelArb, optionsArb, (label, options) => {
        const [header, ...body] = FAMILY_SOURCES[family](label).split('\n')
        const source = [header, `accTitle: ${label}`, `accDescr: ${label}`, ...body].join('\n')
        // A family may refuse a character by name; it may not emit markup its
        // own output policy then rejects, or fail Scene validation.
        let svg = ''
        const rendered = outcome(() => { svg = renderMermaidSVG(source, options) })
        if (rendered.ok) expectWellFormedXml(svg, source)
        else expect({ source, refusal: INTERNAL_REFUSAL.test(rendered.message) ? rendered.message : undefined }).toEqual({ source, refusal: undefined })
      }),
      fcParameters({
        numRuns: PROPERTY_RUNS,
        includeErrorInReport: true,
        examples: [
          ...(family === 'pie' ? [['label \u2028a', { compact: false, transparent: false, style: 'crisp', seed: 0, embedFontImport: false }] as [string, typeof optionsArb extends fc.Arbitrary<infer T> ? T : never]] : []),
          ['label <br/>', { compact: false, transparent: false, style: 'hand-drawn', seed: 0, embedFontImport: false }],
          // Reduced finder counterexamples: a noncharacter and a lone
          // surrogate reached SVG markup in every family.
          ['label \ufffe', { compact: false, transparent: false, style: 'crisp', seed: 0, embedFontImport: false }],
          ['label \ud800', { compact: false, transparent: false, style: 'crisp', seed: 0, embedFontImport: false }],
        ],
      }),
    )
    // Keep fast-check's shrunk replay details while exposing an assertion to
    // Bun's JUnit report, which the base-branch red-green gate requires.
    assert.equal(result.failed, false, fc.defaultReportMessage(result))
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

// CLAUDE.md rule 5: our own surfaces may not disagree. For any label or id
// text — every code point, entity, noncharacter, lone surrogate, bidi control,
// very long or empty — SVG, PNG, ASCII, Unicode and layout JSON either all
// draw the diagram or all refuse it for the same named reason. Text one output
// cannot carry is drawn as the same inert characters by all of them.
describe('every output gives one verdict for hostile label and id text', () => {
  it.each(BUILTIN_FAMILY_METADATA.map(({ id }) => [id] as const))('%s', family => {
    const idSource = FAMILY_ID_SOURCES[family]
    const sourceArb = idSource
      ? fc.oneof(hostileTextArb.map(FAMILY_LABEL_SOURCES[family]), hostileTextArb.map(idSource))
      : hostileTextArb.map(FAMILY_LABEL_SOURCES[family])
    const result = fc.check(
      fc.property(sourceArb, source => {
        const outcomes = {
          svg: outcome(() => renderMermaidSVG(source)),
          // The raster pixel budget is PNG's own documented size knob, not
          // text admission; fitting the width keeps very long labels in it.
          png: outcome(() => renderMermaidPNG(source, { fitTo: { width: 800 } })),
          ascii: outcome(() => renderMermaidASCII(source, { useAscii: true })),
          unicode: outcome(() => renderMermaidASCII(source, { useAscii: false })),
          layout: outcome(() => layoutMermaidWithReceipt(source)),
        }
        const verdicts = new Set(Object.values(outcomes).map(item => item.ok ? 'drawn' : `refused: ${item.message}`))
        expect({ source, verdicts: verdicts.size, outcomes }).toEqual({ source, verdicts: 1, outcomes })
      }),
      fcParameters({
        numRuns: 30,
        includeErrorInReport: true,
        examples: [
          // Reduced finder counterexamples (K4, V3, V8): noncharacters as
          // entities and raw text, a lone surrogate, labels past 256
          // characters and an empty label each split SVG/PNG from ASCII.
          [FAMILY_LABEL_SOURCES[family]('x#65534;y')],
          [FAMILY_LABEL_SOURCES[family]('a\ufffeb')],
          [FAMILY_LABEL_SOURCES[family]('a\ud800b')],
          [FAMILY_LABEL_SOURCES[family]('x'.repeat(300))],
          [FAMILY_LABEL_SOURCES[family]('')],
          // ...and an empty id (gitGraph `id:""`, a blank block line whose
          // terminal parse reported a different line).
          ...(idSource ? [[idSource('n'.repeat(300))] as [string], [idSource('')] as [string]] : []),
        ],
      }),
    )
    assert.equal(result.failed, false, fc.defaultReportMessage(result))
  })
})
