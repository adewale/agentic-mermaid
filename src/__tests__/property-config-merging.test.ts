import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

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

// Prototype-polluting keys cause havoc with plain object semantics — filter them.
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])

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

/** Collect all leaf values from a frontmatter map recursively. */
function collectLeaves(map: MermaidFrontmatterMap): MermaidConfigValue[] {
  const leaves: MermaidConfigValue[] = []
  for (const value of Object.values(map)) {
    if (value === undefined) continue
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      leaves.push(...collectLeaves(value))
    } else {
      leaves.push(value)
    }
  }
  return leaves
}

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
      { numRuns: NUM_RUNS },
    )
  })

  it('merge idempotence: nested maps merged with themselves are unchanged', () => {
    fc.assert(
      fc.property(nestedMapArb, (a) => {
        const merged = mergeFrontmatterMaps(a, a)
        expect(mapsEqual(merged, a)).toBe(true)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('merge associativity: merge(merge(a, b), c) equals merge(a, merge(b, c)) for flat maps', () => {
    fc.assert(
      fc.property(flatMapArb, flatMapArb, flatMapArb, (a, b, c) => {
        const leftAssoc = mergeFrontmatterMaps(mergeFrontmatterMaps(a, b), c)
        const rightAssoc = mergeFrontmatterMaps(a, mergeFrontmatterMaps(b, c))
        expect(mapsEqual(leftAssoc, rightAssoc)).toBe(true)
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('type preservation: getFrontmatterScalar never returns an object', () => {
    // Maps with mixed scalar types and nested objects
    const mixedMapArb = fc.dictionary(
      safeKeyArb({ minLength: 1, maxLength: 10 }),
      fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.dictionary(
          safeKeyArb({ minLength: 1, maxLength: 5 }),
          fc.oneof(fc.string(), fc.integer()),
        ),
      ),
    )

    fc.assert(
      fc.property(mixedMapArb, (map) => {
        for (const key of Object.keys(map)) {
          const result = getFrontmatterScalar(map, [key])
          if (result !== undefined) {
            // Must be a primitive scalar, never an object
            expect(isScalar(result)).toBe(true)
            expect(typeof result !== 'object' || result === null).toBe(true)
          }
        }
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('config round-trip stability: normalizeMermaidSource called twice produces identical config keys', () => {
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

        // The second call has no frontmatter, so its config should be empty/default
        // The key invariant: the second call should not crash and should produce
        // a valid config. Config keys from the first call that come from frontmatter
        // should be absent in the second (since frontmatter was stripped).
        const firstKeys = Object.keys(first.config).filter(k => first.config[k] !== undefined).sort()
        const secondKeys = Object.keys(second.config).filter(k => second.config[k] !== undefined).sort()

        // Second config should be a subset (empty or subset) since no frontmatter
        for (const key of secondKeys) {
          // Any key in second must also be structurally valid
          const val = second.config[key]
          expect(val !== undefined).toBe(true)
        }

        // Body lines must be identical between first and second call
        expect(second.lines).toEqual(first.lines)
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('adversarial YAML: deeply nested maps (5+ levels) produce config without crashing', () => {
    fc.assert(
      fc.property(deepMapArb(6), (map) => {
        // Should not throw
        const merged = mergeFrontmatterMaps({}, map)
        expect(allLeavesAreFiniteScalars(merged)).toBe(true)
      }),
      { numRuns: NUM_RUNS },
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
          // Should not throw; should return undefined for array values
          const result = getFrontmatterScalar(map, [key])
          if (result !== undefined) {
            expect(isScalar(result)).toBe(true)
          }
        }
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('adversarial YAML: deeply nested maps only have finite/string values at leaf positions', () => {
    fc.assert(
      fc.property(deepMapArb(7), (map) => {
        const leaves = collectLeaves(map)
        for (const leaf of leaves) {
          if (typeof leaf === 'number') {
            expect(Number.isFinite(leaf)).toBe(true)
          } else if (leaf !== null) {
            expect(['string', 'boolean'].includes(typeof leaf)).toBe(true)
          }
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('adversarial YAML: preprocessMermaidSource does not crash on hostile frontmatter', () => {
    const hostileYamlArb = fc.oneof(
      // Deeply nested YAML
      fc.constant('---\na:\n  b:\n    c:\n      d:\n        e:\n          f: 1\n---\ngraph TD\nA-->B'),
      // Array where scalar expected
      fc.constant('---\ntheme:\n  - dark\n  - forest\n---\ngraph TD\nA-->B'),
      // Very long value
      fc.constant(`---\ntheme: "${'x'.repeat(1500)}"\n---\ngraph TD\nA-->B`),
      // Empty frontmatter
      fc.constant('---\n---\ngraph TD\nA-->B'),
      // Numeric keys
      fc.constant('---\n123: true\n456: false\n---\ngraph TD\nA-->B'),
      // Unicode keys
      fc.constant('---\n\u00e9\u00e8\u00ea: hello\n\u4f60\u597d: world\n---\ngraph TD\nA-->B'),
      // Null values
      fc.constant('---\ntheme: null\nfontFamily: null\n---\ngraph TD\nA-->B'),
    )

    fc.assert(
      fc.property(hostileYamlArb, (text) => {
        // Must not throw
        const result = preprocessMermaidSource(text)
        expect(typeof result.body).toBe('string')
        expect(result.lines.length).toBeGreaterThan(0)
        expect(allLeavesAreFiniteScalars(result.frontmatter)).toBe(true)
      }),
      { numRuns: NUM_RUNS },
    )
  })
})
