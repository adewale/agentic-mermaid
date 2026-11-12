import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { JsonConfigAdmissionError } from '../shared/json-config-admission.ts'

import {
  mergeFrontmatterMaps,
  getFrontmatterScalar,
  getFrontmatterMap,
  normalizeMermaidSource,
  preprocessMermaidSource,
  type MermaidFrontmatterMap,
  type MermaidFrontmatterScalar,
  type MermaidConfigValue,
} from '../mermaid-source.ts'

const NUM_RUNS = 200

// Frontmatter admission refuses these two keys (parseYamlDocument →
// JsonConfigAdmissionError); every other own key, `toString` included, is data.
const BANNED_KEYS = new Set(['__proto__', 'constructor'])

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Safe key generator that avoids prototype-polluting keys. */
const safeKeyArb = (opts: { minLength: number; maxLength: number }) =>
  fc.string(opts).filter(k => !BANNED_KEYS.has(k))

/** Flat frontmatter map with mixed scalar values. */
const flatMapArb: fc.Arbitrary<MermaidFrontmatterMap> = fc.dictionary(
  safeKeyArb({ minLength: 1, maxLength: 10 }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
)

/** Two-level nested frontmatter map. */
const nestedMapArb: fc.Arbitrary<MermaidFrontmatterMap> = fc.dictionary(
  safeKeyArb({ minLength: 1, maxLength: 5 }),
  fc.dictionary(
    safeKeyArb({ minLength: 1, maxLength: 5 }),
    fc.oneof(fc.string(), fc.integer()),
  ),
)

/** Deeply nested map (5+ levels). */
function deepMapArb(depth: number): fc.Arbitrary<MermaidFrontmatterMap> {
  if (depth <= 0) {
    return fc.dictionary(
      safeKeyArb({ minLength: 1, maxLength: 5 }),
      fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
      { minKeys: 0, maxKeys: 3 },
    )
  }
  return fc.dictionary(
    safeKeyArb({ minLength: 1, maxLength: 5 }),
    fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      deepMapArb(depth - 1),
    ),
    { minKeys: 1, maxKeys: 3 },
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check that a value is a valid scalar (string, number, boolean, null). */
function isScalar(value: unknown): value is MermaidFrontmatterScalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** Check leaf-only scalar constraint: every non-object leaf is a scalar or a finite number. */
function allLeavesAreFiniteScalars(map: MermaidFrontmatterMap): boolean {
  for (const value of Object.values(map)) {
    if (value === undefined) continue
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (!allLeavesAreFiniteScalars(value)) return false
    } else if (Array.isArray(value)) {
      // Arrays are allowed; check each element
      for (const item of value) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          if (!allLeavesAreFiniteScalars(item)) return false
        } else if (typeof item === 'number' && !Number.isFinite(item)) {
          return false
        }
      }
    } else if (typeof value === 'number' && !Number.isFinite(value)) {
      return false
    }
  }
  return true
}

/** Deep equality for frontmatter maps (order-insensitive). */
function mapsEqual(a: MermaidFrontmatterMap, b: MermaidFrontmatterMap): boolean {
  const aKeys = Object.keys(a).filter(k => a[k] !== undefined).sort()
  const bKeys = Object.keys(b).filter(k => b[k] !== undefined).sort()
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false
    const av = a[aKeys[i]!]
    const bv = b[bKeys[i]!]
    if (!valuesEqual(av, bv)) return false
  }
  return true
}

function valuesEqual(a: MermaidConfigValue | undefined, b: MermaidConfigValue | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => valuesEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    return mapsEqual(a, b)
  }
  return a === b
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('property-based config merging', () => {
  it('merge idempotence: merging a config with itself produces the same config', () => {
    fc.assert(
      fc.property(flatMapArb, (a) => {
        const merged = mergeFrontmatterMaps(a, a)
        const aKeys = Object.keys(a).filter(k => a[k] !== undefined).sort()
        const mergedKeys = Object.keys(merged).filter(k => merged[k] !== undefined).sort()

        expect(mergedKeys).toEqual(aKeys)
        for (const key of aKeys) {
          expect(valuesEqual(merged[key], a[key])).toBe(true)
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('merge idempotence: nested maps merged with themselves are unchanged', () => {
    fc.assert(
      fc.property(nestedMapArb, (a) => {
        const merged = mergeFrontmatterMaps(a, a)
        expect(mapsEqual(merged, a)).toBe(true)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('merge associativity: merge(merge(a, b), c) equals merge(a, merge(b, c)) for flat maps', () => {
    fc.assert(
      fc.property(flatMapArb, flatMapArb, flatMapArb, (a, b, c) => {
        const leftAssoc = mergeFrontmatterMaps(mergeFrontmatterMaps(a, b), c)
        const rightAssoc = mergeFrontmatterMaps(a, mergeFrontmatterMaps(b, c))
        expect(mapsEqual(leftAssoc, rightAssoc)).toBe(true)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('later values win: override keys dominate in merged result', () => {
    fc.assert(
      fc.property(flatMapArb, flatMapArb, (base, override) => {
        const merged = mergeFrontmatterMaps(base, override)

        for (const [key, value] of Object.entries(override)) {
          if (value === undefined) continue
          expect(valuesEqual(merged[key], value)).toBe(true)
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('later values win: base-only keys are preserved', () => {
    fc.assert(
      fc.property(flatMapArb, flatMapArb, (base, override) => {
        const merged = mergeFrontmatterMaps(base, override)

        for (const [key, value] of Object.entries(base)) {
          if (value === undefined) continue
          if (override[key] !== undefined) continue
          // Key is only in base — it must survive the merge
          expect(valuesEqual(merged[key], value)).toBe(true)
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('type preservation: getFrontmatterScalar returns correct type for known scalars', () => {
    fc.assert(
      fc.property(flatMapArb, (map) => {
        for (const [key, value] of Object.entries(map)) {
          if (value === undefined) continue
          const result = getFrontmatterScalar(map, [key])
          if (isScalar(value)) {
            // Scalar values should be returned as-is
            expect(result).toBe(value)
          }
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('type preservation: getFrontmatterScalar returns undefined for nested maps', () => {
    fc.assert(
      fc.property(nestedMapArb, (map) => {
        for (const [key, value] of Object.entries(map)) {
          if (value === undefined) continue
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Nested maps should yield undefined
            const result = getFrontmatterScalar(map, [key])
            expect(result).toBeUndefined()
          }
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('init directive override: init directive wins over YAML frontmatter for the same key', () => {
    // Generate a key and two distinct scalar values
    const keyArb = fc.constantFrom('theme', 'fontFamily', 'useMaxWidth')
    const valueArb = fc.oneof(
      fc.constantFrom('dark', 'forest', 'neutral', 'default'),
      fc.constantFrom('Fira Code', 'Menlo', 'monospace'),
    )

    fc.assert(
      fc.property(keyArb, valueArb, valueArb, (key, yamlValue, initValue) => {
        // Build text with both YAML frontmatter and init directive
        const text = [
          '---',
          `${key}: "${yamlValue}"`,
          '---',
          `%%{init: {${key}: "${initValue}"}}%%`,
          'graph TD',
          'A --> B',
        ].join('\n')

        const result = preprocessMermaidSource(text)
        // The init directive should win
        expect(result.frontmatter[key]).toBe(initValue)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('init directive override: nested config keys in init directive override frontmatter', () => {
    const colorArb = fc.constantFrom('#111', '#222', '#333', '#444', '#555')

    fc.assert(
      fc.property(colorArb, colorArb, (yamlColor, initColor) => {
        const text = [
          '---',
          'themeVariables:',
          `  primaryColor: "${yamlColor}"`,
          '---',
          `%%{init: {"themeVariables": {"primaryColor": "${initColor}"}}}%%`,
          'graph TD',
          'A --> B',
        ].join('\n')

        const result = preprocessMermaidSource(text)
        const tv = getFrontmatterMap(result.frontmatter, ['themeVariables'])
        expect(tv).toEqual(expect.objectContaining({ primaryColor: initColor }))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('config round-trip stability: re-normalizing the stripped text keeps the body and drops the frontmatter config', () => {
    const simpleConfigArb = fc.record({
      theme: fc.option(fc.constantFrom('dark', 'forest', 'neutral'), { nil: undefined }),
      fontFamily: fc.option(fc.constantFrom('Fira Code', 'Menlo'), { nil: undefined }),
    })

    fc.assert(
      fc.property(simpleConfigArb, (configInput) => {
        const lines: string[] = []
        const yamlLines: string[] = []
        if (configInput.theme) yamlLines.push(`theme: "${configInput.theme}"`)
        if (configInput.fontFamily) yamlLines.push(`fontFamily: "${configInput.fontFamily}"`)
        if (yamlLines.length > 0) {
          lines.push('---', ...yamlLines, '---')
        }
        lines.push('graph TD', 'A --> B')

        const text = lines.join('\n')
        const first = normalizeMermaidSource(text)

        // Second call uses the output text (frontmatter stripped)
        const second = normalizeMermaidSource(first.text)

        // The first call reads exactly the generated frontmatter keys.
        const definedKeys = (config: Record<string, unknown>) => Object.keys(config).filter(k => config[k] !== undefined).sort()
        const generatedKeys = Object.keys(configInput).filter(k => configInput[k as keyof typeof configInput] !== undefined).sort()
        expect(definedKeys(first.config)).toEqual(generatedKeys)

        // The stripped text carries no frontmatter, so its config is exactly
        // that of the bare body: no frontmatter key survives or leaks.
        expect(definedKeys(second.config)).toEqual(definedKeys(normalizeMermaidSource('graph TD\nA --> B').config))

        // Body lines must be identical between first and second call
        expect(second.lines).toEqual(first.lines)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('config round-trip stability: second normalization text is identical to first', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('dark', 'forest', 'neutral'),
        fc.constantFrom('graph TD\nA --> B', 'sequenceDiagram\nA->>B: Hello'),
        (theme, body) => {
          const text = `---\ntheme: "${theme}"\n---\n${body}`
          const first = normalizeMermaidSource(text)
          const second = normalizeMermaidSource(first.text)

          // Text output is stable after first strip
          expect(second.text).toBe(first.text)
        },
      ),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('adversarial YAML: deeply nested maps (5+ levels) merge onto an empty base unchanged', () => {
    fc.assert(
      fc.property(deepMapArb(6), (map) => {
        const merged = mergeFrontmatterMaps({}, map)
        expect(mapsEqual(merged, map)).toBe(true)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('adversarial YAML: arrays where scalars expected do not crash getFrontmatterScalar', () => {
    const mapWithArraysArb = fc.dictionary(
      safeKeyArb({ minLength: 1, maxLength: 10 }),
      fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(fc.oneof(fc.string(), fc.integer()), { minLength: 0, maxLength: 5 }),
      ),
    )

    fc.assert(
      fc.property(mapWithArraysArb, (map) => {
        for (const key of Object.keys(map)) {
          // A scalar reads back as itself; an array is not a scalar.
          const value = map[key]
          expect(getFrontmatterScalar(map, [key])).toBe(Array.isArray(value) ? undefined : value)
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('adversarial YAML: very long strings (1000+ chars) are handled', () => {
    const longStringArb = fc.string({ minLength: 1000, maxLength: 2000 })

    fc.assert(
      fc.property(
        fc.dictionary(
          safeKeyArb({ minLength: 1, maxLength: 10 }),
          longStringArb,
          { minKeys: 1, maxKeys: 3 },
        ),
        (map) => {
          const merged = mergeFrontmatterMaps({}, map)
          for (const [key, value] of Object.entries(map)) {
            if (value === undefined) continue
            expect(merged[key]).toBe(value)
          }
        },
      ),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('adversarial YAML: empty strings as keys and values', () => {
    // Empty-string keys are filtered by minLength:1 in real generators,
    // but we test empty-string values explicitly
    const emptyValueMapArb = fc.dictionary(
      safeKeyArb({ minLength: 1, maxLength: 5 }),
      fc.constant(''),
      { minKeys: 1, maxKeys: 5 },
    )

    fc.assert(
      fc.property(emptyValueMapArb, (map) => {
        const merged = mergeFrontmatterMaps({}, map)
        for (const [key, value] of Object.entries(map)) {
          if (value === undefined) continue
          expect(merged[key]).toBe('')
        }
        expect(allLeavesAreFiniteScalars(merged)).toBe(true)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('adversarial YAML: unicode keys are preserved through merge', () => {
    const unicodeKeyArb = fc.oneof(
      safeKeyArb({ minLength: 1, maxLength: 10 }),
      fc.constant('\u00e9\u00e8\u00ea'),          // accented chars
      fc.constant('\u4f60\u597d'),                  // Chinese
      fc.constant('\ud83d\ude00'),                  // emoji
      fc.constant('\u0627\u0644\u0639\u0631\u0628'), // Arabic
    )

    fc.assert(
      fc.property(
        fc.dictionary(
          unicodeKeyArb,
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          { minKeys: 1, maxKeys: 5 },
        ),
        (map) => {
          const merged = mergeFrontmatterMaps({}, map)
          for (const key of Object.keys(map)) {
            if (map[key] === undefined) continue
            expect(key in merged).toBe(true)
            expect(valuesEqual(merged[key], map[key])).toBe(true)
          }
        },
      ),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('adversarial YAML: preprocessMermaidSource does not crash on hostile frontmatter', () => {
    const sources = [
      '---\na:\n  b:\n    c:\n      d:\n        e:\n          f: 1\n---\ngraph TD\nA-->B',
      '---\ntheme:\n  - dark\n  - forest\n---\ngraph TD\nA-->B',
      `---\ntheme: "${'x'.repeat(1500)}"\n---\ngraph TD\nA-->B`,
      '---\n---\ngraph TD\nA-->B',
      '---\n123: true\n456: false\n---\ngraph TD\nA-->B',
      '---\néèê: hello\n你好: world\n---\ngraph TD\nA-->B',
      '---\ntheme: null\nfontFamily: null\n---\ngraph TD\nA-->B',
    ]
    for (const text of sources) {
      const result = preprocessMermaidSource(text)
      expect(typeof result.body).toBe('string')
      expect(result.lines.length).toBeGreaterThan(0)
      expect(allLeavesAreFiniteScalars(result.frontmatter)).toBe(true)
    }
  })
})

describe('frontmatter admission refuses prototype keys at any depth', () => {
  it('a __proto__ or constructor key anywhere under config is refused by path; other keys are data', () => {
    const keyArb = fc.stringMatching(/^[a-z][A-Za-z0-9]{0,6}$/).filter(key => !BANNED_KEYS.has(key))
    fc.assert(
      fc.property(fc.array(keyArb, { maxLength: 4 }), fc.constantFrom('__proto__', 'constructor', 'toString'), (path, last) => {
        const keys = ['config', ...path, last]
        const yaml = keys.map((key, depth) => `${'  '.repeat(depth)}${key}:`).join('\n') + ' 1'
        const source = `---\n${yaml}\n---\nflowchart LR\n  A`
        if (BANNED_KEYS.has(last)) {
          expect(() => preprocessMermaidSource(source)).toThrow(JsonConfigAdmissionError)
          expect(() => preprocessMermaidSource(source)).toThrow(`$.${keys.join('.')} uses a forbidden prototype key`)
        } else {
          // The `config:` wrapper is unwrapped into the frontmatter map.
          expect(getFrontmatterScalar(preprocessMermaidSource(source).frontmatter, [...path, last])).toBe(1)
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

describe('a theme that names no Mermaid theme', () => {
  // Config is untyped JSON, so a theme value may be any type. One that is not
  // a Mermaid theme name leaves the default colors, as an unknown name does,
  // rather than failing the render.
  const THEME_NAMES = new Set(['default', 'base', 'neutral', 'dark', 'forest'])
  const word = fc.stringMatching(/^[a-z]{1,8}$/)
  type ThemeValue = string | number | boolean | null | string[] | Record<string, number>
  const notATheme: fc.Arbitrary<ThemeValue> = fc.oneof(
    word.filter(name => !THEME_NAMES.has(name)),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(word, { maxLength: 3 }),
    fc.dictionary(word, fc.integer(), { maxKeys: 2 }),
  )
  const NO_THEME = renderMermaidSVG('flowchart LR\n  A --> B')

  it('renders as no theme and verifies, whatever its type', () => {
    fc.assert(
      fc.property(notATheme, theme => {
        const source = `%%{init: ${JSON.stringify({ theme })}}%%\nflowchart LR\n  A --> B`
        expect(renderMermaidSVG(source)).toBe(NO_THEME)
        expect(verifyMermaid(source).ok).toBe(true)
      }),
      fcParameters<[ThemeValue]>({ numRuns: 40, examples: [[5], [true], [['dark']], [{ a: 1 }]] }),
    )
  })
})
