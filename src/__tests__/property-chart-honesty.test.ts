// Chart honesty for generated diagrams (docs/design/system/chart-honesty.md):
// every family, built at random sizes by its metamorphic generator and given a
// random frontmatter title, draws that title and all of its text legibly and on
// the canvas, in a random style. The corpus tests (chart-honesty-text-*.test.ts)
// hold fixed sources to every style; this varies the structure and the title.
import { beforeAll, describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeViolations, HONESTY_STYLES, textHonestyViolations } from './helpers/chart-honesty.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { renderedTextReady } from './helpers/rendered-text.ts'

beforeAll(() => renderedTextReady())

const WORDS = ['Quarterly', 'revenue', 'by', 'region', 'and', 'channel', 'for', 'the', 'North', 'American', 'market', 'forecast'] as const
const titleArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 14 }).map(words => words.join(' '))

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
          const sample = { name: `k=${k}`, source: `---\ntitle: ${title}\n---\n${untitled(family.build(k, 'n'))}`, expectText: [title] }
          expect(describeViolations(kind, sample, textHonestyViolations(sample, [style]))).toEqual([])
        }),
        { numRuns: 6 },
      )
    }, 120_000)
  }
})
