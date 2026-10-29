import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeXML } from 'entities'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import * as agentApi from '../agent/index.ts'
import { checkMermaid, describeMermaidFacts, layoutMermaid, mutate, parseRegisteredMermaid as parseMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { countStructuralElements } from '../agent/structural-count.ts'
import type { DiagramKind } from '../agent/types.ts'
import { MUTATION_OPS_BY_FAMILY } from '../cli/index.ts'
import { clearElkLayoutCache } from '../elk-instance.ts'
import type { RenderOptions } from '../types.ts'
import { FAMILY_COUNT_FIXTURES } from './helpers/family-count-fixtures.ts'
import { FAMILY_CONFORMANCE_PROFILES, type FamilyCitizenshipWitness } from './helpers/family-conformance-profiles.ts'
import { decodePng } from './helpers/png-pixels.ts'

function assertCitizen(family: DiagramKind, source: string, options: RenderOptions = {}) {
  const parsed = parseMermaid(source)
  expect(parsed.ok, `${family}: parse`).toBe(true)
  if (!parsed.ok) throw new Error(`${family}: could not parse citizenship source`)
  const diagram = parsed.value
  expect(diagram.kind, `${family}: detection`).toBe(family)
  expect(diagram.body.kind, `${family}: structured body`).toBe(family)
  const metadata = BUILTIN_FAMILY_METADATA.find(entry => entry.id === family)!
  const narrower = (agentApi as Record<string, unknown>)[metadata.narrower]
  expect(typeof narrower, `${family}: public narrower`).toBe('function')
  expect((narrower as (diagram: unknown) => unknown)(diagram), `${family}: narrowed diagram`).toBe(diagram)
  expect(MUTATION_OPS_BY_FAMILY[family].length, `${family}: editable`).toBeGreaterThan(0)
  expect(verifyMermaid(diagram, { renderOptions: options }).ok, `${family}: verify`).toBe(true)
  const serialized = serializeMermaid(diagram)
  const reparsed = parseMermaid(serialized)
  expect(reparsed.ok, `${family}: reparse`).toBe(true)
  if (!reparsed.ok) throw new Error(`${family}: could not reparse citizenship serialization`)
  expect(reparsed.value.body.kind, `${family}: round-trip structured body`).toBe(family)
  expect(serializeMermaid(reparsed.value), `${family}: stable serialization`).toBe(serialized)
  const svg = renderMermaidSVG(source, options)
  expect(svg, `${family}: SVG document`).toContain('<svg')
  const ascii = renderMermaidASCII(source, { ...options, useAscii: true, colorMode: 'none' })
  expect(ascii.trim(), `${family}: ASCII output`).not.toBe('')
  const unicode = renderMermaidASCII(source, { ...options, useAscii: false, colorMode: 'none' })
  expect(unicode.trim(), `${family}: Unicode output`).not.toBe('')
  clearElkLayoutCache()
  expect(renderMermaidSVG(source, options), `${family}: uncached SVG determinism`).toBe(svg)
  const layout = layoutMermaid(diagram, { ...options, regions: true })
  const regions = layout.regions ?? []
  const canvas = regions.find(region => region.kind === 'canvas')?.bounds
  const nodes = regions.filter(region => region.kind === 'node')
  expect(canvas, `${family}: canvas region`).toBeDefined()
  expect(nodes.length, `${family}: node regions`).toBeGreaterThan(0)
  const outside = nodes.filter(({ bounds }) => !canvas || bounds.x < canvas.x || bounds.y < canvas.y || bounds.x + bounds.w > canvas.x + canvas.w || bounds.y + bounds.h > canvas.y + canvas.h)
  expect(outside.map(region => region.id), `${family}: regions inside canvas`).toEqual([])
  clearElkLayoutCache()
  expect(layoutMermaid(diagram, { ...options, regions: true }).regions, `${family}: uncached region determinism`).toEqual(regions)
  return { diagram, reparsed: reparsed.value, layout, svg, ascii, unicode }
}

function assertMeaning(family: DiagramKind, artifact: ReturnType<typeof assertCitizen>, witness: FamilyCitizenshipWitness, editFacts: readonly string[]): void {
  for (const diagram of [artifact.diagram, artifact.reparsed]) {
    expect(countStructuralElements(diagram), `${family}: authored semantic count`).toEqual(witness.count)
    expect(checkMermaid(diagram, { include: [...witness.facts, ...editFacts] }).missing, `${family}: independently authored meaning`).toEqual([])
    witness.assertDomain?.(diagram, diagram === artifact.diagram ? artifact.layout : layoutMermaid(diagram, witness.options))
  }
  expect(describeMermaidFacts(artifact.reparsed), `${family}: no additional fact lost during serialization`).toEqual(describeMermaidFacts(artifact.diagram))
  const svgText = [...artifact.svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!
    .replace(/<tspan\b(?![^>]*\bdata-text-fragment=)[^>]*\s(?:x|dy)="[^"]*"[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ''))).join(' ').replace(/\s+/g, ' ')
  const asciiText = artifact.ascii.replace(/\s+/g, ' ')
  const unicodeText = artifact.unicode.replace(/\s+/g, ' ')
  for (const text of witness.visibleText) {
    expect(svgText, `${family}: SVG retains ${text}`).toContain(text)
    expect(asciiText, `${family}: ASCII retains ${text}`).toContain(text)
    expect(unicodeText, `${family}: Unicode retains ${text}`).toContain(text)
  }
}

describe('diagram-family citizenship (issue #41)', () => {
  test('behavioral citizenship: every family parses, verifies, renders SVG+ASCII, round-trips, and is deterministic', () => {
    const covered = new Set<DiagramKind>()
    for (const fixture of FAMILY_COUNT_FIXTURES) {
      assertCitizen(fixture.family, fixture.source)
      covered.add(fixture.family)
    }
    expect(BUILTIN_FAMILY_METADATA.filter(family => !covered.has(family.id)).map(family => family.id)).toEqual([])
  })

  for (const { id: family } of BUILTIN_FAMILY_METADATA) {
    test(`${family}: complex domain meaning survives round-trip, typed edit, and all citizenship outputs`, () => {
      // Mandatory in the existing closed profile: meaningful interacting domain
      // features cannot be replaced by a long source or a repeated simple chain.
      const witness = FAMILY_CONFORMANCE_PROFILES[family].citizenship
      const authored = assertCitizen(family, witness.source, witness.options)
      assertMeaning(family, authored, witness, witness.edit.beforeFacts)
      const originalFacts = describeMermaidFacts(authored.diagram)
      const edited = mutate(authored.diagram, witness.edit.op)
      expect(edited.ok, `${family}: representative typed edit`).toBe(true)
      if (!edited.ok) throw new Error(`${family}: ${edited.error.message}`)
      expect(describeMermaidFacts(authored.diagram), `${family}: edit leaves authored diagram unchanged`).toEqual(originalFacts)
      const changed = assertCitizen(family, serializeMermaid(edited.value), witness.options)
      assertMeaning(family, changed, witness, witness.edit.afterFacts)
      if (witness.pngGolden) {
        const expected = decodePng(readFileSync(join(import.meta.dir, 'testdata', 'stable-families', witness.pngGolden)))
        const actual = decodePng(renderMermaidPNG(witness.source, { ...witness.options, scale: 1 }))
        expect([actual.width, actual.height], `${family}: reviewed complex PNG dimensions`).toEqual([expected.width, expected.height])
        expect(Buffer.from(actual.rgba).equals(expected.rgba), `${family}: reviewed complex PNG pixels`).toBe(true)
      }
    }, 30_000)
  }
})
