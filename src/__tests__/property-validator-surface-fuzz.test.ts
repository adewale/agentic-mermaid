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
import { describe, expect, it, spyOn } from 'bun:test'
import fc from 'fast-check'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fcParameters } from './helpers/fc-parameters.ts'
import { runBatchLine, runCli } from '../cli/index.ts'
import { createTracingMermaid } from '../mcp/facade.ts'

import {
  validateStyleSpec, validateSerializableRenderOptions, validateSceneDoc,
  parseSemVer, semVerSatisfies, renderMermaidSVG, verifyMermaid,
} from '../agent/index.ts'
import { renderMermaidASCII } from '../index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { FAMILY_ID_SOURCES, FAMILY_LABEL_SOURCES, hostileTextArb } from './helpers/family-text-sources.ts'

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
    }), fcParameters({ numRuns: NUM_RUNS }))
  })

  it('validateSerializableRenderOptions', () => {
    fc.assert(fc.property(fc.anything(), v => {
      totalDeterministic(() => validateSerializableRenderOptions(v), r => expect(Array.isArray(r)).toBe(true))
    }), fcParameters({ numRuns: NUM_RUNS }))
  })

  it('validateSceneDoc', () => {
    fc.assert(fc.property(fc.anything(), v => {
      totalDeterministic(() => validateSceneDoc(v), r => expect(typeof r.valid).toBe('boolean'))
    }), fcParameters({ numRuns: NUM_RUNS }))
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
    }), fcParameters({ numRuns: NUM_RUNS }))
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
  it('options render on SVG and terminal exactly when the validator finds no problem', () => {
    let cleanSeen = 0
    let rejectedSeen = 0
    fc.assert(fc.property(fc.oneof(renderOptsArb, fc.dictionary(fc.constantFrom(...Object.keys(RENDER_OPT_ARBS), 'unknownField'), fc.jsonValue(), { maxKeys: 4 })), opts => {
      const problems = validateSerializableRenderOptions(opts)
      if (problems.length === 0) cleanSeen++
      else rejectedSeen++
      // Green-lit options must render; refused ones must be refused by the
      // renderers too, not silently drawn with the bad value.
      for (const render of [renderMermaidSVG, renderMermaidASCII]) {
        if (problems.length === 0) expect(() => render(SRC, opts as never)).not.toThrow()
        else expect(() => render(SRC, opts as never)).toThrow()
      }
      // Reduced counterexample: the terminal renderer silently ignored an
      // unknown key the SVG renderer refuses.
    }), fcParameters<[Record<string, unknown>]>({ numRuns: NUM_RUNS, examples: [[{ unknownField: null }]] }))
    // Guard against a vacuous property: both directions must be exercised.
    expect(cleanSeen).toBeGreaterThan(0)
    expect(rejectedSeen).toBeGreaterThan(0)
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
  it('a style spec renders exactly when the validator finds no problem', () => {
    let cleanSeen = 0
    let rejectedSeen = 0
    fc.assert(fc.property(fc.oneof(styleSpecArb, fc.dictionary(fc.constantFrom(...Object.keys(STYLE_FIELD_ARBS), 'unknownField'), fc.jsonValue(), { maxKeys: 4 })), spec => {
      const problems = validateStyleSpec(spec as never)
      if (problems.length === 0) cleanSeen++
      else rejectedSeen++
      if (problems.length === 0) expect(() => renderMermaidSVG(SRC, { style: spec as never })).not.toThrow()
      else expect(() => renderMermaidSVG(SRC, { style: spec as never })).toThrow()
    }), fcParameters({ numRuns: NUM_RUNS }))
    expect(cleanSeen).toBeGreaterThan(0)
    expect(rejectedSeen).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// verifyMermaid does not lie about renderability. The verify catalog promises
// that a clean verify proves the diagram renders, and RENDER_FAILED/
// INTERNAL_ERROR claim a render failure. Verify judges what render draws from
// the same input, so over hostile label and id text for every family: verify
// ok ⇒ render succeeds, and render succeeds ⇒ no render-failure finding.
// ---------------------------------------------------------------------------
const VERIFY_EXAMPLES: Partial<Record<string, string[]>> = {
  // Reduced counterexamples (V3, V4): a lone surrogate verified clean but did
  // not render; a sankey `%%` node and a requirement quote rendered but
  // verified as RENDER_FAILED (verify rendered the serialized form).
  packet: ['packet\n0-15: "a\uD800b"'],
  sankey: ['sankey-beta\n  "%%",B,10'],
  requirement: ['requirementDiagram\n  requirement r {\n    id: 1\n    text: a"b\n  }'],
}

describe('validator fuzz: verifyMermaid does not lie about renderability', () => {
  it.each(BUILTIN_FAMILY_METADATA.map(({ id }) => [id] as const))('%s', family => {
    const idSource = FAMILY_ID_SOURCES[family]
    const sourceArb = idSource
      ? fc.oneof(hostileTextArb.map(FAMILY_LABEL_SOURCES[family]), hostileTextArb.map(idSource))
      : hostileTextArb.map(FAMILY_LABEL_SOURCES[family])
    fc.assert(fc.property(sourceArb, source => {
      const verified = verifyMermaid(source)
      let rendered = true
      try { renderMermaidSVG(source) } catch { rendered = false }
      const claimsRenderFailure = verified.warnings.some(warning => warning.code === 'RENDER_FAILED' || warning.code === 'INTERNAL_ERROR')
      expect({ source, cleanVerifyButRefused: verified.ok && !rendered, renderFailureButDrawn: rendered && claimsRenderFailure })
        .toEqual({ source, cleanVerifyButRefused: false, renderFailureButDrawn: false })
    }), fcParameters({
      numRuns: 40,
      // A control-producing entity made verify throw instead of reporting the
      // render refusal (state, sequence, class, journey, gantt).
      examples: [...(VERIFY_EXAMPLES[family] ?? []), FAMILY_LABEL_SOURCES[family]('#1;')].map(source => [source] as [string]),
    }))
  })
})

// One admission rule for VerifyOptions.labelCharCap on every surface: a
// positive safe integer is admitted and anything else is refused with an
// error naming the option. NaN and Infinity compare false against every
// label, so admitting one silently disables LABEL_OVERFLOW. The CLI flag
// carries the value as text and a batch line as JSON, so each surface is
// asked about the value it can actually receive.
describe('validator fuzz: verify option admission agrees across library, CLI and MCP Code Mode', () => {
  const source = 'flowchart LR\n  A'
  const file = join(mkdtempSync(join(tmpdir(), 'am-verify-options-')), 'diagram.mmd')
  writeFileSync(file, source)
  const admits = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) > 0
  const refusal = (verify: () => unknown): string | undefined => {
    try { verify(); return undefined } catch (error) { return error instanceof Error ? error.message : String(error) }
  }
  const verdict = (message: string | undefined): string => message === undefined ? 'admitted' : /labelCharCap/.test(message) ? 'refused' : message
  const cli = (argv: string[]): number => {
    const out = spyOn(process.stdout, 'write').mockImplementation(() => true), err = spyOn(process.stderr, 'write').mockImplementation(() => true)
    try { return runCli(argv) as number } finally { out.mockRestore(); err.mockRestore() }
  }
  const capArb = fc.oneof(
    fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -0, -1, 1, 1.5, 0.5, 1e300, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 2 ** 53 + 2),
    fc.integer({ min: -1_000, max: 1_000 }),
    fc.double(),
    fc.constantFrom<unknown>(null, '40', true, [40], {}),
  )

  it('labelCharCap is admitted exactly when it is a positive safe integer, by every surface', () => {
    const mcp = createTracingMermaid()
    fc.assert(fc.property(capArb, cap => {
      const json: unknown = JSON.parse(JSON.stringify({ cap })).cap
      const batch = runBatchLine(JSON.stringify({ op: 'verify', source, options: { labelCharCap: json } }))
      const flag = typeof cap === 'number' ? String(cap) : undefined
      expect({
        cap: String(cap),
        library: verdict(refusal(() => verifyMermaid(source, { labelCharCap: cap as number }))),
        codeMode: verdict(refusal(() => mcp.verifyMermaid(source, { labelCharCap: cap as number }))),
        batch: batch.ok || batch.error?.code === 'VERIFY_FAILED' ? 'admitted' : batch.error?.code === 'INVALID_OPTIONS' && /labelCharCap/.test(batch.error.message) ? 'refused' : batch.error?.code,
        ...(flag === undefined ? {} : { flag: cli(['verify', file, '--label-cap', flag]) === 2 ? 'refused' : 'admitted' }),
      }).toEqual({
        cap: String(cap),
        library: admits(cap) ? 'admitted' : 'refused',
        codeMode: admits(cap) ? 'admitted' : 'refused',
        batch: json === undefined || admits(json) ? 'admitted' : 'refused',
        ...(flag === undefined ? {} : { flag: admits(cap) ? 'admitted' : 'refused' }),
      })
    }), fcParameters<[unknown]>({ numRuns: 60, examples: [[Number.NaN], [Infinity], [-1], [0], [1.5], [1e300], [Number.MAX_SAFE_INTEGER + 1]] }))
  })
})
