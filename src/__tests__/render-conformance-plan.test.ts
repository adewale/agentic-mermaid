import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeMermaidFacts, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { renderMermaidASCII, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { getStyle, resolveStyleStack, validateStyleSpec } from '../scene/style-registry.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import {
  COMPLEXITY_STRATA,
  FAMILY_CONFORMANCE_PROFILES,
  allConformanceSources,
  collectCorpusOutliers,
} from './helpers/family-conformance-profiles.ts'
import { measureDiagramComplexity } from './helpers/diagram-complexity.ts'
import {
  BACKGROUND_POLARITIES,
  OUTPUT_FORMATS,
  SECURITY_MODES,
  buildMixedFormatConformancePlan,
  buildPairwiseAssignments,
  buildRenderConformancePlan,
  registeredLooks,
  registeredPalettes,
} from './helpers/render-conformance-plan.ts'
import {
  independentlyDerivedCoreAuthorities,
  verifyCoreConformancePlan,
  verifyMixedFormatConformancePlan,
  verifyPairwiseAssignments,
} from './helpers/render-conformance-verifier.ts'

const corePlan = buildRenderConformancePlan()
const mixedPlan = buildMixedFormatConformancePlan()
const families = BUILTIN_FAMILY_METADATA.map(entry => entry.id)

function assertSvg(svg: string, context: string): void {
  expect(svg, context).toContain('<svg')
  expect(svg, context).toContain('</svg>')
  expect(svg, context).not.toMatch(/(?:NaN|Infinity|undefined)/)
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/u.exec(svg)
  expect(viewBox, `${context}: viewBox`).not.toBeNull()
  expect(Number(viewBox![1]), `${context}: width`).toBeGreaterThan(0)
  expect(Number(viewBox![2]), `${context}: height`).toBeGreaterThan(0)
}

describe('registry-derived complexity-aware render conformance plan', () => {
  test('family registration forces exact conformance material and six structured strata', () => {
    expect(Object.keys(FAMILY_CONFORMANCE_PROFILES).sort(compareCodePointStrings)).toEqual([...families].sort(compareCodePointStrings))
    expect(Object.keys(collectCorpusOutliers()).sort(compareCodePointStrings)).toEqual([...families].sort(compareCodePointStrings))

    const measurements = new Map<string, ReturnType<typeof measureDiagramComplexity>>()
    for (const source of allConformanceSources()) {
      const parsed = parseRegisteredMermaid(source.source)
      expect(parsed.ok, source.id).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.kind, source.id).toBe(source.family)
      expect(parsed.value.body.kind, source.id).not.toBe('opaque')
      const canonical = serializeMermaid(parsed.value)
      const reparsed = parseRegisteredMermaid(canonical)
      expect(reparsed.ok, `${source.id}: canonical reparse`).toBe(true)
      if (reparsed.ok) expect(describeMermaidFacts(reparsed.value), source.id).toEqual(describeMermaidFacts(parsed.value))
      measurements.set(`${source.family}:${source.stratum}`, measureDiagramComplexity(source.source))
      if (source.stratum === 'text-stress') {
        expect(measurements.get(`${source.family}:${source.stratum}`)!.source.unicodeClasses.length, source.id).toBeGreaterThan(0)
      }
      if (source.stratum === 'corpus-outlier') expect(source.origin).toBe('eval-corpus')
    }

    for (const family of families) {
      const familyMeasurements = COMPLEXITY_STRATA.map(stratum => measurements.get(`${family}:${stratum}`)!)
      expect(familyMeasurements.every(Boolean), family).toBe(true)
      const minimal = measurements.get(`${family}:minimal`)!
      const dense = measurements.get(`${family}:dense`)!
      const structuralWork = (value: typeof minimal) => value.source.entities + value.source.relations + value.rendered.routePoints
      expect(structuralWork(dense), `${family}: dense structural work`).toBeGreaterThanOrEqual(structuralWork(minimal))
    }
  }, 30_000)

  test('exhausts the pure Look × Palette resolver authority', () => {
    let combinations = 0
    for (const look of registeredLooks()) for (const palette of registeredPalettes()) {
      const resolved = resolveStyleStack([look, palette])
      expect(resolved, `${look} × ${palette}`).toBeDefined()
      expect(validateStyleSpec(resolved), `${look} × ${palette}`).toEqual([])
      expect(resolved?.colors?.bg, `${look} × ${palette}: bg`).toBe(getStyle(palette)!.colors!.bg)
      expect(resolved?.colors?.fg, `${look} × ${palette}: fg`).toBe(getStyle(palette)!.colors!.fg)
      combinations++
    }
    expect(combinations).toBe(registeredLooks().length * registeredPalettes().length)
  })

  test('independent verification proves every pair and selected higher-strength obligation', () => {
    const verified = verifyCoreConformancePlan(corePlan)
    expect(verified.missing).toEqual([])
    expect(verified.covered).toBe(verified.required)
    const mixed = verifyMixedFormatConformancePlan(mixedPlan)
    expect(mixed.missing).toEqual([])
    expect(mixed.covered).toBe(mixed.required)

    const authorities = independentlyDerivedCoreAuthorities()
    expect(authorities.looks).toEqual(registeredLooks())
    expect(authorities.palettes).toEqual(registeredPalettes())
    expect(authorities.backends).toEqual(['default', 'hybrid', 'rough'])
    expect(authorities.palettePolarities).toEqual(['dark', 'light'])
  })

  test('is code-point deterministic and does not hide hard-coded family enrollment', () => {
    expect(buildRenderConformancePlan()).toEqual(corePlan)
    expect(buildMixedFormatConformancePlan()).toEqual(mixedPlan)
    expect(corePlan.map(row => row.id)).toEqual([...corePlan.map(row => row.id)].sort(compareCodePointStrings))
    expect(new Set(corePlan.map(row => row.family))).toEqual(new Set(families))
    expect(new Set(corePlan.map(row => row.look))).toEqual(new Set(registeredLooks()))
    expect(new Set(corePlan.map(row => row.palette))).toEqual(new Set(registeredPalettes()))
  })

  test('fake-family and removed-family sabotage is detected independently', () => {
    const domains = { family: ['alpha', 'fake'], format: ['svg', 'png'], complexity: ['minimal', 'dense'] }
    const rows = buildPairwiseAssignments(domains)
    expect(verifyPairwiseAssignments(domains, rows).missing).toEqual([])
    const sabotaged = rows.filter(row => row.family !== 'fake')
    expect(verifyPairwiseAssignments(domains, sabotaged).missing.some(id => id.includes('family=fake'))).toBe(true)

    const withoutRadar = corePlan.filter(row => row.family !== 'radar')
    expect(verifyCoreConformancePlan(withoutRadar).missing.some(id => id.includes('family=radar'))).toBe(true)
  })

  test('renders the variable-strength SVG portfolio with semantic, finite, security and palette oracles', () => {
    for (const row of corePlan) {
      const svg = renderMermaidSVG(row.source, row.options)
      assertSvg(svg, row.id)
      expect(svg, `${row.id}: palette foreground`).toContain(`--fg:${getStyle(row.palette)!.colors!.fg}`)
      if (row.background === 'transparent') expect(svg, `${row.id}: transparency`).not.toContain('data-backdrop="page"')
      if (row.security === 'strict') expect(verifyNoExternalRefs(svg), row.id).toEqual({ ok: true, refs: [] })
    }
  }, 60_000)

  test('selected family × backend rows remain byte-deterministic across rotating complexity strata', () => {
    const seen = new Set<string>()
    for (const row of corePlan) {
      const key = `${row.family}|${row.backend}`
      if (seen.has(key) || row.externalReference === 'authored') continue
      seen.add(key)
      const first = renderMermaidSVG(row.source, row.options)
      const second = renderMermaidSVG(row.source, row.options)
      expect(createHash('sha256').update(first).digest('hex'), key)
        .toBe(createHash('sha256').update(second).digest('hex'))
    }
    expect(seen.size).toBe(families.length * 3)
  }, 20_000)

  test('executes the mixed graphical/PNG/ASCII/Unicode plan', () => {
    for (const row of mixedPlan) {
      const context = `${row.id}:${row.family}:${row.format}:${row.complexity}`
      switch (row.format) {
        case 'svg': assertSvg(renderMermaidSVG(row.source, row.options), context); break
        case 'png': {
          const png = renderMermaidPNG(row.source, { ...row.options, onWarning: () => {} })
          expect([...png.slice(0, 8)], context).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
          break
        }
        case 'ascii': {
          const output = renderMermaidASCII(row.source, { ...row.options, useAscii: true, colorMode: 'none' })
          expect(output.trim().length, context).toBeGreaterThan(0)
          break
        }
        case 'unicode': {
          const output = renderMermaidASCII(row.source, { ...row.options, useAscii: false, colorMode: 'none' })
          expect(output.trim().length, context).toBeGreaterThan(0)
          break
        }
      }
    }
    expect(new Set(mixedPlan.map(row => row.format))).toEqual(new Set(OUTPUT_FORMATS))
  }, 60_000)

  test('declares exact finite domains instead of accidental values', () => {
    expect(SECURITY_MODES).toEqual(['default', 'strict'])
    expect(BACKGROUND_POLARITIES).toEqual(['opaque-dark', 'opaque-light', 'transparent'])
    expect(COMPLEXITY_STRATA).toEqual(['minimal', 'representative', 'dense', 'text-stress', 'family-risk', 'corpus-outlier'])
    expect(corePlan.length).toBeLessThan(1500)
    expect(corePlan.length).toBeGreaterThanOrEqual(registeredLooks().length * registeredPalettes().length * BACKGROUND_POLARITIES.length)
    expect(mixedPlan.length).toBeGreaterThanOrEqual(families.length * COMPLEXITY_STRATA.length)
    expect(mixedPlan.length).toBeLessThanOrEqual(180)
  })
})
