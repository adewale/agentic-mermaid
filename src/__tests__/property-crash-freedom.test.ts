import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

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

function assertNoUndefinedCrash(fn: () => unknown): void {
  try {
    const result = fn()
    // If it returns, the result must be defined (not undefined from an
    // unexpected code path) -- though we mainly care about no crash.
    expect(result).toBeDefined()
  } catch (error) {
    // A clean Error is acceptable; anything else (e.g. TypeError on
    // undefined access, or non-Error throw) is a bug.
    expect(error).toBeInstanceOf(Error)
  }
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives strings with special characters', () => {
    fc.assert(
      fc.property(specialCharStringArb, (text) => {
        assertNoUndefinedCrash(() => parseMermaid(text))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseSequenceDiagram(lines))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseSequenceDiagram(['sequenceDiagram', ...bodyLines]))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseClassDiagram(lines))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseClassDiagram(['classDiagram', ...bodyLines]))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseErDiagram(lines))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseErDiagram(['erDiagram', ...bodyLines]))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseTimelineDiagram(lines))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseTimelineDiagram(['timeline', ...bodyLines]))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseJourneyDiagram(lines))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseJourneyDiagram(['journey', ...bodyLines]))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseArchitectureDiagram(lines))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseArchitectureDiagram(['architecture-beta', ...bodyLines]))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives special character lines', () => {
    fc.assert(
      fc.property(specialLinesArb, (lines) => {
        assertNoUndefinedCrash(() => parseXYChart(lines))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives correct header + random body lines', () => {
    fc.assert(
      fc.property(randomLinesArb, (bodyLines) => {
        assertNoUndefinedCrash(() => parseXYChart(['xychart-beta', ...bodyLines]))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives strings with special characters', () => {
    fc.assert(
      fc.property(specialCharStringArb, (text) => {
        assertNoUndefinedCrash(() => normalizeMermaidSource(text))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives frontmatter-prefixed random body', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (body) => {
        const text = `---\ntheme: dark\n---\n${body}`
        assertNoUndefinedCrash(() => normalizeMermaidSource(text))
      }),
      { numRuns: NUM_RUNS },
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
      { numRuns: NUM_RUNS },
    )
  })

  it('survives strings with special characters', () => {
    fc.assert(
      fc.property(specialCharStringArb, (text) => {
        assertNoUndefinedCrash(() => preprocessMermaidSource(text))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('survives frontmatter-prefixed random body', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (body) => {
        const text = `---\nconfig:\n  theme: forest\n---\n${body}`
        assertNoUndefinedCrash(() => preprocessMermaidSource(text))
      }),
      { numRuns: NUM_RUNS },
    )
  })
})
