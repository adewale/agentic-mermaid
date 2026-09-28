// Source-text metamorphic relations (docs/testing-strategy.md §4) for every
// renderable family, generated from the shared METAMORPHIC_FAMILIES builders.
// Colour relations live in property-invariance-colour.test.ts.
//
//   MR6 Comment/blank-line insertion — full-line `%%` comments and blank lines
//       between statements do not change a byte of the SVG. Insertions the
//       pinned upstream grammar refuses are excluded, each with its reason.
//   MR7 Chain equivalence (flowchart) — `A --> B --> C` says exactly what
//       `A --> B` plus `B --> C` says, down to identical geometry.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { asFlowchart, describeMermaidFacts, layoutMermaid, parseRegisteredMermaid as parseMermaid, renderMermaidSVG } from '../agent/index.ts'
import type { DiagramKind, ParsedDiagram } from '../agent/types.ts'
import { type FamilyMetamorphic, METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { startUpstreamMermaid, type UpstreamMermaid } from './helpers/upstream-mermaid.ts'

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

// Insertions the relation cannot claim, each excluded by construction with its
// reason. Every rule carries a witness family and a proof the last test in
// this block re-runs: `upstream-rejects` (the pinned Mermaid 11.16.0 grammar
// refuses the witness) or `not-a-comment` (the line is live syntax, so our
// render changes). An exclusion that stops being true fails loudly instead of
// rotting.
const COMMENT_GRAMMAR_EXCLUSIONS: Array<{
  family: DiagramKind | 'all'
  witness: DiagramKind
  example: Insertion
  proof: 'upstream-rejects' | 'not-a-comment'
  excludes: (insertion: Insertion) => boolean
  reason: string
}> = [
  {
    family: 'all',
    witness: 'er',
    example: { at: 1, line: '%%' },
    proof: 'upstream-rejects',
    excludes: ({ line }) => /^\s*%%$/.test(line),
    reason: 'a bare `%%` is not a comment: upstream strips only /^\\s*%%(?!{)[^\\n]+/, so it reaches (and breaks) the family grammar, e.g. erDiagram',
  },
  {
    family: 'all',
    witness: 'flowchart',
    example: { at: 0, line: '%%{init: {"theme": "dark"}}%%' },
    proof: 'not-a-comment',
    excludes: ({ line }) => /^\s*%%\{/.test(line),
    reason: '`%%{` opens a directive, not a comment',
  },
  {
    family: 'mindmap',
    witness: 'mindmap',
    example: { at: 1, line: '' },
    proof: 'upstream-rejects',
    excludes: ({ at, line }) => at === 1 && line.trim() === '',
    reason: 'Mermaid 11.16 mindmap rejects a blank line between the `mindmap` header and the root node',
  },
  {
    family: 'sankey',
    witness: 'sankey',
    example: { at: 2, line: '   ' },
    proof: 'upstream-rejects',
    excludes: ({ at, line }) => at > 0 && line !== '' && line.trim() === '',
    reason: 'the sankey CSV grammar rejects a whitespace-only line (an empty line is fine)',
  },
]

function excluded(family: DiagramKind, insertion: Insertion): boolean {
  return COMMENT_GRAMMAR_EXCLUSIONS.some(rule => (rule.family === 'all' || rule.family === family) && rule.excludes(insertion))
}

const commentTextArb = fc
  .array(fc.constantFrom(...'abcXYZ019 :;-->|[](){}"#,.'.split('')), { minLength: 1, maxLength: 16 })
  .map(chars => chars.join(''))
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
  return fc
    .array(fc.record({ at: fc.nat({ max: lineCount }), line: insertedLineArb }), { minLength: 1, maxLength: 4 })
    .filter(insertions => insertions.every(insertion => !excluded(family, insertion)))
}

describe('MR6 comment and blank-line insertion leaves the SVG byte-identical', () => {
  for (const fam of FAMILIES) {
    test(`${fam.family}: %% comments and blank lines between statements are inert`, () => {
      fc.assert(
        fc.property(
          kArb(fam).chain(k => fc.tuple(fc.constant(k), tagArb, insertionsArb(fam.family, fam.build(k, 'q').split('\n').length))),
          ([k, tag, insertions]) => {
            const source = fam.build(k, tag)
            expect(renderMermaidSVG(insertLines(source, insertions))).toBe(renderMermaidSVG(source))
          },
        ),
        { numRuns: 25 },
      )
    })
  }

  describe('upstream grammar evidence for the insertion space', () => {
    let upstream: UpstreamMermaid
    beforeAll(() => {
      upstream = startUpstreamMermaid()
    })
    afterAll(() => upstream.close())

    test('pinned Mermaid accepts sampled insertions for every family', async () => {
      const rejected: string[] = []
      for (const fam of FAMILIES) {
        const source = fam.build(fam.kRange[1], 'q0')
        for (const insertions of fc.sample(insertionsArb(fam.family, source.split('\n').length), 8)) {
          const parsed = await upstream.parse(insertLines(source, insertions))
          if (!parsed.ok) rejected.push(`${fam.family}: ${JSON.stringify(insertions)} — ${parsed.error}`)
        }
      }
      expect(rejected).toEqual([])
    }, 20_000)

    test('every exclusion is still needed (its witness is rejected or live syntax)', async () => {
      const stale: string[] = []
      for (const rule of COMMENT_GRAMMAR_EXCLUSIONS) {
        const fam = METAMORPHIC_FAMILIES[rule.witness]
        const source = fam.build(fam.kRange[1], 'q0')
        const mutated = insertLines(source, [rule.example])
        expect(excluded(rule.witness, rule.example)).toBe(true)
        const stillTrue = rule.proof === 'upstream-rejects'
          ? !(await upstream.parse(mutated)).ok
          : renderMermaidSVG(mutated) !== renderMermaidSVG(source)
        if (!stillTrue) stale.push(`${rule.witness}: ${rule.reason}`)
      }
      expect(stale).toEqual([])
    }, 20_000)
  })
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
        fc.integer({ min: 2, max: 5 }).chain(edges =>
          fc.tuple(tagArb, fc.array(edgeArb, { minLength: edges, maxLength: edges }), fc.array(shapeArb, { minLength: edges + 1, maxLength: edges + 1 })),
        ),
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
      { numRuns: 30 },
    )
  })
})
