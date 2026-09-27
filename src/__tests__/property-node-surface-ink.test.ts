// Property: a custom node surface never swallows the text drawn on it. The
// theme's text tones are repaired against the page and its tints, but a
// `surface` far from the page (black nodes on a white page) leaves no tone that
// reads on both, so text on a node has to be inked against the fill the node
// actually has. Every sample a family is held to (honestyCorpus) is rendered
// with the surface farthest from a light and from a dark page, then with random
// surfaces, and every drawn text is measured as drawn (rendered-text.ts), as the
// chart-honesty contract does. Seed is pinned globally (fc-seed.preload.ts).
import { beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { renderMermaidSVG } from '../index.ts'
import { honestyCorpus } from './helpers/chart-honesty.ts'
import { measureRenderedText, renderedTextReady, requiredContrast } from './helpers/rendered-text.ts'

beforeAll(() => renderedTextReady())

/** A light and a dark page, each with ink of its own. */
const PAGES = [{ bg: '#ffffff', fg: '#27272a' }, { bg: '#18181b', fg: '#fafafa' }] as const
/** Black nodes on the light page and white nodes on the dark one. */
const EXTREMES = [{ ...PAGES[0], surface: '#000000' }, { ...PAGES[1], surface: '#ffffff' }] as const
const surfaceArb = fc.integer({ min: 0, max: 0xffffff }).map(n => `#${n.toString(16).padStart(6, '0')}`)

function illegibleText(source: string, colors: { bg: string; fg: string; surface: string }): string[] {
  const census = measureRenderedText(renderMermaidSVG(source, colors))
  return census.texts
    .filter(text => text.content !== '' && text.contrast !== undefined && text.contrast < requiredContrast(text))
    .map(text => `"${text.content}" ${text.ink} on ${text.surround} is ${text.contrast!.toFixed(2)}:1`)
}

describe('text on a custom node surface', () => {
  for (const family of BUILTIN_FAMILY_METADATA) {
    const corpus = honestyCorpus(family.id)
    test(`${family.id}: every drawn text reads at WCAG AA whatever the node surface`, () => {
      for (const sample of corpus) {
        for (const colors of EXTREMES) {
          expect(illegibleText(sample.source, colors), `${sample.name} on ${JSON.stringify(colors)}`).toEqual([])
        }
      }
      fc.assert(
        fc.property(fc.constantFrom(...corpus), fc.constantFrom(...PAGES), surfaceArb, (sample, page, surface) => {
          const colors = { ...page, surface }
          expect(illegibleText(sample.source, colors), `${sample.name} on ${JSON.stringify(colors)}`).toEqual([])
        }),
        { numRuns: 8 },
      )
    }, 120_000)
  }
})
