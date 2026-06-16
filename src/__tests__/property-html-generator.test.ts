import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { generateHtml, type GenerateHtmlOptions } from '../../scripts/site/generate.ts'
import { samples, type Sample } from '../../scripts/site/samples-data.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

// generateHtml is async and does Bun.build internally (~1-2s per call).
// Keep numRuns low to avoid excessive build time.
const PROPERTY_RUNS = 5

const ALL_CATEGORIES = BUILTIN_FAMILY_METADATA.map(f => f.editorDiagramType)

const SITE_TOC_PREFIX_BY_FAMILY_ID = {
  architecture: 'Architecture: ',
  state: 'State: ',
  sequence: 'Sequence: ',
  class: 'Class: ',
  er: 'ER: ',
  journey: 'Journey: ',
  xychart: 'XY: ',
  pie: 'Pie: ',
  quadrant: 'Quadrant: ',
  gantt: 'Gantt: ',
} as const

/** Count how many samples match a given category set (including Hero). */
function countSamplesForCategories(cats: Set<string>): number {
  return samples.filter(s => cats.has(s.category ?? 'Other')).length
}

/** Replicate the escapeHtml logic from scripts/site/generate.ts for title matching. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ============================================================================
// 1. Default options produce valid HTML (sanity check, not property-based)
// ============================================================================

describe('HTML generator: default options', () => {
  it('has sample coverage for every built-in family category', () => {
    const categories = new Set(samples.map(s => s.category ?? 'Other'))
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect({ family: family.id, category: family.editorDiagramType, covered: categories.has(family.editorDiagramType) })
        .toEqual({ family: family.id, category: family.editorDiagramType, covered: true })
    }
  })

  it('produces valid HTML with all expected structural markers', async () => {
    const html = await generateHtml()

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    // The page embeds inline SVG icons (e.g. GitHub logo, Contents button)
    expect(html).toContain('<svg')
    expect(html).toContain('</svg>')
  }, 30_000)

  it('gives every built-in family category an explicit gallery affordance', async () => {
    const html = await generateHtml()

    for (const family of BUILTIN_FAMILY_METADATA) {
      const category = escapeHtml(family.editorDiagramType)
      const filterStart = html.indexOf(`data-filter="${category}"`)
      expect({ family: family.id, category, filterStart }).toEqual({ family: family.id, category, filterStart: expect.any(Number) })
      expect(filterStart).toBeGreaterThanOrEqual(0)
      const filterHtml = html.slice(filterStart, html.indexOf('</button>', filterStart))
      expect({ family: family.id, category, usesFallback: filterHtml.includes('background:#71717a') })
        .toEqual({ family: family.id, category, usesFallback: false })
    }
  }, 30_000)

  it('strips duplicate family prefixes from generated table-of-contents titles', async () => {
    const html = await generateHtml()

    for (const family of BUILTIN_FAMILY_METADATA) {
      const prefix = SITE_TOC_PREFIX_BY_FAMILY_ID[family.id as keyof typeof SITE_TOC_PREFIX_BY_FAMILY_ID]
      if (!prefix) continue
      const heading = `<h3>${escapeHtml(family.editorDiagramType)} (`
      const sectionStart = html.indexOf(heading)
      expect({ family: family.id, sectionStart }).toEqual({ family: family.id, sectionStart: expect.any(Number) })
      expect(sectionStart).toBeGreaterThanOrEqual(0)
      const sectionEnd = html.indexOf('</div>', sectionStart)
      const tocSection = html.slice(sectionStart, sectionEnd)
      expect({ family: family.id, duplicatePrefix: tocSection.includes(escapeHtml(prefix)) })
        .toEqual({ family: family.id, duplicatePrefix: false })
    }
  }, 30_000)
})

// ============================================================================
// 2-6. Property-based tests (random category subsets + invariant checks)
// ============================================================================

describe('HTML generator: property-based invariants', () => {

  // -- Arbitrary: random non-empty subset of real categories ----------------
  const categorySubsetArb = fc
    .subarray([...ALL_CATEGORIES], { minLength: 1 })
    .map(arr => new Set<string>(arr))

  // ---- Test 2: Category filter produces correct sample count ----------------
  it('category filter yields correct number of sample sections', async () => {
    await fc.assert(
      fc.asyncProperty(categorySubsetArb, async (cats) => {
        const html = await generateHtml({ categories: cats })

        // Count non-hero sample sections: <section class="sample" id="sample-...">
        // Hero sections use class="sample sample-hero", so we match those that
        // do NOT have "sample-hero".
        const sampleMatches = html.match(/<section class="sample" id="sample-/g) ?? []

        // Expected: all samples whose category is in the set, minus Hero
        const allMatchingSamples = samples.filter(s => cats.has(s.category ?? 'Other'))
        const heroCount = allMatchingSamples.filter(s => s.category === 'Hero').length
        const expectedNonHero = allMatchingSamples.length - heroCount

        expect(sampleMatches.length).toBe(expectedNonHero)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  }, 60_000)

  // ---- Test 3: Title override appears in output -----------------------------
  it('title override appears in the <title> tag', async () => {
    // Use safe strings that won't break HTML structure but exercise escaping
    const titleArb = fc.string({ minLength: 1, maxLength: 40 })

    await fc.assert(
      fc.asyncProperty(titleArb, async (title) => {
        // Use a small category to keep build fast
        const html = await generateHtml({
          title,
          categories: new Set(['Timeline']),
        })

        const escaped = escapeHtml(title)
        expect(html).toContain(`<title>${escaped}</title>`)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  }, 60_000)

  // ---- Test 4: Extra samples appear in output -------------------------------
  it('extra samples appear in the generated HTML', async () => {
    const extraSampleArb = fc
      .array(
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 20 })
            .filter(s => /\S/.test(s))
            .map(s => `ExtraTest_${s}`),
          description: fc.constant('Test description'),
          source: fc.constant('graph TD\n  A[X] --> B[Y]'),
          category: fc.constant('Flowchart'),
        }),
        { minLength: 1, maxLength: 3 },
      )
      .map(arr => arr as Sample[])

    await fc.assert(
      fc.asyncProperty(extraSampleArb, async (extraSamples) => {
        const html = await generateHtml({
          extraSamples,
          categories: new Set(['Flowchart']),
        })

        for (const sample of extraSamples) {
          expect(html).toContain(escapeHtml(sample.title))
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  }, 60_000)

  // ---- Test 5: No sample index gaps -----------------------------------------
  it('sample IDs are contiguous starting from 0', async () => {
    await fc.assert(
      fc.asyncProperty(categorySubsetArb, async (cats) => {
        const html = await generateHtml({ categories: cats })

        // Extract all sample IDs
        const idMatches = [...html.matchAll(/id="sample-(\d+)"/g)]
        const ids = idMatches.map(m => Number(m[1])).sort((a, b) => a - b)

        // Must be contiguous from 0
        expect(ids.length).toBeGreaterThan(0)
        for (let i = 0; i < ids.length; i++) {
          expect(ids[i]).toBe(i)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  }, 60_000)

  // ---- Test 6: Theme pills include visible themes ---------------------------
  it('visible themes appear as data-theme in inline pills', async () => {
    const themeKeys = [
      'dracula', 'solarized-light', 'nord', 'tokyo-night',
      'catppuccin-mocha', 'github-dark', 'github-light',
    ]
    const themeSubsetArb = fc
      .subarray(themeKeys, { minLength: 1 })
      .map(arr => new Set(arr))

    await fc.assert(
      fc.asyncProperty(themeSubsetArb, async (visibleThemes) => {
        const html = await generateHtml({
          visibleThemes,
          categories: new Set(['Timeline']),
        })

        // Extract the inline pills area
        const inlineStart = html.indexOf('class="theme-pills-inline"')
        const inlineEnd = html.indexOf('class="theme-more-wrapper"')
        expect(inlineStart).toBeGreaterThan(-1)
        expect(inlineEnd).toBeGreaterThan(inlineStart)

        const inlineSection = html.slice(inlineStart, inlineEnd)

        for (const theme of visibleThemes) {
          expect(inlineSection).toContain(`data-theme="${theme}"`)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  }, 60_000)
})
