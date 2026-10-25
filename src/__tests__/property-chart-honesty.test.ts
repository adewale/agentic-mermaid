// Chart honesty for generated diagrams (docs/design/system/chart-honesty.md):
// every family, built at random sizes by its metamorphic generator and given a
// random frontmatter title, draws that title and all of its text legibly and on
// the canvas, in a random style. The corpus tests (chart-honesty-text-*.test.ts)
// hold fixed sources to every style; this varies the structure and the title.
import { beforeAll, describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { decodeXML } from 'entities'
import { renderMermaidSVG } from '../index.ts'
import { MindmapParseError } from '../mindmap/parser.ts'

import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeViolations, HONESTY_STYLES, textHonestyViolations } from './helpers/chart-honesty.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { renderedTextReady } from './helpers/rendered-text.ts'

beforeAll(() => renderedTextReady())

const WORDS = ['Quarterly', 'revenue', 'by', 'region', 'and', 'channel', 'for', 'the', 'North', 'American', 'market', 'forecast'] as const
const sentenceArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 14 }).map(words => words.join(' '))
const titleArb = fc.oneof(
  sentenceArb,
  fc.array(sentenceArb, { minLength: 2, maxLength: 5 }).map(lines => lines.join('\n')),
  fc.constantFrom('W'.repeat(70), '漢字ひらがな É 👩🏽‍💻', 'First line\n\nThird line'),
)

/** The generator's source without its own title statement, which would
 * (as in Mermaid) override the frontmatter title. */
function untitled(source: string): string {
  return source.replace(/^pie title .*$/m, 'pie').replace(/^\s*title\b.*\n?/gm, '')
}

describe('chart honesty: generated diagrams with random titles', () => {
  for (const { id: kind } of BUILTIN_FAMILY_METADATA) {
    const family = METAMORPHIC_FAMILIES[kind]
    it(`${kind} draws its title and text legibly on the canvas`, () => {
      fc.assert(
        fc.property(fc.integer({ min: family.kRange[0], max: family.kRange[1] }), titleArb, fc.constantFrom(...HONESTY_STYLES), (k, title, style) => {
          const sample = { name: `k=${k}`, source: `---\ntitle: ${JSON.stringify(title)}\n---\n${untitled(family.build(k, 'n'))}`, expectText: [title] }
          expect(describeViolations(kind, sample, textHonestyViolations(sample, [style]))).toEqual([])
        }),
        fcParameters({
          numRuns: fc.readConfigureGlobal().numRuns ?? 6,
          // Nightly finder #362: the one-line title exceeded the fixed canvas.
          examples: kind === 'xychart' ? [[1, 'Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly', undefined]] : kind === 'sequence' ? [[3, 'revenue and Quarterly market region Quarterly region', undefined]] : kind === 'treemap' ? [[2, 'W'.repeat(70), 'accessible-high-contrast']] : [],
        }),
      )
    }, 120_000)

    it(`${kind} draws its title over an empty body, unless it refuses the body`, () => {
      const source = `---\ntitle: Empty body\n---\n${untitled(family.build(family.kRange[0], 'n')).split('\n')[0]}`
      let svg: string
      try {
        svg = renderMermaidSVG(source)
      } catch (error) {
        if (kind === 'mindmap') {
          expect(error).toBeInstanceOf(MindmapParseError)
          expect((error as Error).message).toContain('Mindmap requires exactly one root node')
        } else if (kind === 'sankey') {
          expect(error?.constructor).toBe(Error)
          expect((error as Error).message).toBe('Sankey diagram must include at least one source,target,value row')
        } else if (kind === 'block') {
          expect(error).toMatchObject({ name: 'Error', message: expect.stringMatching(/^block parse error at line 2, column 1: Expecting .+, got 'EOF'$/) })
        } else {
          throw error
        }
        return
      }
      const drawn = [...svg.matchAll(/<text\b[^>]*\bdata-role="title"[^>]*>([\s\S]*?)<\/text>/g)]
        .map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, ''))).join(' ')
      const [, , width, height] = (/viewBox="([^"]*)"/.exec(svg)?.[1] ?? '').split(' ').map(Number)
      expect({ drawn, onCanvas: width! > 0 && height! > 0 }).toEqual({ drawn: 'Empty body', onCanvas: true })
    })

    it(`${kind} preserves exact title case through soft wrapping`, () => {
      const title = 'antidisestablishmentarianism'.repeat(5)
      const source = `---\ntitle: ${JSON.stringify(title)}\n---\n${untitled(family.build(family.kRange[0], 'n'))}`
      const svg = renderMermaidSVG(source, { style: { roles: { group: { textTransform: 'capitalize' } } } })
      const drawn = [...svg.matchAll(/<text\b[^>]*\bdata-role="title"[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, ''))).join('')
      // This controlled source contains no authored hyphens or spaces; only
      // layout can introduce them. Case must remain exact.
      expect(drawn.replace(/[\s-]/g, '')).toBe(`A${title.slice(1)}`)
    })
  }
})
