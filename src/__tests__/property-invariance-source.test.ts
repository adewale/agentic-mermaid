// Source-text metamorphic relations (docs/testing-strategy.md §4) for every
// renderable family, generated from the shared METAMORPHIC_FAMILIES builders.
// Colour relations live in property-invariance-colour.test.ts.
//
//   MR6 Comment/blank-line insertion — full-line `%%` comments and blank lines
//       between statements do not change the drawing. Physical source lines
//       and the whole-output style-scope hash may change. Directives are live syntax, so they are excluded.
//   MR7 Chain equivalence (flowchart) — `A --> B --> C` says exactly what
//       `A --> B` plus `B --> C` says, down to identical geometry.

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { asFlowchart, describeMermaidFacts, layoutMermaid, parseRegisteredMermaid as parseMermaid, renderMermaidSVG } from '../agent/index.ts'
import type { DiagramKind, ParsedDiagram } from '../agent/types.ts'
import { type FamilyMetamorphic, METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'

const FAMILIES = Object.values(METAMORPHIC_FAMILIES)
const tagArb = fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`)
const kArb = (fam: FamilyMetamorphic) => fc.integer({ min: fam.kRange[0], max: fam.kRange[1] })

function parse(source: string): ParsedDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(`generated source failed to parse:\n${source}`)
  return parsed.value
}

// ---------------------------------------------------------------------------
// MR6 — comment and blank-line insertion
// ---------------------------------------------------------------------------

/** A line inserted before original line `at` (0 = before the header). */
type Insertion = { at: number; line: string }

// Directives are live syntax; ordinary full-line comments and blank lines
// are inert in our reader even where upstream's family lexer rejects them.
function excluded(_family: DiagramKind, { line }: Insertion): boolean {
  return /^\s*%%\{/.test(line)
}

const commentTextArb = fc.array(fc.constantFrom(...'abcXYZ019 :;-->|[](){}"#,.'.split('')), { minLength: 1, maxLength: 16 }).map(chars => chars.join(''))
const indentArb = fc.constantFrom('', '  ', '    ', '\t', '      ')
const insertedLineArb = fc.oneof(
  fc.tuple(indentArb, commentTextArb).map(([indent, text]) => `${indent}%%${text}`),
  fc.constantFrom('', '  ', '\t'),
)

/** Apply insertions in original-line coordinates (highest `at` first, so none shifts another). */
function insertLines(source: string, insertions: readonly Insertion[]): string {
  const lines = source.split('\n')
  for (const { at, line } of [...insertions].sort((a, b) => b.at - a.at)) lines.splice(at, 0, line)
  return lines.join('\n')
}

/** Insertions at any line boundary (before the header included), minus the grammar exclusions. */
function insertionsArb(family: DiagramKind, lineCount: number): fc.Arbitrary<Insertion[]> {
  return fc.array(fc.record({ at: fc.nat({ max: lineCount }), line: insertedLineArb }), { minLength: 1, maxLength: 4 }).filter(insertions => insertions.every(insertion => !excluded(family, insertion)))
}

describe('MR6 comment and blank-line insertion preserves the SVG drawing', () => {
  for (const fam of FAMILIES) {
    test(`${fam.family}: %% comments and blank lines between statements are inert`, () => {
      fc.assert(
        fc.property(
          kArb(fam).chain(k => fc.tuple(fc.constant(k), tagArb, insertionsArb(fam.family, fam.build(k, 'q').split('\n').length))),
          ([k, tag, insertions]) => {
            const source = fam.build(k, tag)
            // Source provenance follows physical authored lines; it is not
            // painted geometry. Keep every other attribute, text and paint.
            const drawing = (svg: string) => normalizeSvg(svg.replace(/\sdata-source-line="\d+"/g, ''), { maskStyleScope: true })
            expect(drawing(renderMermaidSVG(insertLines(source, insertions)))).toBe(drawing(renderMermaidSVG(source)))
          },
        ),
        fcParameters({ numRuns: 25 }),
      )
    })
  }

})

// ---------------------------------------------------------------------------
// MR7 — flowchart chain equivalence
// ---------------------------------------------------------------------------

describe('MR7 flowchart: a chained edge equals its pairwise split', () => {
  const edgeArb = fc.constantFrom('-->', '---', '-.->', '==>', '-- via -->', '-->|via|')
  const shapeArb = fc.constantFrom('', '[box]', '(round)', '{choice}', '((dot))')

  test('A --> B --> C … says exactly what A --> B, B --> C … says', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }).chain(edges => fc.tuple(tagArb, fc.array(edgeArb, { minLength: edges, maxLength: edges }), fc.array(shapeArb, { minLength: edges + 1, maxLength: edges + 1 }))),
        fc.constantFrom('TD', 'LR'),
        ([tag, edges, shapes], direction) => {
          const node = (i: number) => `${tag}${i}${shapes[i]}`
          const chained = `flowchart ${direction}\n  ${node(0)}${edges.map((edge, i) => ` ${edge} ${node(i + 1)}`).join('')}`
          // The split form re-references each interior node by bare id so no shape is declared twice.
          const split = `flowchart ${direction}\n${edges.map((edge, i) => `  ${i === 0 ? node(0) : `${tag}${i}`} ${edge} ${node(i + 1)}`).join('\n')}`
          const a = parse(chained)
          const b = parse(split)
          expect(asFlowchart(a)?.body.graph.edges.length).toBe(edges.length)
          expect(describeMermaidFacts(a)).toEqual(describeMermaidFacts(b))
          // Geometry is a function of the graph, not of how statements spelled it.
          expect(layoutMermaid(a)).toEqual(layoutMermaid(b))
          expect(renderMermaidSVG(chained)).toBe(renderMermaidSVG(split))
        },
      ),
      fcParameters({ numRuns: 30 }),
    )
  })
})
