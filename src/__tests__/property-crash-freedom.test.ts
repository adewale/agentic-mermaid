import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'

import { parseMermaid } from '../parser.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { parseErDiagram } from '../er/parser.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from '../xychart/parser.ts'
import { normalizeMermaidSource, preprocessMermaidSource } from '../mermaid-source.ts'

const NUM_RUNS = 200

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary string with special characters likely to trip up parsers. */
const SPECIAL_CHARS = [
  '[', ']', '{', '}', '(', ')', '<', '>', '|', ':', ';', '-', '=',
  '.', ',', '!', '?', '@', '#', '$', '%', '^', '&', '*', '+', '~',
  '`', '"', "'", '\\', '/', '\n', '\r', '\t', ' ',
  '\u0000', '\uFFFF', '\u200B', '\u00E9', '\u2603',
]

const specialCharStringArb = fc
  .array(fc.constantFrom(...SPECIAL_CHARS), { maxLength: 80 })
  .map(chars => chars.join(''))

/** Arbitrary array of random strings (for line-based parsers). */
const randomLinesArb = fc.array(fc.string({ maxLength: 60 }), { minLength: 0, maxLength: 20 })

/** Arbitrary array of special-char strings (for line-based parsers). */
const specialLinesArb = fc.array(specialCharStringArb, { minLength: 0, maxLength: 20 })

// ---------------------------------------------------------------------------
// Helper: assert a function either returns a value or throws an Error
// ---------------------------------------------------------------------------

// The engine's own error classes. A parser reports bad input with a plain
// Error (or a subclass it defines); one of these escaping means the parser
// itself crashed: a TypeError from reading a property of undefined, a
// RangeError from runaway recursion, a ReferenceError, or a SyntaxError from a
// regex built out of input.
const ENGINE_CRASHES = [TypeError, RangeError, ReferenceError, SyntaxError] as const

function assertNoUndefinedCrash(fn: () => unknown): void {
  let outcome: { returned: unknown } | { thrown: unknown }
  try {
    outcome = { returned: fn() }
  } catch (error) {
    outcome = { thrown: error }
  }
  // Checked outside the try so a failed expectation is never mistaken for a
  // clean parser Error.
  if ('returned' in outcome) {
    // A return must be a value, not undefined from an unexpected code path.
    expect(outcome.returned).toBeDefined()
    return
  }
  const error = outcome.thrown
  // Non-Error throws are bugs too.
  expect(error).toBeInstanceOf(Error)
  const crash = ENGINE_CRASHES.find(kind => error instanceof kind)
  expect({ engineCrash: crash ? `${crash.name}: ${(error as Error).message}` : null }).toEqual({ engineCrash: null })
}

// ===========================================================================
// parseMermaid (accepts text: string)
// ===========================================================================

describe('crash-freedom: parseMermaid', () => {
  it('survives arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        assertNoUndefinedCrash(() => parseMermaid(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives strings with special characters', () => {
    fc.assert(
      fc.property(specialCharStringArb, (text) => {
        assertNoUndefinedCrash(() => parseMermaid(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body (flowchart)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('graph TD', 'graph LR', 'flowchart TD', 'flowchart LR'),
        fc.string({ maxLength: 200 }),
        (header, body) => {
          assertNoUndefinedCrash(() => parseMermaid(`${header}\n${body}`))
        },
      ),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body (state diagram)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('stateDiagram-v2', 'stateDiagram'),
        fc.string({ maxLength: 200 }),
        (header, body) => {
          assertNoUndefinedCrash(() => parseMermaid(`${header}\n${body}`))
        },
      ),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// parseSequenceDiagram (accepts lines: string[])
// ===========================================================================

describe('crash-freedom: parseSequenceDiagram', () => {
  it('survives arbitrary string arrays', () => {
    fc.assert(
      fc.property(randomLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseSequenceDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseSequenceDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseSequenceDiagram(['sequenceDiagram', ...bodyLines]))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// parseClassDiagram (accepts lines: string[])
// ===========================================================================

describe('crash-freedom: parseClassDiagram', () => {
  it('survives arbitrary string arrays', () => {
    fc.assert(
      fc.property(randomLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseClassDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseClassDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseClassDiagram(['classDiagram', ...bodyLines]))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// parseErDiagram (accepts lines: string[])
// ===========================================================================

describe('crash-freedom: parseErDiagram', () => {
  it('survives arbitrary string arrays', () => {
    fc.assert(
      fc.property(randomLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseErDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseErDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseErDiagram(['erDiagram', ...bodyLines]))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// parseTimelineDiagram (accepts lines: string[])
// ===========================================================================

describe('crash-freedom: parseTimelineDiagram', () => {
  it('survives arbitrary string arrays', () => {
    fc.assert(
      fc.property(randomLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseTimelineDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseTimelineDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseTimelineDiagram(['timeline', ...bodyLines]))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// parseJourneyDiagram (accepts lines: string[])
// ===========================================================================

describe('crash-freedom: parseJourneyDiagram', () => {
  it('survives arbitrary string arrays', () => {
    fc.assert(
      fc.property(randomLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseJourneyDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseJourneyDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseJourneyDiagram(['journey', ...bodyLines]))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// parseArchitectureDiagram (accepts lines: string[])
// ===========================================================================

describe('crash-freedom: parseArchitectureDiagram', () => {
  it('survives arbitrary string arrays', () => {
    fc.assert(
      fc.property(randomLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseArchitectureDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseArchitectureDiagram(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseArchitectureDiagram(['architecture-beta', ...bodyLines]))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// parseXYChart is source-only; frontmatter is applied as a post-parse pass.
// ===========================================================================

describe('crash-freedom: parseXYChart', () => {
  it('survives arbitrary string arrays', () => {
    fc.assert(
      fc.property(randomLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseXYChart(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseXYChart(lines))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseXYChart(['xychart-beta', ...bodyLines]))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives correct header + random body lines with random frontmatter', () => {
    const frontmatterArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean(), fc.constant(null)),
    )

    fc.assert(
      fc.property(randomLinesArb, frontmatterArb, (bodyLines, frontmatter) => {
        assertNoUndefinedCrash(() => applyXYChartFrontmatterConfig(parseXYChart(['xychart-beta', ...bodyLines]), frontmatter))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// normalizeMermaidSource (accepts text: string, baseConfig?: ...)
// ===========================================================================

describe('crash-freedom: normalizeMermaidSource', () => {
  it('survives arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        assertNoUndefinedCrash(() => normalizeMermaidSource(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives strings with special characters', () => {
    fc.assert(
      fc.property(specialCharStringArb, (text) => {
        assertNoUndefinedCrash(() => normalizeMermaidSource(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives frontmatter-prefixed random body', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (body) => {
        const text = `---\ntheme: dark\n---\n${body}`
        assertNoUndefinedCrash(() => normalizeMermaidSource(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})

// ===========================================================================
// preprocessMermaidSource (accepts text: string, baseFrontmatter?: ...)
// ===========================================================================

describe('crash-freedom: preprocessMermaidSource', () => {
  it('survives arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        assertNoUndefinedCrash(() => preprocessMermaidSource(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives strings with special characters', () => {
    fc.assert(
      fc.property(specialCharStringArb, (text) => {
        assertNoUndefinedCrash(() => preprocessMermaidSource(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('survives frontmatter-prefixed random body', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (body) => {
        const text = `---\nconfig:\n  theme: forest\n---\n${body}`
        assertNoUndefinedCrash(() => preprocessMermaidSource(text))
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })
})
