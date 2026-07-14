// Property fuzz for the untrusted-input VALIDATORS an agent/host runs on data it did not
// author: validateStyleSpec (untrusted style JSON), validateSerializableRenderOptions
// (untrusted render options — the editor's SEC-1 choke point and the CLI/MCP option path),
// validateSceneDoc (untrusted scene), and the semver helpers. None had generated-input
// coverage. Two contracts:
//   • total + deterministic: never throw on any input; two calls agree byte-for-byte.
//   • the validator does not lie: when it reports NO problems, the input must actually be
//     usable — renderMermaidSVG must accept a clean style / clean options without throwing.
//     (A validator that green-lights an input the renderer then rejects is the real bug class.)
// Seed pinned globally (fc-seed.preload.ts); AM_FC_SEED=random hunts fresh counterexamples.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import {
  validateStyleSpec, validateSerializableRenderOptions, validateSceneDoc,
  parseSemVer, semVerSatisfies, renderMermaidSVG,
} from '../agent/index.ts'

const NUM_RUNS = 250
const SRC = 'flowchart TD\n  A[Start] --> B{Choice}\n  B --> C[End]'

function totalDeterministic<T>(fn: () => T, shape: (v: T) => void): T {
  const first = fn()
  shape(first)
  expect(JSON.stringify(fn())).toBe(JSON.stringify(first))
  return first
}

// ---------------------------------------------------------------------------
// Crash-freedom + determinism over arbitrary input.
// ---------------------------------------------------------------------------
describe('validator fuzz: total and deterministic over arbitrary input', () => {
  it('validateStyleSpec', () => {
    fc.assert(fc.property(fc.anything(), v => {
      totalDeterministic(() => validateStyleSpec(v as never), r => expect(Array.isArray(r)).toBe(true))
    }), { numRuns: NUM_RUNS })
  })

  it('validateSerializableRenderOptions', () => {
    fc.assert(fc.property(fc.anything(), v => {
      totalDeterministic(() => validateSerializableRenderOptions(v), r => expect(Array.isArray(r)).toBe(true))
    }), { numRuns: NUM_RUNS })
  })

  it('validateSceneDoc', () => {
    fc.assert(fc.property(fc.anything(), v => {
      totalDeterministic(() => validateSceneDoc(v), r => expect(typeof r.valid).toBe('boolean'))
    }), { numRuns: NUM_RUNS })
  })

  it('parseSemVer / semVerSatisfies', () => {
    const verishArb = fc.oneof(
      fc.string({ maxLength: 16 }),
      fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)).map(([a, b, c]) => `${a}.${b}.${c}`),
      fc.constantFrom('1.0.0', '^1.2.3', '~2.0', '>=1.0.0', 'x', '', '1.2.3-beta'),
    )
    fc.assert(fc.property(verishArb, verishArb, (v, range) => {
      totalDeterministic(() => parseSemVer(v), r => expect(r === undefined || typeof r === 'object').toBe(true))
      totalDeterministic(() => semVerSatisfies(v, range), r => expect(typeof r).toBe('boolean'))
    }), { numRuns: NUM_RUNS })
  })
})

// ---------------------------------------------------------------------------
// The validator does not lie: a clean verdict implies the renderer accepts it.
// ---------------------------------------------------------------------------
const colorArb = fc.oneof(
  fc.constantFrom('#123456', '#abc', '#ABCDEF', 'red', 'rgb(1,2,3)', 'transparent'),
  fc.string({ maxLength: 10 }),
)
// Sane spacings for the "does not lie" generator: bounded well under the 1,000,000-user-unit
// scene cap so a clean options object stays renderable. A padding of ~500k validates fine but
// legitimately overflows the scene-size cap (a clean typed SceneValidationError, not a lie) —
// that resource limit is not what this property is testing.
const saneNumArb = fc.integer({ min: 0, max: 2000 })

// Per-field value arbitraries for the "does not lie" generator, all within the ranges a clean
// options object must actually render for.
const RENDER_OPT_ARBS: Record<string, fc.Arbitrary<unknown>> = {
  bg: colorArb, fg: colorArb, line: colorArb, accent: colorArb, muted: colorArb, surface: colorArb, border: colorArb,
  font: fc.string({ maxLength: 16 }),
  padding: saneNumArb,
  nodeSpacing: saneNumArb,
  layerSpacing: saneNumArb,
  wrappingWidth: saneNumArb,
  componentSpacing: saneNumArb,
  seed: fc.integer(),
  transparent: fc.boolean(), interactive: fc.boolean(), shadow: fc.boolean(), compact: fc.boolean(),
  embedFontImport: fc.boolean(),
  idPrefix: fc.string({ maxLength: 8 }),
  security: fc.constantFrom('strict', 'standard'),
  // Only registered names and standalone-safe inline partials: an unregistered name / a partial
  // needing a rough backend legitimately fails render, which is not a validator lie.
  style: fc.oneof(
    fc.constantFrom('crisp', 'hand-drawn', 'dracula'),
    fc.record({ colors: fc.record({ bg: colorArb, fg: colorArb }, { requiredKeys: [] }) }),
  ),
}
const renderOptsArb = fc
  .array(fc.constantFrom(...Object.keys(RENDER_OPT_ARBS)), { maxLength: 8 })
  .chain(fields => {
    const uniq = [...new Set(fields)]
    return fc.tuple(...uniq.map(f => RENDER_OPT_ARBS[f]!)).map(values => {
      const o: Record<string, unknown> = {}
      uniq.forEach((f, i) => { o[f] = values[i] })
      return o
    })
  })

describe('validator fuzz: validateSerializableRenderOptions does not lie', () => {
  it('a clean options object renders without throwing', () => {
    let cleanSeen = 0
    fc.assert(fc.property(renderOptsArb, opts => {
      const problems = validateSerializableRenderOptions(opts)
      if (problems.length === 0) {
        cleanSeen++
        // The validator green-lit these options; the renderer MUST accept them.
        expect(() => renderMermaidSVG(SRC, opts as never)).not.toThrow()
      }
    }), { numRuns: NUM_RUNS })
    // Guard against a vacuous property: the arbitraries must produce clean options sometimes.
    expect(cleanSeen).toBeGreaterThan(0)
  })
})

const STYLE_COLOR_TOKENS = ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border']
// Standalone-renderable style fields only. Styles are composable PARTIALS: rough-backend
// fields (stroke jittered/freehand, fill solid/none, roughness, bowing, strokeWidth) are
// shape-valid on their own but "have no crisp/default backend projection" until stacked with a
// backend-activating style — an intentional, tested render-time rejection (styled-output.test.ts),
// not a validator lie. Those fields are still fuzzed through validateStyleSpec by the
// crash-freedom suite above; here we only assert the standalone-usable subset renders.
const STYLE_FIELD_ARBS: Record<string, fc.Arbitrary<unknown>> = {
  colors: fc.dictionary(fc.constantFrom(...STYLE_COLOR_TOKENS), colorArb, { maxKeys: 7 }),
  font: fc.oneof(fc.string({ maxLength: 16 }), fc.record({ family: fc.string({ maxLength: 12 }) })),
  mono: fc.boolean(),
  blurb: fc.string({ maxLength: 20 }),
}
const styleSpecArb = fc
  .array(fc.constantFrom(...Object.keys(STYLE_FIELD_ARBS)), { maxLength: 6 })
  .chain(fields => {
    const uniq = [...new Set(fields)]
    return fc.tuple(...uniq.map(f => STYLE_FIELD_ARBS[f]!)).map(values => {
      const o: Record<string, unknown> = {}
      uniq.forEach((f, i) => { o[f] = values[i] })
      return o
    })
  })

describe('validator fuzz: validateStyleSpec does not lie', () => {
  it('a clean style spec renders without throwing', () => {
    let cleanSeen = 0
    fc.assert(fc.property(styleSpecArb, spec => {
      const problems = validateStyleSpec(spec as never)
      if (problems.length === 0) {
        cleanSeen++
        expect(() => renderMermaidSVG(SRC, { style: spec as never })).not.toThrow()
      }
    }), { numRuns: NUM_RUNS })
    expect(cleanSeen).toBeGreaterThan(0)
  })
})
