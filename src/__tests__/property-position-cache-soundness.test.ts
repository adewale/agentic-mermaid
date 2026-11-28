// The position cache may only skip work, never change a drawing. Its key is
// assembled from the request's identity; any input that changes layout or
// paint but is missing from that key lets an earlier render answer a later,
// different request. Compare every cached render in a request sequence with
// the same request rendered with the position cache disabled, across every
// registered family's canonical example and the axes a key could forget: the
// requested output (SVG, terminal text or the agent layout JSON, which resolve
// paint differently from equal options), paint style, spacing, wrapping, font
// and quality options, and theme, look and family config in the frontmatter.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import type { RenderOptions } from '../types.ts'

const examples = BUILTIN_FAMILY_METADATA.flatMap(family => family.example ? [{ id: family.id, source: family.example }] : [])

const variant = fc.record({
  output: fc.constantFrom('svg', 'ascii', 'layout'),
  style: fc.constantFrom(undefined, 'crisp', 'hand-drawn', 'watercolor'),
  padding: fc.constantFrom(undefined, 12, 48),
  nodeSpacing: fc.constantFrom(undefined, 70),
  layerSpacing: fc.constantFrom(undefined, 90),
  wrappingWidth: fc.constantFrom(undefined, 80),
  font: fc.constantFrom(undefined, 'Georgia'),
  quality: fc.constantFrom(undefined, 'balanced' as const),
  frontmatter: fc.constantFrom('', 'theme: dark', 'flowchart:\n    nodeSpacing: 90\n    rankSpacing: 90', 'look: handDrawn'),
})
type Variant = typeof variant extends fc.Arbitrary<infer T> ? T : never
type Axis = keyof Variant
const AXES = ['output', 'style', 'padding', 'nodeSpacing', 'layerSpacing', 'wrappingWidth', 'font', 'quality', 'frontmatter'] as const satisfies readonly Axis[]

// A forgotten key term only collides when two requests differ in that term
// alone, and only in the order that lets one fill the entry the other reads.
// Each change therefore alters one axis of the first request and returns to it.
const requests = fc.tuple(variant, fc.array(fc.tuple(fc.constantFrom(...AXES), variant), { minLength: 1, maxLength: 3 }))
  .map(([first, changes]) => [first, ...changes.flatMap(([axis, other]) => [{ ...first, [axis]: other[axis] } as Variant, first])])

function request(source: string, value: Variant): { text: string; options: RenderOptions } {
  const options: RenderOptions = {}
  if (value.style) options.style = value.style
  if (value.padding !== undefined) options.padding = value.padding
  if (value.nodeSpacing !== undefined) options.nodeSpacing = value.nodeSpacing
  if (value.layerSpacing !== undefined) options.layerSpacing = value.layerSpacing
  if (value.wrappingWidth !== undefined) options.wrappingWidth = value.wrappingWidth
  if (value.font) options.font = value.font
  if (value.quality) options.graphLayout = { quality: value.quality }
  // Examples carry no frontmatter of their own; a config block is prepended.
  const text = value.frontmatter && !source.startsWith('---') ? `---\nconfig:\n  ${value.frontmatter}\n---\n${source}` : source
  return { text, options }
}

let previous: string | undefined
beforeAll(() => {
  previous = process.env.AGENTIC_MERMAID_ELK_CACHE
  process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
})
afterAll(() => {
  if (previous === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE
  else process.env.AGENTIC_MERMAID_ELK_CACHE = previous
})

test('a cached render equals the uncached render of the same request', () => {
  expect(examples.length).toBeGreaterThan(0)
  fc.assert(fc.property(fc.constantFrom(...examples), requests, (example, sequence) => {
    for (const value of sequence) {
      const { text, options } = request(example.source, value)
      const outcome = (cache: boolean) => {
        try {
          return withPerformanceExperiments(cache ? ['text-spans', 'position-cache'] : ['text-spans'],
            () => value.output === 'ascii' ? renderMermaidASCII(text, options)
              : value.output === 'layout' ? JSON.stringify(layoutMermaidWithReceipt(text, options).layout) : renderMermaidSVG(text, options))
        } catch (error) {
          return `error: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      const uncached = outcome(false)
      expect(outcome(true), `${example.id} ${JSON.stringify(value)}`).toBe(uncached)
    }
  }), fcParameters({ numRuns: 40 }))
}, 120_000)
